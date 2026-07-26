import { BENCH_RESOURCE_ID, REPAIR_TOTAL_UNITS } from '../config';
import { NPC_IDS, type NpcId } from '../../shared/ids';
import type { CanonicalState } from '../domain/state';
import { fnv1a64Hex } from '../replay/hash';
import { canonicalSerialize } from '../replay/serialize';

/**
 * Hard dependency fingerprint (remediation 1, section 5.5).
 *
 * A compact projection of the conditions whose change should invalidate a
 * pending decision request: actor incapacity/location/transit/current action,
 * every NPC's injury and treatment status, meal existence and reservation,
 * bench occupancy, task completion, commitment status/terms/proposals,
 * pending transfer requests, and scenario terminal state.
 *
 * Soft utility inputs — hunger and fatigue, which drift every tick — are
 * deliberately EXCLUDED: a global-revision equality test would make every
 * delayed response stale. Soft drift is bounded instead by response
 * expiration plus the constraint and action-validation gates that rerun at
 * acceptance time.
 *
 * The ACTOR's own location, transit, and current action are also excluded:
 * a deferred request's provisional fallback action (and ordinary continued
 * activity) must not permanently invalidate the request it is bridging —
 * the audit's preemption rule requires a late valid response to displace an
 * interruptible action. The actor's own occupancy is enforced authoritatively
 * by the acceptance gate's dedicated interruptibility/transit checks, and
 * travel is re-planned from the current location at launch. The actor's own
 * incapacity and injury/treatment status ARE included (they change action
 * legality and the mandatory constraint set).
 *
 * The projection contains only integers, strings, booleans, and null, and is
 * hashed with the same canonical serializer + FNV-1a 64 used everywhere else.
 */
export function hardDependencyFingerprint(state: CanonicalState, actorId: NpcId): string {
  const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
  const projection = {
    actorId,
    terminal: state.terminal,
    taskComplete: state.purifier.progressUnits >= REPAIR_TOTAL_UNITS,
    benchHolderNpcId: bench ? bench.holderNpcId : null,
    meal: {
      exists: state.meal.exists,
      reservedForNpcId: state.meal.reservedForNpcId,
    },
    npcs: NPC_IDS.map((npcId) => {
      const npc = state.npcs[npcId];
      const action = npc.currentAction;
      const isActor = npcId === actorId;
      return {
        id: npcId,
        incapacitated: npc.incapacitated,
        locationId: isActor ? null : npc.locationId,
        transitTo: isActor || !npc.transit ? null : npc.transit.toLocationId,
        injurySeverityMicro: npc.injury.severityMicro,
        treatmentStarted: npc.injury.treatmentStartedTick !== null,
        currentAction:
          action && !isActor
            ? {
                mode: action.mode,
                phase: action.phase,
                interruptible: action.interruptible,
                targetNpcId: action.targetNpcId,
              }
            : null,
      };
    }),
    commitments: state.commitments.map((c) => ({
      id: c.id,
      status: c.status,
      terms: { ...c.terms },
      pendingProposalId: c.pendingProposal ? c.pendingProposal.proposalId : null,
    })),
    pendingTransferRequests: state.pendingTransferRequests.map((r) => ({
      requestId: r.requestId,
      resourceId: r.resourceId,
      requesterNpcId: r.requesterNpcId,
      ownerNpcId: r.ownerNpcId,
    })),
  };
  return fnv1a64Hex(canonicalSerialize(projection));
}
