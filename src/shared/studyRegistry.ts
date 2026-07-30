import { z } from 'zod';
import { SCENARIO_IDS } from './ids';

/**
 * General study registry (M2 brief §21.1–§21.2, per the Advisor's R8 ruling).
 *
 * Every dataset collected through the laboratory — formal, calibration,
 * pilot, exploratory, or blinded-evaluation — must have a registered study
 * file matching this schema, written BEFORE execution. Failed, aborted, and
 * null-result studies remain registered; a study may not become confirmatory
 * after its output looks favorable; metrics and thresholds may not change
 * mid-study (a material change produces a new study version or a restart).
 *
 * The study-local freeze (§21.2) binds a dataset to one repository SHA, one
 * immutable plan hash, and one nonsecret configuration fingerprint.
 */

export const STUDY_REGISTRY_VERSION = 'study-registry-1.0.0';

export const STUDY_STATUSES = ['confirmatory', 'calibration', 'exploratory', 'pilot'] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

const nonEmpty = z.string().min(1);
const gitSha = z.string().regex(/^[0-9a-f]{40}$/);

/**
 * Execution settings a study binds into its freeze (Phase 2 re-audit
 * blocker 3). `speed` is the simulation pacing multiplier: formal live
 * evidence is constrained to 1× (brief §19.15), and a study may declare a
 * non-1× live pace ONLY by citing a separately registered
 * pacing-comparability study. Speeds are positive integers — the exact
 * multipliers the runtime offers — keeping the freeze projection inside the
 * project's integer discipline. Optional fields bind other nonsecret runtime
 * settings when the study kind makes them meaningful; deterministic, fake,
 * and blinded-review studies are never forced to invent model settings.
 */
export const executionSettingsSchema = z
  .object({
    speed: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive().optional(),
    maxConcurrency: z.number().int().positive().optional(),
    maxCallsPerRun: z.number().int().positive().optional(),
    maxTotalCalls: z.number().int().positive().optional(),
    /** `studyId@studyVersion` of the registered pacing-comparability study
     * authorizing a non-1× live pace. */
    pacingComparabilityAuthorization: nonEmpty.optional(),
  })
  .strict();

export type ExecutionSettings = z.infer<typeof executionSettingsSchema>;

export const studyDeclarationSchema = z
  .object({
    registryVersion: z.literal(STUDY_REGISTRY_VERSION),
    studyId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
    studyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    status: z.enum(STUDY_STATUSES),
    researchQuestion: nonEmpty,
    /**
     * Either the registered hypothesis or an explicit no-hypothesis
     * statement (e.g. "no hypothesis — exploratory measurement of X").
     * Silence is not permitted.
     */
    hypothesis: nonEmpty,
    repositorySha: gitSha,
    packageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    experimentId: nonEmpty,
    experimentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    conditionIds: z.array(nonEmpty).min(1),
    model: nonEmpty,
    provider: nonEmpty,
    promptVersions: z.array(nonEmpty).min(1),
    scenarioIds: z.array(z.enum(SCENARIO_IDS)).min(1),
    seeds: z.array(z.number().int()).min(1),
    sampleSizeN: z.number().int().positive(),
    runOrderMethod: nonEmpty,
    primaryMetrics: z.array(nonEmpty).min(1),
    secondaryMetrics: z.array(nonEmpty),
    /** e.g. { "behavior-fingerprint": "behavior-fingerprint-1.0.0" } */
    metricVersions: z.record(nonEmpty, nonEmpty),
    analysisScriptVersion: nonEmpty,
    /** Null only when the registered status makes thresholds inapplicable. */
    thresholds: z.record(z.string(), z.unknown()).nullable(),
    exclusionRules: z.array(nonEmpty),
    replacementPolicy: z
      .object({
        maxReplacementAttempts: z.number().int().nonnegative(),
        notes: nonEmpty,
      })
      .strict(),
    stopRule: nonEmpty,
    liveCallBudget: z.number().int().nonnegative(),
    /** Required for every live-model study (liveCallBudget > 0); optional
     * otherwise so non-live studies never invent irrelevant settings. */
    executionSettings: executionSettingsSchema.optional(),
    outputRoot: nonEmpty,
    evidenceRetentionPolicy: nonEmpty,
  })
  .strict()
  .superRefine((study, ctx) => {
    if (study.status === 'confirmatory' && study.thresholds === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'confirmatory-study-requires-thresholds',
      });
    }
    // Pacing rules (re-audit blocker 3): a live study must declare and
    // freeze its execution settings, and formal live evidence runs at 1×
    // unless a registered pacing-comparability study authorizes otherwise.
    if (study.liveCallBudget > 0) {
      if (study.executionSettings === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'live-study-requires-execution-settings',
        });
      } else if (
        study.executionSettings.speed !== 1 &&
        study.executionSettings.pacingComparabilityAuthorization === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'live-study-non-1x-pace-requires-pacing-comparability-authorization',
        });
      }
    }
  });

export type StudyDeclaration = z.infer<typeof studyDeclarationSchema>;

/**
 * The nonsecret configuration fields bound by the study-local freeze
 * (§21.2). Deterministically ordered by the caller's serializer; any change
 * to these values mid-study is a freeze violation.
 */
export function studyFreezeProjection(study: StudyDeclaration): Record<string, unknown> {
  return {
    registryVersion: study.registryVersion,
    studyId: study.studyId,
    studyVersion: study.studyVersion,
    status: study.status,
    repositorySha: study.repositorySha,
    packageVersion: study.packageVersion,
    experimentId: study.experimentId,
    experimentVersion: study.experimentVersion,
    conditionIds: study.conditionIds,
    model: study.model,
    provider: study.provider,
    promptVersions: study.promptVersions,
    scenarioIds: study.scenarioIds,
    seeds: study.seeds,
    sampleSizeN: study.sampleSizeN,
    runOrderMethod: study.runOrderMethod,
    primaryMetrics: study.primaryMetrics,
    secondaryMetrics: study.secondaryMetrics,
    metricVersions: study.metricVersions,
    analysisScriptVersion: study.analysisScriptVersion,
    thresholds: study.thresholds,
    exclusionRules: study.exclusionRules,
    replacementPolicy: study.replacementPolicy,
    stopRule: study.stopRule,
    liveCallBudget: study.liveCallBudget,
    // Execution settings are freeze-bound (re-audit blocker 3): a pacing or
    // runtime-setting change moves the configuration fingerprint.
    executionSettings: study.executionSettings ?? null,
  };
}
