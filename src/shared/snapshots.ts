import type { ActionCategory, ActionMode, LocationId, NpcId, ScenarioId } from './ids';

/**
 * Read-only presentation snapshot emitted by the simulation host.
 *
 * Snapshots are derived views of canonical state intended for rendering and
 * inspection. They may be coalesced or dropped for performance without
 * affecting simulation behavior, and nothing in them is authoritative.
 * All normalized quantities are integer micro units (1.0 == 1_000_000).
 */

export type RunStatus = 'idle' | 'running' | 'paused' | 'replaying' | 'importing' | 'complete';

export interface SnapshotTransit {
  fromLocationId: LocationId;
  toLocationId: LocationId;
  startTick: number;
  arriveTick: number;
}

export interface SnapshotAction {
  id: string;
  category: ActionCategory;
  mode: ActionMode;
  phase: 'moving' | 'active';
  startedTick: number;
  completesAtTick: number;
  targetNpcId: NpcId | null;
  targetResourceId: string | null;
  locationId: LocationId | null;
}

export interface SnapshotDecision {
  requestId: string;
  affordanceId: string;
  category: ActionCategory | null;
  mode: ActionMode | null;
  confidenceBp: number;
  reasonCode: string;
  providerId: string;
  tick: number;
  usedFallback: boolean;
}

export interface SnapshotBelief {
  id: string;
  subject: string;
  value: string;
  confidenceMicro: number;
  provenanceKind: string;
  updatedTick: number;
}

export interface SnapshotMemory {
  id: string;
  canonicalFact: string;
  perception: string;
  interpretation: string;
  confidenceMicro: number;
  importanceMicro: number;
  createdTick: number;
  themes: string[];
  socialTargetId: NpcId | null;
  valenceMicro: number;
  selfRelevanceMicro: number;
}

export interface SnapshotRelationship {
  toNpcId: NpcId;
  valueMicro: number;
}

export interface SnapshotRelationshipChange {
  fromNpcId: NpcId;
  toNpcId: NpcId;
  deltaMicro: number;
  valueMicro: number;
  tick: number;
  causeEventIds: string[];
}

/** Diagnostics view of a pending decision request (remediation 1). */
export interface SnapshotPendingDecision {
  requestId: string;
  providerId: string;
  requestedAtTick: number;
  expiresAtTick: number;
  worldRevisionAtRequest: number;
  offeredAffordanceCount: number;
  responseIdsSeen: string[];
}

export interface SnapshotNpc {
  id: NpcId;
  displayName: string;
  locationId: LocationId;
  transit: SnapshotTransit | null;
  hungerMicro: number;
  fatigueMicro: number;
  injurySeverityMicro: number;
  incapacitated: boolean;
  goal: string;
  currentAction: SnapshotAction | null;
  lastDecision: SnapshotDecision | null;
  pendingDecision: SnapshotPendingDecision | null;
  beliefs: SnapshotBelief[];
  memories: SnapshotMemory[];
  relationships: SnapshotRelationship[];
}

export interface SnapshotCommitment {
  id: string;
  kind: string;
  debtorId: NpcId;
  creditorId: NpcId;
  status: 'active' | 'fulfilled' | 'broken';
  startTick: number;
  graceTick: number;
  minDurationTicks: number;
  renegotiated: boolean;
  pendingProposalId: string | null;
}

export interface SnapshotMeal {
  exists: boolean;
  reservedForNpcId: NpcId | null;
  consumedByNpcId: NpcId | null;
  locationId: LocationId;
}

export interface SnapshotPurifier {
  progressUnits: number;
  progressTotalUnits: number;
  activeWorkerId: NpcId | null;
  deadlineTick: number;
  taskOutcome: 'pending' | 'completed' | 'deadline-missed';
}

export interface PresentationSnapshot {
  scenarioId: ScenarioId;
  scenarioVersion: string;
  configVersion: string;
  seed: number;
  tick: number;
  endTick: number;
  terminal: boolean;
  purifier: SnapshotPurifier;
  meal: SnapshotMeal;
  npcs: SnapshotNpc[];
  commitments: SnapshotCommitment[];
  recentRelationshipChanges: SnapshotRelationshipChange[];
  eventCount: number;
  stateVersion: number;
  worldRevision: number;
  worldStateHash: string | null;
  canonicalLedgerHash: string | null;
  providerId: string;
}
