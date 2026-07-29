import type { ScenarioId } from './ids';

/**
 * Single source of truth for the model-experiment literals (re-audit
 * remediation 1.4.0; OpenRouter migration 1.6.0). Every other home — the sim
 * condition registry, the external deferred provider, the exact request
 * schemas, the browser gateway client, and the gateway's prompt/config modules
 * — imports from here; no file may re-declare any of these values.
 */

export const MODEL_EXPERIMENT_ID = 'model-backed-npc-001';
/**
 * 1.1.0 changes the upstream routing layer from direct OpenAI access to a
 * pinned OpenRouter Responses route. The prompt and model-facing context stay
 * unchanged, so MODEL_PROMPT_VERSION does not move.
 *
 * 1.2.0 changes the formal treatment itself: the pinned upstream model moves
 * from `inclusionai/ling-2.6-flash` via `novita` to
 * `google/gemini-2.5-flash-lite` via `google-ai-studio`, after the v1.1.0
 * acceptance attempt was aborted when the single-endpoint route degraded under
 * sustained upstream rate limiting (2026-07-29, Run 2 — valid artifact, below
 * the pre-registered thresholds). The model slug and provider endpoint live
 * only in git-ignored gateway configuration; this version is the source-side
 * record that v1.1.0 and v1.2.0 artifacts are different treatments and are
 * never interchangeable. The prompt, model-facing context, provider identity,
 * condition, scenarios, and gateway behavior stay unchanged, so
 * MODEL_PROMPT_VERSION and EXTERNAL_MARA_PROVIDER_ID do not move.
 */
export const MODEL_EXPERIMENT_VERSION = '1.2.0';
export const MODEL_CONDITION_ID = 'mara-model-per-decision-v1';
export const BASELINE_CONDITION_ID = 'deterministic-baseline-v1';
export const MODEL_TARGET_NPC_ID = 'mara';
export const EXTERNAL_MARA_PROVIDER_ID = 'openrouter-mara-action-v1';
export const MODEL_UPSTREAM_PLATFORM = 'openrouter';
export const MODEL_PROMPT_VERSION = 'mara-action-selection-1.0.0';

/** Scenarios supported by the model condition. Scenario F stays part of the
 * frozen deterministic experiment: model failure is exercised through the
 * real external failure lifecycle, never by rewiring F's scripted failure. */
export const MODEL_CONDITION_SCENARIOS: readonly ScenarioId[] = ['A', 'B1', 'B2', 'C', 'D', 'E'];
