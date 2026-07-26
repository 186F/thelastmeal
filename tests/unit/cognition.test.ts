import { describe, expect, it } from 'vitest';
import { MARA_CRITICISM_MEMORY_ID } from '../../src/sim/domain/identities';
import { completedRun, eventsOfType, firstEventOfType } from '../helpers';

describe('fact / perception / belief / memory separation', () => {
  it('a canonical fact produces per-NPC perception records referencing the fact', () => {
    const run = completedRun('C');
    const injury = firstEventOfType(run, 'InjuryOccurred')!;
    const perceptions = eventsOfType(run, 'PerceptionRecorded').filter(
      (e) => (e.payload as { sourceEventId: string }).sourceEventId === injury.id,
    );
    expect(perceptions).toHaveLength(3); // shared room: all three NPCs perceive
    for (const p of perceptions) {
      expect(p.causationId).toBe(injury.id);
      expect((p.payload as { sourceEventType: string }).sourceEventType).toBe('InjuryOccurred');
    }
  });

  it('beliefs derive from perceptions with explicit provenance, never from the fact directly', () => {
    const run = completedRun('C');
    const injury = firstEventOfType(run, 'InjuryOccurred')!;
    const perceptionIds = new Set(
      eventsOfType(run, 'PerceptionRecorded')
        .filter((e) => (e.payload as { sourceEventId: string }).sourceEventId === injury.id)
        .map((e) => e.id),
    );
    const beliefUpdates = eventsOfType(run, 'BeliefUpdated').filter(
      (e) => (e.payload as { subject: string }).subject === 'injury:rin',
    );
    expect(beliefUpdates.length).toBeGreaterThanOrEqual(3);
    const first = beliefUpdates[0]!.payload as {
      value: string;
      provenanceKind: string;
      provenanceEventId: string;
    };
    expect(first.value).toBe('serious');
    expect(first.provenanceKind).toBe('perception');
    expect(perceptionIds.has(first.provenanceEventId)).toBe(true);
  });

  it('belief values track later facts (being-treated, then treated)', () => {
    const run = completedRun('C');
    const belief = run.state.npcs.mara.beliefs.find((b) => b.subject === 'injury:rin');
    expect(belief?.value).toBe('treated');
    expect(belief?.provenanceKind).toBe('perception');
  });

  it('pre-scenario memories keep fact, perception, interpretation, confidence, importance apart', () => {
    const run = completedRun('A');
    const memory = run.state.npcs.mara.memories.find((m) => m.id === MARA_CRITICISM_MEMORY_ID)!;
    expect(memory.canonicalFact).toContain('player-criticized-mara');
    expect(memory.perception).toBe('heard-directly');
    expect(memory.interpretation).toBe('attack-on-competence');
    expect(memory.confidenceMicro).toBe(900_000);
    expect(memory.importanceMicro).toBe(900_000);
    expect(memory.preScenario).toBe(true);
    expect(memory.factEventId).toBeNull();
    // Typed appraisal is stored alongside, separately inspectable.
    expect(memory.themes).toEqual(['competence-threat']);
    expect(memory.socialTargetId).toBeNull();
  });

  it('runtime memories cite the canonical fact event (treatment memory)', () => {
    const run = completedRun('C');
    const treatment = firstEventOfType(run, 'TreatmentCompleted')!;
    const memory = run.state.npcs.rin.memories.find((m) => m.factEventId === treatment.id);
    expect(memory).toBeDefined();
    expect(memory!.canonicalFact).toBe('treated-by-jonas');
    expect(memory!.preScenario).toBe(false);
    expect(memory!.createdTick).toBe(treatment.tick);
  });
});
