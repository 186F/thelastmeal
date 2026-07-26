import type { EventEnvelope } from '../../shared/events';
import { NPC_DISPLAY_NAMES, NPC_IDS, type NpcId } from '../../shared/ids';
import type {
  PresentationSnapshot,
  SnapshotNpc,
  SnapshotRelationshipChange,
} from '../../shared/snapshots';
import { REPAIR_TOTAL_UNITS, SCENARIO_END_TICK } from '../config';
import { IDENTITIES } from '../domain/identities';
import type { CanonicalState } from '../domain/state';

/**
 * Builds a read-only presentation snapshot from canonical state. Snapshots
 * are derived data for rendering and inspection; dropping or coalescing them
 * never affects the simulation.
 */
export function buildSnapshot(
  state: CanonicalState,
  events: readonly EventEnvelope[],
  providerId: string,
  worldStateHash: string | null,
  canonicalLedgerHash: string | null,
): PresentationSnapshot {
  const npcs: SnapshotNpc[] = NPC_IDS.map((npcId) => buildNpc(state, npcId));
  return {
    scenarioId: state.scenarioId,
    scenarioVersion: state.scenarioVersion,
    configVersion: state.configVersion,
    seed: state.seed,
    tick: state.tick,
    endTick: state.endTick,
    terminal: state.terminal,
    purifier: {
      progressUnits: state.purifier.progressUnits,
      progressTotalUnits: REPAIR_TOTAL_UNITS,
      activeWorkerId: state.purifier.activeWorkerId,
      deadlineTick: SCENARIO_END_TICK,
      taskOutcome: state.taskOutcome,
    },
    meal: {
      exists: state.meal.exists,
      reservedForNpcId: state.meal.reservedForNpcId,
      consumedByNpcId: state.meal.consumedByNpcId,
      locationId: state.meal.locationId,
    },
    npcs,
    commitments: state.commitments.map((c) => ({
      id: c.id,
      kind: c.kind,
      debtorId: c.debtorId,
      creditorId: c.creditorId,
      status: c.status,
      startTick: c.terms.startTick,
      graceTick: c.terms.graceTick,
      minDurationTicks: c.terms.minDurationTicks,
      renegotiated: c.renegotiated,
      pendingProposalId: c.pendingProposal ? c.pendingProposal.proposalId : null,
    })),
    recentRelationshipChanges: recentRelationshipChanges(events),
    eventCount: events.length,
    stateVersion: state.stateVersion,
    worldRevision: state.worldRevision,
    worldStateHash,
    canonicalLedgerHash,
    providerId,
  };
}

function buildNpc(state: CanonicalState, npcId: NpcId): SnapshotNpc {
  const npc = state.npcs[npcId];
  const action = npc.currentAction;
  return {
    id: npcId,
    displayName: NPC_DISPLAY_NAMES[npcId],
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
    injurySeverityMicro: npc.injury.severityMicro,
    incapacitated: npc.incapacitated,
    goal: IDENTITIES[npcId].goalText,
    currentAction: action
      ? {
          id: action.id,
          category: action.category,
          mode: action.mode,
          phase: action.phase,
          startedTick: action.phaseStartTick,
          completesAtTick: action.completesAtTick,
          targetNpcId: action.targetNpcId,
          targetResourceId: action.targetResourceId,
          locationId: action.locationId,
        }
      : null,
    lastDecision: npc.lastDecision
      ? {
          requestId: npc.lastDecision.requestId,
          affordanceId: npc.lastDecision.affordanceId,
          category: npc.lastDecision.category,
          mode: npc.lastDecision.mode,
          confidenceBp: npc.lastDecision.confidenceBp,
          reasonCode: npc.lastDecision.reasonCode,
          providerId: '',
          tick: npc.lastDecision.tick,
          usedFallback: npc.lastDecision.usedFallback,
        }
      : null,
    pendingDecision: npc.pendingDecision
      ? {
          requestId: npc.pendingDecision.requestId,
          providerId: npc.pendingDecision.providerId,
          requestedAtTick: npc.pendingDecision.requestedAtTick,
          expiresAtTick: npc.pendingDecision.expiresAtTick,
          worldRevisionAtRequest: npc.pendingDecision.worldRevisionAtRequest,
          offeredAffordanceCount: npc.pendingDecision.offeredAffordances.length,
          responseIdsSeen: [...npc.pendingDecision.responseIdsSeen],
        }
      : null,
    beliefs: npc.beliefs.map((b) => ({
      id: b.id,
      subject: b.subject,
      value: b.value,
      confidenceMicro: b.confidenceMicro,
      provenanceKind: b.provenanceKind,
      updatedTick: b.updatedTick,
    })),
    memories: npc.memories.map((m) => ({
      id: m.id,
      canonicalFact: m.canonicalFact,
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
    relationships: state.relationships
      .filter((r) => r.fromNpcId === npcId)
      .map((r) => ({ toNpcId: r.toNpcId, valueMicro: r.valueMicro })),
  };
}

function recentRelationshipChanges(events: readonly EventEnvelope[]): SnapshotRelationshipChange[] {
  const out: SnapshotRelationshipChange[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < 6; i -= 1) {
    const e = events[i]!;
    if (e.type !== 'RelationshipChanged') continue;
    const p = e.payload as {
      fromNpcId: NpcId;
      toNpcId: NpcId;
      deltaMicro: number;
      valueMicro: number;
      causeEventIds: string[];
    };
    out.push({
      fromNpcId: p.fromNpcId,
      toNpcId: p.toNpcId,
      deltaMicro: p.deltaMicro,
      valueMicro: p.valueMicro,
      tick: e.tick,
      causeEventIds: p.causeEventIds,
    });
  }
  return out.reverse();
}
