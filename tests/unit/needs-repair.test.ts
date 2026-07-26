import { describe, expect, it } from 'vitest';
import {
  FATIGUE_RATE_PER_TICK,
  HUNGER_RATE_PER_TICK,
  REPAIR_INITIAL_UNITS,
  REPAIR_RATE_PER_TICK,
  REPAIR_TOTAL_UNITS,
} from '../../src/sim/config';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { completedRun, eventsOfType } from '../helpers';

describe('needs update rates through the engine', () => {
  it('applies exactly the fixed hunger/fatigue drift per tick', () => {
    const run = createRun('A');
    const hunger0 = run.state.npcs.jonas.hungerMicro;
    const fatigue0 = run.state.npcs.jonas.fatigueMicro;
    for (let i = 0; i < 120; i += 1) stepTick(run);
    expect(run.state.npcs.jonas.hungerMicro).toBe(hunger0 + 120 * HUNGER_RATE_PER_TICK);
    expect(run.state.npcs.jonas.fatigueMicro).toBe(fatigue0 + 120 * FATIGUE_RATE_PER_TICK);
  });

  it('hunger drift equals 0.003 per simulated minute in micro units', () => {
    expect(HUNGER_RATE_PER_TICK * 60).toBe(3_000);
    expect(FATIGUE_RATE_PER_TICK * 60).toBe(1_500);
  });
});

describe('repair-rate calculations', () => {
  it('fixed rates are exact integers per tick matching the brief percentages', () => {
    // 1 pp/min == 1200 units/min == 20 units/tick, etc.
    expect(REPAIR_RATE_PER_TICK.mara).toBe(20);
    expect(REPAIR_RATE_PER_TICK.jonas).toBe(14);
    expect(REPAIR_RATE_PER_TICK.rin).toBe(7);
    expect(REPAIR_INITIAL_UNITS / REPAIR_TOTAL_UNITS).toBe(0.6);
  });

  it('Mara repairs at 1.00 percentage point per simulated minute from tick 1', () => {
    const run = createRun('A');
    for (let i = 0; i < 60; i += 1) stepTick(run);
    // Mara works the bench from tick 0; one simulated minute adds 1200 units.
    expect(run.state.purifier.progressUnits).toBe(REPAIR_INITIAL_UNITS + 1_200);
  });

  it('progress never exceeds 100% and completion is recorded exactly once', () => {
    const run = completedRun('A');
    expect(run.state.purifier.progressUnits).toBeLessThanOrEqual(REPAIR_TOTAL_UNITS);
    for (const e of eventsOfType(run, 'RepairProgressed')) {
      const p = e.payload as { progressUnits: number; unitsDelta: number };
      expect(p.progressUnits).toBeLessThanOrEqual(REPAIR_TOTAL_UNITS);
      expect(p.unitsDelta).toBeGreaterThan(0);
    }
    expect(eventsOfType(run, 'TaskCompleted')).toHaveLength(1);
    expect(eventsOfType(run, 'TaskDeadlineMissed')).toHaveLength(0);
  });
});
