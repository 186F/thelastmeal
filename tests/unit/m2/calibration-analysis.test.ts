import { describe, expect, it } from 'vitest';
import {
  INSTALLED_ANALYSIS_VERSIONS,
  M2_CALIBRATION_ANALYSIS_VERSION,
  METRIC_PRODUCER_REGISTRY,
  assertMetricsProducible,
  entropyMilliBits,
  log2BoundsFixed,
  quantileMilliFloor,
} from '../../../src/shared/calibrationAnalysis';
import type { DecisionContextFacts } from '../../../src/shared/calibrationAnalysis';
import {
  assertRegisteredCalibrationDesign,
  buildCalibrationReport,
  extractContextFacts,
  mapRegisteredPrimaries,
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
  });

  it('handles two-value interpolation, repeated values, and ties', () => {
    expect(quantileMilliFloor([10, 20], 75)).toBe(17_500);
    expect(quantileMilliFloor([5, 5, 5], 50)).toBe(5_000);
    expect(quantileMilliFloor([5, 5, 5], 90)).toBe(5_000);
    // Ties around the interpolation point collapse to the tied value.
    expect(quantileMilliFloor([1, 7, 7, 7, 9], 50)).toBe(7_000);
    // Floor rounding: rank 0.1·3 = 0.3 over [0,1,…]: 0 + 0.3·1 = 0.3 → 300.
    expect(quantileMilliFloor([0, 1, 2, 3], 10)).toBe(300);
  });

  it('refuses empty samples and non-integer percentiles', () => {
    expect(() => quantileMilliFloor([], 50)).toThrow(/quantile-empty/);
    expect(() => quantileMilliFloor([1], 50.5)).toThrow(/quantile-percentile-invalid/);
  });
});

/** Independent exact reference for floor(1000·H): the largest integer m
 * with 2^(m·T)·(Π c^c)^1000 ≤ (T^T)^1000, found by binary search over pure
 * BigInt powers — no logarithms at all. Practical only for small totals,
 * which is exactly what the sweep uses. */
function entropyMilliFloorReference(counts: readonly number[]): number {
  const positive = counts.filter((count) => count > 0);
  const total = positive.reduce((sum, count) => sum + count, 0);
  if (total === 0 || positive.length <= 1) return 0;
  const bigTotal = BigInt(total);
  const numerator = bigTotal ** (1000n * bigTotal);
  let denominator = 1n;
  for (const count of positive) denominator *= BigInt(count) ** (1000n * BigInt(count));
  // H ≤ log2(k) ≤ total, so m < 1000·total is a safe search ceiling.
  let low = 0n;
  let high = 1000n * bigTotal;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (2n ** (mid * bigTotal) * denominator <= numerator) low = mid;
    else high = mid - 1n;
  }
  return Number(low);
}

describe('deterministic entropy (base 2, milli-bits, TRUE floor)', () => {
  it('matches exact closed forms through the rational shortcut', () => {
    // Uniform over 4 outcomes: exactly 2 bits.
    expect(entropyMilliBits([5, 5, 5, 5])).toBe(2_000);
    // p = (1/4, 1/4, 1/2): exactly 1.5 bits.
    expect(entropyMilliBits([1, 1, 2])).toBe(1_500);
    // Single outcome and empty distributions carry no uncertainty.
    expect(entropyMilliBits([42])).toBe(0);
    expect(entropyMilliBits([])).toBe(0);
    // Zero counts are excluded, not participants.
    expect(entropyMilliBits([0, 8, 0, 8, 0])).toBe(1_000);
    // Uniform over 8: exactly 3 bits, any per-outcome count.
    expect(entropyMilliBits([7, 7, 7, 7, 7, 7, 7, 7])).toBe(3_000);
  });

  it('floors irrational entropies deterministically', () => {
    // p = (1/3, 2/3): H = 0.918295… bits → 918 milli-bits.
    expect(entropyMilliBits([1, 2])).toBe(918);
    // p = (1/10, 9/10): H = 0.468995… bits → floor 468.
    expect(entropyMilliBits([1, 9])).toBe(468);
  });

  it('the audit regression: [1785, 2031] floors to 997, not 996', () => {
    // True value 0.997000152150330… bits — one milli-bit above the
    // boundary. The superseded Q20 approximation returned 996.
    expect(entropyMilliBits([1785, 2031])).toBe(997);
  });

  it('agrees with an independent pure-BigInt-power reference across a deterministic sweep', () => {
    const vectors: number[][] = [
      [1, 1],
      [1, 2],
      [2, 3],
      [1, 9],
      [3, 3, 3],
      [1, 2, 3],
      [5, 7],
      [1, 1, 1, 1, 1],
      [2, 2, 5],
      [4, 6, 10],
      [7, 11, 13],
      [1, 3, 9],
      [8, 8],
      [1, 2, 4, 8],
      [6, 6, 6, 6],
      [1, 1, 2, 4],
      [9, 3],
      [2, 2, 2, 2, 2, 2],
      [10, 20, 30],
      [1, 5, 25],
    ];
    for (const vector of vectors) {
      expect(entropyMilliBits(vector), `counts [${vector.join(', ')}]`).toBe(
        entropyMilliFloorReference(vector),
      );
    }
  });

  it('log2BoundsFixed brackets the true logarithm and is exact on powers of two', () => {
    const eight = log2BoundsFixed(8n, 48n);
    expect(eight.lo).toBe(3n << 48n);
    expect(eight.hi).toBe(3n << 48n);
    const one = log2BoundsFixed(1n, 48n);
    expect(one.lo).toBe(0n);
    expect(one.hi).toBe(0n);
    // log2(3) = 1.584962500721156… — bounds must bracket it tightly.
    const three = log2BoundsFixed(3n, 48n);
    expect(three.lo <= three.hi).toBe(true);
    expect(three.hi - three.lo <= 4n).toBe(true);
    const scaled = Math.log2(3) * 2 ** 48;
    expect(Number(three.lo) <= scaled).toBe(true);
    expect(Number(three.hi) >= scaled).toBe(true);
    expect(() => log2BoundsFixed(0n, 48n)).toThrow(/log2-domain/);
  });
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

function decisions(spec: {
  selections: string[];
  contexts?: string[];
  facts?: (DecisionContextFacts | null)[];
}): DecisionPoint[] {
  return spec.selections.map((selected, index) => ({
    requestId: `dec-${String(index + 1).padStart(4, '0')}`,
    tick: 60 * (index + 1),
    offeredIds: ['aff:a', 'aff:b'],
    hardDependencyFingerprint: 'f'.repeat(16),
    contextHash: spec.contexts?.[index] ?? 'c'.repeat(16),
    selectedAffordanceId: selected,
    contextFacts: spec.facts?.[index] ?? null,
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
  });

  it('is byte-identical across repeated analyses of the same evidence', () => {
    const left = canonicalSerialize(buildCalibrationReport('fixture-seq', tenRuns(), []));
    const right = canonicalSerialize(buildCalibrationReport('fixture-seq', tenRuns(), []));
    expect(left).toBe(right);
  });

  it('identical decision timelines report no divergence and keep ordinal matching valid', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    for (const pair of report.pairs) {
      expect(pair.firstDivergence.kind).toBe('none');
      expect(pair.firstDivergence.comparableDecisions).toBe(3);
      expect(pair.firstDivergence.laterOrdinalMatchingValid).toBe(true);
    }
  });

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
  });

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
  });

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
  });

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
  });

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
  });

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
  });

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
  });
});

// --------------------------------------------------------------------------
// Final targeted remediation B: exact-design binding + semantic context
// --------------------------------------------------------------------------

function facts(overrides: Partial<DecisionContextFacts> = {}): DecisionContextFacts {
  return {
    locationId: 'purifier-workbench',
    currentActivity: 'work-on-purifier/work/active',
    hungerMicro: 723_000,
    fatigueMicro: 351_500,
    injurySeverityMicro: 0,
    injuryTreatmentStarted: false,
    beliefs: ['meal-exists=true', 'meal-owner=rin'],
    memories: ['player-criticized-mara (attack-on-competence)'],
    commitments: ['cmt-jonas-relieves-mara:active:creditor'],
    relationships: ['jonas:0', 'rin:0'],
    offeredAffordances: [
      'aff:a [work-on-purifier/work]',
      'aff:b [eat-meal/eat-violation violation -> rin]',
    ],
    ...overrides,
  };
}

describe('first-divergence semantic context (§4.3)', () => {
  it('emits both sides, explicit differing fields, and hard dependencies at the divergent ordinal', () => {
    const runs = tenRuns();
    runs[0] = run('cal-01', {
      decisions: decisions({
        selections: ['aff:a', 'aff:a', 'aff:b'],
        facts: [facts(), facts(), facts()],
      }),
    });
    runs[1] = run('cal-02', {
      decisions: decisions({
        selections: ['aff:a', 'aff:b', 'aff:b'],
        facts: [facts(), facts({ beliefs: ['meal-exists=false'], hungerMicro: 901_000 }), facts()],
      }),
    });
    const report = buildCalibrationReport('fixture-seq', runs, []);
    const pair = report.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-02-e1',
    )!;
    expect(pair.firstDivergence.kind).toBe('selection-divergence');
    const context = pair.firstDivergence.semanticContext!;
    expect(context).not.toBeNull();
    expect(context.differingFields).toContain('beliefs');
    expect(context.differingFields).toContain('hungerMicro');
    expect(context.differingFields).not.toContain('memories');
    expect(context.left!.beliefs).toEqual(['meal-exists=true', 'meal-owner=rin']);
    expect(context.right!.beliefs).toEqual(['meal-exists=false']);
    expect(context.leftHardDependencyFingerprint).toBe('f'.repeat(16));
    // Offered-descriptor and hard-dependency differences surface too.
    const offered = tenRuns();
    offered[0] = run('cal-01', {
      decisions: decisions({ selections: ['aff:a'], facts: [facts()] }).map((point) => ({
        ...point,
        hardDependencyFingerprint: 'a'.repeat(16),
      })),
    });
    offered[1] = run('cal-02', {
      decisions: decisions({
        selections: ['aff:a'],
        facts: [facts({ offeredAffordances: ['aff:a [work-on-purifier/work]'] })],
      }),
    });
    const offeredReport = buildCalibrationReport('fixture-seq', offered, []);
    const offeredPair = offeredReport.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-02-e1',
    )!;
    expect(offeredPair.firstDivergence.kind).toBe('context-divergence');
    expect(offeredPair.firstDivergence.semanticContext!.differingFields).toContain(
      'offeredAffordances',
    );
    expect(offeredPair.firstDivergence.semanticContext!.differingFields).toContain(
      'hardDependencyFingerprint',
    );
  });

  it('facts are never inferred: no envelopes → null semantic context; non-diverging pairs carry none', () => {
    const report = buildCalibrationReport('fixture-seq', tenRuns(), []);
    for (const pair of report.pairs) {
      expect(pair.firstDivergence.kind).toBe('none');
      expect(pair.firstDivergence.semanticContext).toBeNull();
    }
    const runs = tenRuns();
    runs[1] = run('cal-02', {
      decisions: decisions({ selections: ['aff:a', 'aff:b', 'aff:b'] }),
    });
    const diverging = buildCalibrationReport('fixture-seq', runs, []);
    const pair = diverging.pairs.find(
      (entry) => entry.left === 'cal-01-e1' && entry.right === 'cal-02-e1',
    )!;
    expect(pair.firstDivergence.kind).toBe('selection-divergence');
    expect(pair.firstDivergence.semanticContext).toBeNull();
  });

  it('extractContextFacts reads only present fields, bounded and deterministic', () => {
    const envelope = {
      context: {
        state: {
          locationId: 'purifier-workbench',
          currentAction: { category: 'work-on-purifier', mode: 'work', phase: 'active' },
          hungerMicro: 723_000,
          fatigueMicro: 351_500,
          injury: { severityMicro: 0, treatmentStarted: false },
        },
        cognition: {
          beliefs: [
            { subject: 'meal-owner', value: 'rin' },
            { subject: 'meal-exists', value: 'true' },
          ],
          memories: [{ canonicalFact: 'fact-x', interpretation: 'attack-on-competence' }],
          commitments: [{ id: 'cmt-1', status: 'active', role: 'creditor' }],
          relationships: [{ toNpcId: 'rin', valueMicro: 0 }],
        },
        affordances: [
          {
            id: 'aff:b',
            category: 'eat-meal',
            mode: 'eat-violation',
            violation: true,
            targetNpcId: 'rin',
          },
          {
            id: 'aff:a',
            category: 'work-on-purifier',
            mode: 'work',
            violation: false,
            targetNpcId: null,
          },
        ],
      },
    };
    const extracted = extractContextFacts(envelope)!;
    expect(extracted.locationId).toBe('purifier-workbench');
    expect(extracted.currentActivity).toBe('work-on-purifier/work/active');
    // Deterministic sorted order regardless of envelope order.
    expect(extracted.beliefs).toEqual(['meal-exists=true', 'meal-owner=rin']);
    expect(extracted.offeredAffordances[0]).toBe('aff:a [work-on-purifier/work]');
    expect(extracted.offeredAffordances[1]).toBe('aff:b [eat-meal/eat-violation violation -> rin]');
    // Absent context block: null, never inferred.
    expect(extractContextFacts({})).toBeNull();
    expect(extractContextFacts(null)).toBeNull();
    // Unbounded inputs are capped at 24 entries.
    const flood = extractContextFacts({
      context: {
        cognition: {
          beliefs: Array.from({ length: 100 }, (_, index) => ({
            subject: `s${String(index).padStart(3, '0')}`,
            value: 'v',
          })),
        },
      },
    })!;
    expect(flood.beliefs).toHaveLength(24);
  });
});

describe('exact registered-design binding (§4.2/§4.4)', () => {
  const validState = {
    registrationId: 'calibration-variance-a',
    sequenceId: 'm2-calibration-variance-a',
    studyId: 'm2-calibration-variance-a-001',
    studyVersion: '1.0.0',
    thresholdProfileId: 'm2-formal-attempt-profile',
    thresholdProfileVersion: '1.0.0',
    expectedModelId: 'google/gemini-2.5-flash-lite',
    expectedServingProviderId: 'google-ai-studio',
    promptVersion: 'mara-action-selection-m2-1.0.0',
    experimentId: 'sparse-cognition-policy-001',
    experimentVersion: '1.0.0',
    packageVersion: '1.9.0',
  };
  const validAttempts = Array.from({ length: 10 }, (_, index) => ({
    attemptId: `cal-var-a-${String(index + 1).padStart(2, '0')}`,
    conditionId: 'mara-model-per-decision-m2-v1',
    scenarioId: 'A',
  }));
  const validStudy = {
    studyId: 'm2-calibration-variance-a-001',
    studyVersion: '1.0.0',
    packageVersion: '1.9.0',
    conditionIds: ['mara-model-per-decision-m2-v1'],
    model: 'google/gemini-2.5-flash-lite',
    provider: 'google-ai-studio',
    promptVersions: ['mara-action-selection-m2-1.0.0'],
    scenarioIds: ['A'] as const,
    seeds: [1001],
    sampleSizeN: 10,
    analysisScriptVersion: M2_CALIBRATION_ANALYSIS_VERSION,
    primaryMetrics: ['pairwise-composite-similarity-matrix'],
    secondaryMetrics: ['latency-distribution'],
  };
  const assertDesign = (overrides: {
    state?: Partial<typeof validState>;
    attempts?: typeof validAttempts;
    study?: Partial<typeof validStudy>;
  }) =>
    assertRegisteredCalibrationDesign({
      state: { ...validState, ...overrides.state },
      planAttempts: overrides.attempts ?? validAttempts,
      study: { ...validStudy, ...overrides.study } as typeof validStudy,
    });

  it('the exact registered design passes', () => {
    expect(() => assertDesign({})).not.toThrow();
  });

  it('every identity deviation refuses with the offending field named', () => {
    const cases: Array<[RegExp, Parameters<typeof assertDesign>[0]]> = [
      [/studyId/, { state: { studyId: 'm2-stage-a-acceptance-001' } }],
      [/studyVersion/, { state: { studyVersion: '1.0.1' } }],
      [/sequenceId/, { state: { sequenceId: 'm2-stage-a-acceptance' } }],
      [/registrationId/, { state: { registrationId: 'none' } }],
      [/attemptProfileId/, { state: { thresholdProfileId: 'm2-rehearsal-attempt-profile' } }],
      [/modelId/, { state: { expectedModelId: 'other/model' } }],
      [/servingProviderId/, { state: { expectedServingProviderId: 'other-route' } }],
      [/promptVersion/, { state: { promptVersion: 'mara-action-selection-1.0.0' } }],
      [/study\.model/, { study: { model: 'other/model' } }],
      [/study\.sampleSizeN/, { study: { sampleSizeN: 9 } }],
      [/analysisScriptVersion/, { study: { analysisScriptVersion: 'not-installed-9.9.9' } }],
      [/scenarios/, { study: { scenarioIds: ['A', 'B1'] as unknown as readonly ['A'] } }],
      [/seeds/, { study: { seeds: [1002] } }],
      [/not exactly the M2 condition/, { study: { conditionIds: ['mara-model-per-decision-v1'] } }],
      [/study-metrics-unproducible/, { study: { primaryMetrics: ['spectral-vibe-analysis'] } }],
    ];
    for (const [pattern, overrides] of cases) {
      expect(() => assertDesign(overrides), pattern.source).toThrow(pattern);
    }
    // Nine or eleven planned attempts, a wrong condition, and a wrong
    // scenario each refuse.
    expect(() => assertDesign({ attempts: validAttempts.slice(0, 9) })).toThrow(/9 attempts/);
    expect(() =>
      assertDesign({
        attempts: [
          ...validAttempts,
          {
            attemptId: 'cal-var-a-11',
            conditionId: 'mara-model-per-decision-m2-v1',
            scenarioId: 'A',
          },
        ],
      }),
    ).toThrow(/11 attempts/);
    expect(() =>
      assertDesign({
        attempts: validAttempts.map((attempt, index) =>
          index === 3 ? { ...attempt, conditionId: 'mara-model-per-decision-v1' } : attempt,
        ),
      }),
    ).toThrow(/condition is 'mara-model-per-decision-v1'/);
    expect(() =>
      assertDesign({
        attempts: validAttempts.map((attempt, index) =>
          index === 3 ? { ...attempt, scenarioId: 'B1' } : attempt,
        ),
      }),
    ).toThrow(/scenario is 'B1'/);
  });
});

describe('registered primary mapping (§4.2 items 4–6)', () => {
  const plannedIds = Array.from(
    { length: 10 },
    (_, index) => `cal-var-a-${String(index + 1).padStart(2, '0')}`,
  );
  const validExecution = (
    attemptId: string,
    suffix = 'e1',
    overrides: Partial<AttemptExecution> = {},
  ) =>
    execution(`${attemptId}-x`, {
      executionId: `${attemptId}-${suffix}`,
      attemptId,
      dir: `attempt-${attemptId}-${suffix}`,
      runId: `run-${attemptId}-${suffix}`,
      ...overrides,
    });

  it('one valid primary per planned attempt, with a permitted replacement AS the primary', () => {
    const executions = plannedIds.map((attemptId) => validExecution(attemptId));
    // Attempt 04 failed once and was replaced: the failed original is a
    // typed exclusion, the replacement is THE primary — never an eleventh.
    executions.push(
      validExecution('cal-var-a-04', 'e0', {
        status: 'failed',
        failureReason: 'run-timeout',
        artifactStatus: null,
        studyStatus: null,
      }),
    );
    const { primaries, excluded } = mapRegisteredPrimaries(executions, plannedIds);
    expect(primaries).toHaveLength(10);
    expect(primaries.filter((primary) => primary.attemptId === 'cal-var-a-04')).toHaveLength(1);
    expect(excluded).toEqual([
      { executionId: 'cal-var-a-04-e0', reason: 'status:failed:run-timeout' },
    ]);
  });

  it('nine primaries, duplicate primaries, and out-of-set executions each refuse', () => {
    const nine = plannedIds.slice(0, 9).map((attemptId) => validExecution(attemptId));
    expect(() => mapRegisteredPrimaries(nine, plannedIds)).toThrow(/no valid primary/);

    const duplicated = plannedIds.map((attemptId) => validExecution(attemptId));
    duplicated.push(validExecution('cal-var-a-07', 'e2'));
    expect(() => mapRegisteredPrimaries(duplicated, plannedIds)).toThrow(
      /cal-var-a-07' has 2 competing valid observations/,
    );

    const foreign = plannedIds.map((attemptId) => validExecution(attemptId));
    foreign.push(validExecution('someone-elses-attempt'));
    expect(() => mapRegisteredPrimaries(foreign, plannedIds)).toThrow(
      /not in the registered attempt set/,
    );

    // An invalid-treatment completed execution is NEVER a primary: with a
    // valid replacement it is excluded with its verdicts; alone it refuses.
    const invalidTreatment = plannedIds.map((attemptId) => validExecution(attemptId));
    invalidTreatment.push(
      validExecution('cal-var-a-02', 'e0', { studyStatus: 'invalid-treatment' }),
    );
    const mapped = mapRegisteredPrimaries(invalidTreatment, plannedIds);
    expect(mapped.excluded).toEqual([
      { executionId: 'cal-var-a-02-e0', reason: 'verdicts:artifact-valid/invalid-treatment' },
    ]);
  });
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
  });
});

describe('metric-producer registry (§3.4.G)', () => {
  it('every calibration template metric has an installed producer', () => {
    for (const version of METRIC_PRODUCER_REGISTRY.values()) {
      expect(INSTALLED_ANALYSIS_VERSIONS).toContain(version);
    }
    expect(INSTALLED_ANALYSIS_VERSIONS).toContain(M2_CALIBRATION_ANALYSIS_VERSION);
  });

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
  });
});
