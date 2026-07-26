import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import { workerCommandSchema } from '../../src/shared/workerProtocol';
import { CommandGate } from '../../src/worker/commandGate';
import { handleCommand, WorkerSession } from '../../src/worker/commandProcessor';
import type { WorkerCommand } from '../../src/shared/workerProtocol';

let seq = 0;
function cmd<T extends WorkerCommand['type']>(
  type: T,
  extra: Record<string, unknown> = {},
): WorkerCommand {
  seq += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-${seq}`,
    commandSeq: seq,
    type,
    ...extra,
  } as WorkerCommand;
}

describe('worker command schema validation', () => {
  it('accepts every well-formed command shape', () => {
    expect(workerCommandSchema.safeParse(cmd('hello')).success).toBe(true);
    expect(workerCommandSchema.safeParse(cmd('load-scenario', { scenarioId: 'A' })).success).toBe(
      true,
    );
    expect(workerCommandSchema.safeParse(cmd('set-speed', { speed: 20 })).success).toBe(true);
    expect(workerCommandSchema.safeParse(cmd('step', { ticks: 1 })).success).toBe(true);
    expect(workerCommandSchema.safeParse(cmd('import-ledger', { fileText: '{}' })).success).toBe(
      true,
    );
  });

  it('rejects wrong protocol versions, unknown types, and malformed payloads', () => {
    const bad = { ...cmd('hello'), protocolVersion: PROTOCOL_VERSION + 1 };
    expect(workerCommandSchema.safeParse(bad).success).toBe(false);
    expect(workerCommandSchema.safeParse(cmd('warp-time' as never)).success).toBe(false);
    expect(workerCommandSchema.safeParse(cmd('set-speed', { speed: 7 })).success).toBe(false);
    expect(workerCommandSchema.safeParse(cmd('step', { ticks: 0 })).success).toBe(false);
    expect(workerCommandSchema.safeParse(cmd('load-scenario', { scenarioId: 'Z' })).success).toBe(
      false,
    );
  });
});

describe('command ordering gate', () => {
  it('accepts strictly increasing sequences and rejects duplicates and reordering', () => {
    const gate = new CommandGate();
    const first = cmd('start');
    const second = cmd('pause');
    expect(gate.check(first).ok).toBe(true);
    expect(gate.check(second).ok).toBe(true);
    // Exact duplicate: rejected by ID.
    const dup = gate.check(first);
    expect(dup.ok).toBe(false);
    // Out-of-order (stale seq, fresh id): rejected by sequence.
    const stale = gate.check({ ...first, commandId: 'cmd-fresh', commandSeq: first.commandSeq });
    expect(stale.ok).toBe(false);
  });
});

describe('snapshot schema validation', () => {
  it('a real host snapshot validates against the runtime schema', async () => {
    const { presentationSnapshotSchema } = await import('../../src/shared/snapshotSchema');
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'C' }));
    handleCommand(session, cmd('step', { ticks: 800 }));
    const snapshot = session.host.snapshot();
    const result = presentationSnapshotSchema.safeParse(snapshot);
    expect(result.success, JSON.stringify(result.success ? '' : result.error.issues[0])).toBe(true);
  });

  it('rejects structurally corrupted snapshots', async () => {
    const { presentationSnapshotSchema } = await import('../../src/shared/snapshotSchema');
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    const snapshot = session.host.snapshot() as unknown as Record<string, unknown>;
    expect(presentationSnapshotSchema.safeParse({ ...snapshot, tick: -1 }).success).toBe(false);
    expect(presentationSnapshotSchema.safeParse({ ...snapshot, npcs: [] }).success).toBe(false);
    expect(presentationSnapshotSchema.safeParse({ ...snapshot, extraField: 1 }).success).toBe(
      false,
    );
  });
});

describe('worker snapshot/response flow (Node-driven)', () => {
  it('produces ready, snapshot, events, and run-complete responses', () => {
    const session = new WorkerSession();
    const ready = handleCommand(session, cmd('hello'));
    expect(ready.some((r) => r.type === 'ready')).toBe(true);

    const loaded = handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    const snapshot = loaded.find((r) => r.type === 'snapshot');
    expect(snapshot).toBeDefined();
    if (snapshot && snapshot.type === 'snapshot') {
      expect(snapshot.snapshot.tick).toBe(0);
      expect(snapshot.snapshot.scenarioId).toBe('A');
      expect(snapshot.snapshot.npcs).toHaveLength(3);
    }
    expect(loaded.some((r) => r.type === 'events')).toBe(true);

    const stepped = handleCommand(session, cmd('step', { ticks: 5 }));
    const snap2 = stepped.find((r) => r.type === 'snapshot');
    if (snap2 && snap2.type === 'snapshot') {
      expect(snap2.snapshot.tick).toBe(5);
    }

    const done = handleCommand(session, cmd('run-to-completion'));
    expect(done.some((r) => r.type === 'run-complete')).toBe(true);
    const complete = done.find((r) => r.type === 'run-complete');
    if (complete && complete.type === 'run-complete') {
      expect(complete.worldStateHash).toMatch(/^[0-9a-f]{16}$/);
      expect(complete.canonicalLedgerHash).toMatch(/^[0-9a-f]{16}$/);
      expect(complete.summary.taskOutcome).toBe('completed');
    }
  });

  it('rejects stepping while running and export before completion', () => {
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    const exportEarly = handleCommand(session, cmd('export-ledger'));
    const ackEarly = exportEarly.find((r) => r.type === 'ack');
    expect(ackEarly && ackEarly.type === 'ack' ? ackEarly.ok : true).toBe(false);

    handleCommand(session, cmd('start'));
    const step = handleCommand(session, cmd('step', { ticks: 1 }));
    const ackStep = step.find((r) => r.type === 'ack');
    expect(ackStep && ackStep.type === 'ack' ? ackStep.ok : true).toBe(false);
    expect(ackStep && ackStep.type === 'ack' ? ackStep.errorCode : null).toBe(
      'cannot-step-while-running',
    );
  });
});
