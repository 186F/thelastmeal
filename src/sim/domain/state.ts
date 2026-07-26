import type {
  ActionCategory,
  ActionMode,
  LocationId,
  NpcId,
  ResourceId,
  ScenarioId,
} from '../../shared/ids';

/**
 * Canonical world state.
 *
 * Contains only serializable domain data and stable IDs: plain objects,
 * arrays, integers, booleans, and strings. No Map/Set, no floats intended to
 * carry canonical precision, no functions, no platform objects. Every
 * mutation flows through the event reducer (`events/reduce.ts`); nothing else
 * may write to this structure.
 */

export interface TransitState {
  fromLocationId: LocationId;
  toLocationId: LocationId;
  startTick: number;
  arriveTick: number;
  /** Action that initiated this movement. Movement always completes even if
   * the action is cancelled mid-transit (the NPC still physically arrives). */
  actionId: string;
}

export interface ActionInstanceState {
  id: string;
  affordanceId: string;
  category: ActionCategory;
  mode: ActionMode;
  actorId: NpcId;
  targetNpcId: NpcId | null;
  targetResourceId: ResourceId | null;
  /** Location the active phase requires, if any. */
  locationId: LocationId | null;
  phase: 'moving' | 'active';
  /** Tick at which the current phase started. */
  phaseStartTick: number;
  /** Tick at which the active phase completes (or the movement arrives). */
  completesAtTick: number;
  durationTicks: number;
  stateVersionAtProposal: number;
  interruptible: boolean;
  violation: boolean;
  commitmentId: string | null;
  proposalId: string | null;
  requestId: string | null;
  /** Terms carried by a propose-renegotiation action. */
  proposedTerms: CommitmentTerms | null;
}

/** A proposed-and-accepted action descriptor awaiting its start (movement leg). */
export type PendingActionState = Omit<
  ActionInstanceState,
  'phase' | 'phaseStartTick' | 'completesAtTick'
>;

export interface BeliefState {
  id: string;
  subject: string;
  value: string;
  confidenceMicro: number;
  provenanceKind: 'initial' | 'perception' | 'testimony' | 'inference';
  provenanceEventId: string | null;
  updatedTick: number;
}

export interface MemoryState {
  id: string;
  canonicalFact: string;
  /** Event ID of the canonical fact, or null for pre-scenario facts. */
  factEventId: string | null;
  preScenario: boolean;
  perception: string;
  interpretation: string;
  confidenceMicro: number;
  importanceMicro: number;
  createdTick: number; // -1 for pre-scenario memories
}

export interface InjuryState {
  severityMicro: number;
  injuredAtTick: number | null;
  /** Tick at which a treatment action began, null if none has begun. */
  treatmentStartedTick: number | null;
  treatedByNpcId: NpcId | null;
  worsened: boolean;
}

export interface NpcState {
  id: NpcId;
  locationId: LocationId;
  transit: TransitState | null;
  hungerMicro: number;
  fatigueMicro: number;
  injury: InjuryState;
  incapacitated: boolean;
  currentAction: ActionInstanceState | null;
  pendingAction: PendingActionState | null;
  lastDecisionTick: number;
  /** Set by relevant events; cleared when a decision is requested. */
  needsReevaluation: boolean;
  /** After a refused meal-transfer request, suppress re-requests until this tick. */
  requestCooldownUntilTick: number;
  lastDecision: {
    requestId: string;
    affordanceId: string;
    category: ActionCategory | null;
    mode: ActionMode | null;
    confidenceBp: number;
    reasonCode: string;
    usedFallback: boolean;
    tick: number;
  } | null;
  beliefs: BeliefState[];
  memories: MemoryState[];
}

export interface ReservationState {
  resourceId: ResourceId;
  holderNpcId: NpcId;
  /** 'consumption-right' for the meal, 'exclusive-use' for the workbench slot. */
  kind: 'consumption-right' | 'exclusive-use';
  sinceTick: number;
}

export interface CommitmentTerms {
  startTick: number;
  graceTick: number;
  minDurationTicks: number;
}

export interface RenegotiationProposalState {
  proposalId: string;
  proposedTerms: CommitmentTerms;
  proposedAtTick: number;
  proposedByNpcId: NpcId;
}

export interface CommitmentState {
  id: string;
  kind: 'relieve-at-bench';
  debtorId: NpcId;
  creditorId: NpcId;
  terms: CommitmentTerms;
  originalTerms: CommitmentTerms;
  status: 'active' | 'fulfilled' | 'broken';
  renegotiated: boolean;
  pendingProposal: RenegotiationProposalState | null;
  /** Start tick of the debtor's current qualifying bench run, if any. */
  activeReliefStartTick: number | null;
}

export interface TransferRequestState {
  requestId: string;
  resourceId: ResourceId;
  requesterNpcId: NpcId;
  ownerNpcId: NpcId;
  requestedTick: number;
}

export interface RelationshipState {
  fromNpcId: NpcId;
  toNpcId: NpcId;
  valueMicro: number;
}

export interface SocialSignalState {
  id: string;
  kind: 'help-requested' | 'relief-requested';
  fromNpcId: NpcId;
  toNpcId: NpcId | null; // null == broadcast
  topicCode: string;
  tick: number;
}

export interface MealState {
  resourceId: ResourceId;
  exists: boolean;
  locationId: LocationId;
  reservedForNpcId: NpcId | null;
  consumedByNpcId: NpcId | null;
  consumedTick: number | null;
}

export interface PurifierState {
  progressUnits: number;
  /** NPC currently in an active work-on-purifier phase, if any. */
  activeWorkerId: NpcId | null;
}

export interface CanonicalState {
  schemaVersion: number;
  configVersion: string;
  scenarioId: ScenarioId;
  scenarioVersion: string;
  seed: number;
  /**
   * Canonical state-version token: counts applied canonical events. Operator
   * pause/resume markers do NOT advance it, so pausing can never leak into
   * staleness tokens or the final-state hash.
   */
  stateVersion: number;
  tick: number;
  endTick: number;
  terminal: boolean;
  taskOutcome: 'pending' | 'completed' | 'deadline-missed';
  purifier: PurifierState;
  meal: MealState;
  npcs: Record<NpcId, NpcState>;
  reservations: ReservationState[];
  commitments: CommitmentState[];
  pendingTransferRequests: TransferRequestState[];
  relationships: RelationshipState[];
  socialSignals: SocialSignalState[];
}
