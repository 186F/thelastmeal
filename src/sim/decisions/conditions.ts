import type { NpcId, ScenarioId } from '../../shared/ids';
import type { ScenarioDefinition } from '../scenarios/definitions';
import { DeterministicProvider } from './deterministicProvider';
import { ScriptedFailureProvider } from './failingProvider';
import { ExternalDeferredProvider, EXTERNAL_MARA_PROVIDER_ID } from './externalDeferredProvider';
import { perNpcPlan, singleProviderPlan, type ProviderPlan } from './providerPlan';
import type { DecisionProvider } from './provider';

/**
 * Registered experimental conditions (model integration milestone 001,
 * section 6). The client may select a NAMED registered condition; it can
 * never submit an arbitrary provider, provider ID, prompt, or model
 * configuration — the engine alone resolves a condition into its provider
 * plan.
 */

export const MODEL_EXPERIMENT_ID = 'model-backed-npc-001';
export const MODEL_EXPERIMENT_VERSION = '1.0.0';

export const CONDITION_IDS = ['deterministic-baseline-v1', 'mara-model-per-decision-v1'] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

/** Scenarios supported by the model condition. Scenario F stays part of the
 * frozen deterministic experiment: model failure is exercised through the
 * real external failure lifecycle, never by rewiring F's scripted failure. */
export const MODEL_CONDITION_SCENARIOS: readonly ScenarioId[] = ['A', 'B1', 'B2', 'C', 'D', 'E'];

export function isConditionId(value: string): value is ConditionId {
  return (CONDITION_IDS as readonly string[]).includes(value);
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
  if (conditionId === 'deterministic-baseline-v1') {
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
  return perNpcPlan('mara-model-per-decision-v1', providers, [EXTERNAL_MARA_PROVIDER_ID]);
}

/** Default (no condition selected) provider wiring — extracted so the
 * baseline condition and the default path share one definition. */
export function defaultScenarioProvider(scenario: ScenarioDefinition): DecisionProvider {
  const base = new DeterministicProvider();
  return scenario.providerFailureFromTick !== null
    ? new ScriptedFailureProvider(base, scenario.providerFailureFromTick)
    : base;
}
