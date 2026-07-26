import { NPC_IDS } from '../../shared/ids';
import type {
  ActionInstanceState,
  CanonicalState,
  NpcState,
  PendingActionState,
} from '../domain/state';
import { fnv1a64Hex } from './hash';
import { canonicalSerialize } from './serialize';

/**
 * Semantic world-state hash (remediation 4).
 *
 * `worldStateHash` covers behaviorally and narratively persistent state and
 * deliberately EXCLUDES transport, diagnostics, and counter-derived
 * identifiers, so two decision sources that produce the same consequential
 * world receive the same hash even when their reason codes, confidences, or
 * emitted-event counts differ:
 *
 * Excluded, with the behaviorally relevant part retained elsewhere:
 *  - `stateVersion` / `worldRevision` (event counters).
 *  - `lastDecision` diagnostics (confidence, reason code, fallback flag,
 *    request ID). The behaviorally load-bearing `lastDecisionTick` IS
 *    included (it gates re-evaluation cadence).
 *  - All counter-minted IDs: action IDs (`act-*`), affordance IDs (embed the
 *    decision tick), transfer request IDs (`req-*`), proposal IDs
 *    (`prop-*`), social signal IDs (`sig-*`), memory IDs / event-ID
 *    provenance links (`evt-*`), and decision request/response IDs. In every
 *    case the semantic content those IDs point at is projected directly:
 *    actions by mode/category/target/timing, transfer requests by
 *    requester+owner+resource, proposals by terms+proposer+tick, signals by
 *    kind+parties+tick, memories by full content + appraisal + createdTick,
 *    beliefs by subject+value+confidence+provenance kind+tick.
 *  - `lastSupersededRequestId` (response-transport bookkeeping).
 *  - Pending-decision transport fields (request/response IDs, fingerprint);
 *    the behaviorally relevant part — that a request is outstanding, its
 *    window, and what was offered — IS included.
 *
 * The projection contains only plain objects/arrays with integer, string,
 * boolean, or null leaves, and is hashed with the shared canonical
 * serializer + FNV-1a 64.
 */
export function buildWorldStateHashProjection(state: CanonicalState): Record<string, unknown> {
  return {
    scenarioId: state.scenarioId,
    scenarioVersion: state.scenarioVersion,
    configVersion: state.configVersion,
    seed: state.seed,
    tick: state.tick,
    endTick: state.endTick,
    terminal: state.terminal,
    taskOutcome: state.taskOutcome,
    purifier: {
      progressUnits: state.purifier.progressUnits,
      activeWorkerId: state.purifier.activeWorkerId,
    },
    meal: {
      exists: state.meal.exists,
      locationId: state.meal.locationId,
      reservedForNpcId: state.meal.reservedForNpcId,
      consumedByNpcId: state.meal.consumedByNpcId,
      consumedTick: state.meal.consumedTick,
    },
    reservations: state.reservations.map((r) => ({
      resourceId: r.resourceId,
      holderNpcId: r.holderNpcId,
      kind: r.kind,
      sinceTick: r.sinceTick,
    })),
    commitments: state.commitments.map((c) => ({
      id: c.id, // fixed configuration string, not a counter
      kind: c.kind,
      debtorId: c.debtorId,
      creditorId: c.creditorId,
      terms: { ...c.terms },
      originalTerms: { ...c.originalTerms },
      status: c.status,
      renegotiated: c.renegotiated,
      activeReliefStartTick: c.activeReliefStartTick,
      pendingProposal: c.pendingProposal
        ? {
            proposedTerms: { ...c.pendingProposal.proposedTerms },
            proposedAtTick: c.pendingProposal.proposedAtTick,
            proposedByNpcId: c.pendingProposal.proposedByNpcId,
          }
        : null,
    })),
    pendingTransferRequests: state.pendingTransferRequests.map((r) => ({
      resourceId: r.resourceId,
      requesterNpcId: r.requesterNpcId,
      ownerNpcId: r.ownerNpcId,
      requestedTick: r.requestedTick,
    })),
    relationships: state.relationships.map((r) => ({
      fromNpcId: r.fromNpcId,
      toNpcId: r.toNpcId,
      valueMicro: r.valueMicro,
    })),
    socialSignals: state.socialSignals.map((s) => ({
      kind: s.kind,
      fromNpcId: s.fromNpcId,
      toNpcId: s.toNpcId,
      topicCode: s.topicCode,
      tick: s.tick,
    })),
    npcs: NPC_IDS.map((npcId) => projectNpc(state.npcs[npcId])),
  };
}

function projectNpc(npc: NpcState): Record<string, unknown> {
  return {
    id: npc.id,
    locationId: npc.locationId,
    transit: npc.transit
      ? {
          fromLocationId: npc.transit.fromLocationId,
          toLocationId: npc.transit.toLocationId,
          startTick: npc.transit.startTick,
          arriveTick: npc.transit.arriveTick,
        }
      : null,
    hungerMicro: npc.hungerMicro,
    fatigueMicro: npc.fatigueMicro,
    injury: { ...npc.injury },
    incapacitated: npc.incapacitated,
    currentAction: npc.currentAction ? projectAction(npc.currentAction) : null,
    pendingAction: npc.pendingAction ? projectPendingAction(npc.pendingAction) : null,
    lastDecisionTick: npc.lastDecisionTick,
    needsReevaluation: npc.needsReevaluation,
    requestCooldownUntilTick: npc.requestCooldownUntilTick,
    pendingDecision: npc.pendingDecision
      ? {
          requestedAtTick: npc.pendingDecision.requestedAtTick,
          expiresAtTick: npc.pendingDecision.expiresAtTick,
          offered: npc.pendingDecision.offeredAffordances.map((a) => ({
            category: a.category,
            mode: a.mode,
            targetNpcId: a.targetNpcId,
            targetResourceId: a.targetResourceId,
            requiredLocationId: a.requiredLocationId,
            durationTicks: a.durationTicks,
            interruptible: a.interruptible,
            violation: a.violation,
            isContinue: a.continuesActionId !== null,
          })),
        }
      : null,
    beliefs: npc.beliefs.map((b) => ({
      subject: b.subject,
      value: b.value,
      confidenceMicro: b.confidenceMicro,
      provenanceKind: b.provenanceKind,
      updatedTick: b.updatedTick,
    })),
    memories: npc.memories.map((m) => ({
      canonicalFact: m.canonicalFact,
      preScenario: m.preScenario,
      perception: m.perception,
      interpretation: m.interpretation,
      confidenceMicro: m.confidenceMicro,
      importanceMicro: m.importanceMicro,
      createdTick: m.createdTick,
      themes: [...m.themes],
      socialTargetId: m.socialTargetId,
      valenceMicro: m.valenceMicro,
      selfRelevanceMicro: m.selfRelevanceMicro,
    })),
  };
}

/**
 * Action projection: identity by semantics and timing, never by counter IDs.
 * `requestId`/`proposalId` are excluded because the pending request/proposal
 * they reference is identified semantically by the action's target plus the
 * projected pendingTransferRequests / pendingProposal entries.
 */
function projectAction(action: ActionInstanceState): Record<string, unknown> {
  return {
    ...projectActionCore(action),
    phase: action.phase,
    phaseStartTick: action.phaseStartTick,
    completesAtTick: action.completesAtTick,
  };
}

function projectPendingAction(action: PendingActionState): Record<string, unknown> {
  return projectActionCore(action);
}

function projectActionCore(action: PendingActionState): Record<string, unknown> {
  return {
    category: action.category,
    mode: action.mode,
    targetNpcId: action.targetNpcId,
    targetResourceId: action.targetResourceId,
    locationId: action.locationId,
    durationTicks: action.durationTicks,
    interruptible: action.interruptible,
    violation: action.violation,
    commitmentId: action.commitmentId, // fixed configuration string
    proposedTerms: action.proposedTerms ? { ...action.proposedTerms } : null,
  };
}

export function worldStateHash(state: CanonicalState): string {
  return fnv1a64Hex(canonicalSerialize(buildWorldStateHashProjection(state)));
}
