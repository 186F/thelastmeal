import { ledgerFileSchema, type LedgerFile } from '../../shared/ledgerFile';
import type { EventEnvelope } from '../../shared/events';
import { MODE_TO_CATEGORY, type ActionCategory, type ActionMode } from '../../shared/ids';
import type { ValidationIssue } from '../../shared/validation';
import { CONFIG_VERSION, EXPERIMENT_ID, SCHEMA_VERSION } from '../../shared/versions';
import { FALLBACK_PROVIDER_ID } from '../decisions/fallbackProvider';
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
 *   5. semantic cross-checks (re-audit finding 2): file metadata reconciled
 *      with the ScenarioStarted payload; per-type envelope actor/target
 *      reconciled with payload identities; the full decision lifecycle
 *      joined (accepted/rejected -> received -> requested: existence,
 *      field agreement, offered-set membership, provider authorization with
 *      the engine-owned fallback carve-out); accepted -> ActionProposed
 *      descriptor equality with the original offer; MODE_TO_CATEGORY
 *      agreement everywhere a mode/category pair appears
 *   6. isolated reducer replay into a fresh state (a reducer throw is an
 *      import error here, never a later replay surprise)
 *   7. structural invariants on the replayed result (scenario EXPECTATION
 *      codes are reported as warnings — a genuine ledger from a different
 *      provider may legitimately differ behaviorally without being corrupt)
 *   8. recomputed semantic world-state hash vs file + ScenarioEnded payload
 *   9. recomputed canonical ledger hash vs file
 *  10. final summary rebuilt from the replayed state vs file, field by field
 *
 * Failures carry forensic detail (event ID, computed vs expected values,
 * reducer message) so a rejected import localizes its own divergence.
 *
 * Tamper-model limitation (documented): this proves INTERNAL CONSISTENCY,
 * not authorship. A party who recomputes every unsigned field produces a
 * file this validator accepts ONLY if the file is fully lifecycle-coherent;
 * cryptographic signing is outside this task.
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

  // 5. Semantic cross-checks (re-audit finding 2).
  validateSemanticConsistency(file, err);
  if (failed()) return { ok: false, issues, file: null };

  // 6. Isolated replay. The replay builds its own fresh initial state from
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

  // 7. Invariants on the replayed result: structural codes are errors,
  // scenario expectation codes are warnings.
  for (const violation of checkStructuralInvariants(file.events, replayed.state)) {
    err('structural-invariant-violated', violation);
  }
  if (scenario) {
    for (const violation of checkScenarioExpectations(scenario, file.events)) {
      warn('scenario-expectation-differs', violation);
    }
  }

  // 8. Semantic world-state hash: recomputed from the replayed state, and
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

  // 9. Canonical ledger hash recomputed from the events themselves.
  const recomputedLedgerHash = canonicalLedgerHash(file.events);
  if (recomputedLedgerHash !== file.canonicalLedgerHash) {
    err(
      'ledger-hash-mismatch',
      `Recomputed canonicalLedgerHash ${recomputedLedgerHash} != file canonicalLedgerHash ${file.canonicalLedgerHash}`,
    );
  }

  // 10. Final summary rebuilt from the replayed state, field by field.
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
  // An action can legally END while still in its 'moving' phase: the reducer
  // installs currentAction on MovementStarted, and scenario end or injury
  // worsening interrupts it before ActionStarted is ever emitted.
  const movingActionIds = new Set<string>();
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
      case 'MovementStarted': {
        movingActionIds.add(payload.actionId as string);
        break;
      }
      case 'ActionCompleted':
      case 'ActionInterrupted': {
        const actionId = payload.actionId as string;
        const interruptedInTransit =
          event.type === 'ActionInterrupted' && movingActionIds.has(actionId);
        if (!startedActionIds.has(actionId) && !interruptedInTransit) {
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

// ---------------------------------------------------------------------------
// Step 5: semantic cross-checks (re-audit finding 2)
// ---------------------------------------------------------------------------

/**
 * Per-type envelope expectations: which payload field the engine copies into
 * actorId/targetId at emit time. `actorId === null` is tolerated everywhere —
 * scripted/world-originated events (injury, scripted removal and release)
 * legitimately carry a null actor — and a null targetId is likewise
 * tolerated, so the checks catch SWAPPED or fabricated identities without
 * ever rejecting genuine engine output. Events whose payload carries `npcId`
 * are already covered by the generic actor==npcId rule in step 4; this table
 * covers exactly the families that carry no `npcId`.
 */
const ENVELOPE_EXPECTATIONS: Record<
  string,
  (p: Record<string, unknown>) => { actor?: unknown; target?: unknown }
> = {
  TreatmentStarted: (p) => ({ actor: p.healerId, target: p.patientId }),
  TreatmentCompleted: (p) => ({ actor: p.healerId, target: p.patientId }),
  ResourceReserved: (p) => ({ actor: p.holderNpcId, target: p.resourceId }),
  ReservationReleased: (p) => ({ actor: p.previousHolderNpcId, target: p.resourceId }),
  ResourceRemoved: (p) => ({ target: p.resourceId }),
  MealConsumed: (p) => ({ actor: p.npcId, target: p.resourceId }),
  OwnershipViolated: (p) => ({ actor: p.actorId, target: p.ownerNpcId }),
  ReservationTransferRequested: (p) => ({ actor: p.requesterNpcId, target: p.ownerNpcId }),
  ReservationTransferred: (p) => ({ actor: p.fromNpcId, target: p.toNpcId }),
  ReservationTransferRefused: (p) => ({ actor: p.ownerNpcId, target: p.requesterNpcId }),
  CommitmentCreated: (p) => ({ actor: p.debtorId, target: p.creditorId }),
  CommitmentRenegotiationProposed: (p) => ({ actor: p.proposedByNpcId, target: p.commitmentId }),
  CommitmentRenegotiationAccepted: (p) => ({ actor: p.acceptedByNpcId, target: p.commitmentId }),
  CommitmentRenegotiationRejected: (p) => ({ actor: p.rejectedByNpcId, target: p.commitmentId }),
  // CommitmentFulfilled/Broken carry no NPC payload field (the actor is the
  // debtor from state), so only the commitment target is checkable.
  CommitmentFulfilled: (p) => ({ target: p.commitmentId }),
  CommitmentBroken: (p) => ({ target: p.commitmentId }),
  RelationshipChanged: (p) => ({ actor: p.fromNpcId, target: p.toNpcId }),
  HelpRequested: (p) => ({ actor: p.fromNpcId, target: p.toNpcId }),
  // ReliefRequested is emitted with a null envelope target by design.
  ReliefRequested: (p) => ({ actor: p.fromNpcId }),
  TaskCompleted: (p) => ({ target: p.taskId }),
  TaskDeadlineMissed: (p) => ({ target: p.taskId }),
  PerceptionRecorded: (p) => ({ actor: p.npcId, target: p.sourceEventId }),
};

interface RequestRecord {
  npcId: unknown;
  providerId: unknown;
  offeredIds: Set<string>;
  offeredById: Map<string, Record<string, unknown>>;
}

interface ReceivedRecord {
  responseId: unknown;
  requestId: unknown;
  npcId: unknown;
  providerId: unknown;
  selectedAffordanceId: unknown;
  confidenceBp: unknown;
  reasonCode: unknown;
}

/** Offer field -> ActionProposed descriptor field, for the exact-descriptor
 * join (the descriptor renames three fields and drops the transient ones). */
const OFFER_TO_DESCRIPTOR: ReadonlyArray<[string, string]> = [
  ['id', 'affordanceId'],
  ['actorId', 'npcId'],
  ['category', 'category'],
  ['mode', 'mode'],
  ['targetNpcId', 'targetNpcId'],
  ['targetResourceId', 'targetResourceId'],
  ['requiredLocationId', 'locationId'],
  ['durationTicks', 'durationTicks'],
  ['stateVersion', 'stateVersion'],
  ['interruptible', 'interruptible'],
  ['violation', 'violation'],
  ['commitmentId', 'commitmentId'],
  ['proposalId', 'proposalId'],
  ['requestId', 'requestId'],
];

function termsEqual(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const ta = a as Record<string, unknown>;
  const tb = b as Record<string, unknown>;
  return (
    ta.startTick === tb.startTick &&
    ta.graceTick === tb.graceTick &&
    ta.minDurationTicks === tb.minDurationTicks
  );
}

function checkModeCategory(
  event: EventEnvelope,
  mode: unknown,
  category: unknown,
  err: (code: string, message: string, where?: string | null) => void,
): void {
  if (typeof mode !== 'string' || typeof category !== 'string') return;
  if (MODE_TO_CATEGORY[mode as ActionMode] !== (category as ActionCategory)) {
    err(
      'mode-category-mismatch',
      `${event.type} ${event.id} pairs mode ${mode} with category ${category}, expected ${String(
        MODE_TO_CATEGORY[mode as ActionMode],
      )}`,
    );
  }
}

function validateSemanticConsistency(
  file: LedgerFile,
  err: (code: string, message: string, where?: string | null) => void,
): void {
  // 5a. File metadata must agree with the ScenarioStarted payload: the file
  // envelope and the first event independently record scenario identity,
  // version, seed, config version, and provider — a coherent file cannot
  // claim one thing in its envelope and another in its opening event.
  const started = file.events[0];
  if (started && started.type === 'ScenarioStarted') {
    const p = started.payload as Record<string, unknown>;
    const checks: ReadonlyArray<[string, unknown, unknown]> = [
      ['scenarioId', p.scenarioId, file.scenario.id],
      ['scenarioVersion', p.scenarioVersion, file.scenario.version],
      ['seed', p.seed, file.scenario.seed],
      ['configVersion', p.configVersion, file.scenario.configVersion],
      ['providerId', p.providerId, file.providerId],
    ];
    for (const [field, inEvent, inFile] of checks) {
      if (inEvent !== inFile) {
        err(
          'scenario-started-metadata-mismatch',
          `ScenarioStarted.${field} ${String(inEvent)} != file metadata ${String(inFile)}`,
          started.id,
        );
      }
    }
  }

  const requestsById = new Map<string, RequestRecord>();
  const receivedByEventId = new Map<string, ReceivedRecord>();
  const acceptedByEventId = new Map<string, { requestId: string; selectedAffordanceId: string }>();
  const fallbackUsedByEventId = new Map<
    string,
    { npcId: unknown; requestId: string; affordanceId: unknown; reasonCode: string }
  >();
  const fallbackLicensedRequestIds = new Set<string>();
  const proposalsByActionId = new Map<string, Record<string, unknown>>();

  for (const event of file.events) {
    const payload = event.payload as Record<string, unknown>;

    // 5b. Envelope actor/target vs payload identities, per event type.
    const expectation = ENVELOPE_EXPECTATIONS[event.type];
    if (expectation) {
      const expected = expectation(payload);
      if (
        expected.actor !== undefined &&
        event.actorId !== null &&
        event.actorId !== expected.actor
      ) {
        err(
          'actor-payload-mismatch',
          `${event.type} ${event.id} actorId ${event.actorId} != payload identity ${String(expected.actor)}`,
        );
      }
      if (
        expected.target !== undefined &&
        event.targetId !== null &&
        event.targetId !== expected.target
      ) {
        err(
          'target-payload-mismatch',
          `${event.type} ${event.id} targetId ${event.targetId} != payload identity ${String(expected.target)}`,
        );
      }
    }

    // 5c. Decision lifecycle join.
    switch (event.type) {
      case 'DecisionRequested': {
        const offered = (payload.offeredAffordances as Record<string, unknown>[]) ?? [];
        const declaredIds = (payload.affordanceIds as string[]) ?? [];
        const offeredIds = offered.map((a) => a.id as string);
        if (
          declaredIds.length !== offeredIds.length ||
          declaredIds.some((id, i) => id !== offeredIds[i])
        ) {
          err(
            'request-offer-id-divergence',
            `DecisionRequested ${event.id} affordanceIds do not match offeredAffordances[].id`,
          );
        }
        for (const offer of offered) {
          checkModeCategory(event, offer.mode, offer.category, err);
        }
        requestsById.set(payload.requestId as string, {
          npcId: payload.npcId,
          providerId: payload.providerId,
          offeredIds: new Set(offeredIds),
          offeredById: new Map(offered.map((a) => [a.id as string, a])),
        });
        break;
      }
      case 'DecisionResponseReceived': {
        receivedByEventId.set(event.id, {
          responseId: payload.responseId,
          requestId: payload.requestId,
          npcId: payload.npcId,
          providerId: payload.providerId,
          selectedAffordanceId: payload.selectedAffordanceId,
          confidenceBp: payload.confidenceBp,
          reasonCode: payload.reasonCode,
        });
        break;
      }
      case 'DecisionResponseAccepted': {
        const received = event.causationId ? receivedByEventId.get(event.causationId) : undefined;
        if (!received) {
          err(
            'accepted-without-received',
            `DecisionResponseAccepted ${event.id} is not caused by a DecisionResponseReceived event`,
          );
          break;
        }
        if (
          received.responseId !== payload.responseId ||
          received.requestId !== payload.requestId ||
          received.npcId !== payload.npcId ||
          received.selectedAffordanceId !== payload.selectedAffordanceId ||
          received.confidenceBp !== payload.confidenceBp ||
          received.reasonCode !== payload.reasonCode
        ) {
          err(
            'accepted-received-divergence',
            `DecisionResponseAccepted ${event.id} disagrees with its DecisionResponseReceived record`,
          );
        }
        // A fallback acceptance must be licensed by an earlier
        // FallbackDecisionUsed for the same request: the engine always emits
        // that event before routing the fallback response through the gate,
        // so a forged usedFallback flag (even paired with a forged fallback
        // providerId on the Received record) cannot launder provenance.
        if (
          (payload.usedFallback as boolean) &&
          !fallbackLicensedRequestIds.has(payload.requestId as string)
        ) {
          err(
            'fallback-acceptance-unlicensed',
            `DecisionResponseAccepted ${event.id} claims usedFallback but no FallbackDecisionUsed precedes it for request ${String(payload.requestId)}`,
          );
        }
        const request = requestsById.get(payload.requestId as string);
        if (request) {
          if (request.npcId !== payload.npcId) {
            err(
              'accepted-received-divergence',
              `DecisionResponseAccepted ${event.id} npcId ${String(payload.npcId)} != request npcId ${String(request.npcId)}`,
            );
          }
          if (!request.offeredIds.has(payload.selectedAffordanceId as string)) {
            err(
              'accepted-unoffered-affordance',
              `DecisionResponseAccepted ${event.id} selects ${String(payload.selectedAffordanceId)}, which its request never offered`,
            );
          }
          // Provider authorization, mirroring the runtime gate (re-audit
          // finding 1): a normal acceptance must come from the provider the
          // request named; a fallback acceptance must come from the
          // engine-owned fallback. Rejected responses are exempt — recording
          // an unauthorized response and rejecting it is exactly what the
          // gate does at runtime.
          const authorized = (payload.usedFallback as boolean)
            ? received.providerId === FALLBACK_PROVIDER_ID
            : received.providerId === request.providerId;
          if (!authorized) {
            err(
              'accepted-provider-mismatch',
              `DecisionResponseAccepted ${event.id} accepted a response from ${String(received.providerId)}; request named ${String(request.providerId)}${(payload.usedFallback as boolean) ? ` (fallback must be ${FALLBACK_PROVIDER_ID})` : ''}`,
            );
          }
        }
        acceptedByEventId.set(event.id, {
          requestId: payload.requestId as string,
          selectedAffordanceId: payload.selectedAffordanceId as string,
        });
        break;
      }
      case 'DecisionResponseRejected': {
        const received = event.causationId ? receivedByEventId.get(event.causationId) : undefined;
        if (!received) {
          err(
            'rejected-without-received',
            `DecisionResponseRejected ${event.id} is not caused by a DecisionResponseReceived event`,
          );
          break;
        }
        if (
          received.responseId !== payload.responseId ||
          received.requestId !== payload.requestId ||
          received.npcId !== payload.npcId
        ) {
          err(
            'rejected-received-divergence',
            `DecisionResponseRejected ${event.id} disagrees with its DecisionResponseReceived record`,
          );
        }
        break;
      }
      case 'FallbackDecisionUsed': {
        fallbackUsedByEventId.set(event.id, {
          npcId: payload.npcId,
          requestId: payload.requestId as string,
          affordanceId: payload.affordanceId,
          reasonCode: payload.reasonCode as string,
        });
        fallbackLicensedRequestIds.add(payload.requestId as string);
        break;
      }
      case 'ActionProposed': {
        checkModeCategory(event, payload.mode, payload.category, err);
        // Every genuine proposal is caused by exactly one of two events, and
        // BOTH arms are authenticated (a forger cannot disable the descriptor
        // join by re-pointing causationId):
        //  - a DecisionResponseAccepted: the proposal must launch EXACTLY the
        //    offered descriptor the acceptance selected;
        //  - a provisional FallbackDecisionUsed (reasonCode 'provisional:*'):
        //    the proposal must launch the fallback-selected offer verbatim
        //    EXCEPT interruptible, which the engine forces to true so the
        //    bridged request stays honourable.
        const accepted = event.causationId ? acceptedByEventId.get(event.causationId) : undefined;
        const fallbackUsed = event.causationId
          ? fallbackUsedByEventId.get(event.causationId)
          : undefined;
        if (accepted) {
          if (payload.affordanceId !== accepted.selectedAffordanceId) {
            err(
              'proposal-descriptor-divergence',
              `ActionProposed ${event.id} launches ${String(payload.affordanceId)} but its acceptance selected ${accepted.selectedAffordanceId}`,
            );
            break;
          }
          const offer = requestsById
            .get(accepted.requestId)
            ?.offeredById.get(accepted.selectedAffordanceId);
          if (offer) {
            for (const [offerField, descriptorField] of OFFER_TO_DESCRIPTOR) {
              if (offer[offerField] !== payload[descriptorField]) {
                err(
                  'proposal-descriptor-divergence',
                  `ActionProposed ${event.id} ${descriptorField} ${String(payload[descriptorField])} != offered ${String(offer[offerField])}`,
                );
              }
            }
            if (!termsEqual(offer.proposedTerms ?? null, payload.proposedTerms ?? null)) {
              err(
                'proposal-descriptor-divergence',
                `ActionProposed ${event.id} proposedTerms differ from the offered descriptor`,
              );
            }
          }
        } else if (fallbackUsed) {
          if (
            !fallbackUsed.reasonCode.startsWith('provisional:') ||
            fallbackUsed.npcId !== payload.npcId
          ) {
            err(
              'proposal-cause-invalid',
              `ActionProposed ${event.id} is caused by a non-provisional or foreign FallbackDecisionUsed`,
            );
            break;
          }
          if (payload.affordanceId !== fallbackUsed.affordanceId) {
            err(
              'proposal-descriptor-divergence',
              `ActionProposed ${event.id} launches ${String(payload.affordanceId)} but the provisional fallback selected ${String(fallbackUsed.affordanceId)}`,
            );
            break;
          }
          const offer = requestsById
            .get(fallbackUsed.requestId)
            ?.offeredById.get(fallbackUsed.affordanceId as string);
          if (offer) {
            for (const [offerField, descriptorField] of OFFER_TO_DESCRIPTOR) {
              if (descriptorField === 'interruptible') continue;
              if (offer[offerField] !== payload[descriptorField]) {
                err(
                  'proposal-descriptor-divergence',
                  `ActionProposed ${event.id} ${descriptorField} ${String(payload[descriptorField])} != provisionally offered ${String(offer[offerField])}`,
                );
              }
            }
            if (payload.interruptible !== true) {
              err(
                'proposal-descriptor-divergence',
                `ActionProposed ${event.id} provisional bridge must be interruptible`,
              );
            }
            if (!termsEqual(offer.proposedTerms ?? null, payload.proposedTerms ?? null)) {
              err(
                'proposal-descriptor-divergence',
                `ActionProposed ${event.id} proposedTerms differ from the provisionally offered descriptor`,
              );
            }
          }
        } else {
          err(
            'proposal-cause-invalid',
            `ActionProposed ${event.id} is caused by neither a DecisionResponseAccepted nor a FallbackDecisionUsed`,
          );
        }
        proposalsByActionId.set(payload.actionId as string, payload);
        break;
      }
      case 'ActionStarted': {
        checkModeCategory(event, payload.mode, payload.category, err);
        // The reducer installs currentAction from the ActionStarted payload,
        // not from the earlier proposal — so the start must repeat the
        // proposed descriptor byte-for-byte (completesAtTick is derived and
        // excluded). Scripted tick-0 starts have no proposal by design;
        // non-scripted starts without one are already errors in step 4.
        const proposal = proposalsByActionId.get(payload.actionId as string);
        if (proposal) {
          for (const [, descriptorField] of OFFER_TO_DESCRIPTOR) {
            if (descriptorField === 'affordanceId') continue;
            if (proposal[descriptorField] !== payload[descriptorField]) {
              err(
                'start-descriptor-divergence',
                `ActionStarted ${event.id} ${descriptorField} ${String(payload[descriptorField])} != proposed ${String(proposal[descriptorField])}`,
              );
            }
          }
          if (proposal.affordanceId !== payload.affordanceId) {
            err(
              'start-descriptor-divergence',
              `ActionStarted ${event.id} affordanceId ${String(payload.affordanceId)} != proposed ${String(proposal.affordanceId)}`,
            );
          }
          if (!termsEqual(proposal.proposedTerms ?? null, payload.proposedTerms ?? null)) {
            err(
              'start-descriptor-divergence',
              `ActionStarted ${event.id} proposedTerms differ from the proposal`,
            );
          }
        }
        break;
      }
      case 'ActionCompleted':
      case 'ActionRejected':
      case 'ActionInterrupted': {
        checkModeCategory(event, payload.mode, payload.category, err);
        break;
      }
      case 'ScenarioEnded': {
        // The recorded outcome must agree with the file's summary (the
        // summary itself is later rebuilt field-by-field from the replayed
        // state, so this transitively pins payload == replay == summary).
        if (payload.taskOutcome !== file.finalSummary.taskOutcome) {
          err(
            'scenario-ended-outcome-mismatch',
            `ScenarioEnded.taskOutcome ${String(payload.taskOutcome)} != finalSummary.taskOutcome ${file.finalSummary.taskOutcome}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }
}
