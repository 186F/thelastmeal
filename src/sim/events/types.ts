import type { EventEnvelope } from '../../shared/events';
import type {
  ActionCategory,
  ActionMode,
  EventType,
  LocationId,
  NpcId,
  ResourceId,
  ScenarioId,
} from '../../shared/ids';
import type { CommitmentTerms } from '../domain/state';

/**
 * Typed payloads for every authoritative event. Events are data, never log
 * strings; human-readable messages are derived elsewhere.
 */

type Evt<T extends EventType, P extends Record<string, unknown>> = Omit<
  EventEnvelope,
  'type' | 'payload'
> & { type: T; payload: P };

/** An event draft: everything except the ledger-assigned id and seq. */
export type EventDraft<E extends SimEvent = SimEvent> = Omit<E, 'id' | 'seq'>;

// --- Run lifecycle -----------------------------------------------------------

export type ScenarioStartedEvent = Evt<
  'ScenarioStarted',
  {
    scenarioId: ScenarioId;
    scenarioVersion: string;
    seed: number;
    configVersion: string;
    providerId: string;
  }
>;

export type ScenarioEndedEvent = Evt<
  'ScenarioEnded',
  { finalStateHash: string; taskOutcome: 'completed' | 'deadline-missed' }
>;

/**
 * TimeAdvanced owns uniform time integration: the reducer applies the fixed
 * per-tick hunger/fatigue drift and per-tick repair accrual for the active
 * bench worker. Discrete, action-caused changes are separate events.
 */
export type TimeAdvancedEvent = Evt<'TimeAdvanced', { tick: number }>;

export type SimulationPausedEvent = Evt<'SimulationPaused', Record<string, never>>;
export type SimulationResumedEvent = Evt<'SimulationResumed', Record<string, never>>;

// --- Decisions -----------------------------------------------------------------

export interface AffordanceScoreComponent {
  code: string;
  value: number;
}

export interface AffordanceScoreRecord {
  affordanceId: string;
  mode: ActionMode;
  totalScore: number;
  components: AffordanceScoreComponent[];
}

export type DecisionRequestedEvent = Evt<
  'DecisionRequested',
  {
    npcId: NpcId;
    requestId: string;
    providerId: string;
    stateVersion: number;
    affordanceIds: string[];
  }
>;

export type DecisionReturnedEvent = Evt<
  'DecisionReturned',
  {
    npcId: NpcId;
    requestId: string;
    affordanceId: string;
    confidenceBp: number;
    reasonCode: string;
    scores: AffordanceScoreRecord[];
  }
>;

export type DecisionProviderFailedEvent = Evt<
  'DecisionProviderFailed',
  { npcId: NpcId; requestId: string; providerId: string; errorCode: string }
>;

export type FallbackDecisionUsedEvent = Evt<
  'FallbackDecisionUsed',
  { npcId: NpcId; requestId: string; affordanceId: string; reasonCode: string }
>;

// --- Action lifecycle -------------------------------------------------------------

export interface ActionDescriptor extends Record<string, unknown> {
  actionId: string;
  affordanceId: string;
  npcId: NpcId;
  category: ActionCategory;
  mode: ActionMode;
  targetNpcId: NpcId | null;
  targetResourceId: ResourceId | null;
  locationId: LocationId | null;
  durationTicks: number;
  stateVersion: number;
  interruptible: boolean;
  violation: boolean;
  commitmentId: string | null;
  proposalId: string | null;
  requestId: string | null;
  proposedTerms: (CommitmentTerms & Record<string, unknown>) | null;
}

export type ActionProposedEvent = Evt<'ActionProposed', ActionDescriptor>;

export type ActionStartedEvent = Evt<
  'ActionStarted',
  ActionDescriptor & { completesAtTick: number }
>;

export type ActionCompletedEvent = Evt<
  'ActionCompleted',
  {
    actionId: string;
    npcId: NpcId;
    category: ActionCategory;
    mode: ActionMode;
    startedTick: number;
    /** Structured outcome code, e.g. 'rest-applied', 'meal-consumed'. */
    outcomeCode: string;
  }
>;

export type ActionRejectedEvent = Evt<
  'ActionRejected',
  {
    actionId: string | null;
    affordanceId: string;
    npcId: NpcId;
    category: ActionCategory;
    mode: ActionMode;
    reasonCode: string;
    /** Precondition codes that failed revalidation. */
    failedPreconditions: string[];
  }
>;

export type ActionInterruptedEvent = Evt<
  'ActionInterrupted',
  {
    actionId: string;
    npcId: NpcId;
    category: ActionCategory;
    mode: ActionMode;
    reasonCode: string;
  }
>;

// --- Movement -------------------------------------------------------------------

export type MovementStartedEvent = Evt<
  'MovementStarted',
  {
    npcId: NpcId;
    actionId: string;
    fromLocationId: LocationId;
    toLocationId: LocationId;
    arriveTick: number;
  }
>;

export type MovementCompletedEvent = Evt<
  'MovementCompleted',
  { npcId: NpcId; actionId: string; locationId: LocationId }
>;

// --- Repair, injury, treatment ------------------------------------------------------

export type RepairProgressedEvent = Evt<
  'RepairProgressed',
  { npcId: NpcId; unitsDelta: number; progressUnits: number }
>;

export type InjuryOccurredEvent = Evt<
  'InjuryOccurred',
  { npcId: NpcId; severityMicro: number; cause: 'scripted' }
>;

export type InjuryWorsenedEvent = Evt<
  'InjuryWorsened',
  { npcId: NpcId; severityMicro: number; reasonCode: 'treatment-not-started-in-time' }
>;

export type TreatmentStartedEvent = Evt<
  'TreatmentStarted',
  {
    actionId: string;
    healerId: NpcId;
    patientId: NpcId;
    expectedDurationTicks: number;
  }
>;

export type TreatmentCompletedEvent = Evt<
  'TreatmentCompleted',
  {
    actionId: string;
    healerId: NpcId;
    patientId: NpcId;
    severityBeforeMicro: number;
    severityAfterMicro: number;
  }
>;

// --- Resources and reservations ------------------------------------------------------

export type ResourceReservedEvent = Evt<
  'ResourceReserved',
  {
    resourceId: ResourceId;
    holderNpcId: NpcId;
    kind: 'consumption-right' | 'exclusive-use';
  }
>;

export type ReservationTransferRequestedEvent = Evt<
  'ReservationTransferRequested',
  {
    requestId: string;
    resourceId: ResourceId;
    requesterNpcId: NpcId;
    ownerNpcId: NpcId;
  }
>;

export type ReservationTransferredEvent = Evt<
  'ReservationTransferred',
  {
    resourceId: ResourceId;
    fromNpcId: NpcId;
    toNpcId: NpcId;
    requestId: string | null;
  }
>;

export type ReservationTransferRefusedEvent = Evt<
  'ReservationTransferRefused',
  {
    requestId: string;
    resourceId: ResourceId;
    ownerNpcId: NpcId;
    requesterNpcId: NpcId;
    reasonCode: string;
  }
>;

export type ReservationReleasedEvent = Evt<
  'ReservationReleased',
  {
    resourceId: ResourceId;
    previousHolderNpcId: NpcId;
    reasonCode: string;
  }
>;

export type ResourceRemovedEvent = Evt<
  'ResourceRemoved',
  { resourceId: ResourceId; reasonCode: 'scripted-world-event' }
>;

export type MealConsumedEvent = Evt<
  'MealConsumed',
  {
    npcId: NpcId;
    resourceId: ResourceId;
    hungerBeforeMicro: number;
    hungerAfterMicro: number;
    violation: boolean;
  }
>;

export type OwnershipViolatedEvent = Evt<
  'OwnershipViolated',
  {
    actorId: NpcId;
    resourceId: ResourceId;
    ownerNpcId: NpcId;
    /** Recorded at the moment the actor takes the reserved resource; whether
     * consumption then completes is recorded separately by MealConsumed. */
    violationKind: 'took-reserved-meal';
  }
>;

// --- Commitments ------------------------------------------------------------------------

export type CommitmentCreatedEvent = Evt<
  'CommitmentCreated',
  {
    commitmentId: string;
    kind: 'relieve-at-bench';
    debtorId: NpcId;
    creditorId: NpcId;
    terms: CommitmentTerms & Record<string, unknown>;
  }
>;

export type CommitmentRenegotiationProposedEvent = Evt<
  'CommitmentRenegotiationProposed',
  {
    commitmentId: string;
    proposalId: string;
    proposedByNpcId: NpcId;
    proposedTerms: CommitmentTerms & Record<string, unknown>;
    reasonCode: string;
  }
>;

export type CommitmentRenegotiationAcceptedEvent = Evt<
  'CommitmentRenegotiationAccepted',
  {
    commitmentId: string;
    proposalId: string;
    acceptedByNpcId: NpcId;
    newTerms: CommitmentTerms & Record<string, unknown>;
  }
>;

export type CommitmentRenegotiationRejectedEvent = Evt<
  'CommitmentRenegotiationRejected',
  { commitmentId: string; proposalId: string; rejectedByNpcId: NpcId }
>;

export type CommitmentFulfilledEvent = Evt<
  'CommitmentFulfilled',
  { commitmentId: string; reliefStartTick: number; reliefEndTick: number }
>;

export type CommitmentBrokenEvent = Evt<
  'CommitmentBroken',
  { commitmentId: string; reasonCode: string }
>;

// --- Task outcome -------------------------------------------------------------------------

export type TaskCompletedEvent = Evt<'TaskCompleted', { taskId: string; progressUnits: number }>;

export type TaskDeadlineMissedEvent = Evt<
  'TaskDeadlineMissed',
  { taskId: string; progressUnits: number }
>;

// --- Cognition ------------------------------------------------------------------------------

export type PerceptionRecordedEvent = Evt<
  'PerceptionRecorded',
  {
    npcId: NpcId;
    sourceEventId: string;
    sourceEventType: EventType;
    summaryCode: string;
  }
>;

export type BeliefUpdatedEvent = Evt<
  'BeliefUpdated',
  {
    npcId: NpcId;
    beliefId: string;
    subject: string;
    value: string;
    confidenceMicro: number;
    provenanceKind: 'perception' | 'testimony' | 'inference';
    provenanceEventId: string | null;
  }
>;

export type RelationshipChangedEvent = Evt<
  'RelationshipChanged',
  {
    fromNpcId: NpcId;
    toNpcId: NpcId;
    deltaMicro: number;
    valueMicro: number;
    reasonCode: string;
    causeEventIds: string[];
  }
>;

// --- Social signals ----------------------------------------------------------------------------

export type HelpRequestedEvent = Evt<
  'HelpRequested',
  { signalId: string; fromNpcId: NpcId; toNpcId: NpcId | null; topicCode: string }
>;

export type ReliefRequestedEvent = Evt<
  'ReliefRequested',
  { signalId: string; fromNpcId: NpcId; toNpcId: NpcId | null; topicCode: string }
>;

// --- Union ------------------------------------------------------------------------------------

export type SimEvent =
  | ScenarioStartedEvent
  | ScenarioEndedEvent
  | TimeAdvancedEvent
  | SimulationPausedEvent
  | SimulationResumedEvent
  | DecisionRequestedEvent
  | DecisionReturnedEvent
  | DecisionProviderFailedEvent
  | FallbackDecisionUsedEvent
  | ActionProposedEvent
  | ActionStartedEvent
  | ActionCompletedEvent
  | ActionRejectedEvent
  | ActionInterruptedEvent
  | MovementStartedEvent
  | MovementCompletedEvent
  | RepairProgressedEvent
  | InjuryOccurredEvent
  | InjuryWorsenedEvent
  | TreatmentStartedEvent
  | TreatmentCompletedEvent
  | ResourceReservedEvent
  | ReservationTransferRequestedEvent
  | ReservationTransferredEvent
  | ReservationTransferRefusedEvent
  | ReservationReleasedEvent
  | ResourceRemovedEvent
  | MealConsumedEvent
  | OwnershipViolatedEvent
  | CommitmentCreatedEvent
  | CommitmentRenegotiationProposedEvent
  | CommitmentRenegotiationAcceptedEvent
  | CommitmentRenegotiationRejectedEvent
  | CommitmentFulfilledEvent
  | CommitmentBrokenEvent
  | TaskCompletedEvent
  | TaskDeadlineMissedEvent
  | PerceptionRecordedEvent
  | BeliefUpdatedEvent
  | RelationshipChangedEvent
  | HelpRequestedEvent
  | ReliefRequestedEvent;
