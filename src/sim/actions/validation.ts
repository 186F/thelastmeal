import {
  BENCH_RESOURCE_ID,
  INJURY_NEEDS_TREATMENT_SEVERITY,
  REPAIR_CAPABLE_SEVERITY_LIMIT,
  REPAIR_TOTAL_UNITS,
  TREATMENT_BY_HEALER,
} from '../config';
import type { CanonicalState, PendingActionState } from '../domain/state';

/**
 * Transactional validation for the action pipeline.
 *
 * The same structured checks run: (a) when an action is accepted, (b) again
 * at start after any movement leg (staleness gate), (c) as sustained checks
 * every active tick, and (d) at completion before outcome events commit.
 * A failed check never mutates state; the engine records ActionRejected or
 * ActionInterrupted with the failed precondition codes.
 */

export interface ValidationOutcome {
  ok: boolean;
  failed: string[];
}

const OK: ValidationOutcome = { ok: true, failed: [] };

function fail(...codes: string[]): ValidationOutcome {
  return { ok: false, failed: codes };
}

/** Checks that must hold for the action to begin its active phase. */
export function validateStart(
  state: CanonicalState,
  action: PendingActionState,
  atLocationCheck: boolean,
): ValidationOutcome {
  const npc = state.npcs[action.actorId];
  if (npc.incapacitated) return fail('actor-incapacitated');
  if (state.terminal) return fail('scenario-ended');
  if (atLocationCheck && action.locationId !== null && npc.locationId !== action.locationId) {
    return fail('actor-not-at-required-location');
  }

  switch (action.mode) {
    case 'work': {
      const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
      if (npc.injury.severityMicro >= REPAIR_CAPABLE_SEVERITY_LIMIT) {
        return fail('actor-not-capable-of-repair');
      }
      if (state.purifier.progressUnits >= REPAIR_TOTAL_UNITS)
        return fail('repair-already-complete');
      if (bench && bench.holderNpcId !== action.actorId) return fail('bench-occupied');
      return OK;
    }
    case 'relieve': {
      if (npc.injury.severityMicro >= REPAIR_CAPABLE_SEVERITY_LIMIT) {
        return fail('actor-not-capable-of-repair');
      }
      if (state.purifier.progressUnits >= REPAIR_TOTAL_UNITS)
        return fail('repair-already-complete');
      // Never silently reinterpret against a new target: when the active
      // phase begins, the bench must still be held by the NPC this relieve
      // was proposed for. If they left or were replaced, the action is stale
      // and gets rejected cleanly; the actor re-decides next tick.
      if (atLocationCheck && action.targetNpcId !== null) {
        const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
        if (!bench || bench.holderNpcId !== action.targetNpcId) {
          return fail('stale-relieve-target');
        }
      }
      return OK;
    }
    case 'treat': {
      const patientId = action.targetNpcId;
      if (!patientId) return fail('no-patient');
      const patient = state.npcs[patientId];
      if (!TREATMENT_BY_HEALER[action.actorId]) return fail('healer-not-capable');
      if (patient.injury.severityMicro < INJURY_NEEDS_TREATMENT_SEVERITY) {
        return fail('patient-does-not-need-treatment');
      }
      if (patient.injury.treatmentStartedTick !== null) return fail('treatment-already-started');
      if (atLocationCheck && patient.locationId !== npc.locationId) return fail('patient-absent');
      if (atLocationCheck && patient.transit !== null) return fail('patient-in-transit');
      return OK;
    }
    case 'eat': {
      if (!state.meal.exists) return fail('meal-missing');
      const owner = state.meal.reservedForNpcId;
      if (owner !== null && owner !== action.actorId) return fail('stale-reservation-state');
      return OK;
    }
    case 'eat-violation': {
      if (!state.meal.exists) return fail('meal-missing');
      const owner = state.meal.reservedForNpcId;
      if (owner === null || owner === action.actorId) return fail('stale-reservation-state');
      return OK;
    }
    case 'request-transfer': {
      if (!state.meal.exists) return fail('meal-missing');
      const owner = state.meal.reservedForNpcId;
      if (owner === null || owner === action.actorId) return fail('stale-reservation-state');
      return OK;
    }
    case 'transfer':
    case 'refuse-request': {
      if (!state.meal.exists) return fail('meal-missing');
      if (state.meal.reservedForNpcId !== action.actorId) return fail('actor-not-owner');
      if (
        action.requestId !== null &&
        !state.pendingTransferRequests.some((r) => r.requestId === action.requestId)
      ) {
        return fail('request-no-longer-pending');
      }
      return OK;
    }
    case 'release': {
      if (!state.meal.exists) return fail('meal-missing');
      if (state.meal.reservedForNpcId !== action.actorId) return fail('actor-not-owner');
      return OK;
    }
    case 'ask-help':
    case 'request-break':
      return OK;
    case 'propose-renegotiation': {
      const c = state.commitments.find((x) => x.id === action.commitmentId);
      if (!c || c.status !== 'active') return fail('commitment-not-active');
      if (c.pendingProposal !== null) return fail('proposal-already-pending');
      if (state.tick >= c.terms.graceTick) return fail('past-grace-deadline');
      return OK;
    }
    case 'accept-renegotiation':
    case 'reject-renegotiation': {
      const c = state.commitments.find((x) => x.id === action.commitmentId);
      if (!c || c.status !== 'active') return fail('commitment-not-active');
      if (!c.pendingProposal || c.pendingProposal.proposalId !== action.proposalId) {
        return fail('proposal-no-longer-pending');
      }
      return OK;
    }
    case 'rest':
    case 'wait':
    case 'routine-work':
    case 'deliver-materials':
      return OK;
    case 'stay-at-cot': {
      if (npc.injury.injuredAtTick === null) return fail('actor-not-injured');
      return OK;
    }
    default:
      return fail('unknown-mode');
  }
}

/** Sustained checks evaluated every tick while an action is active. */
export function validateSustained(
  state: CanonicalState,
  action: PendingActionState,
): ValidationOutcome {
  const npc = state.npcs[action.actorId];
  if (npc.incapacitated) return fail('actor-incapacitated');
  switch (action.mode) {
    case 'work':
    case 'relieve': {
      if (npc.injury.severityMicro >= REPAIR_CAPABLE_SEVERITY_LIMIT) {
        return fail('actor-not-capable-of-repair');
      }
      const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
      if (!bench || bench.holderNpcId !== action.actorId) return fail('bench-reservation-lost');
      return OK;
    }
    case 'eat':
    case 'eat-violation': {
      if (!state.meal.exists) return fail('meal-missing');
      return OK;
    }
    case 'treat': {
      const patientId = action.targetNpcId;
      if (!patientId) return fail('no-patient');
      const patient = state.npcs[patientId];
      if (patient.locationId !== npc.locationId || patient.transit !== null) {
        return fail('patient-absent');
      }
      return OK;
    }
    default:
      return OK;
  }
}

/** Checks re-run at completion time, before outcome events commit. */
export function validateCompletion(
  state: CanonicalState,
  action: PendingActionState,
): ValidationOutcome {
  switch (action.mode) {
    case 'eat':
    case 'eat-violation':
      if (!state.meal.exists) return fail('meal-missing');
      return OK;
    case 'treat':
      return validateSustained(state, action);
    case 'transfer':
    case 'refuse-request':
    case 'release':
    case 'request-transfer':
    case 'propose-renegotiation':
    case 'accept-renegotiation':
    case 'reject-renegotiation':
      // These emit their outcome event only if still applicable; the engine
      // downgrades to a 'moot' completion when the world moved on.
      return validateStart(state, action, false);
    default:
      return OK;
  }
}
