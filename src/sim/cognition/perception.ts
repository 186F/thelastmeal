import type { NpcId } from '../../shared/ids';
import { INCAPACITATION_SEVERITY, INJURY_NEEDS_TREATMENT_SEVERITY } from '../config';
import type { CanonicalState } from '../domain/state';
import type { SimEvent } from '../events/types';

/**
 * Perception and belief derivation.
 *
 * The workshop is one small room, so in this slice every NPC is eligible to
 * perceive every significant event (documented simplification; the layer
 * exists so later slices can restrict eligibility). Perception records and
 * belief updates are events themselves, appended by the engine directly after
 * the source event. Beliefs are the only channel through which providers see
 * social facts, so a future slice can let beliefs diverge from canonical
 * truth without touching provider code.
 */

export interface BeliefDelta {
  subject: string;
  value: string;
  confidenceMicro: number;
}

/** Returns a structured summary code if the event is perceivable, else null. */
export function perceivableSummary(state: CanonicalState, event: SimEvent): string | null {
  switch (event.type) {
    case 'InjuryOccurred':
      return `injury:${event.payload.npcId}`;
    case 'InjuryWorsened':
      return `injury-worsened:${event.payload.npcId}`;
    case 'TreatmentStarted':
      return `treatment-started:${event.payload.patientId}`;
    case 'TreatmentCompleted':
      return `treatment-completed:${event.payload.patientId}`;
    case 'MealConsumed':
      return `meal-consumed:${event.payload.npcId}`;
    case 'ResourceRemoved':
      return `resource-removed:${event.payload.resourceId}`;
    case 'ReservationTransferred':
      return `meal-transferred:${event.payload.toNpcId}`;
    case 'ReservationTransferRefused':
      return `meal-request-refused:${event.payload.requesterNpcId}`;
    case 'ReservationTransferRequested':
      return `meal-requested:${event.payload.requesterNpcId}`;
    case 'ReservationReleased':
      return event.payload.resourceId === state.meal.resourceId
        ? `meal-reservation-released`
        : null;
    case 'OwnershipViolated':
      return `ownership-violated:${event.payload.actorId}`;
    case 'CommitmentRenegotiationProposed':
      return `renegotiation-proposed:${event.payload.commitmentId}`;
    case 'CommitmentRenegotiationAccepted':
      return `renegotiation-accepted:${event.payload.commitmentId}`;
    case 'CommitmentRenegotiationRejected':
      return `renegotiation-rejected:${event.payload.commitmentId}`;
    case 'CommitmentFulfilled':
      return `commitment-fulfilled:${event.payload.commitmentId}`;
    case 'CommitmentBroken':
      return `commitment-broken:${event.payload.commitmentId}`;
    case 'TaskCompleted':
      return 'task-completed';
    case 'TaskDeadlineMissed':
      return 'task-deadline-missed';
    case 'HelpRequested':
      return `help-requested:${event.payload.fromNpcId}`;
    case 'ReliefRequested':
      return `relief-requested:${event.payload.fromNpcId}`;
    default:
      return null;
  }
}

export function severityBand(severityMicro: number): string {
  if (severityMicro >= INCAPACITATION_SEVERITY) return 'incapacitating';
  if (severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY) return 'serious';
  if (severityMicro > 0) return 'minor';
  return 'none';
}

/**
 * Belief updates a perceiving NPC derives from an event. Identical for all
 * perceivers in this slice (shared room, high-confidence direct perception).
 */
export function beliefDeltasFor(
  _npcId: NpcId,
  state: CanonicalState,
  event: SimEvent,
): BeliefDelta[] {
  const HIGH = 900_000;
  switch (event.type) {
    case 'InjuryOccurred':
      return [
        {
          subject: `injury:${event.payload.npcId}`,
          value: severityBand(event.payload.severityMicro),
          confidenceMicro: HIGH,
        },
      ];
    case 'InjuryWorsened':
      return [
        {
          subject: `injury:${event.payload.npcId}`,
          value: severityBand(event.payload.severityMicro),
          confidenceMicro: HIGH,
        },
      ];
    case 'TreatmentStarted':
      return [
        {
          subject: `injury:${event.payload.patientId}`,
          value: 'being-treated',
          confidenceMicro: HIGH,
        },
      ];
    case 'TreatmentCompleted':
      return [
        {
          subject: `injury:${event.payload.patientId}`,
          value: 'treated',
          confidenceMicro: HIGH,
        },
      ];
    case 'MealConsumed':
      return [
        { subject: 'meal-exists', value: 'false', confidenceMicro: HIGH },
        { subject: 'meal-owner', value: 'none', confidenceMicro: HIGH },
      ];
    case 'ResourceRemoved':
      if (event.payload.resourceId !== state.meal.resourceId) return [];
      return [
        { subject: 'meal-exists', value: 'false', confidenceMicro: HIGH },
        { subject: 'meal-owner', value: 'none', confidenceMicro: HIGH },
      ];
    case 'ReservationTransferred':
      return [{ subject: 'meal-owner', value: event.payload.toNpcId, confidenceMicro: HIGH }];
    case 'ReservationReleased':
      if (event.payload.resourceId !== state.meal.resourceId) return [];
      return [{ subject: 'meal-owner', value: 'none', confidenceMicro: HIGH }];
    case 'ReservationTransferRequested':
      return [
        {
          subject: `meal-request:${event.payload.requesterNpcId}`,
          value: 'pending',
          confidenceMicro: HIGH,
        },
      ];
    case 'ReservationTransferRefused':
      return [
        {
          subject: `meal-request:${event.payload.requesterNpcId}`,
          value: 'refused',
          confidenceMicro: HIGH,
        },
      ];
    case 'OwnershipViolated':
      return [
        {
          subject: `norm-violation:${event.payload.actorId}`,
          value: 'took-reserved-meal',
          confidenceMicro: HIGH,
        },
      ];
    case 'CommitmentRenegotiationProposed':
      return [
        {
          subject: `commitment:${event.payload.commitmentId}`,
          value: 'renegotiation-pending',
          confidenceMicro: HIGH,
        },
      ];
    case 'CommitmentRenegotiationAccepted':
      return [
        {
          subject: `commitment:${event.payload.commitmentId}`,
          value: 'renegotiated-active',
          confidenceMicro: HIGH,
        },
      ];
    case 'CommitmentRenegotiationRejected':
      return [
        {
          subject: `commitment:${event.payload.commitmentId}`,
          value: 'active',
          confidenceMicro: HIGH,
        },
      ];
    case 'CommitmentFulfilled':
      return [
        {
          subject: `commitment:${event.payload.commitmentId}`,
          value: 'fulfilled',
          confidenceMicro: HIGH,
        },
      ];
    case 'CommitmentBroken':
      return [
        {
          subject: `commitment:${event.payload.commitmentId}`,
          value: 'broken',
          confidenceMicro: HIGH,
        },
      ];
    case 'TaskCompleted':
      return [{ subject: 'task:purifier-repair', value: 'completed', confidenceMicro: HIGH }];
    case 'TaskDeadlineMissed':
      return [{ subject: 'task:purifier-repair', value: 'deadline-missed', confidenceMicro: HIGH }];
    case 'HelpRequested':
      return [
        {
          subject: `help-request:${event.payload.fromNpcId}`,
          value: event.payload.topicCode,
          confidenceMicro: HIGH,
        },
      ];
    case 'ReliefRequested':
      return [
        {
          subject: `relief-request:${event.payload.fromNpcId}`,
          value: event.payload.topicCode,
          confidenceMicro: HIGH,
        },
      ];
    default:
      return [];
  }
}
