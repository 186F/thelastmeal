import type { NpcId, ScenarioId } from '../../shared/ids';
import type { DecisionResponse } from '../../shared/decisionContracts';
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

/**
 * A provider that cannot answer on the current logical tick returns
 * `{ deferred: true }` (remediation 1). The request stays pending in
 * canonical state; the simulation continues (current action or provisional
 * fallback) and the eventual response enters through the engine's single
 * acceptance gate on a later tick. The simulation clock NEVER awaits a
 * provider: "asynchronous" means later-tick response submission, not
 * Promises inside canonical code.
 */
export interface DeferredDecision {
  deferred: true;
}

export type ProviderDecision = DecisionResult | DeferredDecision;

export function isDeferred(decision: ProviderDecision): decision is DeferredDecision {
  return 'deferred' in decision;
}

export interface DecisionProvider {
  readonly id: string;
  decide(ctx: DecisionContext): ProviderDecision;
}

/**
 * Implemented by providers that schedule responses by logical tick (the
 * simulated asynchronous test provider). The engine drains due responses at
 * one fixed point inside stepTick, so canonical outcomes are independent of
 * operator tick-batch sizes. Wall-clock time is never involved.
 */
export interface ScheduledResponseSource {
  dueResponses(tick: number): DecisionResponse[];
}

export function isScheduledResponseSource(
  provider: DecisionProvider,
): provider is DecisionProvider & ScheduledResponseSource {
  return typeof (provider as Partial<ScheduledResponseSource>).dueResponses === 'function';
}

/** Thrown by providers in failure mode; the engine records it and falls back. */
export class ProviderFailureError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(`provider-failure: ${errorCode}`);
    this.errorCode = errorCode;
  }
}
