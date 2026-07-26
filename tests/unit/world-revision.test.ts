import { describe, expect, it } from 'vitest';
import { EVENT_TYPES } from '../../src/shared/ids';
import { ADVANCES_WORLD_REVISION, applyEvent } from '../../src/sim/events/reduce';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { eventsOfType, freshState, mkEvent } from '../helpers';

/**
 * Remediation 1: worldRevision semantics. Advances only for events that
 * mutate state relevant to action legality, decision context, or future
 * behavior; never for decision-lifecycle bookkeeping, diagnostics, or
 * operator markers. Classification is static per event type.
 */

describe('worldRevision classification', () => {
  it('covers every event type exactly once', () => {
    expect(Object.keys(ADVANCES_WORLD_REVISION).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('never advances for the decision lifecycle, diagnostics, or operator markers', () => {
    for (const type of [
      'DecisionRequested',
      'DecisionResponseReceived',
      'DecisionResponseAccepted',
      'DecisionResponseRejected',
      'DecisionRequestExpired',
      'DecisionRequestSuperseded',
      'DecisionProviderFailed',
      'FallbackDecisionUsed',
      'SimulationPaused',
      'SimulationResumed',
      'PerceptionRecorded',
    ] as const) {
      expect(ADVANCES_WORLD_REVISION[type], type).toBe(false);
    }
  });

  it('advances for time, actions, movement, resources, injuries, commitments, and cognition', () => {
    for (const type of [
      'TimeAdvanced',
      'ActionProposed',
      'ActionStarted',
      'ActionCompleted',
      'MovementStarted',
      'RepairProgressed',
      'InjuryOccurred',
      'ResourceReserved',
      'MealConsumed',
      'CommitmentCreated',
      'BeliefUpdated',
      'RelationshipChanged',
      'HelpRequested',
      'ScenarioEnded',
    ] as const) {
      expect(ADVANCES_WORLD_REVISION[type], type).toBe(true);
    }
  });
});

describe('worldRevision behavior in the reducer', () => {
  it('TimeAdvanced advances both counters; decision bookkeeping advances stateVersion only', () => {
    const state = freshState('A');
    const sv = state.stateVersion;
    const wr = state.worldRevision;

    applyEvent(state, mkEvent('TimeAdvanced', 1, { tick: 1 }));
    expect(state.stateVersion).toBe(sv + 1);
    expect(state.worldRevision).toBe(wr + 1);

    applyEvent(
      state,
      mkEvent('DecisionRequested', 1, {
        npcId: 'mara',
        requestId: 'dec-0001',
        providerId: 'test',
        stateVersion: state.stateVersion,
        worldRevision: state.worldRevision,
        expiresAtTick: 61,
        hardDependencyFingerprint: '0000000000000000',
        affordanceIds: [],
        offeredAffordances: [],
      }),
    );
    expect(state.stateVersion).toBe(sv + 2);
    expect(state.worldRevision).toBe(wr + 1); // unchanged
  });

  it('a live run records the request-time worldRevision on every DecisionRequested', () => {
    const run = createRun('A');
    for (let i = 0; i < 100; i += 1) stepTick(run);
    const requests = eventsOfType(run, 'DecisionRequested');
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const payload = request.payload as { worldRevision: number };
      expect(payload.worldRevision).toBeGreaterThan(0);
      expect(payload.worldRevision).toBeLessThanOrEqual(run.state.worldRevision);
    }
  });
});
