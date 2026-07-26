import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/sim/scenarios/initialState';
import { getScenario } from '../../src/sim/scenarios/definitions';
import { buildMaraPersistenceStats } from '../../src/sim/reporting';
import { completedRun } from '../helpers';

describe('B1/B2 memory ablation', () => {
  it('B1 and B2 share a seed and differ only through Mara’s criticism memory', () => {
    const b1 = getScenario('B1');
    const b2 = getScenario('B2');
    expect(b1.seed).toBe(b2.seed);
    const s1 = buildInitialState(b1);
    const s2 = buildInitialState(b2);
    // Remove the single expected difference, then require deep equality.
    s1.npcs.mara.memories = s1.npcs.mara.memories.filter((m) => m.id !== 'mem-mara-criticism');
    s2.scenarioId = 'B1';
    expect(s2).toEqual(s1);
  });

  it('the memory measurably alters Mara’s behavior in a controlled comparison', () => {
    const b1 = buildMaraPersistenceStats(completedRun('B1').ledger.events);
    const b2 = buildMaraPersistenceStats(completedRun('B2').ledger.events);
    // With the criticism memory, Mara persists at work and does not ask for
    // relief; without it she requests breaks and works measurably less.
    expect(b1.workTicks).toBeGreaterThan(b2.workTicks);
    expect(b1.breakRequestCount).toBe(0);
    expect(b2.breakRequestCount).toBeGreaterThan(0);
    expect(b1.firstBreakRequestTick).toBeNull();
    expect(b2.firstBreakRequestTick).not.toBeNull();
  });

  it('the memory does not alter action legality or survival constraints', () => {
    // Both runs satisfy the same invariants; the memory only shifts preferences.
    const b1 = completedRun('B1');
    const b2 = completedRun('B2');
    for (const run of [b1, b2]) {
      expect(run.state.terminal).toBe(true);
      expect(run.ledger.events.filter((e) => e.type === 'MealConsumed').length).toBeLessThanOrEqual(
        1,
      );
    }
  });
});
