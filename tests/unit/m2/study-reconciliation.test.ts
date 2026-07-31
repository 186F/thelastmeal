import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { studyDeclarationSchema, type StudyDeclaration } from '../../../src/shared/studyRegistry';
import {
  STUDY_PLAN_MAPPING_VERSION,
  reconcileStudyWithPlan,
  type ReconciliationContext,
} from '../../../scripts/experiments/m2/studyReconciliation';
import { orchestratorPlanSchema } from '../../../scripts/experiments/m2/planSchema';
import { getAttemptProfile } from '../../../scripts/experiments/m2/attemptProfile';

/**
 * Semantic study-to-plan reconciliation (re-audit finding 2): an authentic
 * registered study must also be the study the plan IMPLEMENTS — every
 * materially binding field is compared, and every §6.5 mismatch class is a
 * typed refusal.
 */

const HEAD = 'f'.repeat(40);

function plan() {
  return orchestratorPlanSchema.parse(
    JSON.parse(readFileSync(join('experiments', 'm2', 'plans', 'rehearsal.json'), 'utf8')),
  );
}

const profile = getAttemptProfile('m2-rehearsal-attempt-profile', '1.0.0');

function context(): ReconciliationContext {
  return {
    repoRoot: process.cwd(),
    headSha: HEAD,
    packageVersion: '1.8.0',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.2.0',
    promptVersion: 'mara-action-selection-1.0.0',
    installedMetricVersions: {
      'behavior-fingerprint': 'behavior-fingerprint-1.0.0',
      'behavior-similarity': 'behavior-similarity-1.0.0',
    },
    installedAnalysisVersion: 'behavior-similarity-1.0.0',
  };
}

function matchingStudy(): StudyDeclaration {
  return studyDeclarationSchema.parse({
    registryVersion: 'study-registry-1.0.0',
    studyId: 'm2-rehearsal-reconciliation-fixture',
    studyVersion: '1.0.0',
    status: 'calibration',
    researchQuestion: 'Does the rehearsal plan implement its registered study?',
    hypothesis: 'no hypothesis — reconciliation fixture',
    repositorySha: HEAD,
    packageVersion: '1.8.0',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.2.0',
    conditionIds: ['deterministic-baseline-v1', 'mara-model-per-decision-v1'],
    model: 'fake-adapter',
    provider: 'local',
    promptVersions: ['mara-action-selection-1.0.0'],
    scenarioIds: ['A'],
    seeds: [1001],
    sampleSizeN: 3,
    runOrderMethod: 'plan-order',
    primaryMetrics: ['behavior-fingerprint'],
    secondaryMetrics: [],
    metricVersions: {
      'behavior-fingerprint': 'behavior-fingerprint-1.0.0',
      'behavior-similarity': 'behavior-similarity-1.0.0',
    },
    analysisScriptVersion: 'behavior-similarity-1.0.0',
    thresholds: {
      attemptProfileId: 'm2-rehearsal-attempt-profile',
      attemptProfileVersion: '1.0.0',
    },
    exclusionRules: [],
    replacementPolicy: { maxReplacementAttempts: 1, notes: 'one transient replacement' },
    stopRule: 'fixed attempt set',
    liveCallBudget: 0,
    executionSettings: { speed: 20, maxCallsPerRun: 120, maxTotalCalls: 120 },
    outputRoot: 'artifacts/m2-sequences/rehearsal',
    evidenceRetentionPolicy: 'retain all rehearsal evidence',
  });
}

function expectMismatch(study: StudyDeclaration, field: RegExp, planOverride?: unknown): void {
  const effectivePlan = (planOverride ?? plan()) as ReturnType<typeof plan>;
  let message = '';
  try {
    reconcileStudyWithPlan(study, effectivePlan, profile, context());
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toMatch(/^study-reconciliation-failed/);
  expect(message).toContain(STUDY_PLAN_MAPPING_VERSION);
  expect(message).toMatch(field);
}

describe('study-to-plan reconciliation (re-audit §6.5 matrix)', () => {
  it('a study the plan implements reconciles cleanly', () => {
    expect(() => reconcileStudyWithPlan(matchingStudy(), plan(), profile, context())).not.toThrow();
  });

  it('wrong repository SHA', () => {
    expectMismatch({ ...matchingStudy(), repositorySha: 'e'.repeat(40) }, /repositorySha/);
  });

  it('wrong package version', () => {
    expectMismatch({ ...matchingStudy(), packageVersion: '9.9.9' }, /packageVersion/);
  });

  it('wrong experiment identity', () => {
    expectMismatch({ ...matchingStudy(), experimentVersion: '9.9.9' }, /experimentVersion/);
  });

  it('wrong model and wrong serving provider', () => {
    expectMismatch({ ...matchingStudy(), model: 'other-model' }, /model/);
    expectMismatch({ ...matchingStudy(), provider: 'other-provider' }, /provider/);
  });

  it('wrong prompt version', () => {
    expectMismatch(
      { ...matchingStudy(), promptVersions: ['other-prompt-1.0.0'] },
      /promptVersions/,
    );
  });

  it('wrong condition set', () => {
    expectMismatch(
      { ...matchingStudy(), conditionIds: ['deterministic-baseline-v1'] },
      /conditionIds/,
    );
  });

  it('wrong scenario and wrong seed', () => {
    expectMismatch({ ...matchingStudy(), scenarioIds: ['A', 'C'] }, /scenarioIds/);
    expectMismatch({ ...matchingStudy(), seeds: [1001, 1003] }, /seeds/);
  });

  it('sampleSizeN not matching the registered primary observations', () => {
    expectMismatch({ ...matchingStudy(), sampleSizeN: 4 }, /sampleSizeN/);
  });

  it('a run-order method the orchestrator cannot honor', () => {
    expectMismatch({ ...matchingStudy(), runOrderMethod: 'randomized' }, /runOrderMethod/);
  });

  it('a plan budget exceeding the registered live-call budget', () => {
    expectMismatch(matchingStudy(), /liveCallBudget/, { ...plan(), liveCallBudget: 5 });
  });

  it('a different replacement policy', () => {
    expectMismatch(
      {
        ...matchingStudy(),
        replacementPolicy: { maxReplacementAttempts: 0, notes: 'none' },
      },
      /replacementPolicy/,
    );
  });

  it('frozen execution settings the attempts do not honor (speed and caps)', () => {
    const study = matchingStudy();
    expectMismatch(
      { ...study, executionSettings: { ...study.executionSettings!, speed: 1 } },
      /executionSettings.speed/,
    );
    expectMismatch(
      { ...study, executionSettings: { ...study.executionSettings!, maxCallsPerRun: 5 } },
      /executionSettings.maxCallsPerRun/,
    );
  });

  it('a different output root', () => {
    expectMismatch({ ...matchingStudy(), outputRoot: 'artifacts/somewhere-else' }, /outputRoot/);
  });

  it('metric or analysis versions not installed', () => {
    expectMismatch(
      {
        ...matchingStudy(),
        metricVersions: { 'behavior-fingerprint': 'behavior-fingerprint-2.0.0' },
      },
      /metricVersions/,
    );
    expectMismatch(
      { ...matchingStudy(), metricVersions: { 'unknown-metric': '1.0.0' } },
      /metricVersions/,
    );
    expectMismatch(
      { ...matchingStudy(), analysisScriptVersion: 'behavior-similarity-9.9.9' },
      /analysisScriptVersion/,
    );
  });

  it('thresholds must bind the SAME registered attempt profile', () => {
    expectMismatch({ ...matchingStudy(), thresholds: null }, /thresholds/);
    expectMismatch(
      {
        ...matchingStudy(),
        thresholds: { attemptProfileId: 'other-profile', attemptProfileVersion: '1.0.0' },
      },
      /thresholds.attemptProfileId/,
    );
    expectMismatch(
      {
        ...matchingStudy(),
        thresholds: {
          attemptProfileId: 'm2-rehearsal-attempt-profile',
          attemptProfileVersion: '2.0.0',
        },
      },
      /thresholds.attemptProfileVersion/,
    );
  });

  it('every disagreement is listed, not only the first', () => {
    let message = '';
    try {
      reconcileStudyWithPlan(
        { ...matchingStudy(), packageVersion: '9.9.9', sampleSizeN: 7 },
        plan(),
        profile,
        context(),
      );
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/packageVersion/);
    expect(message).toMatch(/sampleSizeN/);
  });
});
