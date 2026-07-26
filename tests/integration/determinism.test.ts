import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '../../src/shared/ids';
import { SimulationHost } from '../../src/sim/runtime/host';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { diffCanonicalStreams } from '../../src/sim/replay/streamDiff';
import { SCENARIOS } from '../../src/sim/scenarios/definitions';

/**
 * Remediation 5: determinism is proven on COMPLETE canonical event streams —
 * every id, type, tick, actor, target, causation, correlation, and exact
 * payload — never just hashes, lengths, or seq:type:tick fingerprints.
 * Mismatches report the scenario, seed, first differing canonical index,
 * both event identities, and a field-level diff.
 */

function expectIdenticalStreams(
  scenarioId: (typeof SCENARIO_IDS)[number],
  reference: Parameters<typeof serializeCanonicalEventStream>[0],
  candidate: Parameters<typeof serializeCanonicalEventStream>[0],
): void {
  const referenceStream = serializeCanonicalEventStream(reference);
  const candidateStream = serializeCanonicalEventStream(candidate);
  if (referenceStream !== candidateStream) {
    throw new Error(
      diffCanonicalStreams(scenarioId, SCENARIOS[scenarioId].seed, reference, candidate),
    );
  }
  expect(candidateStream).toBe(referenceStream);
}

describe('determinism across execution modes (complete canonical streams)', () => {
  for (const scenarioId of SCENARIO_IDS) {
    it(`scenario ${scenarioId}: tick-batch sizes 1, 5, and 20 produce identical complete streams`, () => {
      const runs = [1, 5, 20].map((batchSize) => {
        const host = new SimulationHost();
        host.loadScenario(scenarioId);
        while (!host.terminal) host.stepTicks(batchSize);
        return host.activeRun!;
      });
      expect(runs[1]!.worldStateHash).toBe(runs[0]!.worldStateHash);
      expect(runs[2]!.worldStateHash).toBe(runs[0]!.worldStateHash);
      expect(runs[1]!.canonicalLedgerHash).toBe(runs[0]!.canonicalLedgerHash);
      expect(runs[2]!.canonicalLedgerHash).toBe(runs[0]!.canonicalLedgerHash);
      expectIdenticalStreams(scenarioId, runs[0]!.ledger.events, runs[1]!.ledger.events);
      expectIdenticalStreams(scenarioId, runs[0]!.ledger.events, runs[2]!.ledger.events);
    });
  }

  it('direct Node host execution and repeated clean runs produce identical complete streams', () => {
    const first = createRun('D');
    runToCompletion(first);
    const second = createRun('D');
    runToCompletion(second);
    expect(second.worldStateHash).toBe(first.worldStateHash);
    expect(second.canonicalLedgerHash).toBe(first.canonicalLedgerHash);
    expectIdenticalStreams('D', first.ledger.events, second.ledger.events);
  });

  it('pausing and resuming mid-run never changes the canonical projection or hashes', () => {
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

    expect(paused.activeRun!.worldStateHash).toBe(plain.activeRun!.worldStateHash);
    expect(paused.activeRun!.canonicalLedgerHash).toBe(plain.activeRun!.canonicalLedgerHash);
    // The canonical projection filters the four operator markers entirely.
    expectIdenticalStreams('A', plain.activeRun!.ledger.events, paused.activeRun!.ledger.events);
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
    expect(again.worldStateHash).toBe(referenceA.worldStateHash);
    expectIdenticalStreams('A', referenceA.ledger.events, again.ledger.events);
  });

  it('the stream diff reporter localizes a divergence precisely', () => {
    const run = createRun('A');
    runToCompletion(run);
    const doctored = run.ledger.events.map((e, i) =>
      i === 40 ? { ...e, payload: { ...(e.payload as object), doctored: 1 } } : e,
    );
    const message = diffCanonicalStreams(
      'A',
      SCENARIOS.A.seed,
      run.ledger.events,
      doctored as typeof run.ledger.events,
    );
    expect(message).toContain('scenario=A');
    expect(message).toContain(`seed=${SCENARIOS.A.seed}`);
    expect(message).toContain('first-divergence-at-canonical-index=');
    expect(message).toContain('payload:');
  });
});
