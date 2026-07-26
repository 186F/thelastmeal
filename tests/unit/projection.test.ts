import { describe, expect, it } from 'vitest';
import { applyEvent } from '../../src/sim/events/reduce';
import { freshState, mkEvent } from '../helpers';

describe('state projection from events (reducer)', () => {
  it('TimeAdvanced applies fixed hunger and fatigue drift to all NPCs', () => {
    const state = freshState('A');
    const hunger0 = state.npcs.mara.hungerMicro;
    const fatigue0 = state.npcs.mara.fatigueMicro;
    applyEvent(state, mkEvent('TimeAdvanced', 1, { tick: 1 }));
    expect(state.tick).toBe(1);
    expect(state.npcs.mara.hungerMicro).toBe(hunger0 + 50);
    expect(state.npcs.mara.fatigueMicro).toBe(fatigue0 + 25);
    expect(state.npcs.rin.hungerMicro).toBe(800_000 + 50);
  });

  it('hunger and fatigue clamp at 1.0', () => {
    const state = freshState('A');
    state.npcs.mara.hungerMicro = 999_990; // direct setup for the clamp check
    applyEvent(state, mkEvent('TimeAdvanced', 1, { tick: 1 }));
    expect(state.npcs.mara.hungerMicro).toBe(1_000_000);
  });

  it('RepairProgressed accumulates and validates against payload', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('RepairProgressed', 1, { npcId: 'mara', unitsDelta: 20, progressUnits: 72_020 }),
    );
    expect(state.purifier.progressUnits).toBe(72_020);
    expect(() =>
      applyEvent(
        state,
        mkEvent('RepairProgressed', 2, { npcId: 'mara', unitsDelta: 20, progressUnits: 99 }),
      ),
    ).toThrow(/repair-mismatch/);
  });

  it('MealConsumed destroys the meal and applies the hunger effect exactly once', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('MealConsumed', 10, {
        npcId: 'rin',
        resourceId: 'meal-1',
        hungerBeforeMicro: 800_000,
        hungerAfterMicro: 250_000,
        violation: false,
      }),
    );
    expect(state.meal.exists).toBe(false);
    expect(state.meal.consumedByNpcId).toBe('rin');
    expect(state.npcs.rin.hungerMicro).toBe(250_000);
    // A second consumption of the same meal must be impossible.
    expect(() =>
      applyEvent(
        state,
        mkEvent('MealConsumed', 11, {
          npcId: 'mara',
          resourceId: 'meal-1',
          hungerBeforeMicro: 700_000,
          hungerAfterMicro: 150_000,
          violation: true,
        }),
      ),
    ).toThrow(/double-consumption/);
  });

  it('rejects duplicate exclusive reservations for the same resource', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('ResourceReserved', 0, {
        resourceId: 'workbench-slot',
        holderNpcId: 'mara',
        kind: 'exclusive-use',
      }),
    );
    expect(() =>
      applyEvent(
        state,
        mkEvent('ResourceReserved', 1, {
          resourceId: 'workbench-slot',
          holderNpcId: 'jonas',
          kind: 'exclusive-use',
        }),
      ),
    ).toThrow(/duplicate-exclusive-reservation/);
  });

  it('prevents contradictory commitment outcomes', () => {
    const state = freshState('A');
    const terms = { startTick: 900, graceTick: 1020, minDurationTicks: 300 };
    applyEvent(
      state,
      mkEvent('CommitmentCreated', 0, {
        commitmentId: 'cmt-x',
        kind: 'relieve-at-bench',
        debtorId: 'jonas',
        creditorId: 'mara',
        terms,
      }),
    );
    applyEvent(
      state,
      mkEvent('CommitmentFulfilled', 10, {
        commitmentId: 'cmt-x',
        reliefStartTick: 1,
        reliefEndTick: 10,
      }),
    );
    expect(state.commitments[0]!.status).toBe('fulfilled');
    expect(() =>
      applyEvent(
        state,
        mkEvent('CommitmentBroken', 11, { commitmentId: 'cmt-x', reasonCode: 'x' }),
      ),
    ).toThrow(/broken-after-fulfilled/);
  });

  it('prevents a commitment from being recorded broken twice', () => {
    const state = freshState('A');
    const terms = { startTick: 900, graceTick: 1020, minDurationTicks: 300 };
    applyEvent(
      state,
      mkEvent('CommitmentCreated', 0, {
        commitmentId: 'cmt-y',
        kind: 'relieve-at-bench',
        debtorId: 'jonas',
        creditorId: 'mara',
        terms,
      }),
    );
    applyEvent(state, mkEvent('CommitmentBroken', 5, { commitmentId: 'cmt-y', reasonCode: 'x' }));
    expect(() =>
      applyEvent(state, mkEvent('CommitmentBroken', 6, { commitmentId: 'cmt-y', reasonCode: 'x' })),
    ).toThrow(/broken-twice/);
  });

  it('BeliefUpdated upserts by belief ID', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('BeliefUpdated', 3, {
        npcId: 'jonas',
        beliefId: 'bel-jonas-injury:rin',
        subject: 'injury:rin',
        value: 'serious',
        confidenceMicro: 900_000,
        provenanceKind: 'perception',
        provenanceEventId: 'evt-000001',
      }),
    );
    const belief = state.npcs.jonas.beliefs.find((b) => b.id === 'bel-jonas-injury:rin');
    expect(belief?.value).toBe('serious');
    applyEvent(
      state,
      mkEvent('BeliefUpdated', 9, {
        npcId: 'jonas',
        beliefId: 'bel-jonas-injury:rin',
        subject: 'injury:rin',
        value: 'treated',
        confidenceMicro: 900_000,
        provenanceKind: 'perception',
        provenanceEventId: 'evt-000002',
      }),
    );
    const updated = state.npcs.jonas.beliefs.filter((b) => b.id === 'bel-jonas-injury:rin');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.value).toBe('treated');
    expect(updated[0]!.updatedTick).toBe(9);
  });

  it('pause and resume markers change nothing canonical, including stateVersion', () => {
    const state = freshState('A');
    const before = JSON.stringify(state);
    applyEvent(state, mkEvent('SimulationPaused', 4, {}));
    applyEvent(state, mkEvent('SimulationResumed', 4, {}));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rest completion reduces fatigue, clamped at zero', () => {
    const state = freshState('A');
    // Start a rest action, then complete it.
    applyEvent(
      state,
      mkEvent('ActionStarted', 10, {
        actionId: 'act-r1',
        affordanceId: 'aff:jonas:10:rest',
        npcId: 'jonas',
        category: 'rest-or-wait',
        mode: 'rest',
        targetNpcId: null,
        targetResourceId: null,
        locationId: null,
        durationTicks: 300,
        stateVersion: 0,
        interruptible: true,
        violation: false,
        commitmentId: null,
        proposalId: null,
        requestId: null,
        proposedTerms: null,
        completesAtTick: 310,
      }),
    );
    const fatigueBefore = state.npcs.jonas.fatigueMicro;
    applyEvent(
      state,
      mkEvent('ActionCompleted', 310, {
        actionId: 'act-r1',
        npcId: 'jonas',
        category: 'rest-or-wait',
        mode: 'rest',
        startedTick: 10,
        outcomeCode: 'rest-applied',
      }),
    );
    expect(state.npcs.jonas.fatigueMicro).toBe(Math.max(0, fatigueBefore - 100_000));
    expect(state.npcs.jonas.currentAction).toBeNull();
  });
});
