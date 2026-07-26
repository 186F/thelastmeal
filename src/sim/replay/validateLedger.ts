import { ledgerFileSchema, type LedgerFile } from '../../shared/ledgerFile';
import type { ValidationIssue } from '../../shared/validation';
import { CONFIG_VERSION, EXPERIMENT_ID, SCHEMA_VERSION } from '../../shared/versions';
import { validateEventExact } from '../events/eventSchemas';
import { checkScenarioExpectations, checkStructuralInvariants } from '../invariants';
import { buildFinalSummary } from '../reporting';
import { SCENARIOS } from '../scenarios/definitions';
import { canonicalLedgerHash } from './ledgerHash';
import { replayLedger } from './replay';

/**
 * Imported-ledger validation (remediation 3): all-or-nothing.
 *
 * A file is accepted ONLY after the complete sequence passes:
 *   1. JSON parse
 *   2. ledger-file envelope schema
 *   3. exact per-event payload schema for every event
 *   4. ordering and reference integrity (sequence, ID counters, ticks,
 *      start/end framing, causation/correlation, action and decision
 *      lifecycle references)
 *   5. isolated reducer replay into a fresh state (a reducer throw is an
 *      import error here, never a later replay surprise)
 *   6. structural invariants on the replayed result (scenario EXPECTATION
 *      codes are reported as warnings — a genuine ledger from a different
 *      provider may legitimately differ behaviorally without being corrupt)
 *   7. recomputed semantic world-state hash vs file + ScenarioEnded payload
 *   8. recomputed canonical ledger hash vs file
 *   9. final summary rebuilt from the replayed state vs file, field by field
 *
 * Failures carry forensic detail (event ID, computed vs expected values,
 * reducer message) so a rejected import localizes its own divergence.
 *
 * Tamper-model limitation (documented): this proves INTERNAL CONSISTENCY,
 * not authorship. A party who recomputes every unsigned field produces a
 * file this validator accepts; cryptographic signing is outside this task.
 */

export interface LedgerValidation {
  ok: boolean;
  issues: ValidationIssue[];
  file: LedgerFile | null;
}

export function validateLedgerFile(text: string): LedgerValidation {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, where: string | null = null): void => {
    issues.push({ severity: 'error', code, message, where });
  };
  const warn = (code: string, message: string, where: string | null = null): void => {
    issues.push({ severity: 'warning', code, message, where });
  };
  const failed = (): boolean => issues.some((i) => i.severity === 'error');

  // 1. JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    err('invalid-json', `File is not valid JSON: ${(e as Error).message}`);
    return { ok: false, issues, file: null };
  }

  // 2. File envelope schema (strict). Old format versions are rejected here
  // explicitly — never silently reinterpreted.
  const maybeVersion = (parsed as { formatVersion?: unknown })?.formatVersion;
  if (typeof maybeVersion === 'number' && maybeVersion === 1) {
    err(
      'unsupported-format-version',
      'This file uses ledger format 1 (finalStateHash, schema 1). Format 1 exports are not supported by this build; re-export from a current run.',
    );
    return { ok: false, issues, file: null };
  }
  const result = ledgerFileSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues.slice(0, 20)) {
      err('schema-violation', issue.message, issue.path.join('.'));
    }
    return { ok: false, issues, file: null };
  }
  const file = result.data as LedgerFile;

  if (file.experimentId !== EXPERIMENT_ID) {
    err('wrong-experiment', `Expected experiment ${EXPERIMENT_ID}, got ${file.experimentId}`);
  }
  if (file.scenario.configVersion !== CONFIG_VERSION) {
    err(
      'config-version-mismatch',
      `Ledger was produced with config ${file.scenario.configVersion}; this build is ${CONFIG_VERSION}`,
    );
  }
  const scenario = SCENARIOS[file.scenario.id];
  if (!scenario) {
    err('unknown-scenario', `Unknown scenario ${file.scenario.id}`);
  } else {
    if (scenario.version !== file.scenario.version) {
      err(
        'scenario-version-mismatch',
        `Scenario ${file.scenario.id} is version ${scenario.version} here, file has ${file.scenario.version}`,
      );
    }
    if (scenario.seed !== file.scenario.seed) {
      err(
        'seed-mismatch',
        `Scenario ${file.scenario.id} uses seed ${scenario.seed}, file has ${file.scenario.seed}`,
      );
    }
  }
  if (failed()) return { ok: false, issues, file: null };

  // 3. Exact per-event schemas.
  let exactErrors = 0;
  file.events.forEach((event, index) => {
    if (exactErrors >= 20) return;
    const problem = validateEventExact(event);
    if (problem !== null) {
      exactErrors += 1;
      err('event-payload-invalid', problem, `events[${index}] ${event.id} (${event.type})`);
    }
  });
  if (failed()) return { ok: false, issues, file: null };

  // 4. Ordering and reference integrity.
  validateOrderingAndReferences(file, err);
  if (failed()) return { ok: false, issues, file: null };

  // 5. Isolated replay. The replay builds its own fresh initial state from
  // the local scenario definition; nothing here can touch a live run.
  let replayed: ReturnType<typeof replayLedger>;
  try {
    replayed = replayLedger(file.scenario.id, file.events);
  } catch (e) {
    err(
      'replay-aborted',
      `Reducer rejected the event stream during import replay: ${(e as Error).message}`,
    );
    return { ok: false, issues, file: null };
  }

  // 6. Invariants on the replayed result: structural codes are errors,
  // scenario expectation codes are warnings.
  for (const violation of checkStructuralInvariants(file.events, replayed.state)) {
    err('structural-invariant-violated', violation);
  }
  if (scenario) {
    for (const violation of checkScenarioExpectations(scenario, file.events)) {
      warn('scenario-expectation-differs', violation);
    }
  }

  // 7. Semantic world-state hash: recomputed from the replayed state, and
  // cross-checked against both the file metadata and the ScenarioEnded
  // payload.
  if (replayed.worldStateHash !== file.worldStateHash) {
    err(
      'world-hash-mismatch',
      `Recomputed worldStateHash ${replayed.worldStateHash} != file worldStateHash ${file.worldStateHash}`,
    );
  }
  if (
    replayed.recordedWorldStateHash !== null &&
    replayed.recordedWorldStateHash !== file.worldStateHash
  ) {
    err(
      'hash-mismatch-in-file',
      `ScenarioEnded payload hash ${replayed.recordedWorldStateHash} != file worldStateHash ${file.worldStateHash}`,
    );
  }

  // 8. Canonical ledger hash recomputed from the events themselves.
  const recomputedLedgerHash = canonicalLedgerHash(file.events);
  if (recomputedLedgerHash !== file.canonicalLedgerHash) {
    err(
      'ledger-hash-mismatch',
      `Recomputed canonicalLedgerHash ${recomputedLedgerHash} != file canonicalLedgerHash ${file.canonicalLedgerHash}`,
    );
  }

  // 9. Final summary rebuilt from the replayed state, field by field.
  try {
    const rebuilt = buildFinalSummary(replayed.state, file.events);
    const recorded = file.finalSummary as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(rebuilt)) {
      if (recorded[key] !== value) {
        err(
          'summary-mismatch',
          `finalSummary.${key}: file has ${String(recorded[key])}, replay computes ${String(value)}`,
        );
      }
    }
  } catch (e) {
    err('summary-rebuild-failed', (e as Error).message);
  }

  const ok = !failed();
  return { ok, issues, file: ok ? file : null };
}

function validateOrderingAndReferences(
  file: LedgerFile,
  err: (code: string, message: string, where?: string | null) => void,
): void {
  let lastTick = -1;
  let endedSeen = false;
  let canonicalCount = 0;
  let markerCount = 0;
  const seenEventIds = new Set<string>();
  const proposedActionIds = new Set<string>();
  const startedActionIds = new Set<string>();
  const requestedDecisionIds = new Set<string>();
  const resolvedDecisionIds = new Set<string>();
  const createdCommitmentIds = new Set<string>();

  file.events.forEach((event, index) => {
    if (event.seq !== index) {
      err('sequence-gap', `Event at index ${index} has seq ${event.seq}`, event.id);
    }
    const isMarker = event.type === 'SimulationPaused' || event.type === 'SimulationResumed';
    const expectedId = isMarker
      ? `evt-op-${String(markerCount).padStart(4, '0')}`
      : `evt-${String(canonicalCount).padStart(6, '0')}`;
    if (isMarker) markerCount += 1;
    else canonicalCount += 1;
    if (event.id !== expectedId) {
      err('id-mismatch', `Event at seq ${index} has id ${event.id}, expected ${expectedId}`);
    }
    if (event.schemaVersion !== SCHEMA_VERSION) {
      err('event-schema-version', `Event ${event.id} has schema ${event.schemaVersion}`);
    }
    if (event.tick < lastTick) {
      err('tick-regression', `Event ${event.id} tick ${event.tick} < previous ${lastTick}`);
    }
    lastTick = event.tick;
    if (endedSeen) {
      err('events-after-end', `Event ${event.id} appears after ScenarioEnded`);
    }
    if (index > 0 && event.type === 'ScenarioStarted') {
      err('duplicate-scenario-started', `Second ScenarioStarted at ${event.id}`);
    }
    if (event.type === 'ScenarioEnded') {
      endedSeen = true;
    }

    // Causation must reference an earlier canonical event.
    if (event.causationId !== null && !seenEventIds.has(event.causationId)) {
      err(
        'dangling-causation',
        `Event ${event.id} causationId ${event.causationId} does not reference an earlier event`,
      );
    }

    const payload = event.payload as Record<string, unknown>;

    // Correlation consistency: when an event carries a non-null actionId in
    // its payload and a correlation ID, the two must agree.
    if (
      event.correlationId !== null &&
      typeof payload.actionId === 'string' &&
      payload.actionId !== event.correlationId
    ) {
      err(
        'correlation-mismatch',
        `Event ${event.id} correlationId ${event.correlationId} != payload.actionId ${String(payload.actionId)}`,
      );
    }

    // Actor/target agreement with payload IDs where the engine defines both.
    const npcPayload = payload.npcId;
    if (typeof npcPayload === 'string' && event.actorId !== null && event.actorId !== npcPayload) {
      // InjuryOccurred / InjuryWorsened carry the patient in targetId.
      if (event.type !== 'InjuryOccurred' && event.type !== 'InjuryWorsened') {
        err(
          'actor-payload-mismatch',
          `Event ${event.id} actorId ${event.actorId} != payload.npcId ${npcPayload}`,
        );
      }
    }
    if (
      (event.type === 'InjuryOccurred' || event.type === 'InjuryWorsened') &&
      event.targetId !== npcPayload
    ) {
      err('target-payload-mismatch', `Event ${event.id} targetId != payload.npcId`);
    }

    // Action lifecycle references.
    switch (event.type) {
      case 'ActionProposed': {
        proposedActionIds.add(payload.actionId as string);
        break;
      }
      case 'ActionStarted': {
        const actionId = payload.actionId as string;
        const scripted =
          event.tick === 0 && String(payload.affordanceId ?? '').startsWith('scripted:');
        if (!proposedActionIds.has(actionId) && !scripted) {
          err(
            'action-started-without-proposal',
            `ActionStarted ${event.id} references unproposed action ${actionId}`,
          );
        }
        startedActionIds.add(actionId);
        break;
      }
      case 'ActionCompleted':
      case 'ActionInterrupted': {
        const actionId = payload.actionId as string;
        if (!startedActionIds.has(actionId)) {
          err(
            'action-lifecycle-without-start',
            `${event.type} ${event.id} references unstarted action ${actionId}`,
          );
        }
        break;
      }
      case 'ActionRejected': {
        const actionId = payload.actionId as string | null;
        if (actionId !== null && !proposedActionIds.has(actionId)) {
          err(
            'action-rejected-without-proposal',
            `ActionRejected ${event.id} references unproposed action ${actionId}`,
          );
        }
        break;
      }
      case 'DecisionRequested': {
        const requestId = payload.requestId as string;
        if (requestedDecisionIds.has(requestId)) {
          err('duplicate-decision-request', `Request ${requestId} requested twice`, event.id);
        }
        requestedDecisionIds.add(requestId);
        break;
      }
      case 'DecisionResponseAccepted':
      case 'DecisionRequestExpired':
      case 'DecisionRequestSuperseded': {
        const requestId = payload.requestId as string;
        if (!requestedDecisionIds.has(requestId)) {
          err(
            'decision-resolution-without-request',
            `${event.type} ${event.id} references unknown request ${requestId}`,
          );
        }
        if (resolvedDecisionIds.has(requestId)) {
          err(
            'contradictory-decision-outcomes',
            `Request ${requestId} resolved more than once (${event.type} at ${event.id})`,
          );
        }
        resolvedDecisionIds.add(requestId);
        break;
      }
      case 'DecisionProviderFailed':
      case 'FallbackDecisionUsed': {
        const requestId = payload.requestId as string;
        if (!requestedDecisionIds.has(requestId)) {
          err(
            'decision-diagnostic-without-request',
            `${event.type} ${event.id} references unknown request ${requestId}`,
          );
        }
        break;
      }
      case 'CommitmentCreated': {
        createdCommitmentIds.add(payload.commitmentId as string);
        break;
      }
      case 'CommitmentRenegotiationProposed':
      case 'CommitmentRenegotiationAccepted':
      case 'CommitmentRenegotiationRejected':
      case 'CommitmentFulfilled':
      case 'CommitmentBroken': {
        const commitmentId = payload.commitmentId as string;
        if (!createdCommitmentIds.has(commitmentId)) {
          err(
            'unknown-commitment-reference',
            `${event.type} ${event.id} references uncreated commitment ${commitmentId}`,
          );
        }
        break;
      }
      default:
        break;
    }

    seenEventIds.add(event.id);
  });

  if (file.events.length === 0) {
    err('empty-ledger', 'Ledger contains no events');
  } else {
    if (file.events[0]!.type !== 'ScenarioStarted') {
      err('missing-scenario-started', 'First event must be ScenarioStarted');
    }
    if (!endedSeen) {
      err('missing-scenario-ended', 'Ledger has no ScenarioEnded event');
    }
  }
  if (file.finalSummary.eventCount !== file.events.length) {
    err(
      'event-count-mismatch',
      `finalSummary.eventCount ${file.finalSummary.eventCount} != events.length ${file.events.length}`,
    );
  }
}
