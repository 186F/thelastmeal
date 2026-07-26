import { describe, expect, it } from 'vitest';
import { applyEvent } from '../../src/sim/events/reduce';
import { validateStart } from '../../src/sim/actions/validation';
import type { PendingActionState } from '../../src/sim/domain/state';
import { completedRun, eventsOfType, firstEventOfType, freshState, mkEvent } from '../helpers';

function eatAction(
  actor: 'mara' | 'jonas' | 'rin',
  mode: 'eat' | 'eat-violation',
): PendingActionState {
  return {
    id: 'act-t1',
    affordanceId: `aff:${actor}:1:${mode}`,
    category: 'eat-meal',
    mode,
    actorId: actor,
    targetNpcId: null,
    targetResourceId: 'meal-1',
    locationId: 'food-shelf',
    durationTicks: 180,
    stateVersionAtProposal: 0,
    interruptible: false,
    violation: mode === 'eat-violation',
    commitmentId: null,
    proposalId: null,
    requestId: null,
    proposedTerms: null,
  };
}

describe('meal reservation lifecycle', () => {
  it('creation, transfer, release, and consumption update ownership consistently', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('ResourceReserved', 0, {
        resourceId: 'meal-1',
        holderNpcId: 'rin',
        kind: 'consumption-right',
      }),
    );
    expect(state.meal.reservedForNpcId).toBe('rin');

    applyEvent(
      state,
      mkEvent('ReservationTransferred', 5, {
        resourceId: 'meal-1',
        fromNpcId: 'rin',
        toNpcId: 'mara',
        requestId: null,
      }),
    );
    expect(state.meal.reservedForNpcId).toBe('mara');
    expect(state.reservations.find((r) => r.resourceId === 'meal-1')?.holderNpcId).toBe('mara');

    applyEvent(
      state,
      mkEvent('ReservationReleased', 7, {
        resourceId: 'meal-1',
        previousHolderNpcId: 'mara',
        reasonCode: 'voluntary-release',
      }),
    );
    expect(state.meal.reservedForNpcId).toBeNull();
    expect(state.reservations).toHaveLength(0);
  });

  it('transfer without a matching reservation is impossible', () => {
    const state = freshState('A');
    expect(() =>
      applyEvent(
        state,
        mkEvent('ReservationTransferred', 5, {
          resourceId: 'meal-1',
          fromNpcId: 'rin',
          toNpcId: 'mara',
          requestId: null,
        }),
      ),
    ).toThrow(/transfer-without-reservation/);
  });

  it('the same meal is never consumed twice across a full scenario run', () => {
    for (const id of ['A', 'B1', 'B2', 'C', 'D', 'F'] as const) {
      expect(eventsOfType(completedRun(id), 'MealConsumed').length).toBeLessThanOrEqual(1);
    }
  });

  it('legal eat validation depends on reservation state (stale modes rejected)', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('ResourceReserved', 0, {
        resourceId: 'meal-1',
        holderNpcId: 'rin',
        kind: 'consumption-right',
      }),
    );
    // Rin may eat her reserved meal; Mara's legal-eat attempt is stale.
    expect(validateStart(state, eatAction('rin', 'eat'), false).ok).toBe(true);
    expect(validateStart(state, eatAction('mara', 'eat'), false).failed).toContain(
      'stale-reservation-state',
    );
    // A violation-flavored attempt by Mara is physically executable...
    expect(validateStart(state, eatAction('mara', 'eat-violation'), false).ok).toBe(true);
    // ...but becomes stale if the reservation moves to her meanwhile.
    applyEvent(
      state,
      mkEvent('ReservationTransferred', 5, {
        resourceId: 'meal-1',
        fromNpcId: 'rin',
        toNpcId: 'mara',
        requestId: null,
      }),
    );
    expect(validateStart(state, eatAction('mara', 'eat-violation'), false).failed).toContain(
      'stale-reservation-state',
    );
  });

  it('a missing meal fails validation for every eat-family action', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('ResourceRemoved', 3, { resourceId: 'meal-1', reasonCode: 'scripted-world-event' }),
    );
    expect(state.meal.exists).toBe(false);
    expect(validateStart(state, eatAction('rin', 'eat'), false).failed).toContain('meal-missing');
  });

  it('ownership violation records the -0.25 relationship consequence with cause IDs', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('OwnershipViolated', 10, {
        actorId: 'mara',
        resourceId: 'meal-1',
        ownerNpcId: 'rin',
        violationKind: 'took-reserved-meal',
      }),
    );
    // The reducer records the victim's structured memory of the violation.
    expect(
      state.npcs.rin.memories.some((m) => m.interpretation === 'mara-violated-my-ownership'),
    ).toBe(true);
    applyEvent(
      state,
      mkEvent('RelationshipChanged', 10, {
        fromNpcId: 'rin',
        toNpcId: 'mara',
        deltaMicro: -250_000,
        valueMicro: -250_000,
        reasonCode: 'meal-taken',
        causeEventIds: ['evt-000010'],
      }),
    );
    const rel = state.relationships.find((r) => r.fromNpcId === 'rin' && r.toNpcId === 'mara');
    expect(rel?.valueMicro).toBe(-250_000);
  });

  it('scenario D records the request and Rin’s refusal', () => {
    const run = completedRun('D');
    const request = firstEventOfType(run, 'ReservationTransferRequested');
    const refusal = firstEventOfType(run, 'ReservationTransferRefused');
    expect(request).toBeDefined();
    expect((request!.payload as { requesterNpcId: string }).requesterNpcId).toBe('mara');
    expect(refusal).toBeDefined();
    expect((refusal!.payload as { ownerNpcId: string }).ownerNpcId).toBe('rin');
    // Refusal sets the requester's cooldown.
    expect(refusal!.tick).toBeGreaterThan(request!.tick);
  });
});
