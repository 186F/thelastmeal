import type { ActionCategory, ActionMode, LocationId, NpcId, ResourceId, ScenarioId } from './ids';

/**
 * Serializable decision-lifecycle contracts (remediation 1).
 *
 * A DecisionRequest is created by the engine at every decision opportunity and
 * recorded verbatim in the DecisionRequested event payload, which is what makes
 * pending-request state replayable. A DecisionResponse may be produced on the
 * same logical tick (local deterministic provider), on a later logical tick
 * (simulated asynchronous provider), or injected from outside through the
 * worker command `submit-decision-response`. Every response — local, delayed,
 * or external — passes through the same engine acceptance gate.
 *
 * All values are integers, strings, booleans, or null: these contracts must
 * survive canonical serialization and structured clone unchanged.
 */

export interface CommitmentTermsShape {
  startTick: number;
  graceTick: number;
  minDurationTicks: number;
}

/**
 * A complete, immutable affordance descriptor as offered at request time.
 * Stored (not regenerated) so a delayed response can be revalidated and
 * launched later: affordance IDs embed the original decision tick, so
 * regeneration at a later tick can never reproduce the offered ID.
 */
export interface OfferedAffordance {
  id: string;
  category: ActionCategory;
  mode: ActionMode;
  actorId: NpcId;
  targetNpcId: NpcId | null;
  targetResourceId: ResourceId | null;
  requiredLocationId: LocationId | null;
  durationTicks: number;
  expectedTravelTicks: number;
  preconditions: string[];
  reservations: ResourceId[];
  violation: boolean;
  interruptible: boolean;
  commitmentId: string | null;
  proposalId: string | null;
  requestId: string | null;
  proposedTerms: CommitmentTermsShape | null;
  continuesActionId: string | null;
  stateVersion: number;
}

export interface DecisionRequest {
  requestId: string;
  npcId: NpcId;
  scenarioId: ScenarioId;
  requestedAtTick: number;
  expiresAtTick: number;
  /** Audit metadata: canonical worldRevision at request time. Acceptance is
   * gated on the hard dependency fingerprint, not on revision equality —
   * needs drift every tick would otherwise make every delayed response stale. */
  worldRevisionAtRequest: number;
  providerId: string;
  offeredAffordances: OfferedAffordance[];
  offeredAffordanceIds: string[];
  /** FNV-1a 64 hash of the hard-dependency projection (see
   * sim/decisions/dependencyFingerprint.ts). A response is rejected as
   * stale-dependencies when the recomputed fingerprint differs. */
  hardDependencyFingerprint: string;
}

export interface DecisionResponseScoreComponent {
  code: string;
  value: number;
}

export interface DecisionResponseScoreRecord {
  affordanceId: string;
  mode: ActionMode;
  totalScore: number;
  components: DecisionResponseScoreComponent[];
}

export interface DecisionResponse {
  responseId: string;
  requestId: string;
  npcId: NpcId;
  scenarioId: ScenarioId;
  providerId: string;
  selectedAffordanceId: string;
  confidenceBp: number;
  reasonCode: string;
  /** Optional structured score decomposition (diagnostic; empty allowed). */
  scores: DecisionResponseScoreRecord[];
}

/**
 * Structured external decision context (model integration milestone 001,
 * section 9): the immutable, bounded, integers-only snapshot a model
 * provider receives alongside the replayable DecisionRequest. Types live
 * here (the shared leaf layer) so the worker protocol can name them; the
 * deterministic builder and the exact runtime schemas live in
 * `src/sim/decisions/` where the config-derived bounds are.
 */
export interface ExternalDecisionContext {
  npc: {
    id: NpcId;
    displayName: string;
    traits: { key: string; valueMicro: number }[];
    values: string[];
    skills: { repair: string; firstAid: string };
    goalId: string;
    goalText: string;
    hardBoundaryId: string;
    hardBoundaryText: string;
  };
  state: {
    tick: number;
    locationId: string;
    currentAction: {
      category: string;
      mode: string;
      phase: string;
      interruptible: boolean;
      completesAtTick: number | null;
    } | null;
    hungerMicro: number;
    fatigueMicro: number;
    injury: { severityMicro: number; treatmentStarted: boolean; worsened: boolean };
    incapacitated: boolean;
  };
  world: {
    purifierProgressUnits: number;
    purifierTotalUnits: number;
    taskOutcome: string;
    benchOccupantId: NpcId | null;
    mealExists: boolean;
    mealReservedForNpcId: NpcId | null;
    taskDeadlineTick: number;
  };
  cognition: {
    beliefs: { subject: string; value: string; confidenceMicro: number; updatedTick: number }[];
    memories: {
      canonicalFact: string;
      preScenario: boolean;
      perception: string;
      interpretation: string;
      confidenceMicro: number;
      importanceMicro: number;
      createdTick: number;
      themes: string[];
      socialTargetId: NpcId | null;
      valenceMicro: number;
      selfRelevanceMicro: number;
    }[];
    relationships: { toNpcId: NpcId; valueMicro: number }[];
    commitments: {
      id: string;
      kind: string;
      role: string;
      otherPartyId: NpcId;
      status: string;
      renegotiated: boolean;
      terms: CommitmentTermsShape;
      hasPendingProposal: boolean;
      activeReliefStartTick: number | null;
    }[];
    recentSignals: { kind: string; fromNpcId: NpcId; toNpcId: NpcId | null; tick: number }[];
  };
  affordances: {
    id: string;
    category: string;
    mode: string;
    actorId: NpcId;
    targetNpcId: NpcId | null;
    targetResourceId: string | null;
    requiredLocationId: string | null;
    durationTicks: number;
    expectedTravelTicks: number;
    preconditions: string[];
    reservations: string[];
    violation: boolean;
    interruptible: boolean;
    isContinuation: boolean;
    description: string;
  }[];
}

export interface ExternalContextTruncation {
  beliefs: number;
  memories: number;
  commitments: number;
  relationships: number;
  recentSignals: number;
}

/** What the engine's external outbox holds and the worker's
 * `decision-request` message carries: the replayable request, the bounded
 * deterministic context, its hash, and truncation diagnostics. */
export interface ExternalDecisionRequest {
  request: DecisionRequest;
  context: ExternalDecisionContext;
  contextHash: string;
  truncationCounts: ExternalContextTruncation;
}

/**
 * Typed external-gateway failure (model integration milestone 001, section
 * 15): a KNOWN gateway/model failure is reported explicitly through the
 * `submit-decision-failure` command instead of relying on silent TTL expiry.
 * The engine verifies the pending request and provider binding, records
 * DecisionProviderFailed with the structured code, and resolves the request
 * with an explicit expiry; the NPC re-decides on the ordinary cadence.
 */
export const EXTERNAL_FAILURE_CODES = [
  'gateway-unavailable',
  'request-timeout',
  'upstream-timeout',
  'upstream-error',
  'upstream-refusal',
  'invalid-model-output',
  'invalid-gateway-response',
  'budget-exhausted',
  'client-aborted',
] as const;
export type ExternalFailureCode = (typeof EXTERNAL_FAILURE_CODES)[number];

export interface ExternalDecisionFailure {
  failureId: string;
  requestId: string;
  npcId: NpcId;
  scenarioId: ScenarioId;
  providerId: string;
  failureCode: ExternalFailureCode;
  /** Diagnostic only: whether the client judged the failure retryable. The
   * engine never retries — one request, at most one upstream call. */
  retryable: boolean;
}

/** Structured response-rejection reasons (remediation 1, section 5.6;
 * `provider-mismatch` added by re-audit finding 1: a response must come from
 * the decision authority named by its request). */
export const DECISION_REJECTION_REASONS = [
  'duplicate-response',
  'unknown-request',
  'provider-mismatch',
  'superseded-request',
  'response-expired',
  'unoffered-affordance',
  'stale-dependencies',
  'constraint-violation',
  'action-no-longer-valid',
  'actor-busy-noninterruptible',
] as const;
export type DecisionRejectionReason = (typeof DECISION_REJECTION_REASONS)[number];
