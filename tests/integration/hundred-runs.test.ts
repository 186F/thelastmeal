import { describe, expect, it } from 'vitest';
import type { BatchReport } from '../../src/shared/reports';
import { runFullBatch } from '../../src/sim/batch';

/**
 * 100 repeated runs per scenario, split into five 20-run batches so no single
 * synchronous test blocks its worker's event loop past Vitest's 60s RPC
 * window (a 50-run half already exceeds it on slower CI runners). Coverage is
 * NOT weakened: each chunk verifies complete canonical event-stream equality
 * across its 20 runs, and the cross-chunk check pins all five chunks to
 * identical world-state AND ledger hashes per scenario — i.e. 100 total runs
 * per scenario against one reference stream. The standalone `npm run batch`
 * (default 100 runs, used by the scheduled CI workflow) additionally
 * exercises the single-batch form.
 */
const CHUNKS = 5;
const RUNS_PER_CHUNK = 20;

describe(`100-run deterministic batch (${CHUNKS} x ${RUNS_PER_CHUNK}-run chunks)`, () => {
  const reports: BatchReport[] = [];

  for (let chunk = 1; chunk <= CHUNKS; chunk += 1) {
    it(
      `${RUNS_PER_CHUNK} repeated runs per scenario, chunk ${chunk}/${CHUNKS}: zero violations, stable hashes and streams`,
      { timeout: 300_000 },
      () => {
        const { report } = runFullBatch({ runsPerScenario: RUNS_PER_CHUNK });
        expect(report.determinism.invariantViolations).toEqual([]);
        expect(report.determinism.allHashesStable).toBe(true);
        expect(report.determinism.allEventStreamsStable).toBe(true);
        expect(report.scenarios.every((s) => s.replayHashMatch)).toBe(true);
        expect(report.ok).toBe(true);
        reports.push(report);
      },
    );
  }

  it('all chunks agree on every scenario world and ledger hash (100 total runs each)', () => {
    expect(reports).toHaveLength(CHUNKS);
    const [first, ...rest] = reports;
    for (const other of rest) {
      for (let i = 0; i < first!.scenarios.length; i += 1) {
        const a = first!.scenarios[i]!;
        const b = other.scenarios[i]!;
        expect(b.worldStateHash, `scenario ${a.scenarioId}`).toBe(a.worldStateHash);
        expect(b.canonicalLedgerHash, `scenario ${a.scenarioId}`).toBe(a.canonicalLedgerHash);
        expect(b.eventCount, `scenario ${a.scenarioId}`).toBe(a.eventCount);
      }
    }
  });
});
