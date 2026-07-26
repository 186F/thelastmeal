import { describe, expect, it } from 'vitest';
import { INJURY_INITIAL_SEVERITY, INJURY_WORSENED_SEVERITY } from '../../src/sim/config';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { completedRun, eventsOfType, firstEventOfType } from '../helpers';

describe('injury lifecycle', () => {
  it('scenario C injures Rin at exactly minute 12 with severity 0.55', () => {
    const run = createRun('C');
    for (let i = 0; i < 719; i += 1) stepTick(run);
    expect(run.state.npcs.rin.injury.injuredAtTick).toBeNull();
    stepTick(run); // tick 720
    expect(run.state.npcs.rin.injury.injuredAtTick).toBe(720);
    expect(run.state.npcs.rin.injury.severityMicro).toBe(INJURY_INITIAL_SEVERITY);
    expect(run.state.npcs.rin.incapacitated).toBe(false);
  });

  it('Rin cannot perform repair work after the injury', () => {
    const run = completedRun('C');
    for (const e of eventsOfType(run, 'ActionStarted')) {
      const p = e.payload as { npcId: string; mode: string };
      if (p.npcId === 'rin' && (p.mode === 'work' || p.mode === 'relieve')) {
        expect(e.tick).toBeLessThan(720);
      }
    }
  });

  it('untreated injury worsens to 0.85 and incapacitates at minute 22 (scenario F)', () => {
    const run = completedRun('F');
    const worsened = firstEventOfType(run, 'InjuryWorsened');
    expect(worsened).toBeDefined();
    expect(worsened!.tick).toBe(720 + 600);
    expect((worsened!.payload as { severityMicro: number }).severityMicro).toBe(
      INJURY_WORSENED_SEVERITY,
    );
    expect(run.state.npcs.rin.incapacitated).toBe(true);
    expect(eventsOfType(run, 'TreatmentStarted')).toHaveLength(0);
  });

  it('treatment begun in time prevents worsening and applies the healer outcome (scenario C)', () => {
    const run = completedRun('C');
    expect(eventsOfType(run, 'InjuryWorsened')).toHaveLength(0);
    const started = firstEventOfType(run, 'TreatmentStarted');
    const completed = firstEventOfType(run, 'TreatmentCompleted');
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(started!.tick).toBeLessThan(720 + 600);
    const payload = completed!.payload as {
      healerId: string;
      patientId: string;
      severityAfterMicro: number;
    };
    // Jonas treats in 4 simulated minutes and lowers severity to 0.15.
    expect(payload.healerId).toBe('jonas');
    expect(payload.patientId).toBe('rin');
    expect(payload.severityAfterMicro).toBe(150_000);
    expect(completed!.tick - started!.tick).toBe(240);
    expect(run.state.npcs.rin.injury.severityMicro).toBe(150_000);
  });

  it('treatment success raises the patient-to-healer relationship by 0.10', () => {
    const run = completedRun('C');
    const rel = run.state.relationships.find((r) => r.fromNpcId === 'rin' && r.toNpcId === 'jonas');
    expect(rel?.valueMicro).toBe(100_000);
    // ...but does not erase Rin's suspicious memory of Jonas.
    expect(run.state.npcs.rin.memories.some((m) => m.id === 'mem-rin-supply-taken')).toBe(true);
  });
});
