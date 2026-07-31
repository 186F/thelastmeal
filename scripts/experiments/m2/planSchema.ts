import { z } from 'zod';
import { createHash } from 'node:crypto';
import { SCENARIO_IDS } from '../../../src/shared/ids';
import { AUTOMATION_SPEEDS } from '../../../src/shared/automationContract';
import { MODEL_CONDITION_SCENARIOS } from '../../../src/shared/modelExperiment';
import { M2_CONDITION_SCENARIOS } from '../../../src/shared/m2Experiment';
import {
  contractForCondition,
  isModelBackedConditionId,
} from '../../../src/shared/conditionContract';
import { RETRYABLE_ELIGIBLE_FAILURE_CLASSES } from './failureTaxonomy';
import { getAttemptProfile, type AttemptProfile } from './attemptProfile';

/**
 * Orchestrator plan schema (M2 brief §19). A plan is the complete,
 * pre-registered description of one unattended sequence: which attempts run,
 * under which conditions, at what pace, with which gateway mode and caps,
 * and under which budgets and timeouts. Plans are immutable inputs — the
 * orchestrator records the plan's byte-exact sha256 into the sequence state
 * and refuses to resume under a different plan (§19.11).
 *
 * Phase 3 scope was the deterministic baseline and the Milestone 1
 * per-decision condition. Phase 4 adds the M2 per-decision condition
 * (`mara-model-per-decision-m2-v1`); the policy-patch condition arrives in
 * Phase 5, never retroactively.
 */

export const PLAN_SCHEMA_VERSION = 'm2-orchestrator-plan-1.1.0';

/** Conditions the harness may drive: the Phase 3 pair plus the Phase 4 M2
 * per-decision comparator. */
export const ORCHESTRATABLE_CONDITION_IDS = [
  'deterministic-baseline-v1',
  'mara-model-per-decision-v1',
  'mara-model-per-decision-m2-v1',
] as const;

const nonEmpty = z.string().min(1);
const positiveInt = z.number().int().positive();

/**
 * Reviewed treatment identity (Phase 3 audit finding 2): the exact nonsecret
 * model and serving route the sequence is REVIEWED to run. Before Start, the
 * orchestrator queries the gateway's public provider-config and refuses on
 * any mismatch — a live gateway started with the wrong `.env.gateway` model
 * or route can never produce an attempt. For keyless rehearsals the expected
 * values are the fake adapter's (`fake-adapter` / `local`), so the
 * verification path itself is exercised in CI.
 */
export const expectedTreatmentSchema = z
  .object({
    modelId: nonEmpty,
    servingProviderId: nonEmpty,
    allowFallbacks: z.literal(false),
    requireParameters: z.literal(true),
    promptVersion: nonEmpty,
    conditionId: nonEmpty,
    experimentId: nonEmpty,
    experimentVersion: nonEmpty,
  })
  .strict();
export type ExpectedTreatment = z.infer<typeof expectedTreatmentSchema>;

/** Registered attempt-profile binding (re-audit finding 3): every plan
 * names the versioned execution/threshold profile its attempts are judged
 * under. The profile id and version join the sequence resume identity. */
export const attemptProfileBindingSchema = z
  .object({
    profileId: nonEmpty,
    profileVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();
export type AttemptProfileBinding = z.infer<typeof attemptProfileBindingSchema>;

/** Pre-registered study binding (audit finding 2): an evidentiary sequence
 * must name its validated Phase 2 study declaration and freeze artifacts. */
export const studyBindingSchema = z
  .object({
    studyId: nonEmpty,
    studyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    studyPlanPath: nonEmpty,
    studyPlanSha256: z.string().regex(/^[0-9a-f]{64}$/),
    studyConfigFingerprint: nonEmpty,
  })
  .strict();
export type StudyBinding = z.infer<typeof studyBindingSchema>;

/** Formal execution profile (audit finding 8 / §19.9–§19.10): evidentiary
 * plans must use exactly these values; test plans may scale down. */
export const FORMAL_TIMING = {
  maxHeartbeatIntervalMs: 60_000,
  stallTimeoutMs: 120_000,
  normalRunTimeoutMs: 75 * 60_000,
  gatewayStopRunTimeoutMs: 90 * 60_000,
} as const;

export const plannedAttemptSchema = z
  .object({
    /** Stable plan-level attempt id (kebab-case). Executions of this attempt
     * get their own execution ids; the plan id never changes. */
    attemptId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
    scenarioId: z.enum(SCENARIO_IDS),
    conditionId: z.enum(ORCHESTRATABLE_CONDITION_IDS),
    /** Operator pacing (§19.17): 1× for formal live evidence; 5×/20× legal
     * only for non-evidentiary rehearsal/test plans (`evidentiary: false`). */
    speed: z
      .number()
      .int()
      .refine((value) => (AUTOMATION_SPEEDS as readonly number[]).includes(value), {
        message: 'speed-not-an-operator-speed',
      }),
    /** off = deterministic (no gateway); fake = keyless fake adapter child
     * process; live = child process reading its own .env.gateway. */
    gatewayMode: z.enum(['off', 'fake', 'live']),
    /** Planned mid-run gateway stop (the M1 Run 6 drill): stop the gateway
     * child once the observed tick reaches this value. */
    gatewayStopAtTick: positiveInt.optional(),
    /** Per-attempt gateway caps (fresh gateway process per attempt, so the
     * process-wide cap resets each attempt — §19.14). */
    maxCallsPerRun: positiveInt.optional(),
    maxTotalCalls: positiveInt.optional(),
    requestTimeoutMs: positiveInt.optional(),
    maxConcurrency: positiveInt.optional(),
  })
  .strict()
  .superRefine((attempt, ctx) => {
    if (attempt.conditionId === 'deterministic-baseline-v1' && attempt.gatewayMode !== 'off') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseline-attempt-must-run-gateway-off',
      });
    }
    if (isModelBackedConditionId(attempt.conditionId) && attempt.gatewayMode === 'off') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model-attempt-requires-a-gateway',
      });
    }
    // The app refuses a model condition outside its registered scenarios
    // (silently degrading to baseline); a plan must fail STATICALLY, never
    // at attempt time in an unattended run.
    if (
      attempt.conditionId === 'mara-model-per-decision-v1' &&
      !MODEL_CONDITION_SCENARIOS.includes(attempt.scenarioId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scenario-not-in-model-condition:${attempt.scenarioId}`,
      });
    }
    if (
      attempt.conditionId === 'mara-model-per-decision-m2-v1' &&
      !(M2_CONDITION_SCENARIOS as readonly string[]).includes(attempt.scenarioId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scenario-not-in-m2-condition:${attempt.scenarioId}`,
      });
    }
    if (attempt.gatewayStopAtTick !== undefined && attempt.gatewayMode === 'off') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'gateway-stop-requires-a-gateway',
      });
    }
  });

export type PlannedAttempt = z.infer<typeof plannedAttemptSchema>;

export const orchestratorPlanSchema = z
  .object({
    planSchemaVersion: z.literal(PLAN_SCHEMA_VERSION),
    sequenceId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
    description: nonEmpty,
    /** Evidentiary sequences feed studies and must pace at 1× (§19.17);
     * non-evidentiary rehearsals/tests may accelerate. */
    evidentiary: z.boolean(),
    /** Root for all sequence output. Formal evidence lives OUTSIDE the
     * tracked repository; rehearsal plans may use git-ignored artifacts/. */
    outputRoot: nonEmpty,
    /** Pinned frozen SHA for formal plans; when present, preflight requires
     * HEAD to match exactly. Rehearsal plans may omit it — the orchestrator
     * records HEAD at sequence start and resume still requires equality. */
    repositorySha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    attempts: z.array(plannedAttemptSchema).min(1),
    /** The registered attempt execution/threshold profile every attempt is
     * judged under (re-audit finding 3). */
    attemptProfile: attemptProfileBindingSchema,
    /** Required whenever any model-backed attempt exists: the reviewed
     * treatment identity verified against the gateway before Start. */
    expectedTreatment: expectedTreatmentSchema.optional(),
    /** Required for evidentiary plans: the pre-registered study binding. */
    study: studyBindingSchema.optional(),
    replacementPolicy: z
      .object({
        maxReplacementAttempts: z.number().int().nonnegative(),
        /** The ONLY failure classes eligible for automatic replacement
         * (audit finding 8; re-audit finding 3): a CLOSED enum built from
         * the taxonomy's retryable-eligible partition, so hard-stop classes
         * (replay-mismatch, freeze-violation, treatment-mismatch, evidence
         * contradictions, …) are structurally impossible to register. */
        retryableFailureClasses: z.array(z.enum(RETRYABLE_ELIGIBLE_FAILURE_CLASSES)),
      })
      .strict(),
    /** Acknowledged live-call budget (§19.14). Zero for keyless plans. */
    liveCallBudget: z.number().int().nonnegative(),
    timeouts: z
      .object({
        /** Wall-clock cap for a NORMAL attempt (§19.10: 75 min formal). */
        runTimeoutMs: positiveInt,
        /** Wall-clock cap for a planned gateway-stop attempt (§19.10:
         * 90 min formal). Required when any attempt plans a stop. */
        gatewayStopRunTimeoutMs: positiveInt.optional(),
        /** Stall watchdog: tick unchanged this long while 'running' →
         * diagnostics, grace, failed attempt (§19.9: 120 s formal). */
        stallTimeoutMs: positiveInt,
        stallGraceMs: positiveInt,
        /** Heartbeat cadence (§19.9: ≤60 s formal). */
        heartbeatIntervalMs: positiveInt,
      })
      .strict(),
    /** Run the deterministic batch after the sequence (§19.4). CI rehearsal
     * plans may skip it because CI runs the batch as its own frozen gate. */
    postSequenceBatch: z.boolean(),
    /** Evidence-size budget for the sequence root (re-audit §13.4): free
     * disk is preflighted against it and the root is measured after every
     * execution; exceeding it fails the sequence as
     * `evidence-budget-exceeded`. Defaults to the orchestrator constant. */
    evidenceSizeBudgetBytes: positiveInt.optional(),
    /** Playwright trace-chunk rotation cadence (Phase 4, focused re-audit
     * §8.2): bounds the open trace on multi-hour 1× attempts and feeds the
     * evidence forecaster. Minimum one minute; defaults to the driver
     * constant (10 minutes). All chunks are retained. */
    tracing: z
      .object({
        chunkIntervalMs: z.number().int().min(60_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    for (const attempt of plan.attempts) {
      if (ids.has(attempt.attemptId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate-attempt-id:${attempt.attemptId}`,
        });
      }
      ids.add(attempt.attemptId);
    }
    if (plan.evidentiary) {
      for (const attempt of plan.attempts) {
        if (attempt.speed !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `evidentiary-plan-requires-1x-pacing:${attempt.attemptId}`,
          });
        }
      }
      // Evidentiary plans pin the frozen SHA, bind a registered study, and
      // use EXACTLY the formal §19.9–§19.10 execution profile.
      if (plan.repositorySha === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-plan-requires-pinned-repository-sha',
        });
      }
      if (plan.study === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-plan-requires-study-binding',
        });
      }
      if (plan.timeouts.heartbeatIntervalMs > FORMAL_TIMING.maxHeartbeatIntervalMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-heartbeat-exceeds-60s',
        });
      }
      if (plan.timeouts.stallTimeoutMs !== FORMAL_TIMING.stallTimeoutMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-stall-timeout-must-be-120s',
        });
      }
      if (plan.timeouts.runTimeoutMs !== FORMAL_TIMING.normalRunTimeoutMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-run-timeout-must-be-75min',
        });
      }
      if (
        plan.attempts.some((attempt) => attempt.gatewayStopAtTick !== undefined) &&
        plan.timeouts.gatewayStopRunTimeoutMs !== FORMAL_TIMING.gatewayStopRunTimeoutMs
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidentiary-gateway-stop-timeout-must-be-90min',
        });
      }
    }
    const modelConditionIds = [
      ...new Set(
        plan.attempts
          .map((attempt) => attempt.conditionId)
          .filter((conditionId) => isModelBackedConditionId(conditionId)),
      ),
    ];
    if (modelConditionIds.length > 1) {
      // One sequence, one treatment (Phase 4): a plan mixing model-backed
      // conditions would need two expected treatments, two gateway pairings,
      // and two experiment identities in one resume identity. Mixed formal
      // designs arrive with the Phase 5+ paired plans, reviewed then.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `plan-mixes-model-conditions:${modelConditionIds.join(',')}`,
      });
    }
    const hasModelAttempt = modelConditionIds.length > 0;
    if (hasModelAttempt && plan.expectedTreatment === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model-attempts-require-expected-treatment',
      });
    }
    if (hasModelAttempt && plan.expectedTreatment !== undefined) {
      // The reviewed treatment must name the PLAN's model condition and that
      // condition's registered experiment/prompt pairing — a plan whose
      // treatment block contradicts the condition registry fails statically.
      const contract = contractForCondition(modelConditionIds[0]!);
      if (contract !== null) {
        const treatment = plan.expectedTreatment;
        const mismatches: string[] = [];
        if (treatment.conditionId !== contract.conditionId) mismatches.push('conditionId');
        if (treatment.experimentId !== contract.experimentId) mismatches.push('experimentId');
        if (treatment.experimentVersion !== contract.experimentVersion) {
          mismatches.push('experimentVersion');
        }
        if (treatment.promptVersion !== contract.promptVersion) mismatches.push('promptVersion');
        if (mismatches.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `expected-treatment-contradicts-condition-contract:${mismatches.join(',')}`,
          });
        }
      }
    }
    if (
      plan.attempts.some((attempt) => attempt.gatewayStopAtTick !== undefined) &&
      plan.timeouts.gatewayStopRunTimeoutMs === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'gateway-stop-attempts-require-stop-timeout',
      });
    }
    for (const attempt of plan.attempts) {
      if (attempt.gatewayMode === 'live') {
        if (attempt.maxCallsPerRun === undefined || attempt.maxTotalCalls === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `live-attempt-requires-explicit-caps:${attempt.attemptId}`,
          });
        }
      }
    }
  });

export type OrchestratorPlan = z.infer<typeof orchestratorPlanSchema>;

/**
 * Worst-case upstream call budget (§19.14, amended formula): every planned
 * live attempt AND every permitted replacement starts a FRESH gateway
 * process, so the process-wide cap resets per attempt:
 *
 *   worstCaseStudyCalls =
 *     Σ over every planned live attempt and every permitted replacement of
 *       min(attempt.maxCallsPerRun, attempt.maxTotalCalls)
 */
export function worstCaseStudyCalls(plan: OrchestratorPlan): number {
  let total = 0;
  for (const attempt of plan.attempts) {
    if (attempt.gatewayMode !== 'live') continue;
    const perExecution = Math.min(
      attempt.maxCallsPerRun ?? Number.MAX_SAFE_INTEGER,
      attempt.maxTotalCalls ?? Number.MAX_SAFE_INTEGER,
    );
    total += perExecution * (1 + plan.replacementPolicy.maxReplacementAttempts);
  }
  return total;
}

export interface LoadedPlan {
  plan: OrchestratorPlan;
  /** sha256 of the exact plan-file BYTES (§19.11 resume identity). */
  planSha256: string;
  /** The resolved registered attempt profile (re-audit finding 3). */
  profile: AttemptProfile;
}

export function parsePlan(bytes: Buffer): LoadedPlan {
  const plan = orchestratorPlanSchema.parse(JSON.parse(bytes.toString('utf8')));
  const profile = getAttemptProfile(
    plan.attemptProfile.profileId,
    plan.attemptProfile.profileVersion,
  );
  const live = plan.attempts.some((attempt) => attempt.gatewayMode === 'live');
  if (plan.replacementPolicy.maxReplacementAttempts > profile.maxReplacementAttempts) {
    throw new Error(
      `plan-replacements-exceed-profile-limit: plan permits ` +
        `${plan.replacementPolicy.maxReplacementAttempts}, profile '${profile.profileId}' ` +
        `caps replacements at ${profile.maxReplacementAttempts}`,
    );
  }
  for (const registered of plan.replacementPolicy.retryableFailureClasses) {
    if (!profile.retryableFailureClasses.includes(registered)) {
      throw new Error(
        `plan-retryable-class-outside-profile: '${registered}' is not retryable under ` +
          `profile '${profile.profileId}'`,
      );
    }
  }
  if (live) {
    const worstCase = worstCaseStudyCalls(plan);
    if (worstCase > plan.liveCallBudget) {
      throw new Error(
        `plan-worst-case-exceeds-live-budget: worst case ${worstCase} calls ` +
          `(incl. ${plan.replacementPolicy.maxReplacementAttempts} replacement(s) per attempt) ` +
          `> acknowledged budget ${plan.liveCallBudget}`,
      );
    }
  }
  // Re-audit finding 3 (§7.1): evidentiary or live operation requires a
  // profile REVIEWED for formal use. Phase 3 registers none, so every
  // evidentiary/live plan is hard-refused until Phase 4 registers the
  // formal profile with its study.
  if ((plan.evidentiary || live) && !profile.formalUse) {
    throw new Error(
      `formal-attempt-profile-required: '${profile.profileId}' is not reviewed for ` +
        'evidentiary/live use, and no formal attempt profile is registered in Phase 3 — ' +
        'Phase 4 registers it with the calibration study',
    );
  }
  return { plan, planSha256: createHash('sha256').update(bytes).digest('hex'), profile };
}
