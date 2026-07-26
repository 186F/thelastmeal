import type { NpcId, ScenarioId } from '../../shared/ids';
import type { Affordance } from '../actions/affordances';
import type { NpcIdentity } from '../domain/identities';
import type {
  BeliefState,
  CommitmentTerms,
  InjuryState,
  MemoryState,
  RelationshipState,
} from '../domain/state';
import type { AffordanceScoreRecord } from '../events/types';

/**
 * Decision-provider contract (brief section 14).
 *
 * The provider sees structured identity, needs, beliefs, memories, goals,
 * commitments, and the offered affordances. It returns exactly one offered
 * affordance ID plus confidence, a structured reason code, and optional debug
 * scoring. It cannot mutate the world; the engine validates and executes.
 *
 * The world simulation never learns whether a decision came from this
 * deterministic provider, a future model provider, or a policy-patch
 * compiler — they all implement this same interface, and the fallback path
 * covers any provider failure.
 */

export interface CommitmentView {
  id: string;
  kind: string;
  role: 'debtor' | 'creditor';
  otherPartyId: NpcId;
  terms: CommitmentTerms;
  status: 'active' | 'fulfilled' | 'broken';
  renegotiated: boolean;
  pendingProposalId: string | null;
  activeReliefStartTick: number | null;
}

export interface DecisionContext {
  npcId: NpcId;
  scenarioId: ScenarioId;
  tick: number;
  stateVersion: number;
  requestId: string;
  identity: NpcIdentity;
  hungerMicro: number;
  fatigueMicro: number;
  injury: InjuryState;
  incapacitated: boolean;
  locationId: string;
  goalId: string;
  beliefs: readonly BeliefState[];
  memories: readonly MemoryState[];
  commitments: readonly CommitmentView[];
  /** Outgoing relationship values for this NPC. */
  relationships: readonly RelationshipState[];
  affordances: readonly Affordance[];
  /** Context the provider may use for politeness/awareness scoring. */
  benchOccupantId: NpcId | null;
  benchOccupantRunTicks: number | null;
  purifierProgressUnits: number;
  /** Recent social signals visible to everyone (small shared room). */
  recentSignals: readonly { kind: string; fromNpcId: NpcId; toNpcId: NpcId | null; tick: number }[];
}

export interface DecisionResult {
  affordanceId: string;
  confidenceBp: number;
  reasonCode: string;
  scores: AffordanceScoreRecord[];
}

export interface DecisionProvider {
  readonly id: string;
  decide(ctx: DecisionContext): DecisionResult;
}

/** Thrown by providers in failure mode; the engine records it and falls back. */
export class ProviderFailureError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(`provider-failure: ${errorCode}`);
    this.errorCode = errorCode;
  }
}
