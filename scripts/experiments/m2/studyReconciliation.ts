import { resolve } from 'node:path';
import type { StudyDeclaration } from '../../../src/shared/studyRegistry';
import { assertMetricsProducible } from '../../../src/shared/calibrationAnalysis';
import { SCENARIOS } from '../../../src/sim/scenarios/definitions';
import type { AttemptProfile } from './attemptProfile';
import type { OrchestratorPlan } from './planSchema';

/**
 * Semantic study-to-plan reconciliation (Phase 3 re-audit finding 2).
 *
 * Validating a study file's hash proves the plan references an AUTHENTIC
 * registered study; it does not prove the orchestrator plan IMPLEMENTS
 * that study. This module is the single shared reconciliation: before any
 * write, every materially binding study field is compared against the
 * plan, the reviewed treatment, the effective attempts, and the installed
 * evaluator versions. A mismatch on any field is a typed refusal listing
 * every disagreement.
 *
 * Versioned mapping (STUDY_PLAN_MAPPING_VERSION): where a study field has
 * no one-to-one plan field, the mapping below is EXPLICIT rather than a
 * silent omission (§6.4):
 *
 *  - `seeds` — scenarios carry fixed registered seeds; the planned seed
 *    set is derived from the plan's scenario set via the frozen scenario
 *    definitions and compared to the study's seed set.
 *  - `sampleSizeN` — the registered count of PRIMARY observations = the
 *    number of planned attempts (replacements are replacements, not new
 *    observations).
 *  - `runOrderMethod` — the orchestrator executes attempts in registered
 *    plan order; a study run through it must declare exactly
 *    `plan-order`. Any other method cannot be honored and is refused.
 *  - `thresholds` — the study's thresholds record must bind the SAME
 *    registered attempt profile the plan names (`attemptProfileId` +
 *    `attemptProfileVersion`); the numeric thresholds themselves live in
 *    the versioned profile.
 *  - `liveCallBudget` — the plan's acknowledged budget must not exceed
 *    the study's registered budget (equal or safely bounded).
 *  - `executionSettings` — the study's frozen pacing/caps must equal the
 *    effective per-attempt values wherever the study declares them.
 *  - Prose fields (researchQuestion, hypothesis, exclusionRules, stopRule,
 *    evidenceRetentionPolicy, primary/secondary metric NAME lists) are
 *    registration content with no machine-checkable plan counterpart;
 *    they are deliberately listed here as not-machine-compared.
 */

export const STUDY_PLAN_MAPPING_VERSION = 'm2-study-plan-mapping-1.0.0';

export interface ReconciliationContext {
  repoRoot: string;
  /** Current HEAD — the study, the plan pin, and HEAD must all agree. */
  headSha: string;
  packageVersion: string;
  experimentId: string;
  experimentVersion: string;
  /** Code-pinned prompt version of the experiment the plan drives. */
  promptVersion: string;
  /** Installed metric implementations, e.g. behavior-fingerprint →
   * behavior-fingerprint-1.0.0. */
  installedMetricVersions: Record<string, string>;
  /** Installed analysis programs a study may declare (Phase 4 audit
   * finding 1: the pairwise similarity metric, the calibration variance
   * analyzer, the Stage A acceptance gates). */
  installedAnalysisVersions: readonly string[];
}

export function reconcileStudyWithPlan(
  study: StudyDeclaration,
  plan: OrchestratorPlan,
  profile: AttemptProfile,
  context: ReconciliationContext,
): void {
  const mismatches: string[] = [];
  const miss = (field: string, detail: string): void => {
    mismatches.push(`${field}: ${detail}`);
  };

  // Repository / release identity.
  if (study.repositorySha !== context.headSha) {
    miss('repositorySha', `study ${study.repositorySha} != HEAD ${context.headSha}`);
  }
  if (plan.repositorySha !== undefined && study.repositorySha !== plan.repositorySha) {
    miss('repositorySha', `study ${study.repositorySha} != plan pin ${plan.repositorySha}`);
  }
  if (study.packageVersion !== context.packageVersion) {
    miss('packageVersion', `study ${study.packageVersion} != installed ${context.packageVersion}`);
  }

  // Experiment / treatment identity.
  if (study.experimentId !== context.experimentId) {
    miss('experimentId', `study ${study.experimentId} != planned ${context.experimentId}`);
  }
  if (study.experimentVersion !== context.experimentVersion) {
    miss(
      'experimentVersion',
      `study ${study.experimentVersion} != planned ${context.experimentVersion}`,
    );
  }
  if (plan.expectedTreatment) {
    if (study.model !== plan.expectedTreatment.modelId) {
      miss('model', `study ${study.model} != expectedTreatment ${plan.expectedTreatment.modelId}`);
    }
    if (study.provider !== plan.expectedTreatment.servingProviderId) {
      miss(
        'provider',
        `study ${study.provider} != expectedTreatment ${plan.expectedTreatment.servingProviderId}`,
      );
    }
    if (!study.promptVersions.includes(plan.expectedTreatment.promptVersion)) {
      miss(
        'promptVersions',
        `study [${study.promptVersions.join(', ')}] lacks ${plan.expectedTreatment.promptVersion}`,
      );
    }
    if (!study.promptVersions.includes(context.promptVersion)) {
      miss(
        'promptVersions',
        `study [${study.promptVersions.join(', ')}] lacks installed ${context.promptVersion}`,
      );
    }
  } else if (study.model !== 'none') {
    miss('model', `study declares model '${study.model}' but the plan has no expectedTreatment`);
  }

  // Sample definition: conditions, scenarios, seeds, N, ordering.
  const planConditions = [...new Set(plan.attempts.map((attempt) => attempt.conditionId))].sort();
  const studyConditions = [...new Set(study.conditionIds)].sort();
  if (JSON.stringify(planConditions) !== JSON.stringify(studyConditions)) {
    miss(
      'conditionIds',
      `study [${studyConditions.join(', ')}] != plan [${planConditions.join(', ')}]`,
    );
  }
  const planScenarios = [...new Set(plan.attempts.map((attempt) => attempt.scenarioId))].sort();
  const studyScenarios = [...new Set(study.scenarioIds)].sort();
  if (JSON.stringify(planScenarios) !== JSON.stringify(studyScenarios)) {
    miss(
      'scenarioIds',
      `study [${studyScenarios.join(', ')}] != plan [${planScenarios.join(', ')}]`,
    );
  }
  const planSeeds = [
    ...new Set(plan.attempts.map((attempt) => SCENARIOS[attempt.scenarioId].seed)),
  ].sort((a, b) => a - b);
  const studySeeds = [...new Set(study.seeds)].sort((a, b) => a - b);
  if (JSON.stringify(planSeeds) !== JSON.stringify(studySeeds)) {
    miss('seeds', `study [${studySeeds.join(', ')}] != scenario-derived [${planSeeds.join(', ')}]`);
  }
  if (study.sampleSizeN !== plan.attempts.length) {
    miss(
      'sampleSizeN',
      `study registers ${study.sampleSizeN} primary observations, plan schedules ${plan.attempts.length}`,
    );
  }
  if (study.runOrderMethod !== 'plan-order') {
    miss(
      'runOrderMethod',
      `study declares '${study.runOrderMethod}'; the orchestrator honors exactly 'plan-order'`,
    );
  }

  // Budgets, replacement policy, execution settings.
  if (plan.liveCallBudget > study.liveCallBudget) {
    miss(
      'liveCallBudget',
      `plan acknowledges ${plan.liveCallBudget} > study budget ${study.liveCallBudget}`,
    );
  }
  if (
    study.replacementPolicy.maxReplacementAttempts !== plan.replacementPolicy.maxReplacementAttempts
  ) {
    miss(
      'replacementPolicy.maxReplacementAttempts',
      `study ${study.replacementPolicy.maxReplacementAttempts} != plan ${plan.replacementPolicy.maxReplacementAttempts}`,
    );
  }
  if (study.executionSettings) {
    const settings = study.executionSettings;
    for (const attempt of plan.attempts) {
      if (attempt.speed !== settings.speed) {
        miss(
          'executionSettings.speed',
          `study freezes ${settings.speed}×, attempt ${attempt.attemptId} paces ${attempt.speed}×`,
        );
      }
      const caps: Array<[string, number | undefined, number | undefined]> = [
        ['requestTimeoutMs', settings.requestTimeoutMs, attempt.requestTimeoutMs],
        ['maxConcurrency', settings.maxConcurrency, attempt.maxConcurrency],
        ['maxCallsPerRun', settings.maxCallsPerRun, attempt.maxCallsPerRun],
        ['maxTotalCalls', settings.maxTotalCalls, attempt.maxTotalCalls],
      ];
      for (const [name, frozen, effective] of caps) {
        if (frozen !== undefined && attempt.gatewayMode !== 'off' && effective !== frozen) {
          miss(
            `executionSettings.${name}`,
            `study freezes ${frozen}, attempt ${attempt.attemptId} uses ${String(effective)}`,
          );
        }
      }
    }
  }

  // Output location (normalized).
  if (resolve(context.repoRoot, study.outputRoot) !== resolve(context.repoRoot, plan.outputRoot)) {
    miss('outputRoot', `study ${study.outputRoot} != plan ${plan.outputRoot} (normalized)`);
  }

  // Installed evaluator/metric versions.
  for (const [metric, version] of Object.entries(study.metricVersions)) {
    const installed = context.installedMetricVersions[metric];
    if (installed === undefined) {
      miss('metricVersions', `study metric '${metric}' has no installed implementation`);
    } else if (installed !== version) {
      miss('metricVersions', `study pins ${metric}@${version}, installed is ${installed}`);
    }
  }
  if (!context.installedAnalysisVersions.includes(study.analysisScriptVersion)) {
    miss(
      'analysisScriptVersion',
      `study ${study.analysisScriptVersion} is not among the installed analyses ` +
        `[${context.installedAnalysisVersions.join(', ')}]`,
    );
  }
  // Metric-producer completeness (Phase 4 audit finding 1): every declared
  // primary and secondary metric must resolve to an INSTALLED producer in
  // the closed registry — a study can never promise an output the
  // installed analysis surface cannot generate.
  try {
    assertMetricsProducible(study);
  } catch (error) {
    miss('metrics', error instanceof Error ? error.message : String(error));
  }

  // Threshold profile binding (the versioned mapping for thresholds).
  const thresholds = study.thresholds as Record<string, unknown> | null;
  if (thresholds === null) {
    miss('thresholds', 'study binds no thresholds record; the attempt profile binding is required');
  } else {
    if (thresholds.attemptProfileId !== profile.profileId) {
      miss(
        'thresholds.attemptProfileId',
        `study binds '${String(thresholds.attemptProfileId)}', plan profile is '${profile.profileId}'`,
      );
    }
    if (thresholds.attemptProfileVersion !== profile.profileVersion) {
      miss(
        'thresholds.attemptProfileVersion',
        `study binds '${String(thresholds.attemptProfileVersion)}', plan profile is ${profile.profileVersion}`,
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `study-reconciliation-failed (${STUDY_PLAN_MAPPING_VERSION}): ${mismatches.join('; ')}`,
    );
  }
}
