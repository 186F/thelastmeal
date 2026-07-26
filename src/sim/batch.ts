import type { BatchReport, MemoryComparison, ScenarioReportRow } from '../shared/reports';
import type { LedgerFile } from '../shared/ledgerFile';
import type { TraceExport } from '../shared/traces';
import type { ScenarioId } from '../shared/ids';
import { CONFIG_VERSION, EXPERIMENT_ID, SCHEMA_VERSION } from '../shared/versions';
import { checkInvariants } from './invariants';
import { buildMaraPersistenceStats, buildScenarioReportRow } from './reporting';
import { replayLedger } from './replay/replay';
import { SCENARIO_LIST } from './scenarios/definitions';
import { createRun, runToCompletion } from './runtime/engine';
import { buildLedgerFile } from './runtime/ledgerFileBuilder';
import { buildAnonymizedTraces } from './traces';

/**
 * The deterministic batch: run every scenario headlessly, replay every
 * ledger, verify invariants, and repeat runs to confirm hash stability.
 * Shared verbatim by `npm run batch` (Node) and the in-browser worker batch.
 */

export interface BatchOptions {
  runsPerScenario: number;
  onProgress?: (completed: number, total: number, scenarioId: ScenarioId) => void;
}

export interface BatchOutput {
  report: BatchReport;
  ledgers: { scenarioId: ScenarioId; file: LedgerFile }[];
  traces: TraceExport[];
}

export function runFullBatch(options: BatchOptions): BatchOutput {
  const { runsPerScenario } = options;
  const rows: ScenarioReportRow[] = [];
  const ledgers: BatchOutput['ledgers'] = [];
  const traces: TraceExport[] = [];
  const violations: string[] = [];
  let allHashesStable = true;
  const total = SCENARIO_LIST.length;
  let completed = 0;

  const eventsByScenario = new Map<ScenarioId, LedgerFile>();

  for (const scenario of SCENARIO_LIST) {
    const firstRun = createRun(scenario.id);
    runToCompletion(firstRun);
    const file = buildLedgerFile(firstRun);
    eventsByScenario.set(scenario.id, file);
    ledgers.push({ scenarioId: scenario.id, file });
    traces.push(buildAnonymizedTraces(scenario, file.events));

    for (const violation of checkInvariants(scenario, file.events, firstRun.state)) {
      violations.push(`${scenario.id}: ${violation}`);
    }

    // Replay verification: reducer-only replay must reproduce the hash.
    const replay = replayLedger(scenario.id, file.events);
    const replayHashMatch = replay.finalStateHash === file.finalStateHash;
    if (!replayHashMatch) {
      violations.push(
        `${scenario.id}: replay-hash-mismatch (${replay.finalStateHash} != ${file.finalStateHash})`,
      );
    }

    // Repeat-run determinism.
    for (let i = 1; i < runsPerScenario; i += 1) {
      const repeat = createRun(scenario.id);
      runToCompletion(repeat);
      if (repeat.finalStateHash !== file.finalStateHash) {
        allHashesStable = false;
        violations.push(
          `${scenario.id}: hash-unstable-on-run-${i + 1} (${repeat.finalStateHash} != ${file.finalStateHash})`,
        );
      }
      if (repeat.ledger.length !== file.events.length) {
        allHashesStable = false;
        violations.push(`${scenario.id}: ledger-length-unstable-on-run-${i + 1}`);
      }
    }

    rows.push(
      buildScenarioReportRow(
        scenario,
        firstRun.state,
        file.events,
        file.finalStateHash,
        replayHashMatch,
      ),
    );
    completed += 1;
    options.onProgress?.(completed, total, scenario.id);
  }

  const b1 = buildMaraPersistenceStats(eventsByScenario.get('B1')!.events);
  const b2 = buildMaraPersistenceStats(eventsByScenario.get('B2')!.events);
  const memoryComparison: MemoryComparison = {
    b1,
    b2,
    workTickDelta: b1.workTicks - b2.workTicks,
    distinctBehaviorObserved:
      b1.workTicks !== b2.workTicks ||
      b1.breakRequestCount !== b2.breakRequestCount ||
      b1.firstBreakRequestTick !== b2.firstBreakRequestTick,
  };
  if (!memoryComparison.distinctBehaviorObserved) {
    violations.push('B1/B2: memory-ablation-produced-identical-behavior');
  }

  const report: BatchReport = {
    experimentId: EXPERIMENT_ID,
    configVersion: CONFIG_VERSION,
    schemaVersion: SCHEMA_VERSION,
    scenarios: rows,
    determinism: {
      runsPerScenario,
      allHashesStable,
      invariantViolations: violations,
    },
    memoryComparison,
    ok: violations.length === 0 && allHashesStable && rows.every((r) => r.replayHashMatch),
  };

  return { report, ledgers, traces };
}
