import { describe, expect, it } from 'vitest';
import { SimulationHost } from '../../src/sim/runtime/host';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';

describe('determinism across execution modes', () => {
  it('tick-batch sizes 1, 5, and 20 produce identical authoritative ledgers', () => {
    const results = [1, 5, 20].map((batchSize) => {
      const host = new SimulationHost();
      host.loadScenario('C');
      while (!host.terminal) host.stepTicks(batchSize);
      const run = host.activeRun!;
      return {
        hash: run.finalStateHash,
        length: run.ledger.length,
        fingerprint: run.ledger.events.map((e) => `${e.seq}:${e.type}:${e.tick}`).join('|'),
      };
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('repeated runs of the same scenario and seed produce the same hash', () => {
    const first = createRun('D');
    runToCompletion(first);
    const second = createRun('D');
    runToCompletion(second);
    expect(second.finalStateHash).toBe(first.finalStateHash);
    expect(second.ledger.length).toBe(first.ledger.length);
  });

  it('pausing and resuming mid-run never changes the authoritative outcome', () => {
    const plain = new SimulationHost();
    plain.loadScenario('A');
    plain.runToCompletion();

    const paused = new SimulationHost();
    paused.loadScenario('A');
    paused.stepTicks(100);
    paused.markPaused();
    paused.stepTicks(1); // single-tick stepping while paused
    paused.markResumed();
    paused.stepTicks(500);
    paused.markPaused();
    paused.markResumed();
    paused.runToCompletion();

    expect(paused.activeRun!.finalStateHash).toBe(plain.activeRun!.finalStateHash);
    // The pause markers are recorded, so the ledgers differ in length only.
    expect(paused.activeRun!.ledger.length).toBe(plain.activeRun!.ledger.length + 4);
  });

  it('sequential scenario runs in one process do not leak state', () => {
    const referenceA = createRun('A');
    runToCompletion(referenceA);

    // Interleave other scenarios, then re-run A.
    for (const id of ['C', 'F', 'D'] as const) {
      const run = createRun(id);
      runToCompletion(run);
    }
    const again = createRun('A');
    runToCompletion(again);
    expect(again.finalStateHash).toBe(referenceA.finalStateHash);
    expect(again.ledger.length).toBe(referenceA.ledger.length);
  });
});
