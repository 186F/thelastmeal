import { ledgerFileSchema, type LedgerFile } from '../../shared/ledgerFile';
import type { ValidationIssue } from '../../shared/validation';
import { CONFIG_VERSION, EXPERIMENT_ID, SCHEMA_VERSION } from '../../shared/versions';
import { SCENARIOS } from '../scenarios/definitions';

/**
 * Imported-ledger validation. An imported file must fully validate before any
 * replay begins; a rejected file never partially mutates an active run.
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    err('invalid-json', `File is not valid JSON: ${(e as Error).message}`);
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

  // Event stream integrity: contiguous sequence, consistent IDs and versions,
  // monotonic ticks, single terminal event.
  let lastTick = -1;
  let endedSeen = false;
  let canonicalCount = 0;
  let markerCount = 0;
  file.events.forEach((event, index) => {
    if (event.seq !== index) {
      err('sequence-gap', `Event at index ${index} has seq ${event.seq}`, event.id);
    }
    // Canonical events and operator markers draw from separate ID counters
    // (see EventLedger.append); recompute both while scanning.
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
    if (event.type === 'ScenarioEnded') {
      endedSeen = true;
      const recorded = (event.payload as { finalStateHash?: unknown }).finalStateHash;
      if (recorded !== file.finalStateHash) {
        err(
          'hash-mismatch-in-file',
          'ScenarioEnded hash does not match the file-level finalStateHash',
        );
      }
    }
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

  return { ok: issues.every((i) => i.severity !== 'error'), issues, file };
}
