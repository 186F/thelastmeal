import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import type { WorkerCommand } from '../../src/shared/workerProtocol';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { SimulationHost } from '../../src/sim/runtime/host';
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

describe('worker-command semantics match direct Node execution', () => {
  it('the same fixed command sequence and direct host calls produce one hash', () => {
    // Direct Node path.
    const host = new SimulationHost();
    host.loadScenario('C');
    host.stepTicks(100);
    host.stepTicks(1);
    host.runToCompletion();
    const directHash = host.activeRun!.worldStateHash;
    const directLedgerHash = host.activeRun!.canonicalLedgerHash;

    // Worker-command path (same protocol the browser uses, minus postMessage).
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'C' }));
    handleCommand(session, cmd('step', { ticks: 100 }));
    handleCommand(session, cmd('pause'));
    handleCommand(session, cmd('step', { ticks: 1 }));
    handleCommand(session, cmd('resume'));
    handleCommand(session, cmd('run-to-completion'));

    expect(session.host.activeRun!.worldStateHash).toBe(directHash);
    expect(session.host.activeRun!.canonicalLedgerHash).toBe(directLedgerHash);
    // Complete canonical stream equality across the two execution paths.
    expect(serializeCanonicalEventStream(session.host.activeRun!.ledger.events)).toBe(
      serializeCanonicalEventStream(host.activeRun!.ledger.events),
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
