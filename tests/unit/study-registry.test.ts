import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STUDY_REGISTRY_VERSION,
  studyDeclarationSchema,
  studyFreezeProjection,
  type StudyDeclaration,
} from '../../src/shared/studyRegistry';
import { validateStudyFile } from '../../scripts/experiments/m2/studyRegistry';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { fnv1a64Hex } from '../../src/sim/replay/hash';

/**
 * Study registry and study-local freeze (M2 brief §21.1–§21.2, R8 ruling):
 * pre-registration is mandatory for every dataset; the freeze artifacts must
 * be deterministic and byte-sensitive.
 */

function validStudy(): StudyDeclaration {
  return {
    registryVersion: STUDY_REGISTRY_VERSION,
    studyId: 'm2-calibration-variance-a-001',
    studyVersion: '1.0.0',
    status: 'calibration',
    researchQuestion:
      'How behaviorally different is Mara from herself under identical observable configuration?',
    hypothesis:
      'no hypothesis — calibration measurement of within-condition variance (explicit no-hypothesis statement)',
    repositorySha: 'a'.repeat(40),
    packageVersion: '1.7.0',
    experimentId: 'sparse-cognition-policy-001',
    experimentVersion: '1.0.0',
    conditionIds: ['mara-model-per-decision-m2-v1'],
    model: 'google/gemini-2.5-flash-lite',
    provider: 'google-ai-studio',
    promptVersions: ['mara-action-selection-m2-1.0.0'],
    scenarioIds: ['A'],
    seeds: [1001],
    sampleSizeN: 10,
    runOrderMethod: 'sequential identical replicates',
    primaryMetrics: ['pairwise composite similarity distribution'],
    secondaryMetrics: ['latency distribution'],
    metricVersions: {
      'behavior-fingerprint': 'behavior-fingerprint-1.0.0',
      'behavior-similarity': 'behavior-similarity-1.0.0',
    },
    analysisScriptVersion: 'eval-behavior-cli-1.0.0',
    thresholds: null,
    exclusionRules: ['failed attempts recorded but excluded from n unless registered as primary'],
    replacementPolicy: { maxReplacementAttempts: 1, notes: 'identical configuration only' },
    stopRule: 'stop after two consecutive failures with the same cause',
    liveCallBudget: 1_200,
    // The R2 pacing constraint (re-audit blocker 3): formal live evidence
    // runs at 1×, frozen into the study-local configuration fingerprint.
    executionSettings: {
      speed: 1,
      requestTimeoutMs: 20_000,
      maxConcurrency: 1,
      maxCallsPerRun: 120,
      maxTotalCalls: 1_200,
    },
    outputRoot: '../thelastmeal-m2-sparse-cognition-001/calibration',
    evidenceRetentionPolicy: 'all attempts preserved; nothing deleted or overwritten',
  };
}

describe('study declaration schema', () => {
  it('accepts the canonical calibration-study declaration', () => {
    expect(() => studyDeclarationSchema.parse(validStudy())).not.toThrow();
  });

  it('rejects missing fields, unknown fields, and silent hypotheses', () => {
    const study = validStudy() as Record<string, unknown>;
    delete study.stopRule;
    expect(() => studyDeclarationSchema.parse(study)).toThrow();
    expect(() => studyDeclarationSchema.parse({ ...validStudy(), extraField: true })).toThrow();
    expect(() => studyDeclarationSchema.parse({ ...validStudy(), hypothesis: '' })).toThrow();
  });

  it('requires thresholds for confirmatory studies', () => {
    expect(() => studyDeclarationSchema.parse({ ...validStudy(), status: 'confirmatory' })).toThrow(
      /confirmatory-study-requires-thresholds/,
    );
    expect(() =>
      studyDeclarationSchema.parse({
        ...validStudy(),
        status: 'confirmatory',
        thresholds: { minComposite: 8_000 },
      }),
    ).not.toThrow();
  });

  it('requires execution settings with pacing for live studies (re-audit blocker 3)', () => {
    const noSettings = { ...validStudy() } as Record<string, unknown>;
    delete noSettings.executionSettings;
    expect(() => studyDeclarationSchema.parse(noSettings)).toThrow(
      /live-study-requires-execution-settings/,
    );
    // A non-live study is never forced to invent model settings.
    expect(() => studyDeclarationSchema.parse({ ...noSettings, liveCallBudget: 0 })).not.toThrow();
  });

  it('a non-1× live pace requires a registered pacing-comparability authorization', () => {
    const study = validStudy();
    expect(() =>
      studyDeclarationSchema.parse({
        ...study,
        executionSettings: { ...study.executionSettings!, speed: 2 },
      }),
    ).toThrow(/live-study-non-1x-pace-requires-pacing-comparability-authorization/);
    expect(() =>
      studyDeclarationSchema.parse({
        ...study,
        executionSettings: {
          ...study.executionSettings!,
          speed: 2,
          pacingComparabilityAuthorization: 'm2-pacing-comparability-001@1.0.0',
        },
      }),
    ).not.toThrow();
    // Non-integer pacing multipliers are outside the integer discipline.
    expect(() =>
      studyDeclarationSchema.parse({
        ...study,
        executionSettings: { ...study.executionSettings!, speed: 1.5 },
      }),
    ).toThrow();
  });
});

describe('study-local freeze artifacts', () => {
  it('config fingerprint is stable across JSON key order and formatting', () => {
    const study = validStudy();
    const reordered = Object.fromEntries(
      Object.keys(study)
        .sort()
        .reverse()
        .map((key) => [key, (study as Record<string, unknown>)[key]]),
    ) as unknown as StudyDeclaration;
    const a = fnv1a64Hex(canonicalSerialize(studyFreezeProjection(study)));
    const b = fnv1a64Hex(canonicalSerialize(studyFreezeProjection(reordered)));
    expect(a).toBe(b);
  });

  it('config fingerprint moves when frozen configuration moves', () => {
    const study = validStudy();
    const changed = { ...study, sampleSizeN: 11 };
    expect(fnv1a64Hex(canonicalSerialize(studyFreezeProjection(study)))).not.toBe(
      fnv1a64Hex(canonicalSerialize(studyFreezeProjection(changed))),
    );
  });

  it('a pacing change moves the configuration fingerprint (re-audit blocker 3)', () => {
    const study = studyDeclarationSchema.parse(validStudy());
    const repaced = studyDeclarationSchema.parse({
      ...validStudy(),
      executionSettings: {
        ...validStudy().executionSettings!,
        speed: 2,
        pacingComparabilityAuthorization: 'm2-pacing-comparability-001@1.0.0',
      },
    });
    expect(fnv1a64Hex(canonicalSerialize(studyFreezeProjection(study)))).not.toBe(
      fnv1a64Hex(canonicalSerialize(studyFreezeProjection(repaced))),
    );
    // A timeout change alone also moves it: every execution setting is bound.
    const retimed = studyDeclarationSchema.parse({
      ...validStudy(),
      executionSettings: { ...validStudy().executionSettings!, requestTimeoutMs: 30_000 },
    });
    expect(fnv1a64Hex(canonicalSerialize(studyFreezeProjection(study)))).not.toBe(
      fnv1a64Hex(canonicalSerialize(studyFreezeProjection(retimed))),
    );
  });

  it('validateStudyFile computes byte-sensitive plan hashes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-registry-'));
    const pathA = join(dir, 'study.json');
    writeFileSync(pathA, JSON.stringify(validStudy(), null, 2), 'utf8');
    const first = validateStudyFile(pathA);
    // Byte-level change with identical semantics (extra trailing newline).
    writeFileSync(pathA, `${JSON.stringify(validStudy(), null, 2)}\n`, 'utf8');
    const second = validateStudyFile(pathA);
    expect(first.freeze.planSha256).not.toBe(second.freeze.planSha256);
    expect(first.freeze.configFingerprint).toBe(second.freeze.configFingerprint);
  });
});
