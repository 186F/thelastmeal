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

/** Structured response-rejection reasons (remediation 1, section 5.6). */
export const DECISION_REJECTION_REASONS = [
  'duplicate-response',
  'unknown-request',
  'superseded-request',
  'response-expired',
  'unoffered-affordance',
  'stale-dependencies',
  'constraint-violation',
  'action-no-longer-valid',
  'actor-busy-noninterruptible',
] as const;
export type DecisionRejectionReason = (typeof DECISION_REJECTION_REASONS)[number];
