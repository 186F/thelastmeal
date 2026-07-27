import type { ScenarioId } from './ids';

/**
 * Single source of truth for the model-experiment literals (re-audit
 * remediation 1.4.0). Every other home — the sim condition registry, the
 * external deferred provider, the exact request schemas, the browser gateway
 * client, and the gateway's prompt/config modules — imports from here; no
 * file may re-declare any of these values.
 */

export const MODEL_EXPERIMENT_ID = 'model-backed-npc-001';
export const MODEL_EXPERIMENT_VERSION = '1.0.0';
export const MODEL_CONDITION_ID = 'mara-model-per-decision-v1';
export const BASELINE_CONDITION_ID = 'deterministic-baseline-v1';
export const MODEL_TARGET_NPC_ID = 'mara';
export const EXTERNAL_MARA_PROVIDER_ID = 'openai-mara-action-v1';
export const MODEL_PROMPT_VERSION = 'mara-action-selection-1.0.0';

/** Scenarios supported by the model condition. Scenario F stays part of the
 * frozen deterministic experiment: model failure is exercised through the
 * real external failure lifecycle, never by rewiring F's scripted failure. */
export const MODEL_CONDITION_SCENARIOS: readonly ScenarioId[] = ['A', 'B1', 'B2', 'C', 'D', 'E'];
