import type { NpcId } from '../../shared/ids';
import {
  FATIGUE_RATE_PER_TICK,
  HUNGER_RATE_PER_TICK,
  INCAPACITATION_SEVERITY,
  INJURY_NEEDS_TREATMENT_SEVERITY,
  REPAIR_TOTAL_UNITS,
  REQUEST_REFUSAL_COOLDOWN_TICKS,
  REST_FATIGUE_REDUCTION,
} from '../config';
import type {
  ActionInstanceState,
  CanonicalState,
  CommitmentState,
  NpcState,
} from '../domain/state';
import type { ActionStartedEvent, SimEvent } from './types';

/**
 * The event reducer: the ONLY code path that mutates canonical state.
 *
 * `applyEvent(state, event)` must be a pure function of its two arguments so
 * that replaying a recorded ledger over the same initial state reproduces the
 * exact same final canonical state. It never consults wall time, randomness,
 * scenario scripts, or provider logic.
 *
 * The reducer also acts as a last-line invariant guard: transitions that the
 * engine must never produce (double meal consumption, duplicate exclusive
 * reservations, contradictory commitment outcomes) throw instead of
 * corrupting state.
 */
export function applyEvent(state: CanonicalState, event: SimEvent): void {
  applyEventBody(state, event);
  // Pause/resume are operator-stream markers; every other event advances the
  // canonical state-version token used for staleness detection.
  if (event.type !== 'SimulationPaused' && event.type !== 'SimulationResumed') {
    state.stateVersion += 1;
  }
  if (ADVANCES_WORLD_REVISION[event.type]) {
    state.worldRevision += 1;
  }
}

/**
 * Static per-event-type worldRevision classification (remediation 1).
 *
 * `worldRevision` advances only for events that mutate state relevant to
 * action legality, decision context, or future NPC behavior. It never
 * advances for decision-lifecycle bookkeeping (requests, responses,
 * rejections, expiry, supersession, provider failure, fallback diagnostics),
 * for pure observation records, or for operator pause/resume markers.
 *
 * The classification is deliberately a static function of the event TYPE —
 * never of payload contents or engine context — because applyEvent must be a
 * pure function of (state, event) for replay to agree with live execution.
 *
 * Decision-cadence bookkeeping (lastDecisionTick, needsReevaluation) is NOT
 * treated as world state: DecisionRequested itself mutates those fields and
 * the audit brief fixes it as non-advancing, so the same rule is applied to
 * the whole lifecycle family (including expiry) and to PerceptionRecorded,
 * whose only mutation is the re-evaluation flag; the perceived change itself
 * arrives via its own advancing event (belief/resource/injury/...).
 */
export const ADVANCES_WORLD_REVISION: Record<SimEvent['type'], boolean> = {
  ScenarioStarted: false,
  ScenarioEnded: true,
  TimeAdvanced: true,
  SimulationPaused: false,
  SimulationResumed: false,
  DecisionRequested: false,
  DecisionResponseReceived: false,
  DecisionResponseAccepted: false,
  DecisionResponseRejected: false,
  DecisionRequestExpired: false,
  DecisionRequestSuperseded: false,
  DecisionProviderFailed: false,
  FallbackDecisionUsed: false,
  ActionProposed: true,
  ActionStarted: true,
  ActionCompleted: true,
  ActionRejected: true,
  ActionInterrupted: true,
  MovementStarted: true,
  MovementCompleted: true,
  RepairProgressed: true,
  InjuryOccurred: true,
  InjuryWorsened: true,
  TreatmentStarted: true,
  TreatmentCompleted: true,
  ResourceReserved: true,
  ReservationTransferRequested: true,
  ReservationTransferred: true,
  ReservationTransferRefused: true,
  ReservationReleased: true,
  ResourceRemoved: true,
  MealConsumed: true,
  OwnershipViolated: true,
  CommitmentCreated: true,
  CommitmentRenegotiationProposed: true,
  CommitmentRenegotiationAccepted: true,
  CommitmentRenegotiationRejected: true,
  CommitmentFulfilled: true,
  CommitmentBroken: true,
  TaskCompleted: true,
  TaskDeadlineMissed: true,
  PerceptionRecorded: false,
  BeliefUpdated: true,
  RelationshipChanged: true,
  HelpRequested: true,
  ReliefRequested: true,
};

function applyEventBody(state: CanonicalState, event: SimEvent): void {
  switch (event.type) {
    case 'ScenarioStarted':
      // The payload's scenarioVersion is authoritative for reconstruction:
      // eval-harness runs relabel the version while reusing a base scenario
      // definition. A no-op for every v1.0 ledger (values already agree).
      state.scenarioVersion = event.payload.scenarioVersion;
      break;

    case 'ScenarioEnded':
      state.terminal = true;
      break;

    case 'TimeAdvanced': {
      state.tick = event.payload.tick;
      for (const npcId of ['mara', 'jonas', 'rin'] as const) {
        const npc = state.npcs[npcId];
        npc.hungerMicro = clampMicro(npc.hungerMicro + HUNGER_RATE_PER_TICK);
        // All NPCs are awake for the whole 45-minute scenario.
        npc.fatigueMicro = clampMicro(npc.fatigueMicro + FATIGUE_RATE_PER_TICK);
      }
      break;
    }

    case 'SimulationPaused':
    case 'SimulationResumed':
      // Operator-stream markers; pausing never alters canonical outcomes.
      break;

    case 'DecisionRequested': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      if (npc.pendingDecision !== null) {
        // The engine must supersede an outstanding request before creating a
        // new one; overlapping requests would make acceptance ambiguous.
        throw new Error(`reduce-decision-request-overlap: ${npc.pendingDecision.requestId}`);
      }
      npc.lastDecisionTick = event.tick;
      npc.needsReevaluation = false;
      npc.pendingDecision = {
        requestId: p.requestId,
        providerId: p.providerId,
        requestedAtTick: event.tick,
        expiresAtTick: p.expiresAtTick,
        worldRevisionAtRequest: p.worldRevision,
        hardDependencyFingerprint: p.hardDependencyFingerprint,
        offeredAffordances: p.offeredAffordances.map((a) => ({
          ...a,
          preconditions: [...a.preconditions],
          reservations: [...a.reservations],
          proposedTerms: a.proposedTerms ? { ...a.proposedTerms } : null,
        })),
        responseIdsSeen: [],
      };
      break;
    }

    case 'DecisionResponseReceived': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      const pending = npc.pendingDecision;
      if (
        pending &&
        pending.requestId === p.requestId &&
        !pending.responseIdsSeen.includes(p.responseId)
      ) {
        pending.responseIdsSeen.push(p.responseId);
      }
      break;
    }

    case 'DecisionResponseAccepted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      if (npc.pendingDecision === null || npc.pendingDecision.requestId !== p.requestId) {
        throw new Error(`reduce-acceptance-without-pending-request: ${p.requestId}`);
      }
      npc.pendingDecision = null;
      npc.lastDecision = {
        requestId: p.requestId,
        affordanceId: p.selectedAffordanceId,
        category: null,
        mode: null,
        confidenceBp: p.confidenceBp,
        reasonCode: p.reasonCode,
        usedFallback: p.usedFallback,
        tick: event.tick,
      };
      break;
    }

    case 'DecisionResponseRejected':
      // The response ID was already recorded by DecisionResponseReceived; a
      // rejection leaves the request pending (a later, valid response may
      // still be accepted before expiry).
      break;

    case 'DecisionRequestExpired': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      if (npc.pendingDecision === null || npc.pendingDecision.requestId !== p.requestId) {
        throw new Error(`reduce-expiry-without-pending-request: ${p.requestId}`);
      }
      npc.pendingDecision = null;
      if (p.reasonCode === 'ttl-expired') {
        npc.needsReevaluation = true;
      }
      break;
    }

    case 'DecisionRequestSuperseded': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      if (npc.pendingDecision === null || npc.pendingDecision.requestId !== p.requestId) {
        throw new Error(`reduce-supersede-without-pending-request: ${p.requestId}`);
      }
      npc.pendingDecision = null;
      npc.lastSupersededRequestId = p.requestId;
      break;
    }

    case 'DecisionProviderFailed':
      break;

    case 'FallbackDecisionUsed': {
      const npc = getNpc(state, event.payload.npcId);
      npc.lastDecision = {
        requestId: event.payload.requestId,
        affordanceId: event.payload.affordanceId,
        category: null,
        mode: null,
        confidenceBp: 0,
        reasonCode: event.payload.reasonCode,
        usedFallback: true,
        tick: event.tick,
      };
      break;
    }

    case 'ActionProposed': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      npc.pendingAction = {
        id: p.actionId,
        affordanceId: p.affordanceId,
        category: p.category,
        mode: p.mode,
        actorId: p.npcId,
        targetNpcId: p.targetNpcId,
        targetResourceId: p.targetResourceId,
        locationId: p.locationId,
        durationTicks: p.durationTicks,
        stateVersionAtProposal: p.stateVersion,
        interruptible: p.interruptible,
        violation: p.violation,
        commitmentId: p.commitmentId,
        proposalId: p.proposalId,
        requestId: p.requestId,
        proposedTerms: p.proposedTerms
          ? {
              startTick: p.proposedTerms.startTick,
              graceTick: p.proposedTerms.graceTick,
              minDurationTicks: p.proposedTerms.minDurationTicks,
            }
          : null,
      };
      if (npc.lastDecision) {
        npc.lastDecision.category = p.category;
        npc.lastDecision.mode = p.mode;
      }
      break;
    }

    case 'ActionStarted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      const action = buildActionInstance(event, 'active');
      npc.currentAction = action;
      npc.pendingAction = null;
      if (p.mode === 'work' || p.mode === 'relieve') {
        state.purifier.activeWorkerId = p.npcId;
        for (const c of activeCommitmentsForDebtor(state, p.npcId)) {
          c.activeReliefStartTick = event.tick;
        }
      }
      break;
    }

    case 'ActionCompleted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      if (p.mode === 'rest') {
        npc.fatigueMicro = Math.max(0, npc.fatigueMicro - REST_FATIGUE_REDUCTION);
      }
      clearBenchWorkEffects(state, npc);
      npc.currentAction = null;
      break;
    }

    case 'ActionRejected': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      npc.pendingAction = null;
      if (p.actionId !== null && npc.currentAction?.id === p.actionId) {
        clearBenchWorkEffects(state, npc);
        npc.currentAction = null;
      }
      npc.needsReevaluation = true;
      break;
    }

    case 'ActionInterrupted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      const action = npc.currentAction;
      if (action?.id === p.actionId) {
        // An interrupted treatment did not complete: release the patient's
        // treatment markers so re-treatment stays possible and the untreated
        // worsening rule re-arms. (A completed treatment lowers severity
        // below the treatment threshold first, so this only fires for
        // genuinely aborted treatments.)
        if (action.mode === 'treat' && action.targetNpcId !== null) {
          const patient = getNpc(state, action.targetNpcId);
          if (
            patient.injury.treatmentStartedTick !== null &&
            patient.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY
          ) {
            patient.injury.treatmentStartedTick = null;
            patient.injury.treatedByNpcId = null;
            patient.needsReevaluation = true;
          }
        }
        clearBenchWorkEffects(state, npc);
        npc.currentAction = null;
      }
      npc.needsReevaluation = true;
      break;
    }

    case 'MovementStarted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      npc.transit = {
        fromLocationId: p.fromLocationId,
        toLocationId: p.toLocationId,
        startTick: event.tick,
        arriveTick: p.arriveTick,
        actionId: p.actionId,
      };
      if (npc.pendingAction && npc.pendingAction.id === p.actionId) {
        npc.currentAction = {
          ...npc.pendingAction,
          phase: 'moving',
          phaseStartTick: event.tick,
          completesAtTick: p.arriveTick,
        };
        npc.pendingAction = null;
      }
      break;
    }

    case 'MovementCompleted': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      npc.locationId = p.locationId;
      npc.transit = null;
      break;
    }

    case 'RepairProgressed': {
      const next = state.purifier.progressUnits + event.payload.unitsDelta;
      state.purifier.progressUnits = Math.min(REPAIR_TOTAL_UNITS, next);
      if (state.purifier.progressUnits !== event.payload.progressUnits) {
        throw new Error(
          `reduce-repair-mismatch: expected ${event.payload.progressUnits}, got ${state.purifier.progressUnits}`,
        );
      }
      break;
    }

    case 'InjuryOccurred': {
      const npc = getNpc(state, event.payload.npcId);
      npc.injury = {
        severityMicro: event.payload.severityMicro,
        injuredAtTick: event.tick,
        treatmentStartedTick: null,
        treatedByNpcId: null,
        worsened: false,
      };
      npc.incapacitated = npc.injury.severityMicro >= INCAPACITATION_SEVERITY;
      npc.needsReevaluation = true;
      break;
    }

    case 'InjuryWorsened': {
      const npc = getNpc(state, event.payload.npcId);
      npc.injury.severityMicro = event.payload.severityMicro;
      npc.injury.worsened = true;
      npc.incapacitated = npc.injury.severityMicro >= INCAPACITATION_SEVERITY;
      break;
    }

    case 'TreatmentStarted': {
      const patient = getNpc(state, event.payload.patientId);
      patient.injury.treatmentStartedTick = event.tick;
      patient.injury.treatedByNpcId = event.payload.healerId;
      break;
    }

    case 'TreatmentCompleted': {
      const patient = getNpc(state, event.payload.patientId);
      patient.injury.severityMicro = event.payload.severityAfterMicro;
      patient.incapacitated = patient.injury.severityMicro >= INCAPACITATION_SEVERITY;
      patient.memories.push({
        id: `mem-${patient.id}-${event.id}`,
        canonicalFact: `treated-by-${event.payload.healerId}`,
        factEventId: event.id,
        preScenario: false,
        perception: 'experienced-directly',
        interpretation: `${event.payload.healerId}-helped-when-injured`,
        confidenceMicro: 950_000,
        importanceMicro: 700_000,
        createdTick: event.tick,
        themes: ['care-received'],
        socialTargetId: event.payload.healerId,
        valenceMicro: 600_000,
        selfRelevanceMicro: 800_000,
      });
      break;
    }

    case 'ResourceReserved': {
      const p = event.payload;
      const existing = state.reservations.find((r) => r.resourceId === p.resourceId);
      if (existing) {
        throw new Error(
          `reduce-duplicate-exclusive-reservation: ${p.resourceId} already held by ${existing.holderNpcId}`,
        );
      }
      state.reservations.push({
        resourceId: p.resourceId,
        holderNpcId: p.holderNpcId,
        kind: p.kind,
        sinceTick: event.tick,
      });
      if (p.resourceId === state.meal.resourceId) {
        state.meal.reservedForNpcId = p.holderNpcId;
      }
      break;
    }

    case 'ReservationReleased': {
      const p = event.payload;
      removeReservation(state, p.resourceId);
      if (p.resourceId === state.meal.resourceId) {
        state.meal.reservedForNpcId = null;
      }
      break;
    }

    case 'ReservationTransferRequested': {
      const p = event.payload;
      state.pendingTransferRequests.push({
        requestId: p.requestId,
        resourceId: p.resourceId,
        requesterNpcId: p.requesterNpcId,
        ownerNpcId: p.ownerNpcId,
        requestedTick: event.tick,
      });
      getNpc(state, p.ownerNpcId).needsReevaluation = true;
      break;
    }

    case 'ReservationTransferred': {
      const p = event.payload;
      const reservation = state.reservations.find((r) => r.resourceId === p.resourceId);
      if (!reservation || reservation.holderNpcId !== p.fromNpcId) {
        throw new Error(`reduce-transfer-without-reservation: ${p.resourceId}`);
      }
      reservation.holderNpcId = p.toNpcId;
      reservation.sinceTick = event.tick;
      if (p.resourceId === state.meal.resourceId) {
        state.meal.reservedForNpcId = p.toNpcId;
      }
      state.pendingTransferRequests = state.pendingTransferRequests.filter(
        (r) => r.resourceId !== p.resourceId,
      );
      getNpc(state, p.toNpcId).needsReevaluation = true;
      break;
    }

    case 'ReservationTransferRefused': {
      const p = event.payload;
      state.pendingTransferRequests = state.pendingTransferRequests.filter(
        (r) => r.requestId !== p.requestId,
      );
      const requester = getNpc(state, p.requesterNpcId);
      requester.requestCooldownUntilTick = event.tick + REQUEST_REFUSAL_COOLDOWN_TICKS;
      requester.needsReevaluation = true;
      break;
    }

    case 'ResourceRemoved': {
      const p = event.payload;
      if (p.resourceId === state.meal.resourceId) {
        state.meal.exists = false;
        state.meal.reservedForNpcId = null;
      }
      removeReservation(state, p.resourceId);
      state.pendingTransferRequests = state.pendingTransferRequests.filter(
        (r) => r.resourceId !== p.resourceId,
      );
      break;
    }

    case 'MealConsumed': {
      const p = event.payload;
      if (!state.meal.exists) {
        throw new Error('reduce-meal-double-consumption');
      }
      if (state.meal.resourceId !== p.resourceId) {
        throw new Error(`reduce-unknown-meal: ${p.resourceId}`);
      }
      state.meal.exists = false;
      state.meal.consumedByNpcId = p.npcId;
      state.meal.consumedTick = event.tick;
      state.meal.reservedForNpcId = null;
      removeReservation(state, p.resourceId);
      state.pendingTransferRequests = state.pendingTransferRequests.filter(
        (r) => r.resourceId !== p.resourceId,
      );
      const npc = getNpc(state, p.npcId);
      npc.hungerMicro = p.hungerAfterMicro;
      break;
    }

    case 'OwnershipViolated': {
      const p = event.payload;
      const owner = getNpc(state, p.ownerNpcId);
      owner.memories.push({
        id: `mem-${owner.id}-${event.id}`,
        canonicalFact: `${p.actorId}-took-reserved-resource-${p.resourceId}`,
        factEventId: event.id,
        preScenario: false,
        perception: 'observed-directly',
        interpretation: `${p.actorId}-violated-my-ownership`,
        confidenceMicro: 950_000,
        importanceMicro: 900_000,
        createdTick: event.tick,
        themes: ['ownership-violation'],
        socialTargetId: p.actorId,
        valenceMicro: -800_000,
        selfRelevanceMicro: 900_000,
      });
      break;
    }

    case 'CommitmentCreated': {
      const p = event.payload;
      state.commitments.push({
        id: p.commitmentId,
        kind: p.kind,
        debtorId: p.debtorId,
        creditorId: p.creditorId,
        terms: {
          startTick: p.terms.startTick,
          graceTick: p.terms.graceTick,
          minDurationTicks: p.terms.minDurationTicks,
        },
        originalTerms: {
          startTick: p.terms.startTick,
          graceTick: p.terms.graceTick,
          minDurationTicks: p.terms.minDurationTicks,
        },
        status: 'active',
        renegotiated: false,
        pendingProposal: null,
        activeReliefStartTick: null,
      });
      break;
    }

    case 'CommitmentRenegotiationProposed': {
      const p = event.payload;
      const c = getCommitment(state, p.commitmentId);
      c.pendingProposal = {
        proposalId: p.proposalId,
        proposedTerms: {
          startTick: p.proposedTerms.startTick,
          graceTick: p.proposedTerms.graceTick,
          minDurationTicks: p.proposedTerms.minDurationTicks,
        },
        proposedAtTick: event.tick,
        proposedByNpcId: p.proposedByNpcId,
      };
      getNpc(state, c.creditorId).needsReevaluation = true;
      break;
    }

    case 'CommitmentRenegotiationAccepted': {
      const p = event.payload;
      const c = getCommitment(state, p.commitmentId);
      if (c.status !== 'active') {
        throw new Error(`reduce-renegotiation-on-${c.status}-commitment`);
      }
      c.terms = {
        startTick: p.newTerms.startTick,
        graceTick: p.newTerms.graceTick,
        minDurationTicks: p.newTerms.minDurationTicks,
      };
      c.renegotiated = true;
      c.pendingProposal = null;
      getNpc(state, c.debtorId).needsReevaluation = true;
      break;
    }

    case 'CommitmentRenegotiationRejected': {
      const p = event.payload;
      const c = getCommitment(state, p.commitmentId);
      c.pendingProposal = null;
      getNpc(state, c.debtorId).needsReevaluation = true;
      break;
    }

    case 'CommitmentFulfilled': {
      const c = getCommitment(state, event.payload.commitmentId);
      if (c.status === 'broken') {
        throw new Error('reduce-commitment-fulfilled-after-broken');
      }
      c.status = 'fulfilled';
      break;
    }

    case 'CommitmentBroken': {
      const c = getCommitment(state, event.payload.commitmentId);
      if (c.status === 'fulfilled') {
        throw new Error('reduce-commitment-broken-after-fulfilled');
      }
      if (c.status === 'broken') {
        throw new Error('reduce-commitment-broken-twice');
      }
      c.status = 'broken';
      c.pendingProposal = null;
      const creditor = getNpc(state, c.creditorId);
      creditor.memories.push({
        id: `mem-${creditor.id}-${event.id}`,
        canonicalFact: `${c.debtorId}-broke-commitment-${c.id}`,
        factEventId: event.id,
        preScenario: false,
        perception: 'experienced-directly',
        interpretation: `${c.debtorId}-is-unreliable`,
        confidenceMicro: 950_000,
        importanceMicro: 800_000,
        createdTick: event.tick,
        themes: ['promise-broken'],
        socialTargetId: c.debtorId,
        valenceMicro: -500_000,
        selfRelevanceMicro: 600_000,
      });
      break;
    }

    case 'TaskCompleted': {
      if (state.taskOutcome !== 'pending') {
        throw new Error('reduce-task-outcome-already-recorded');
      }
      state.taskOutcome = 'completed';
      break;
    }

    case 'TaskDeadlineMissed': {
      if (state.taskOutcome !== 'pending') {
        throw new Error('reduce-task-outcome-already-recorded');
      }
      state.taskOutcome = 'deadline-missed';
      break;
    }

    case 'PerceptionRecorded': {
      const npc = getNpc(state, event.payload.npcId);
      npc.needsReevaluation = true;
      break;
    }

    case 'BeliefUpdated': {
      const p = event.payload;
      const npc = getNpc(state, p.npcId);
      const existing = npc.beliefs.find((b) => b.id === p.beliefId);
      if (existing) {
        existing.value = p.value;
        existing.confidenceMicro = p.confidenceMicro;
        existing.provenanceKind = p.provenanceKind;
        existing.provenanceEventId = p.provenanceEventId;
        existing.updatedTick = event.tick;
      } else {
        npc.beliefs.push({
          id: p.beliefId,
          subject: p.subject,
          value: p.value,
          confidenceMicro: p.confidenceMicro,
          provenanceKind: p.provenanceKind,
          provenanceEventId: p.provenanceEventId,
          updatedTick: event.tick,
        });
      }
      break;
    }

    case 'RelationshipChanged': {
      const p = event.payload;
      const rel = state.relationships.find(
        (r) => r.fromNpcId === p.fromNpcId && r.toNpcId === p.toNpcId,
      );
      if (!rel) throw new Error(`reduce-unknown-relationship: ${p.fromNpcId}->${p.toNpcId}`);
      rel.valueMicro = p.valueMicro;
      break;
    }

    case 'HelpRequested':
    case 'ReliefRequested': {
      const p = event.payload;
      state.socialSignals.push({
        id: p.signalId,
        kind: event.type === 'HelpRequested' ? 'help-requested' : 'relief-requested',
        fromNpcId: p.fromNpcId,
        toNpcId: p.toNpcId,
        topicCode: p.topicCode,
        tick: event.tick,
      });
      for (const npcId of ['mara', 'jonas', 'rin'] as const) {
        if (npcId !== p.fromNpcId && (p.toNpcId === null || p.toNpcId === npcId)) {
          state.npcs[npcId].needsReevaluation = true;
        }
      }
      break;
    }

    default: {
      const exhaustive: never = event;
      throw new Error(`reduce-unknown-event-type: ${(exhaustive as SimEvent).type}`);
    }
  }
}

// --- helpers -----------------------------------------------------------------

function clampMicro(v: number): number {
  return Math.max(0, Math.min(1_000_000, v));
}

function getNpc(state: CanonicalState, npcId: NpcId): NpcState {
  return state.npcs[npcId];
}

function getCommitment(state: CanonicalState, id: string): CommitmentState {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) throw new Error(`reduce-unknown-commitment: ${id}`);
  return c;
}

function activeCommitmentsForDebtor(state: CanonicalState, debtorId: NpcId): CommitmentState[] {
  return state.commitments.filter((c) => c.debtorId === debtorId && c.status === 'active');
}

function removeReservation(state: CanonicalState, resourceId: string): void {
  state.reservations = state.reservations.filter((r) => r.resourceId !== resourceId);
}

function clearBenchWorkEffects(state: CanonicalState, npc: NpcState): void {
  const action = npc.currentAction;
  if (!action) return;
  if (action.mode === 'work' || action.mode === 'relieve') {
    if (state.purifier.activeWorkerId === npc.id) {
      state.purifier.activeWorkerId = null;
    }
    for (const c of state.commitments) {
      if (c.debtorId === npc.id && c.activeReliefStartTick !== null) {
        c.activeReliefStartTick = null;
      }
    }
  }
}

function buildActionInstance(event: ActionStartedEvent, phase: 'active'): ActionInstanceState {
  const p = event.payload;
  return {
    id: p.actionId,
    affordanceId: p.affordanceId,
    category: p.category,
    mode: p.mode,
    actorId: p.npcId,
    targetNpcId: p.targetNpcId,
    targetResourceId: p.targetResourceId,
    locationId: p.locationId,
    phase,
    phaseStartTick: event.tick,
    completesAtTick: p.completesAtTick,
    durationTicks: p.durationTicks,
    stateVersionAtProposal: p.stateVersion,
    interruptible: p.interruptible,
    violation: p.violation,
    commitmentId: p.commitmentId,
    proposalId: p.proposalId,
    requestId: p.requestId,
    proposedTerms: p.proposedTerms
      ? {
          startTick: p.proposedTerms.startTick,
          graceTick: p.proposedTerms.graceTick,
          minDurationTicks: p.proposedTerms.minDurationTicks,
        }
      : null,
  };
}
