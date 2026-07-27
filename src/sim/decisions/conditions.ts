import type { NpcId } from '../../shared/ids';
import type { ExternalDecisionRequest } from '../../shared/decisionContracts';
import {
  BASELINE_CONDITION_ID,
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_CONDITION_SCENARIOS,
  MODEL_TARGET_NPC_ID,
} from '../../shared/modelExperiment';
import type { ScenarioDefinition } from '../scenarios/definitions';
import { DeterministicProvider } from './deterministicProvider';
import { ScriptedFailureProvider } from './failingProvider';
import { ExternalDeferredProvider } from './externalDeferredProvider';
import { perNpcPlan, singleProviderPlan, type ProviderPlan } from './providerPlan';
import type { DecisionProvider } from './provider';

/**
 * Registered experimental conditions (model integration milestone 001,
 * section 6). The client may select a NAMED registered condition; it can
 * never submit an arbitrary provider, provider ID, prompt, or model
 * configuration — the engine alone resolves a condition into its provider
 * plan.
 *
 * The experiment literals live in src/shared/modelExperiment.ts (re-audit
 * remediation 1.4.0); this module re-exports its historical names so
 * existing importers keep working.
 */

export {
  MODEL_CONDITION_SCENARIOS,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../shared/modelExperiment';

export const CONDITION_IDS = [BASELINE_CONDITION_ID, MODEL_CONDITION_ID] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export function isConditionId(value: string): value is ConditionId {
  return (CONDITION_IDS as readonly string[]).includes(value);
}

/**
 * Condition-carried request validator for the model condition (re-audit
 * remediation, deviation D4): the only external requests this condition may
 * ever emit are Mara's, from the registered external provider, in a
 * model-supported scenario. Carried as DATA on the provider plan so the
 * engine stays experiment-agnostic.
 */
function validateModelConditionRequest(external: ExternalDecisionRequest): string | null {
  if (external.request.npcId !== MODEL_TARGET_NPC_ID) return 'npc-not-in-condition';
  if (external.request.providerId !== EXTERNAL_MARA_PROVIDER_ID) return 'provider-not-in-condition';
  if (!MODEL_CONDITION_SCENARIOS.includes(external.request.scenarioId)) {
    return 'scenario-not-in-condition';
  }
  return null;
}

/**
 * Resolves a registered condition into a provider plan for a scenario.
 *
 * - `deterministic-baseline-v1` reproduces the default wiring exactly: the
 *   plan id is the default provider's own id (`deterministic-utility-v1`,
 *   including Scenario F's scripted-failure wrapper), so explicitly selecting
 *   the baseline yields byte-identical event streams and hashes.
 * - `mara-model-per-decision-v1` routes ONLY Mara to the external deferred
 *   provider; Jonas and Rin keep the deterministic provider and can never
 *   cause an outbound model call.
 */
export function planForCondition(
  conditionId: ConditionId,
  scenario: ScenarioDefinition,
  defaultProvider: () => DecisionProvider,
): ProviderPlan {
  if (conditionId === BASELINE_CONDITION_ID) {
    const provider = defaultProvider();
    return singleProviderPlan(() => provider);
  }
  if (!MODEL_CONDITION_SCENARIOS.includes(scenario.id)) {
    throw new Error(`condition-not-supported-for-scenario: ${conditionId} on ${scenario.id}`);
  }
  const deterministic = new DeterministicProvider();
  const mara = new ExternalDeferredProvider(EXTERNAL_MARA_PROVIDER_ID);
  const providers: Record<NpcId, DecisionProvider> = {
    mara,
    jonas: deterministic,
    rin: deterministic,
  };
  return perNpcPlan(
    MODEL_CONDITION_ID,
    providers,
    [EXTERNAL_MARA_PROVIDER_ID],
    validateModelConditionRequest,
  );
}

/** Default (no condition selected) provider wiring — extracted so the
 * baseline condition and the default path share one definition. */
export function defaultScenarioProvider(scenario: ScenarioDefinition): DecisionProvider {
  const base = new DeterministicProvider();
  return scenario.providerFailureFromTick !== null
    ? new ScriptedFailureProvider(base, scenario.providerFailureFromTick)
    : base;
}
