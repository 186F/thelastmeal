/**
 * Central Milestone 2 identity module (M2 brief §6.3; Phase 2 re-audit
 * blocker 1). The complete M2 identity vocabulary lives HERE and is imported
 * everywhere else — never redeclared. Changing the model, provider, prompts,
 * policy vocabulary, patch-lifecycle constants, behavioral metric, or
 * acceptance thresholds requires a new M2 experiment version and a complete
 * restart of the formal sequence (§6.3).
 *
 * Phase 2 declares identities only: no condition wiring, prompt text, or
 * policy mechanics exist yet — those arrive in later reviewable phases.
 */

export const M2_EXPERIMENT_ID = 'sparse-cognition-policy-001';
export const M2_EXPERIMENT_VERSION = '1.0.0';

export const M2_PER_DECISION_CONDITION_ID = 'mara-model-per-decision-m2-v1';
export const M2_POLICY_PATCH_CONDITION_ID = 'mara-policy-patch-m2-v1';

/** The M2 per-decision external action authority (upstream-capable). */
export const M2_ACTION_PROVIDER_ID = 'openrouter-mara-action-m2-v1';
/** The M2 policy compiler authority (upstream-capable; never serves
 * per-decision action requests). */
export const M2_POLICY_COMPILER_PROVIDER_ID = 'openrouter-mara-policy-compiler-v1';
/** The M2 policy executor: a deterministic LOCAL provider. Never upstream. */
export const M2_POLICY_EXECUTOR_PROVIDER_ID = 'mara-policy-patch-executor-v1';

export const M2_ACTION_PROMPT_VERSION = 'mara-action-selection-m2-1.0.0';
export const M2_POLICY_PROMPT_VERSION = 'mara-policy-compiler-1.0.0';
