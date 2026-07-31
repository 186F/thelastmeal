import { describe, expect, it } from 'vitest';
import {
  INSTALLED_ANALYSIS_VERSIONS,
  M2_CALIBRATION_ANALYSIS_VERSION,
  METRIC_PRODUCER_REGISTRY,
  assertMetricsProducible,
  entropyMilliBits,
  log2MilliBitsFloor,
  quantileMilliFloor,
} from '../../../src/shared/calibrationAnalysis';
import {
  buildCalibrationReport,
  writeCalibrationReport,
  type DecisionPoint,
  type RunEvidence,
} from '../../../scripts/evaluation/calibrationVariance';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBehaviorFingerprints } from '../../../src/sim/evaluation/behaviorFingerprint';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { exportedFile } from '../../ledgerCorruption';
import type { AttemptExecution } from '../../../scripts/experiments/m2/sequenceState';

/**
 * The ten-run calibration variance analyzer (Phase 4 audit finding 1,
 * §3.5): deterministic synthetic ten-run fixture over REAL engine-derived
 * fingerprints and crafted decision timelines — all 45 pairs, exact
 * quantile boundaries and ties, entropy definitions, the matched-decision
 * divergence matrix, non-primary exclusions, byte-identical repetition,
 * and refusal of unproducible study metrics.
 */

// --------------------------------------------------------------------------
// Deterministic arithmetic
// --------------------------------------------------------------------------

describe('deterministic quantiles (type-7, floor, milli-units)', () => {
  it('interpolates exactly on the audit boundaries', () => {
    const values = [10, 20, 30, 40, 50];
    expect(quantileMilliFloor(values, 50)).toBe(30_000);
    // rank = 0.1 * 4 = 0.4 → 10 + 0.4·10 = 14.
    expect(quantileMilliFloor(values, 10)).toBe(14_000);
    // rank = 0.25 * 4 = 1 exactly → 20, no interpolation.
    expect(quantileMilliFloor(values, 25)).toBe(20_000);
    expect(quantileMilliFloor(values, 75)).toBe(40_000);
    // rank = 0.9 * 4 = 3.6 → 40 + 0.6·10 = 46.
    expect(quantileMilliFloor(values, 90)).toBe(46_000);
    expect(quantileMilliFloor(values, 0)).toBe(10_000);
    expect(quantileMilliFloor(values, 100)).toBe(50_000);
  }, 120_000);

  it('handles two-value interpolation, repeated values, and ties', () => {
    expect(quantileMilliFloor([10, 20], 75)).toBe(17_500);
    expect(quantileMilliFloor([5, 5, 5], 50)).toBe(5_000);
    expect(quantileMilliFloor([5, 5, 5], 90)).toBe(5_000);
    // Ties around the interpolation point collapse to the tied value.
    expect(quantileMilliFloor([1, 7, 7, 7, 9], 50)).toBe(7_000);
    // Floor rounding: rank 0.1·3 = 0.3 over [0,1,…]: 0 + 0.3·1 = 0.3 → 300.
    expect(quantileMilliFloor([0, 1, 2, 3], 10)).toBe(300);
  }, 120_000);

  it('refuses empty samples and non-integer percentiles', () => {
    expect(() => quantileMilliFloor([], 50)).toThrow(/quantile-empty/);
    expect(() => quantileMilliFloor([1], 50.5)).toThrow(/quantile-percentile-invalid/);
  }, 120_000);
});

describe('deterministic entropy (base 2, milli-bits, floor)', () => {
  it('matches exact closed forms', () => {
    // Uniform over 4 outcomes: exactly 2 bits.
    expect(entropyMilliBits([5, 5, 5, 5])).toBe(2_000);
    // p = (1/4, 1/4, 1/2): exactly 1.5 bits.
    expect(entropyMilliBits([1, 1, 2])).toBe(1_500);
    // Single outcome and empty distributions carry no uncertainty.
    expect(entropyMilliBits([42])).toBe(0);
    expect(entropyMilliBits([])).toBe(0);
    // Zero counts are excluded, not participants.
    expect(entropyMilliBits([0, 8, 0, 8, 0])).toBe(1_000);
  }, 120_000);

  it('floors irrational entropies deterministically', () => {
    // p = (1/3, 2/3): H = 0.918295… bits → 918 milli-bits.
    expect(entropyMilliBits([1, 2])).toBe(918);
    // p = (1/10, 9/10): H = 0.468995… bits → floor 468.
    expect(entropyMilliBits([1, 9])).toBe(468);
  }, 120_000);

  it('log2MilliBitsFloor is exact on powers of two and floors otherwise', () => {
    expect(log2MilliBitsFloor(8n, 1n)).toBe(3_000n);
    expect(log2MilliBitsFloor(1n, 1n)).toBe(0n);
    // log2(3) = 1.58496… → 1584.
    expect(log2MilliBitsFloor(3n, 1n)).toBe(1_584n);
    expect(() => log2MilliBitsFloor(1n, 2n)).toThrow(/log2-domain/);
  }, 120_000);
});

// --------------------------------------------------------------------------
// Synthetic ten-run fixture
// --------------------------------------------------------------------------

function execution(id: string, overrides: Partial<AttemptExecution> = {}): AttemptExecution {
  return {
    executionId: `${id}-e1`,
    attemptId: id,
    status: 'completed',
    seal: null,
    failureReason: null,
    failureStage: null,
    artifactStatus: 'artifact-valid',
    studyStatus: 'study-valid',
    replacementDisposition: null,
    thresholdVerdicts: null,
    runId: `run-${id}-00000001`,
    dir: `attempt-${id}-e1`,
    artifacts: [],
    verdicts: {},
    navigationCount: 1,
    browserProvenance: null,
    startedAtUtc: '2026-07-31T00:00:00.000Z',
    endedAtUtc: '2026-07-31T00:45:00.000Z',
    ...overrides,
  };
}

/** A shared, REAL fingerprint set from the deterministic Scenario A run —
 * ten identical primaries give the registered tie/boundary case: every
 * pair compares at exactly 10,000 bp. */
const FINGERPRINTS = buildBehaviorFingerprints(exportedFile('A'));

function decisions(spec: { selections: string[]; contexts?: string[] }): DecisionPoint[] {
  return spec.selections.map((selected, index) => ({
    requestId: `dec-${String(index + 1).padStart(4, '0')}`,
    tick: 60 * (index + 1),
    offeredIds: ['aff:a', 'aff:b'],
    hardDependencyFingerprint: 'f'.repeat(16),
    contextHash: spec.contexts?.[index] ?? 'c'.repeat(16),
    selectedAffordanceId: selected,
  }));
}

function run(
  id: string,
  overrides: {
    decisions?: DecisionPoint[];
    servingProviderIds?: string[];
    returnedModelIds?: string[];
    rationaleNormalizedRows?: number;
  } = {},
): RunEvidence {
  return {
    execution: execution(id),
    fingerprints: FINGERPRINTS,
    decisions: overrides.decisions ?? decisions({ selections: ['aff:a', 'aff:a', 'aff:b'] }),
    manifest: {
      externalRequestsEmitted: 40,
      upstreamCallsAttempted: 38,
      callsCompleted: 37,
      acceptedModelResponses: 36,
      callsFailedByCategory: { 'upstream-timeout': 1 },
      inputTokens: 40_000,
      outputTokens: 4_000,
      returnedModelIds: overrides.returnedModelIds ?? ['fake-decision-adapter-v1'],
    },
    latenciesMs: [100, 200, 300, 400],
    totalTokensPerCall: [1_000, 1_100, 1_200],
    rationaleRows: 36,
    rationaleNormalizedRows: overrides.rationaleNormalizedRows ?? 9,
    servingProviderIds: overrides.servingProviderIds ?? ['local'],
  };
}

function tenRuns(): RunEvidence[] {
  return Array.from({ length: 10 }, (_, index) => run(`cal-${String(index + 1).padStart(2, '0')}`));
}

describe('buildCalibrationReport — synthetic ten-run fixture', () => {
  it('produces all 45 unique pairs with tied composites and exact distribution', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    expect(report.runCount).toBe(10);
    expect(report.pairs).toHaveLength(45);
    expect(report.pairs.every((pair) => pair.compositeBp === 10_000)).toBe(true);
    expect(report.pairs.every((pair) => pair.distanceBp === 0)).toBe(true);
    const d = report.compositeSimilarityDistribution;
    expect(d.count).toBe(45);
    expect(d.medianMilli).toBe(10_000_000);
    expect(d.p10Milli).toBe(10_000_000);
    expect(d.p90Milli).toBe(10_000_000);
    expect(d.minimum).toBe(10_000);
    expect(d.maximum).toBe(10_000);
  }, 120_000);

  it('is byte-identical across repeated analyses of the same evidence', () => {
    const left = canonicalSerialize(buildCalibrationReport('fixture-seq', tenRuns(), []));
    const right = canonicalSerialize(buildCalibrationReport('fixture-seq', tenRuns(), []));
    expect(left).toBe(right);
  }, 120_000);

  it('identical decision timelines report no divergence and keep ordinal matching valid', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    for (const pair of report.pairs) {
      expect(pair.firstDivergence.kind).toBe('none');
      expect(pair.firstDivergence.comparableDecisions).toBe(3);
      expect(pair.firstDivergence.laterOrdinalMatchingValid).toBe(true);
    }
  }, 120_000);

  it('reports SELECTION divergence at the first comparable differing choice', () => {
    const runs = tenRuns();
    runs[1] = run('cal-02', {
      decisions: decisions({ selections: ['aff:a', 'aff:b', 'aff:b'] }),
    });
    const report = buildCalibrationReport('fixture-seq', runs, []);
    const pair = report.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-02-e1',
    )!;
    expect(pair.firstDivergence.kind).toBe('selection-divergence');
    expect(pair.firstDivergence.atOrdinal).toBe(1);
    expect(pair.firstDivergence.logicalTick).toBe(120);
    expect(pair.firstDivergence.leftSelectedAffordanceId).toBe('aff:a');
    expect(pair.firstDivergence.rightSelectedAffordanceId).toBe('aff:b');
    expect(pair.firstDivergence.laterOrdinalMatchingValid).toBe(false);
  }, 120_000);

  it('reports CONTEXT divergence when beliefs/memories/affordances drift before any action difference', () => {
    const runs = tenRuns();
    // Same selections, but the second decision's semantic context differs
    // (a belief/memory change moves the context hash).
    runs[2] = run('cal-03', {
      decisions: decisions({
        selections: ['aff:a', 'aff:a', 'aff:b'],
        contexts: ['c'.repeat(16), 'd'.repeat(16), 'c'.repeat(16)],
      }),
    });
    const report = buildCalibrationReport('fixture-seq', runs, []);
    const pair = report.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-03-e1',
    )!;
    expect(pair.firstDivergence.kind).toBe('context-divergence');
    expect(pair.firstDivergence.atOrdinal).toBe(1);
    expect(pair.firstDivergence.comparableDecisions).toBe(1);
    expect(pair.firstDivergence.laterOrdinalMatchingValid).toBe(false);

    // Offered-affordance changes are context divergence too.
    const offered = tenRuns();
    const altered = decisions({ selections: ['aff:a', 'aff:a', 'aff:b'] });
    altered[0] = { ...altered[0]!, offeredIds: ['aff:a', 'aff:c'] };
    offered[3] = run('cal-04', { decisions: altered });
    const offeredReport = buildCalibrationReport('fixture-seq', offered, []);
    const offeredPair = offeredReport.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-04-e1',
    )!;
    expect(offeredPair.firstDivergence.kind).toBe('context-divergence');
    expect(offeredPair.firstDivergence.atOrdinal).toBe(0);
  }, 120_000);

  it('computes entropy from the real fingerprint distributions with pooled aggregates', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    const first = report.runs[0]!;
    // Ten identical runs: pooled distributions are scaled copies, so
    // pooled entropy equals per-run entropy exactly.
    expect(report.aggregate.pooledActionCategoryEntropyMilliBits).toBe(
      first.actionCategoryEntropyMilliBits,
    );
    expect(report.aggregate.pooledActionModeEntropyMilliBits).toBe(
      first.actionModeEntropyMilliBits,
    );
    expect(first.actionCategoryEntropyMilliBits).toBeGreaterThan(0);
    expect(report.entropyParameters.base).toBe(2);
    expect(report.entropyParameters.rounding).toBe('floor');
    // TRANSITION entropy (§3.4.D): the reported value IS the registered
    // entropy over the fingerprint's categoryTransitions counts, and the
    // pooled aggregate of identical runs equals the per-run value.
    const transitions = FINGERPRINTS.npcs.mara.categoryTransitions;
    const expectedTransitionEntropy = entropyMilliBits(
      Object.keys(transitions)
        .sort()
        .map((key) => transitions[key]!),
    );
    expect(first.categoryTransitionEntropyMilliBits).toBe(expectedTransitionEntropy);
    expect(report.aggregate.pooledCategoryTransitionEntropyMilliBits).toBe(
      expectedTransitionEntropy,
    );
  }, 120_000);

  it('aggregates outcomes, coverage, rationale frequency, and route consistency', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    expect(Object.values(report.aggregate.taskOutcomeCounts).reduce((a, b) => a + b, 0)).toBe(10);
    const first = report.runs[0]!;
    expect(first.acceptedModelCoverageBp).toBe(9_000); // 36/40
    expect(report.aggregate.rationaleNormalizationFrequencyBp).toBe(2_500); // 90/360
    expect(report.aggregate.routeConsistencyVerdict).toBe('consistent');
    expect(report.aggregate.latencyMsDistribution.count).toBe(40);
    expect(report.aggregate.totalTokensDistribution.count).toBe(30);

    // A run served by a second provider flips route consistency — at the
    // aggregate AND at the offending run, while intact runs stay verdant.
    const mixed = tenRuns();
    mixed[5] = run('cal-06', { servingProviderIds: ['local', 'other-route'] });
    const mixedReport = buildCalibrationReport('fixture-seq', mixed, []);
    expect(mixedReport.aggregate.routeConsistencyVerdict).toBe('inconsistent');
    expect(mixedReport.aggregate.servingProviderIdsDistinct).toEqual(['local', 'other-route']);
    expect(mixedReport.runs[5]!.routeConsistencyVerdict).toBe('inconsistent');
    expect(mixedReport.runs[0]!.routeConsistencyVerdict).toBe('consistent');
  }, 120_000);

  it('reports operational metrics per run AND in aggregate (§3.4.F)', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    const first = report.runs[0]!;
    // Per-run latency distribution over [100, 200, 300, 400].
    expect(first.latencyMsDistribution.count).toBe(4);
    expect(first.latencyMsDistribution.minimum).toBe(100);
    expect(first.latencyMsDistribution.maximum).toBe(400);
    expect(first.latencyMsDistribution.medianMilli).toBe(250_000);
    // Per-run token distribution over [1000, 1100, 1200].
    expect(first.totalTokensDistribution.count).toBe(3);
    expect(first.totalTokensDistribution.medianMilli).toBe(1_100_000);
    expect(first.routeConsistencyVerdict).toBe('consistent');
    // Aggregate call accounting: sums, floored pooled coverage, summed
    // failure categories.
    expect(report.aggregate.externalRequestsEmittedTotal).toBe(400);
    expect(report.aggregate.acceptedModelResponsesTotal).toBe(360);
    expect(report.aggregate.acceptedModelCoverageBp).toBe(9_000);
    expect(report.aggregate.failureCategories).toEqual({ 'upstream-timeout': 10 });
  }, 120_000);

  it('a run answered by a SECOND model id is inconsistent per run and in aggregate (§3.5)', () => {
    const runs = tenRuns();
    runs[7] = run('cal-08', {
      returnedModelIds: ['fake-decision-adapter-v1', 'surprise-substitute-model'],
    });
    const report = buildCalibrationReport('fixture-seq', runs, []);
    expect(report.runs[7]!.routeConsistencyVerdict).toBe('inconsistent');
    expect(report.runs[0]!.routeConsistencyVerdict).toBe('consistent');
    expect(report.aggregate.routeConsistencyVerdict).toBe('inconsistent');
    expect(report.aggregate.returnedModelIdsDistinct).toEqual([
      'fake-decision-adapter-v1',
      'surprise-substitute-model',
    ]);
  }, 120_000);

  it('refuses fewer than two primaries and lists exclusions verbatim', () => {
    expect(() => buildCalibrationReport('fixture-seq', [run('only')], [])).toThrow(
      /nothing to pair/,
    );
    const report = buildCalibrationReport('fixture-seq', tenRuns(), [
      { executionId: 'cal-11-e1', reason: 'status:failed' },
      { executionId: 'cal-12-e1', reason: 'verdicts:artifact-valid/invalid-treatment' },
      { executionId: 'det-1-e1', reason: 'deterministic-non-primary' },
    ]);
    expect(report.excludedExecutions).toHaveLength(3);
  }, 120_000);
});

describe('writeCalibrationReport (create-once write/render path)', () => {
  it('writes canonical JSON + Markdown once and refuses a second write', () => {
    const parent = mkdtempSync(join(tmpdir(), 'm2-cal-write-'));
    try {
      const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
      const outDir = join(parent, 'derived');
      const { jsonPath, markdownPath } = writeCalibrationReport(report, outDir);
      expect(readFileSync(jsonPath, 'utf8')).toBe(canonicalSerialize(report));
      const markdown = readFileSync(markdownPath, 'utf8');
      expect(markdown).toContain('# Calibration variance analysis — fixture-seq');
      expect(markdown).toContain('route consistency: consistent');
      expect(existsSync(jsonPath)).toBe(true);
      expect(() => writeCalibrationReport(report, outDir)).toThrow(
        /calibration-analysis-output-exists/,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('metric-producer registry (§3.4.G)', () => {
  it('every calibration template metric has an installed producer', () => {
    for (const version of METRIC_PRODUCER_REGISTRY.values()) {
      expect(INSTALLED_ANALYSIS_VERSIONS).toContain(version);
    }
    expect(INSTALLED_ANALYSIS_VERSIONS).toContain(M2_CALIBRATION_ANALYSIS_VERSION);
  }, 120_000);

  it('refuses a study declaring an unimplemented metric or uninstalled analysis version', () => {
    const base = {
      studyId: 's',
      analysisScriptVersion: M2_CALIBRATION_ANALYSIS_VERSION,
      primaryMetrics: ['pairwise-composite-similarity-matrix'],
      secondaryMetrics: [],
    };
    expect(() => assertMetricsProducible(base)).not.toThrow();
    expect(() =>
      assertMetricsProducible({ ...base, primaryMetrics: ['spectral-vibe-analysis'] }),
    ).toThrow(/study-metrics-unproducible/);
    expect(() =>
      assertMetricsProducible({ ...base, analysisScriptVersion: 'not-installed-9.9.9' }),
    ).toThrow(/study-metrics-unproducible/);
  }, 120_000);
});
