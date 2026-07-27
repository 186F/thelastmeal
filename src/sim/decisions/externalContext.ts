import type {
  ExternalContextTruncation,
  ExternalDecisionContext,
} from '../../shared/decisionContracts';
import { REPAIR_TOTAL_UNITS, SCENARIO_END_TICK } from '../config';
import type { CanonicalState } from '../domain/state';
import { fnv1a64Hex } from '../replay/hash';
import { canonicalSerialize } from '../replay/serialize';
import type { Affordance } from '../actions/affordances';
import type { DecisionContext } from './provider';

/**
 * Structured external decision context (model integration milestone 001,
 * section 9): the immutable, bounded, integers-only snapshot a model provider
 * receives alongside the replayable DecisionRequest. Everything here is
 * derived deterministically from canonical state — the builder is pure, so
 * the context hash is reproducible by the gateway and by replay tooling.
 *
 * The human-readable affordance descriptions are presentation data generated
 * from the structured offer; they can never add a capability the offer lacks.
 */

export const EXTERNAL_CONTEXT_LIMITS = {
  affordances: 24,
  beliefs: 24,
  memories: 12,
  commitments: 12,
  relationships: 12,
  recentSignals: 20,
} as const;

/** Deterministic, mechanical description of an offered affordance. */
export function describeAffordance(a: Affordance): string {
  const parts: string[] = [`${a.mode} (${a.category})`];
  if (a.targetNpcId !== null) parts.push(`targeting ${a.targetNpcId}`);
  if (a.targetResourceId !== null) parts.push(`using ${a.targetResourceId}`);
  if (a.requiredLocationId !== null) parts.push(`at ${a.requiredLocationId}`);
  parts.push(`for ${a.durationTicks} ticks`);
  if (a.expectedTravelTicks > 0) parts.push(`after ${a.expectedTravelTicks} ticks of travel`);
  if (a.continuesActionId !== null) parts.push('continuing the current action');
  if (a.violation) parts.push("violating another NPC's reservation");
  if (!a.interruptible) parts.push('non-interruptible once started');
  return parts.join(', ');
}

/**
 * Builds the bounded external context for one decision opportunity. List
 * truncation uses deterministic, documented orderings (section 9): memories
 * by importance, then confidence, then recency, then canonical fact; beliefs
 * by recency then subject; signals by recency then kind/sender; relationships
 * and commitments by stable identity. Truncation counts are reported for the
 * noncanonical model trace; the frozen scenarios never exceed these bounds.
 */
export function buildExternalDecisionContext(
  state: CanonicalState,
  ctx: DecisionContext,
): { context: ExternalDecisionContext; truncationCounts: ExternalContextTruncation } {
  const npc = state.npcs[ctx.npcId];

  const beliefsSorted = [...ctx.beliefs].sort(
    (a, b) => b.updatedTick - a.updatedTick || (a.subject < b.subject ? -1 : 1),
  );
  const memoriesSorted = [...ctx.memories].sort(
    (a, b) =>
      b.importanceMicro - a.importanceMicro ||
      b.confidenceMicro - a.confidenceMicro ||
      b.createdTick - a.createdTick ||
      (a.canonicalFact < b.canonicalFact ? -1 : 1),
  );
  const relationshipsSorted = [...ctx.relationships].sort((a, b) =>
    a.toNpcId < b.toNpcId ? -1 : 1,
  );
  const commitmentsSorted = [...ctx.commitments].sort((a, b) => (a.id < b.id ? -1 : 1));
  const signalsSorted = [...ctx.recentSignals].sort(
    (a, b) => b.tick - a.tick || (a.kind < b.kind ? -1 : 1) || (a.fromNpcId < b.fromNpcId ? -1 : 1),
  );

  const limits = EXTERNAL_CONTEXT_LIMITS;
  const truncationCounts: ExternalContextTruncation = {
    beliefs: Math.max(0, beliefsSorted.length - limits.beliefs),
    memories: Math.max(0, memoriesSorted.length - limits.memories),
    commitments: Math.max(0, commitmentsSorted.length - limits.commitments),
    relationships: Math.max(0, relationshipsSorted.length - limits.relationships),
    recentSignals: Math.max(0, signalsSorted.length - limits.recentSignals),
  };

  const context: ExternalDecisionContext = {
    npc: {
      id: ctx.npcId,
      displayName: ctx.identity.displayName,
      traits: Object.entries(ctx.identity.traits)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, valueMicro]) => ({ key, valueMicro })),
      values: [...ctx.identity.values],
      skills: { repair: ctx.identity.skills.repair, firstAid: ctx.identity.skills.firstAid },
      goalId: ctx.identity.goalId,
      goalText: ctx.identity.goalText,
      hardBoundaryId: ctx.identity.hardBoundaryId,
      hardBoundaryText: ctx.identity.hardBoundaryText,
    },
    state: {
      tick: ctx.tick,
      locationId: ctx.locationId,
      currentAction: npc.currentAction
        ? {
            category: npc.currentAction.category,
            mode: npc.currentAction.mode,
            phase: npc.currentAction.phase,
            interruptible: npc.currentAction.interruptible,
            completesAtTick: npc.currentAction.completesAtTick,
          }
        : null,
      hungerMicro: ctx.hungerMicro,
      fatigueMicro: ctx.fatigueMicro,
      injury: {
        severityMicro: ctx.injury.severityMicro,
        treatmentStarted: ctx.injury.treatmentStartedTick !== null,
        worsened: ctx.injury.worsened,
      },
      incapacitated: ctx.incapacitated,
    },
    world: {
      purifierProgressUnits: ctx.purifierProgressUnits,
      purifierTotalUnits: REPAIR_TOTAL_UNITS,
      taskOutcome: state.taskOutcome,
      benchOccupantId: ctx.benchOccupantId,
      mealExists: state.meal.exists,
      mealReservedForNpcId: state.meal.reservedForNpcId,
      taskDeadlineTick: SCENARIO_END_TICK,
    },
    cognition: {
      beliefs: beliefsSorted.slice(0, limits.beliefs).map((b) => ({
        subject: b.subject,
        value: b.value,
        confidenceMicro: b.confidenceMicro,
        updatedTick: b.updatedTick,
      })),
      memories: memoriesSorted.slice(0, limits.memories).map((m) => ({
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
      relationships: relationshipsSorted.slice(0, limits.relationships).map((r) => ({
        toNpcId: r.toNpcId,
        valueMicro: r.valueMicro,
      })),
      commitments: commitmentsSorted.slice(0, limits.commitments).map((c) => ({
        id: c.id,
        kind: c.kind,
        role: c.role,
        otherPartyId: c.otherPartyId,
        status: c.status,
        renegotiated: c.renegotiated,
        terms: { ...c.terms },
        hasPendingProposal: c.pendingProposalId !== null,
        activeReliefStartTick: c.activeReliefStartTick,
      })),
      recentSignals: signalsSorted.slice(0, limits.recentSignals).map((s) => ({
        kind: s.kind,
        fromNpcId: s.fromNpcId,
        toNpcId: s.toNpcId,
        tick: s.tick,
      })),
    },
    affordances: ctx.affordances.slice(0, limits.affordances).map((a) => ({
      id: a.id,
      category: a.category,
      mode: a.mode,
      actorId: a.actorId,
      targetNpcId: a.targetNpcId,
      targetResourceId: a.targetResourceId,
      requiredLocationId: a.requiredLocationId,
      durationTicks: a.durationTicks,
      expectedTravelTicks: a.expectedTravelTicks,
      preconditions: [...a.preconditions],
      reservations: [...a.reservations],
      violation: a.violation,
      interruptible: a.interruptible,
      isContinuation: a.continuesActionId !== null,
      description: describeAffordance(a),
    })),
  };

  return { context, truncationCounts };
}

/** Context hash: canonical serialization + FNV-1a 64, recomputed and
 * verified by the gateway before any upstream call. */
export function externalContextHash(context: ExternalDecisionContext): string {
  return fnv1a64Hex(canonicalSerialize(context as unknown as Record<string, unknown>));
}
