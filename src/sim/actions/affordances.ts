import {
  MODE_TO_CATEGORY,
  NPC_IDS,
  type ActionMode,
  type LocationId,
  type NpcId,
} from '../../shared/ids';
import {
  BENCH_LOCATION,
  BENCH_RESOURCE_ID,
  COMMITMENT_LEAD_TICKS,
  DELIVER_MATERIALS_DURATION_TICKS,
  EAT_DURATION_TICKS,
  HUNGER_MODERATE,
  INJURY_NEEDS_TREATMENT_SEVERITY,
  MEAL_LOCATION,
  REPAIR_CAPABLE_SEVERITY_LIMIT,
  REPAIR_TOTAL_UNITS,
  RENEGOTIATION_BUFFER_TICKS,
  RENEGOTIATION_GRACE_SPAN_TICKS,
  REST_DURATION_TICKS,
  ROUTINE_WORK_BLOCK_TICKS,
  SOCIAL_ACTION_DURATION_TICKS,
  TRAVEL_TICKS,
  TREATMENT_BY_HEALER,
  TREATMENT_LOCATION,
  WAIT_DURATION_TICKS,
} from '../config';
import type { CanonicalState, CommitmentTerms } from '../domain/state';
import type { OfferedAffordance } from '../../shared/decisionContracts';
import { TICKS_PER_MINUTE } from '../../shared/units';

/**
 * Affordance generation: the concrete, structured menu of actions that are
 * physically and procedurally executable for an NPC at the current state.
 * "Available" does not mean morally approved — a violating eat attempt on a
 * reserved meal is generated (flagged) and the engine records the violation
 * if executed. Hard boundaries and preferences are the provider's layer;
 * legality and physics are the engine's.
 */

/**
 * An affordance IS the serializable offered-affordance contract (remediation
 * 1): the exact objects generated here are recorded verbatim in the
 * DecisionRequested payload so a delayed response can be revalidated and
 * launched from the stored descriptor.
 */
export type Affordance = OfferedAffordance;

export function generateAffordances(
  state: CanonicalState,
  npcId: NpcId,
  tick: number,
  stateVersion: number,
): Affordance[] {
  const npc = state.npcs[npcId];
  if (npc.incapacitated || state.terminal) return [];

  const out: Affordance[] = [];
  const mk = (
    mode: ActionMode,
    fields: Partial<Affordance> & { durationTicks: number },
  ): Affordance => ({
    id: affordanceId(npcId, tick, mode, fields.targetNpcId ?? fields.targetResourceId ?? null),
    category: MODE_TO_CATEGORY[mode],
    mode,
    actorId: npcId,
    targetNpcId: null,
    targetResourceId: null,
    requiredLocationId: null,
    expectedTravelTicks: 0,
    preconditions: [],
    reservations: [],
    violation: false,
    interruptible: false,
    commitmentId: null,
    proposalId: null,
    requestId: null,
    proposedTerms: null,
    continuesActionId: null,
    stateVersion,
    ...fields,
  });

  const travelTo = (loc: LocationId): number => (npc.locationId === loc ? 0 : TRAVEL_TICKS);
  const capable = npc.injury.severityMicro < REPAIR_CAPABLE_SEVERITY_LIMIT;
  const benchReservation = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
  const remaining = Math.max(1, state.endTick - tick);

  // Continue-current pseudo-affordance (only for interruptible active actions).
  const current = npc.currentAction;
  if (current && current.phase === 'active' && current.interruptible) {
    out.push(
      mk(current.mode, {
        id: `aff:${npcId}:${tick}:continue:${current.mode}`,
        durationTicks: Math.max(1, current.completesAtTick - tick),
        continuesActionId: current.id,
        interruptible: true,
        targetNpcId: current.targetNpcId,
        targetResourceId: current.targetResourceId,
        requiredLocationId: current.locationId,
        commitmentId: current.commitmentId,
      }),
    );
  }

  // 1. Work on the purifier (requires a free bench slot).
  if (
    capable &&
    state.purifier.progressUnits < REPAIR_TOTAL_UNITS &&
    !benchReservation &&
    !(current && (current.mode === 'work' || current.mode === 'relieve'))
  ) {
    out.push(
      mk('work', {
        requiredLocationId: BENCH_LOCATION,
        expectedTravelTicks: travelTo(BENCH_LOCATION),
        durationTicks: remaining,
        reservations: [BENCH_RESOURCE_ID],
        preconditions: ['capable-of-repair', 'bench-free', 'progress-incomplete'],
        interruptible: true,
      }),
    );
  }

  // 2. Relieve the current bench worker (physical handover).
  if (
    capable &&
    state.purifier.progressUnits < REPAIR_TOTAL_UNITS &&
    benchReservation &&
    benchReservation.holderNpcId !== npcId
  ) {
    const commitment = state.commitments.find(
      (c) =>
        c.status === 'active' &&
        c.debtorId === npcId &&
        c.creditorId === benchReservation.holderNpcId,
    );
    out.push(
      mk('relieve', {
        targetNpcId: benchReservation.holderNpcId,
        requiredLocationId: BENCH_LOCATION,
        expectedTravelTicks: travelTo(BENCH_LOCATION),
        durationTicks: remaining,
        reservations: [BENCH_RESOURCE_ID],
        preconditions: ['capable-of-repair', 'progress-incomplete'],
        interruptible: true,
        commitmentId: commitment ? commitment.id : null,
      }),
    );
  }

  // 3. Treat an injured NPC.
  for (const patientId of NPC_IDS) {
    if (patientId === npcId) continue; // Rin cannot treat herself; nobody self-treats.
    const patient = state.npcs[patientId];
    const capability = TREATMENT_BY_HEALER[npcId];
    if (
      capability &&
      patient.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY &&
      patient.injury.treatmentStartedTick === null
    ) {
      const where = patient.incapacitated ? patient.locationId : TREATMENT_LOCATION;
      out.push(
        mk('treat', {
          targetNpcId: patientId,
          requiredLocationId: where,
          expectedTravelTicks: travelTo(where),
          durationTicks: capability.durationTicks,
          preconditions: ['patient-present', 'patient-needs-treatment', 'healer-capable'],
        }),
      );
    }
  }

  // 4. Eat the meal (legal or ownership-violating variant).
  if (state.meal.exists) {
    const owner = state.meal.reservedForNpcId;
    const violation = owner !== null && owner !== npcId;
    out.push(
      mk(violation ? 'eat-violation' : 'eat', {
        targetNpcId: violation ? owner : null,
        targetResourceId: state.meal.resourceId,
        requiredLocationId: MEAL_LOCATION,
        expectedTravelTicks: travelTo(MEAL_LOCATION),
        durationTicks: EAT_DURATION_TICKS,
        violation,
        preconditions: violation
          ? ['meal-exists', 'meal-reserved-by-other']
          : ['meal-exists', 'meal-available-to-actor'],
      }),
    );
  }

  // 5. Request transfer of the meal reservation.
  if (
    state.meal.exists &&
    state.meal.reservedForNpcId !== null &&
    state.meal.reservedForNpcId !== npcId &&
    tick >= npc.requestCooldownUntilTick &&
    !state.pendingTransferRequests.some(
      (r) => r.requesterNpcId === npcId && r.resourceId === state.meal.resourceId,
    )
  ) {
    out.push(
      mk('request-transfer', {
        targetNpcId: state.meal.reservedForNpcId,
        targetResourceId: state.meal.resourceId,
        durationTicks: SOCIAL_ACTION_DURATION_TICKS,
        preconditions: ['meal-exists', 'meal-reserved-by-other', 'no-pending-own-request'],
      }),
    );
  }

  // 6. Transfer, refuse, or release the meal reservation (owner only).
  if (state.meal.exists && state.meal.reservedForNpcId === npcId) {
    for (const request of state.pendingTransferRequests) {
      if (request.resourceId !== state.meal.resourceId) continue;
      out.push(
        mk('transfer', {
          targetNpcId: request.requesterNpcId,
          targetResourceId: state.meal.resourceId,
          durationTicks: SOCIAL_ACTION_DURATION_TICKS,
          requestId: request.requestId,
          preconditions: ['meal-exists', 'actor-owns-reservation', 'request-pending'],
        }),
      );
      out.push(
        mk('refuse-request', {
          targetNpcId: request.requesterNpcId,
          targetResourceId: state.meal.resourceId,
          durationTicks: SOCIAL_ACTION_DURATION_TICKS,
          requestId: request.requestId,
          preconditions: ['meal-exists', 'actor-owns-reservation', 'request-pending'],
        }),
      );
    }
    out.push(
      mk('release', {
        targetResourceId: state.meal.resourceId,
        durationTicks: SOCIAL_ACTION_DURATION_TICKS,
        preconditions: ['meal-exists', 'actor-owns-reservation'],
      }),
    );
  }

  // 7. Ask another NPC for help (structured topic: untreated own injury).
  if (
    npc.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY &&
    npc.injury.treatmentStartedTick === null
  ) {
    const recentAsk = state.socialSignals.some(
      (s) =>
        s.kind === 'help-requested' &&
        s.fromNpcId === npcId &&
        s.topicCode === 'need-treatment' &&
        tick - s.tick < 300,
    );
    if (!recentAsk) {
      // Ask the most capable OTHER treatment-capable NPC (shortest treatment
      // duration wins; capability is identity data, not a hardcoded name).
      const healer = NPC_IDS.filter((id) => id !== npcId && TREATMENT_BY_HEALER[id]).sort(
        (a, b) => TREATMENT_BY_HEALER[a]!.durationTicks - TREATMENT_BY_HEALER[b]!.durationTicks,
      )[0];
      if (healer) {
        out.push(
          mk('ask-help', {
            targetNpcId: healer,
            durationTicks: SOCIAL_ACTION_DURATION_TICKS,
            preconditions: ['actor-injured-untreated'],
          }),
        );
      }
    }
  }

  // 8. Request a break / relief while working the bench.
  if (
    current &&
    (current.mode === 'work' || current.mode === 'relieve') &&
    current.phase === 'active' &&
    (npc.hungerMicro >= HUNGER_MODERATE || npc.fatigueMicro >= 500_000)
  ) {
    const recent = state.socialSignals.some(
      (s) => s.kind === 'relief-requested' && s.fromNpcId === npcId && tick - s.tick < 600,
    );
    if (!recent) {
      out.push(
        mk('request-break', {
          durationTicks: SOCIAL_ACTION_DURATION_TICKS,
          preconditions: ['actor-working-bench'],
        }),
      );
    }
  }

  // 9. Renegotiate a commitment.
  for (const commitment of state.commitments) {
    if (commitment.status !== 'active') continue;
    // Debtor proposes when a care conflict makes the current terms infeasible.
    if (
      commitment.debtorId === npcId &&
      commitment.pendingProposal === null &&
      tick < commitment.terms.graceTick
    ) {
      const conflict = conflictingTreatmentNeed(state, npcId);
      if (conflict !== null) {
        out.push(
          mk('propose-renegotiation', {
            targetNpcId: commitment.creditorId,
            durationTicks: SOCIAL_ACTION_DURATION_TICKS,
            commitmentId: commitment.id,
            proposedTerms: proposeTerms(state, npcId, commitment.terms, tick),
            preconditions: ['commitment-active', 'no-pending-proposal', 'before-grace'],
          }),
        );
      }
    }
    // Creditor responds to a pending proposal.
    if (commitment.creditorId === npcId && commitment.pendingProposal !== null) {
      out.push(
        mk('accept-renegotiation', {
          targetNpcId: commitment.debtorId,
          durationTicks: SOCIAL_ACTION_DURATION_TICKS,
          commitmentId: commitment.id,
          proposalId: commitment.pendingProposal.proposalId,
          preconditions: ['commitment-active', 'proposal-pending'],
        }),
      );
      out.push(
        mk('reject-renegotiation', {
          targetNpcId: commitment.debtorId,
          durationTicks: SOCIAL_ACTION_DURATION_TICKS,
          commitmentId: commitment.id,
          proposalId: commitment.pendingProposal.proposalId,
          preconditions: ['commitment-active', 'proposal-pending'],
        }),
      );
    }
  }

  // 10. Rest or wait (and low-intensity duty variants).
  if (
    npc.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY &&
    npc.injury.treatmentStartedTick === null &&
    !(current && current.mode === 'stay-at-cot')
  ) {
    out.push(
      mk('stay-at-cot', {
        requiredLocationId: TREATMENT_LOCATION,
        expectedTravelTicks: travelTo(TREATMENT_LOCATION),
        durationTicks: ROUTINE_WORK_BLOCK_TICKS,
        interruptible: true,
        preconditions: ['actor-injured-untreated'],
      }),
    );
  }
  out.push(
    mk('rest', {
      durationTicks: REST_DURATION_TICKS,
      interruptible: true,
      preconditions: [],
    }),
  );
  if (!(current && current.mode === 'routine-work' && npc.locationId === 'routine-work-station')) {
    out.push(
      mk('routine-work', {
        requiredLocationId: 'routine-work-station',
        expectedTravelTicks: travelTo('routine-work-station'),
        durationTicks: ROUTINE_WORK_BLOCK_TICKS,
        interruptible: true,
        preconditions: [],
      }),
    );
  }
  out.push(mk('wait', { durationTicks: WAIT_DURATION_TICKS, interruptible: true }));

  return out;
}

function affordanceId(npcId: NpcId, tick: number, mode: ActionMode, target: string | null): string {
  return target === null
    ? `aff:${npcId}:${tick}:${mode}`
    : `aff:${npcId}:${tick}:${mode}:${target}`;
}

/**
 * A treatment conflict exists for the debtor when someone needs treatment the
 * debtor can provide and providing it would overlap the commitment window.
 */
export function conflictingTreatmentNeed(state: CanonicalState, npcId: NpcId): NpcId | null {
  const capability = TREATMENT_BY_HEALER[npcId];
  if (!capability) return null;
  for (const patientId of NPC_IDS) {
    if (patientId === npcId) continue;
    const patient = state.npcs[patientId];
    if (
      patient.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY &&
      patient.injury.treatmentStartedTick === null
    ) {
      return patientId;
    }
  }
  return null;
}

/** Deterministic renegotiation terms (see config note). */
export function proposeTerms(
  _state: CanonicalState,
  debtorId: NpcId,
  _currentTerms: CommitmentTerms,
  tick: number,
): CommitmentTerms {
  const capability = TREATMENT_BY_HEALER[debtorId];
  const treatTicks = capability ? capability.durationTicks : 0;
  const earliest =
    tick +
    SOCIAL_ACTION_DURATION_TICKS + // finish this proposal
    TRAVEL_TICKS + // reach the patient
    treatTicks + // treat
    TRAVEL_TICKS + // reach the bench
    RENEGOTIATION_BUFFER_TICKS;
  const startTick = Math.ceil(earliest / TICKS_PER_MINUTE) * TICKS_PER_MINUTE;
  return {
    startTick,
    graceTick: startTick + RENEGOTIATION_GRACE_SPAN_TICKS,
    minDurationTicks: _currentTerms.minDurationTicks,
  };
}

export { DELIVER_MATERIALS_DURATION_TICKS, COMMITMENT_LEAD_TICKS };
