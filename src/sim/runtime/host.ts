import type { PresentationSnapshot } from '../../shared/snapshots';
import type {
  DecisionResponse,
  ExternalDecisionFailure,
  ExternalDecisionRequest,
} from '../../shared/decisionContracts';
import type { ConditionId } from '../decisions/conditions';
import type { LedgerFile } from '../../shared/ledgerFile';
import { ledgerFileName } from '../../shared/ledgerFile';
import type { ScenarioId } from '../../shared/ids';
import type { ContextRichTraceExport } from '../../shared/traces';
import type { ValidationIssue } from '../../shared/validation';
import { makeDraft } from '../events/ledger';
import { applyEvent } from '../events/reduce';
import { canonicalLedgerHash } from '../replay/ledgerHash';
import { replayLedger } from '../replay/replay';
import { validateLedgerFile } from '../replay/validateLedger';
import { SCENARIO_LIST } from '../scenarios/definitions';
import { buildContextRichTraces } from '../traces';
import { createRun, runToCompletion, stepTick, type EngineRun } from './engine';
import { buildLedgerFile } from './ledgerFileBuilder';
import { buildSnapshot } from './snapshot';
import type { SimEvent } from '../events/types';

/**
 * Platform-independent simulation host: one canonical run plus import/replay
 * bookkeeping. The browser worker and the Node headless runner both drive
 * this class, which is what keeps their command semantics identical.
 *
 * The host owns operator-level (non-canonical) status: pause markers are
 * appended to the ledger as informational events but never affect canonical
 * outcomes or the final-state hash.
 */

export interface ReplayOutcome {
  ok: boolean;
  /** True when both hash comparisons match. */
  match: boolean;
  computedWorldStateHash: string | null;
  expectedWorldStateHash: string | null;
  computedLedgerHash: string | null;
  expectedLedgerHash: string | null;
  errors: string[];
}

export interface ScenarioListing {
  id: ScenarioId;
  version: string;
  seed: number;
  title: string;
  description: string;
}

export class SimulationHost {
  private run: EngineRun | null = null;
  private importedFile: LedgerFile | null = null;

  listScenarios(): ScenarioListing[] {
    return SCENARIO_LIST.map((s) => ({
      id: s.id,
      version: s.version,
      seed: s.seed,
      title: s.title,
      description: s.description,
    }));
  }

  get activeRun(): EngineRun | null {
    return this.run;
  }

  get scenarioId(): ScenarioId | null {
    return this.run ? this.run.scenario.id : null;
  }

  get terminal(): boolean {
    return this.run !== null && this.run.state.terminal;
  }

  get providerId(): string {
    return this.run ? this.run.plan.id : 'deterministic-utility-v1';
  }

  get conditionId(): ConditionId | null {
    return this.loadedConditionId;
  }

  private loadedConditionId: ConditionId | null = null;

  loadScenario(id: ScenarioId, conditionId?: ConditionId): void {
    this.run = conditionId ? createRun(id, { conditionId }) : createRun(id);
    this.loadedConditionId = conditionId ?? null;
  }

  reset(): void {
    if (!this.run) throw new Error('no-scenario-loaded');
    const id = this.run.scenario.id;
    this.run = this.loadedConditionId
      ? createRun(id, { conditionId: this.loadedConditionId })
      : createRun(id);
  }

  /**
   * Queue an externally produced decision response (remediation 1). The
   * response is NOT processed here: it drains at the fixed response-drain
   * point inside the next stepTick, so canonical outcomes are independent of
   * when and in what batch sizes the operator advances time.
   */
  submitDecisionResponse(response: DecisionResponse): void {
    const run = this.requireRun();
    if (run.state.terminal) throw new Error('run-already-complete');
    run.responseInbox.push(response);
  }

  /**
   * Queue an externally reported gateway/model failure (milestone 001,
   * section 15). Like responses, failures drain at the fixed in-tick point,
   * never mid-command.
   */
  submitDecisionFailure(failure: ExternalDecisionFailure): void {
    const run = this.requireRun();
    if (run.state.terminal) throw new Error('run-already-complete');
    run.failureInbox.push(failure);
  }

  /**
   * Drain pending external decision requests (provider deferred): the exact
   * request plus its bounded deterministic model context. The worker
   * forwards these to the main thread; whether they reach a gateway is the
   * registered condition's transport decision.
   */
  drainExternalDecisionRequests(): ExternalDecisionRequest[] {
    const run = this.run;
    if (!run || run.externalRequests.length === 0) return [];
    return run.externalRequests.splice(0, run.externalRequests.length);
  }

  /** Process up to `ticks` whole logical ticks; stops early at terminal. */
  stepTicks(ticks: number): number {
    const run = this.requireRun();
    let processed = 0;
    while (processed < ticks && !run.state.terminal) {
      stepTick(run);
      processed += 1;
    }
    return processed;
  }

  runToCompletion(): void {
    runToCompletion(this.requireRun());
  }

  /** Operator pause/resume markers (canonical no-ops, recorded for audit). */
  markPaused(): void {
    this.appendMarker('SimulationPaused');
  }

  markResumed(): void {
    this.appendMarker('SimulationResumed');
  }

  private appendMarker(type: 'SimulationPaused' | 'SimulationResumed'): void {
    const run = this.requireRun();
    if (run.state.terminal) return;
    const event = run.ledger.append(
      makeDraft({
        type,
        tick: run.state.tick,
        actorId: null,
        targetId: null,
        causationId: null,
        correlationId: null,
        payload: {},
      }),
    );
    applyEvent(run.state, event);
  }

  snapshot(): PresentationSnapshot {
    const run = this.requireRun();
    return buildSnapshot(
      run.state,
      run.ledger.events,
      run.plan.id,
      run.worldStateHash,
      run.canonicalLedgerHash,
    );
  }

  eventsSince(seq: number): SimEvent[] {
    const run = this.requireRun();
    return run.ledger.events.slice(seq) as SimEvent[];
  }

  exportLedger(): { fileName: string; json: string; file: LedgerFile } {
    const run = this.requireRun();
    const file = buildLedgerFile(run);
    return {
      fileName: ledgerFileName(file.scenario.id, file.scenario.version, file.scenario.seed),
      json: JSON.stringify(file, null, 2),
      file,
    };
  }

  importLedger(text: string): {
    ok: boolean;
    issues: ValidationIssue[];
    scenarioId: ScenarioId | null;
  } {
    const result = validateLedgerFile(text);
    if (!result.ok || result.file === null) {
      // A rejected file never partially mutates anything: nothing is stored.
      return { ok: false, issues: result.issues, scenarioId: null };
    }
    this.importedFile = result.file;
    return { ok: true, issues: result.issues, scenarioId: result.file.scenario.id };
  }

  get hasImportedLedger(): boolean {
    return this.importedFile !== null;
  }

  /**
   * Replay: 'imported' replays the imported file; 'live' replays the current
   * completed run's own ledger. Both fold the reducer over recorded events —
   * no decision provider is consulted — and compare the semantic world-state
   * hash plus the canonical ledger hash.
   */
  replay(source: 'imported' | 'live'): ReplayOutcome {
    if (source === 'imported') {
      if (!this.importedFile) {
        return notReplayable('no-imported-ledger');
      }
      const file = this.importedFile;
      // The reducer deliberately throws on impossible transitions, so a
      // schema-valid but payload-corrupted ledger can abort mid-replay. That
      // must surface as an explicit non-match result, never as a lost
      // response: a replay command always yields a replay outcome.
      try {
        const result = replayLedger(file.scenario.id, file.events);
        const computedLedgerHash = canonicalLedgerHash(file.events);
        return {
          ok: true,
          match:
            result.worldStateHash === file.worldStateHash &&
            computedLedgerHash === file.canonicalLedgerHash,
          computedWorldStateHash: result.worldStateHash,
          expectedWorldStateHash: file.worldStateHash,
          computedLedgerHash,
          expectedLedgerHash: file.canonicalLedgerHash,
          errors: [],
        };
      } catch (error) {
        return {
          ok: false,
          match: false,
          computedWorldStateHash: null,
          expectedWorldStateHash: file.worldStateHash,
          computedLedgerHash: null,
          expectedLedgerHash: file.canonicalLedgerHash,
          errors: [`replay-aborted: ${(error as Error).message}`],
        };
      }
    }
    const run = this.run;
    if (!run || !run.state.terminal || run.worldStateHash === null) {
      return notReplayable('live-run-not-complete');
    }
    try {
      const result = replayLedger(run.scenario.id, run.ledger.events);
      const computedLedgerHash = canonicalLedgerHash(run.ledger.events);
      return {
        ok: true,
        match:
          result.worldStateHash === run.worldStateHash &&
          computedLedgerHash === run.canonicalLedgerHash,
        computedWorldStateHash: result.worldStateHash,
        expectedWorldStateHash: run.worldStateHash,
        computedLedgerHash,
        expectedLedgerHash: run.canonicalLedgerHash,
        errors: [],
      };
    } catch (error) {
      return {
        ok: false,
        match: false,
        computedWorldStateHash: null,
        expectedWorldStateHash: run.worldStateHash,
        computedLedgerHash: null,
        expectedLedgerHash: run.canonicalLedgerHash,
        errors: [`replay-aborted: ${(error as Error).message}`],
      };
    }
  }

  /** Browser trace export: the CONTEXT-RICH diagnostic mode. Behavior-only
   * reviewer packages are produced by the evaluation CLI, where the blinding
   * map is generated with cryptographic randomness outside the sim core. */
  exportTraces(): { fileName: string; json: string; traces: ContextRichTraceExport } {
    const run = this.requireRun();
    if (!run.state.terminal) throw new Error('traces-require-terminal-run');
    const traces = buildContextRichTraces(run.scenario, run.ledger.events);
    return {
      fileName: `traces-context-rich-${run.scenario.id}-v${run.scenario.version}-seed${run.scenario.seed}.json`,
      json: JSON.stringify(traces, null, 2),
      traces,
    };
  }

  private requireRun(): EngineRun {
    if (!this.run) throw new Error('no-scenario-loaded');
    return this.run;
  }
}

function notReplayable(code: string): ReplayOutcome {
  return {
    ok: false,
    match: false,
    computedWorldStateHash: null,
    expectedWorldStateHash: null,
    computedLedgerHash: null,
    expectedLedgerHash: null,
    errors: [code],
  };
}
