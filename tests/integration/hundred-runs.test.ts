import { describe, expect, it } from 'vitest';
import { runFullBatch } from '../../src/sim/batch';

describe('100-run deterministic batch', () => {
  it(
    'one hundred repeated runs per scenario produce zero invariant violations and stable hashes',
    { timeout: 300_000 },
    () => {
      const { report } = runFullBatch({ runsPerScenario: 100 });
      expect(report.determinism.invariantViolations).toEqual([]);
      expect(report.determinism.allHashesStable).toBe(true);
      expect(report.scenarios.every((s) => s.replayHashMatch)).toBe(true);
      expect(report.ok).toBe(true);
    },
  );
});
