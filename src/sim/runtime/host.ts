import type { PresentationSnapshot } from '../../shared/snapshots';
import type { LedgerFile } from '../../shared/ledgerFile';
import { ledgerFileName } from '../../shared/ledgerFile';
import type { ScenarioId } from '../../shared/ids';
import type { TraceExport } from '../../shared/traces';
import type { ValidationIssue } from '../../shared/validation';
import { makeDraft } from '../events/ledger';
import { applyEvent } from '../events/reduce';
import { replayLedger } from '../replay/replay';
import { validateLedgerFile } from '../replay/validateLedger';
import { SCENARIO_LIST } from '../scenarios/definitions';
import { buildAnonymizedTraces } from '../traces';
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
  match: boolean;
  computedHash: string | null;
  expectedHash: string | null;
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
    return this.run ? this.run.provider.id : 'deterministic-utility-v1';
  }

  loadScenario(id: ScenarioId): void {
    this.run = createRun(id);
  }

  reset(): void {
    if (!this.run) throw new Error('no-scenario-loaded');
    this.run = createRun(this.run.scenario.id);
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
    return buildSnapshot(run.state, run.ledger.events, run.provider.id, run.finalStateHash);
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
   * no decision provider is consulted — and compare final-state hashes.
   */
  replay(source: 'imported' | 'live'): ReplayOutcome {
    if (source === 'imported') {
      if (!this.importedFile) {
        return notReplayable('no-imported-ledger');
      }
      const file = this.importedFile;
      const result = replayLedger(file.scenario.id, file.events);
      return {
        ok: true,
        match: result.finalStateHash === file.finalStateHash,
        computedHash: result.finalStateHash,
        expectedHash: file.finalStateHash,
        errors: [],
      };
    }
    const run = this.run;
    if (!run || !run.state.terminal || run.finalStateHash === null) {
      return notReplayable('live-run-not-complete');
    }
    const result = replayLedger(run.scenario.id, run.ledger.events);
    return {
      ok: true,
      match: result.finalStateHash === run.finalStateHash,
      computedHash: result.finalStateHash,
      expectedHash: run.finalStateHash,
      errors: [],
    };
  }

  exportTraces(): { fileName: string; json: string; traces: TraceExport } {
    const run = this.requireRun();
    if (!run.state.terminal) throw new Error('traces-require-terminal-run');
    const traces = buildAnonymizedTraces(run.scenario, run.ledger.events);
    return {
      fileName: `traces-${run.scenario.id}-v${run.scenario.version}-seed${run.scenario.seed}.json`,
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
  return { ok: false, match: false, computedHash: null, expectedHash: null, errors: [code] };
}
