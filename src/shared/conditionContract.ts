import type { ScenarioId } from './ids';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_CONDITION_SCENARIOS,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
  MODEL_TARGET_NPC_ID,
  MODEL_UPSTREAM_PLATFORM,
} from './modelExperiment';
import {
  M2_ACTION_PROMPT_VERSION,
  M2_ACTION_PROVIDER_ID,
  M2_CONDITION_SCENARIOS,
  M2_EXPERIMENT_ID,
  M2_EXPERIMENT_VERSION,
  M2_PER_DECISION_CONDITION_ID,
  M2_TARGET_NPC_ID,
  M2_UPSTREAM_PLATFORM,
} from './m2Experiment';

/**
 * The registered pairing of every MODEL-BACKED condition with its complete
 * experiment identity (M2 brief §9.2/§9.4; Phase 4). A condition ID is the
 * only thing a client may select; everything else — experiment, provider,
 * prompt, target NPC, scenario coverage, diagnostic contract — is resolved
 * HERE, from code, never from client input or gateway advertisement.
 *
 * Milestone 1's pairing is frozen (§6.1). The M2 pairing is new in Phase 4
 * and differs in exactly one contract dimension: the diagnostic-output
 * contract, where rationale and self-reported confidence are normalized
 * diagnostics instead of structural gates (§17.5; scope ruling R7 §9.1/§9.2).
 */

export interface ModelConditionContract {
  /** Closed literal unions: the registry is a CLOSED set, so consumers that
   * build the transport envelope get exact-literal type safety for free. */
  conditionId: typeof MODEL_CONDITION_ID | typeof M2_PER_DECISION_CONDITION_ID;
  experimentId: typeof MODEL_EXPERIMENT_ID | typeof M2_EXPERIMENT_ID;
  experimentVersion: typeof MODEL_EXPERIMENT_VERSION | typeof M2_EXPERIMENT_VERSION;
  providerId: string;
  promptVersion: string;
  targetNpcId: string;
  upstreamPlatform: string;
  scenarios: readonly ScenarioId[];
  /** 'm1-strict': rationale and confidence are required structural fields
   * (frozen Milestone 1 behavior). 'm2-normalized': rationale and confidence
   * are optional diagnostics, normalized per §17.5 — never grounds for
   * rejecting a structurally valid choice. */
  diagnosticContract: 'm1-strict' | 'm2-normalized';
}

const M1_CONTRACT: ModelConditionContract = {
  conditionId: MODEL_CONDITION_ID,
  experimentId: MODEL_EXPERIMENT_ID,
  experimentVersion: MODEL_EXPERIMENT_VERSION,
  providerId: EXTERNAL_MARA_PROVIDER_ID,
  promptVersion: MODEL_PROMPT_VERSION,
  targetNpcId: MODEL_TARGET_NPC_ID,
  upstreamPlatform: MODEL_UPSTREAM_PLATFORM,
  scenarios: MODEL_CONDITION_SCENARIOS,
  diagnosticContract: 'm1-strict',
};

const M2_CONTRACT: ModelConditionContract = {
  conditionId: M2_PER_DECISION_CONDITION_ID,
  experimentId: M2_EXPERIMENT_ID,
  experimentVersion: M2_EXPERIMENT_VERSION,
  providerId: M2_ACTION_PROVIDER_ID,
  promptVersion: M2_ACTION_PROMPT_VERSION,
  targetNpcId: M2_TARGET_NPC_ID,
  upstreamPlatform: M2_UPSTREAM_PLATFORM,
  scenarios: M2_CONDITION_SCENARIOS,
  diagnosticContract: 'm2-normalized',
};

export const MODEL_BACKED_CONDITION_CONTRACTS: readonly ModelConditionContract[] = [
  M1_CONTRACT,
  M2_CONTRACT,
];

/** Returns the registered contract for a model-backed condition, or null for
 * every other condition (including the deterministic baseline). */
export function contractForCondition(conditionId: string): ModelConditionContract | null {
  return (
    MODEL_BACKED_CONDITION_CONTRACTS.find((contract) => contract.conditionId === conditionId) ??
    null
  );
}

export function isModelBackedConditionId(conditionId: string): boolean {
  return contractForCondition(conditionId) !== null;
}

/** Typed lookup that refuses unknown condition ids instead of returning
 * null — for call sites where a model-backed condition is already proven. */
export function requireContractForCondition(conditionId: string): ModelConditionContract {
  const contract = contractForCondition(conditionId);
  if (contract === null) {
    throw new Error(`condition-not-model-backed: ${conditionId}`);
  }
  return contract;
}
