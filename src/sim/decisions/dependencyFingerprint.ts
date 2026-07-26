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
 * TRANSIENT ACTIVITY — every NPC's current action, location, and transit —
 * is also excluded, for two reasons the audit's own design anticipates:
 *
 *  1. The actor's side: a deferred request's provisional fallback action
 *     (and ordinary continued activity) must not permanently invalidate the
 *     request it is bridging — the preemption rule requires a late valid
 *     response to displace an interruptible action. Actor occupancy is
 *     enforced authoritatively by the acceptance gate's dedicated
 *     interruptibility/transit checks.
 *  2. The others' side: requests are created inside the per-NPC decision
 *     phase, where later-ordered NPCs can be MID-TICK transiently actionless
 *     (their action completed earlier in the same tick and re-launches later
 *     in the same tick). A fingerprint over that transient snapshot is
 *     unreproducible at the response-drain point, permanently invalidating
 *     perfectly valid late responses. Durable consequences of activity
 *     changes (bench occupancy, reservations, treatment markers) ARE
 *     fingerprinted, and the selected action is independently revalidated
 *     against live state at acceptance and again on arrival after any travel
 *     leg — exactly the audit's "final constraint and action revalidation
 *     gates".
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
      return {
        id: npcId,
        incapacitated: npc.incapacitated,
        injurySeverityMicro: npc.injury.severityMicro,
        treatmentStarted: npc.injury.treatmentStartedTick !== null,
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
