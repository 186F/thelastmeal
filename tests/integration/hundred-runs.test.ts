import { describe, expect, it } from 'vitest';
import type { BatchReport } from '../../src/shared/reports';
import { runFullBatch } from '../../src/sim/batch';

/**
 * In-suite batch determinism check: two 10-run batches per scenario with
 * cross-chunk equality of world hashes, ledger hashes, and event counts.
 *
 * The AUTHORITATIVE 100-runs-per-scenario gate is the standalone
 * `npm run batch` command (exit-code gated, verifies complete canonical
 * event-stream equality across all 100 repeats), which CI runs on every push
 * and the scheduled deterministic-batch workflow re-runs weekly. It lives
 * outside Vitest deliberately: long CPU-bound batches inside a Vitest worker
 * trip the runner's internal worker-RPC timeout ("Timeout calling
 * onTaskUpdate") on slow CI machines even when every test passes, so the
 * heavy gate uses the plain Node runner where no RPC machinery exists.
 */
const CHUNKS = 2;
const RUNS_PER_CHUNK = 10;

describe(`in-suite batch determinism (${CHUNKS} x ${RUNS_PER_CHUNK}-run chunks; full 100-run gate = npm run batch)`, () => {
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

  it('all chunks agree on every scenario world and ledger hash', () => {
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
