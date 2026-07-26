import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '../../src/shared/ids';
import { checkInvariants } from '../../src/sim/invariants';
import { getScenario } from '../../src/sim/scenarios/definitions';
import { completedRun, eventsOfType, firstEventOfType } from '../helpers';

describe('every scenario runs to a valid terminal state', () => {
  for (const id of SCENARIO_IDS) {
    it(`scenario ${id} terminates with zero invariant violations`, () => {
      const run = completedRun(id);
      expect(run.state.terminal).toBe(true);
      expect(run.state.tick).toBe(2700);
      expect(run.finalStateHash).toMatch(/^[0-9a-f]{16}$/);
      expect(['completed', 'deadline-missed']).toContain(run.state.taskOutcome);
      const violations = checkInvariants(getScenario(id), run.ledger.events, run.state);
      expect(violations).toEqual([]);
    });
  }
});

describe('scenario-specific outcomes', () => {
  it('A: routine operation — meal eaten once by Rin, promise fulfilled, no injuries', () => {
    const run = completedRun('A');
    expect(run.state.meal.consumedByNpcId).toBe('rin');
    expect(eventsOfType(run, 'MealConsumed')).toHaveLength(1);
    expect(run.state.commitments[0]!.status).toBe('fulfilled');
    expect(eventsOfType(run, 'InjuryOccurred')).toHaveLength(0);
  });

  it('C: promise versus emergency — treatment and renegotiated relief, never both at once', () => {
    const run = completedRun('C');
    expect(firstEventOfType(run, 'TreatmentCompleted')).toBeDefined();
    expect(run.state.commitments[0]!.status).toBe('fulfilled');
    expect(run.state.commitments[0]!.renegotiated).toBe(true);
    // Silence never counts as acceptance: an explicit acceptance event exists.
    expect(firstEventOfType(run, 'CommitmentRenegotiationAccepted')).toBeDefined();
  });

  it('D: scarce resource conflict — request, refusal, and exact outcomes recorded', () => {
    const run = completedRun('D');
    expect(firstEventOfType(run, 'ReservationTransferRequested')).toBeDefined();
    expect(firstEventOfType(run, 'ReservationTransferRefused')).toBeDefined();
    // Rin keeps or consumes her own meal; the ledger records which.
    expect(run.state.meal.consumedByNpcId).toBe('rin');
  });

  it('E: stale decision — eat rejected cleanly, no phantom meal, actor re-decides', () => {
    const run = completedRun('E');
    expect(eventsOfType(run, 'MealConsumed')).toHaveLength(0);
    const rejection = eventsOfType(run, 'ActionRejected').find(
      (e) => (e.payload as { category: string }).category === 'eat-meal',
    );
    expect(rejection).toBeDefined();
    const p = rejection!.payload as { npcId: string; failedPreconditions: string[] };
    expect(p.failedPreconditions).toContain('meal-missing');
    // The NPC got a new decision after the rejection.
    const later = eventsOfType(run, 'DecisionRequested').some(
      (e) => e.tick > rejection!.tick && (e.payload as { npcId: string }).npcId === p.npcId,
    );
    expect(later).toBe(true);
  });

  it('F: provider failure — recorded failures, fallback continuation, valid terminal outcome', () => {
    const run = completedRun('F');
    const failures = eventsOfType(run, 'DecisionProviderFailed');
    const fallbacks = eventsOfType(run, 'FallbackDecisionUsed');
    expect(failures.length).toBeGreaterThan(0);
    expect(fallbacks.length).toBe(failures.length);
    // No provider failure before minute 10; every decision after fails.
    expect(failures.every((e) => e.tick >= 600)).toBe(true);
    expect(run.state.terminal).toBe(true);
  });
});
