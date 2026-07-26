import { describe, expect, it } from 'vitest';
import type { BatchReport } from '../../src/shared/reports';
import { runFullBatch } from '../../src/sim/batch';

/**
 * 100 repeated runs per scenario, split into two 50-run batches so no single
 * synchronous test blocks the worker's event loop past Vitest's RPC window.
 * Coverage is NOT weakened: each half verifies complete canonical
 * event-stream equality across its 50 runs, and the cross-half check pins
 * both halves to identical world-state AND ledger hashes per scenario —
 * i.e. 100 total runs per scenario against one reference stream. The
 * standalone `npm run batch` (default 100 runs, used by the scheduled CI
 * workflow) additionally exercises the single-batch form.
 */
describe('100-run deterministic batch (two 50-run halves)', () => {
  const reports: BatchReport[] = [];

  for (const half of [1, 2]) {
    it(
      `fifty repeated runs per scenario, half ${half}/2: zero violations, stable hashes and streams`,
      { timeout: 300_000 },
      () => {
        const { report } = runFullBatch({ runsPerScenario: 50 });
        expect(report.determinism.invariantViolations).toEqual([]);
        expect(report.determinism.allHashesStable).toBe(true);
        expect(report.determinism.allEventStreamsStable).toBe(true);
        expect(report.scenarios.every((s) => s.replayHashMatch)).toBe(true);
        expect(report.ok).toBe(true);
        reports.push(report);
      },
    );
  }

  it('both halves agree on every scenario world and ledger hash (100 total runs each)', () => {
    expect(reports).toHaveLength(2);
    const [first, second] = reports;
    for (let i = 0; i < first!.scenarios.length; i += 1) {
      const a = first!.scenarios[i]!;
      const b = second!.scenarios[i]!;
      expect(b.worldStateHash, `scenario ${a.scenarioId}`).toBe(a.worldStateHash);
      expect(b.canonicalLedgerHash, `scenario ${a.scenarioId}`).toBe(a.canonicalLedgerHash);
      expect(b.eventCount, `scenario ${a.scenarioId}`).toBe(a.eventCount);
    }
  });
});
