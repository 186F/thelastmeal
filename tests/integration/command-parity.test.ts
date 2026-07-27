import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '../../src/shared/ids';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import type { WorkerCommand } from '../../src/shared/workerProtocol';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import {
  SimulatedAsyncProvider,
  type SimulatedAsyncScript,
} from '../../src/sim/decisions/simulatedAsyncProvider';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { buildFinalSummary } from '../../src/sim/reporting';
import { SimulationHost } from '../../src/sim/runtime/host';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { handleCommand, WorkerSession } from '../../src/worker/commandProcessor';

let seq = 0;
function cmd(type: WorkerCommand['type'], extra: Record<string, unknown> = {}): WorkerCommand {
  seq += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-${seq}`,
    commandSeq: seq,
    type,
    ...extra,
  } as WorkerCommand;
}

describe('worker-command semantics match direct Node execution (all scenarios; re-audit finding 4)', () => {
  // Direct-host vs worker-command parity for EVERY frozen scenario, comparing
  // worldStateHash, canonicalLedgerHash, the complete serialized canonical
  // event stream, AND the final summary. The pause/resume commands are made
  // real (a `start` precedes them, so runStatus transitions actually happen)
  // and the direct host mirrors the same markers: FinalSummary.eventCount
  // counts operator markers, so summary parity requires marker parity.
  for (const scenarioId of SCENARIO_IDS) {
    it(`scenario ${scenarioId}: fixed command sequence == direct host calls (hashes, stream, summary)`, () => {
      // Direct Node path, mirroring the worker sequence including markers.
      const host = new SimulationHost();
      host.loadScenario(scenarioId);
      host.stepTicks(100);
      host.markPaused();
      host.stepTicks(1);
      host.markResumed();
      host.runToCompletion();
      const direct = host.activeRun!;

      // Worker-command path (same protocol the browser uses, minus
      // postMessage). `start` makes pause/resume real state transitions.
      const session = new WorkerSession();
      handleCommand(session, cmd('load-scenario', { scenarioId }));
      handleCommand(session, cmd('step', { ticks: 100 }));
      handleCommand(session, cmd('start'));
      handleCommand(session, cmd('pause'));
      handleCommand(session, cmd('step', { ticks: 1 }));
      handleCommand(session, cmd('resume'));
      handleCommand(session, cmd('run-to-completion'));
      const viaWorker = session.host.activeRun!;

      // The pause/resume pair really executed (regression guard: with no
      // `start`, both commands are status-gated no-ops that append nothing).
      const workerMarkers = viaWorker.ledger.events.filter(
        (e) => e.type === 'SimulationPaused' || e.type === 'SimulationResumed',
      );
      expect(workerMarkers.map((e) => e.type)).toEqual(['SimulationPaused', 'SimulationResumed']);

      expect(viaWorker.worldStateHash).toBe(direct.worldStateHash);
      expect(viaWorker.canonicalLedgerHash).toBe(direct.canonicalLedgerHash);
      expect(serializeCanonicalEventStream(viaWorker.ledger.events)).toBe(
        serializeCanonicalEventStream(direct.ledger.events),
      );
      expect(buildFinalSummary(viaWorker.state, viaWorker.ledger.events)).toEqual(
        buildFinalSummary(direct.state, direct.ledger.events),
      );
    });
  }

  it('deferred-provider sequences run identically through worker commands and the direct host', () => {
    // The scheduled-response drain point lives inside stepTick, so worker
    // `step`/`run-to-completion` commands must drive the full asynchronous
    // lifecycle byte-identically to direct stepping. The provider is injected
    // post-load on BOTH paths (same ScenarioStarted either way); the run is
    // never exported, so file-metadata reconciliation is not in play.
    const script: SimulatedAsyncScript = (ordinal) => ({ delayTicks: 1 + (ordinal % 4) });

    const direct = createRun('A');
    direct.provider = new SimulatedAsyncProvider(new DeterministicProvider(), script);
    while (!direct.state.terminal) stepTick(direct);

    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    session.host.activeRun!.provider = new SimulatedAsyncProvider(
      new DeterministicProvider(),
      script,
    );
    handleCommand(session, cmd('run-to-completion'));
    const viaWorker = session.host.activeRun!;

    // The deferred lifecycle actually ran (deferrals produce scheduled
    // responses that arrive on later ticks).
    const receivedLater = viaWorker.ledger.events.filter(
      (e) => e.type === 'DecisionResponseReceived',
    );
    expect(receivedLater.length).toBeGreaterThan(0);

    expect(viaWorker.worldStateHash).toBe(direct.worldStateHash);
    expect(viaWorker.canonicalLedgerHash).toBe(direct.canonicalLedgerHash);
    expect(serializeCanonicalEventStream(viaWorker.ledger.events)).toBe(
      serializeCanonicalEventStream(direct.ledger.events),
    );
  });

  it('export -> import -> replay through worker commands reports a hash match', () => {
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    handleCommand(session, cmd('run-to-completion'));
    const exported = handleCommand(session, cmd('export-ledger')).find(
      (r) => r.type === 'ledger-export',
    );
    expect(exported).toBeDefined();
    if (!exported || exported.type !== 'ledger-export') throw new Error('no export');

    const imported = handleCommand(session, cmd('import-ledger', { fileText: exported.json })).find(
      (r) => r.type === 'import-result',
    );
    expect(imported && imported.type === 'import-result' ? imported.ok : false).toBe(true);

    const replayed = handleCommand(session, cmd('replay', { source: 'imported' })).find(
      (r) => r.type === 'replay-result',
    );
    expect(replayed && replayed.type === 'replay-result' ? replayed.match : false).toBe(true);
  });

  it('a tampered import is rejected without touching the active run', () => {
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    handleCommand(session, cmd('step', { ticks: 10 }));
    const before = session.host.snapshot();
    const responses = handleCommand(
      session,
      cmd('import-ledger', { fileText: '{"formatVersion": 1, "garbage": true' }),
    );
    const result = responses.find((r) => r.type === 'import-result');
    expect(result && result.type === 'import-result' ? result.ok : true).toBe(false);
    const after = session.host.snapshot();
    expect(after.tick).toBe(before.tick);
    expect(after.eventCount).toBe(before.eventCount);
    expect(session.host.hasImportedLedger).toBe(false);
  });

  it('in-browser batch semantics (worker command) verify all scenarios and replays', () => {
    const session = new WorkerSession();
    const responses = handleCommand(session, cmd('run-batch'));
    const result = responses.find((r) => r.type === 'batch-result');
    expect(result).toBeDefined();
    if (result && result.type === 'batch-result') {
      expect(result.report.ok).toBe(true);
      expect(result.report.scenarios).toHaveLength(7);
      expect(result.report.scenarios.every((s) => s.replayHashMatch)).toBe(true);
      expect(result.reportMarkdown).toContain('Batch Report');
    }
  });
});
