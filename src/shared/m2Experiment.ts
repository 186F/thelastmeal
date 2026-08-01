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

/** The M2 per-decision condition drives the same single treatment NPC as
 * Milestone 1 (brief §9.2: Jonas and Rin stay deterministic). */
export const M2_TARGET_NPC_ID = 'mara';

/** The M2 action route rides the same pinned OpenRouter platform as
 * Milestone 1 (brief §6.3: model/provider are runtime configuration, pinned
 * in plans and manifests — the platform identity is code). */
export const M2_UPSTREAM_PLATFORM = 'openrouter';

/**
 * Scenarios supported by the M2 per-decision condition — identical coverage
 * to Milestone 1's condition (brief §9.2: "behaviorally equivalent in
 * authority"). Scenario F stays part of the frozen deterministic experiment:
 * provider failure is exercised through the real external failure
 * lifecycle, never by rewiring F's scripted failure.
 */
export const M2_CONDITION_SCENARIOS = ['A', 'B1', 'B2', 'C', 'D', 'E'] as const;

/**
 * The fixed trace limit for the M2 revised diagnostic-output contract
 * (brief §17.5; scope ruling R7 §9.1). Rationale longer than this is
 * TRUNCATED into the noncanonical trace with `rationaleNormalized: true` —
 * never a structural rejection. The value is deliberately larger than
 * Milestone 1's 160-character structural cap (which caused seven live
 * failures) while still bounding trace growth; per R7 the fix is
 * normalization, not the bound itself, so local acceptance never trusts
 * any upstream-declared length.
 */
export const M2_RATIONALE_TRACE_MAX_CHARS = 600;
