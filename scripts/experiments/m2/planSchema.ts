import { z } from 'zod';
import { createHash } from 'node:crypto';
import { SCENARIO_IDS } from '../../../src/shared/ids';
import { AUTOMATION_SPEEDS } from '../../../src/shared/automationContract';

/**
 * Orchestrator plan schema (M2 brief §19). A plan is the complete,
 * pre-registered description of one unattended sequence: which attempts run,
 * under which conditions, at what pace, with which gateway mode and caps,
 * and under which budgets and timeouts. Plans are immutable inputs — the
 * orchestrator records the plan's byte-exact sha256 into the sequence state
 * and refuses to resume under a different plan (§19.11).
 *
 * Phase 3 scope: the deterministic baseline and the Milestone 1 per-decision
 * condition only. The M2 conditions arrive in Phases 4–5 and extend the
 * condition enum THERE, never here retroactively.
 */

export const PLAN_SCHEMA_VERSION = 'm2-orchestrator-plan-1.0.0';

/** Conditions the Phase 3 harness may drive (R1: existing paths only). */
export const ORCHESTRATABLE_CONDITION_IDS = [
  'deterministic-baseline-v1',
  'mara-model-per-decision-v1',
] as const;

const nonEmpty = z.string().min(1);
const positiveInt = z.number().int().positive();

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
    if (attempt.conditionId === 'mara-model-per-decision-v1' && attempt.gatewayMode === 'off') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'model-attempt-requires-a-gateway',
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
    replacementPolicy: z
      .object({
        maxReplacementAttempts: z.number().int().nonnegative(),
      })
      .strict(),
    /** Acknowledged live-call budget (§19.14). Zero for keyless plans. */
    liveCallBudget: z.number().int().nonnegative(),
    timeouts: z
      .object({
        /** Wall-clock cap per attempt (§19.10: 75 min normal, 90 min
         * gateway-stop for 1× live runs; test plans scale down). */
        runTimeoutMs: positiveInt,
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
}

export function parsePlan(bytes: Buffer): LoadedPlan {
  const plan = orchestratorPlanSchema.parse(JSON.parse(bytes.toString('utf8')));
  const live = plan.attempts.some((attempt) => attempt.gatewayMode === 'live');
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
  return { plan, planSha256: createHash('sha256').update(bytes).digest('hex') };
}
