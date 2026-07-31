import { z } from 'zod';

/**
 * The Milestone 2 ten-run calibration analysis contract (Phase 4 audit
 * finding 1).
 *
 * `m2-calibration-variance-analysis-1.0.0` is a DISTINCT installed
 * analysis program — not an alias for the pairwise similarity metric. It
 * deterministically produces every output the R2 calibration study
 * registers, as exact integers (the repository's evidence discipline: no
 * floats in canonical JSON; formula changes require a new version
 * literal).
 *
 * This module holds the version, the CLOSED metric-producer registry that
 * registration and study reconciliation verify declared metrics against,
 * the output schema, and the deterministic arithmetic (integer type-7
 * quantiles in milli-basis-points; base-2 entropy in milli-bits via an
 * exact BigInt binary logarithm — never `Math.log2`, whose cross-platform
 * bit-identity IEEE 754 does not guarantee).
 */

export const M2_CALIBRATION_ANALYSIS_VERSION = 'm2-calibration-variance-analysis-1.0.0';

/** The Stage A acceptance "analysis" is the orchestrator's §23.1/§23.2
 * gate machinery, versioned so the Stage A study declaration names an
 * installed producer rather than prose. */
export const M2_STAGE_A_ACCEPTANCE_GATES_VERSION = 'm2-stage-a-acceptance-gates-1.0.0';

/**
 * The closed metric-producer registry: every metric ID a registered study
 * may declare, mapped to the installed analysis version that produces it.
 * Registration and study reconciliation REFUSE a study declaring a metric
 * absent from this registry or produced by an uninstalled version.
 */
export const METRIC_PRODUCER_REGISTRY: ReadonlyMap<string, string> = new Map([
  // The Phase 2 pairwise metric family (installed since 1.7.0).
  ['behavior-fingerprint', 'behavior-similarity-1.0.0'],
  ['behavior-similarity', 'behavior-similarity-1.0.0'],
  // §22.6 / ruling §4.3 calibration outputs.
  ['pairwise-composite-similarity-matrix', M2_CALIBRATION_ANALYSIS_VERSION],
  ['composite-similarity-distribution', M2_CALIBRATION_ANALYSIS_VERSION],
  ['first-divergence-matched-decision', M2_CALIBRATION_ANALYSIS_VERSION],
  ['action-category-entropy', M2_CALIBRATION_ANALYSIS_VERSION],
  ['action-mode-entropy', M2_CALIBRATION_ANALYSIS_VERSION],
  ['category-transition-entropy', M2_CALIBRATION_ANALYSIS_VERSION],
  ['outcome-frequencies', M2_CALIBRATION_ANALYSIS_VERSION],
  ['upstream-call-coverage', M2_CALIBRATION_ANALYSIS_VERSION],
  ['accepted-model-coverage', M2_CALIBRATION_ANALYSIS_VERSION],
  ['latency-distribution', M2_CALIBRATION_ANALYSIS_VERSION],
  ['token-distribution', M2_CALIBRATION_ANALYSIS_VERSION],
  ['rationale-normalization-frequency', M2_CALIBRATION_ANALYSIS_VERSION],
  ['returned-model-consistency', M2_CALIBRATION_ANALYSIS_VERSION],
  ['serving-provider-consistency', M2_CALIBRATION_ANALYSIS_VERSION],
  // Stage A acceptance gates (§23.1/§23.2), produced by the orchestrator.
  ['per-run-integrity-gates', M2_STAGE_A_ACCEPTANCE_GATES_VERSION],
  ['upstream-reliability-gate', M2_STAGE_A_ACCEPTANCE_GATES_VERSION],
  ['in-browser-replay-verdict', M2_STAGE_A_ACCEPTANCE_GATES_VERSION],
  ['strict-finalization-verdict', M2_STAGE_A_ACCEPTANCE_GATES_VERSION],
  ['measured-evidence-size', M2_STAGE_A_ACCEPTANCE_GATES_VERSION],
]);

export const INSTALLED_ANALYSIS_VERSIONS: readonly string[] = [
  'behavior-similarity-1.0.0',
  M2_CALIBRATION_ANALYSIS_VERSION,
  M2_STAGE_A_ACCEPTANCE_GATES_VERSION,
];

/**
 * Refuses any declared metric without an INSTALLED producer, and any
 * analysis version that is not installed (audit §3.4.G). Called at
 * registration time and inside study reconciliation.
 */
export function assertMetricsProducible(study: {
  studyId: string;
  analysisScriptVersion: string;
  primaryMetrics: readonly string[];
  secondaryMetrics: readonly string[];
}): void {
  if (!INSTALLED_ANALYSIS_VERSIONS.includes(study.analysisScriptVersion)) {
    throw new Error(
      `study-metrics-unproducible: ${study.studyId} declares analysisScriptVersion ` +
        `'${study.analysisScriptVersion}', which is not installed`,
    );
  }
  for (const metric of [...study.primaryMetrics, ...study.secondaryMetrics]) {
    const producer = METRIC_PRODUCER_REGISTRY.get(metric);
    if (producer === undefined) {
      throw new Error(
        `study-metrics-unproducible: ${study.studyId} declares metric '${metric}' ` +
          'with no installed producer in the metric-producer registry',
      );
    }
    if (!INSTALLED_ANALYSIS_VERSIONS.includes(producer)) {
      throw new Error(
        `study-metrics-unproducible: metric '${metric}' maps to uninstalled producer '${producer}'`,
      );
    }
  }
}

// --------------------------------------------------------------------------
// Deterministic arithmetic
// --------------------------------------------------------------------------

/**
 * Exact base-2 logarithm of a rational numerator/denominator in
 * MILLI-BITS, floor-rounded, via the classic BigInt squaring algorithm:
 * integer part by halving, then 20 binary fraction bits (granularity
 * 2^-20 ≪ one milli-bit), converted to thousandths by floor. Requires
 * numerator >= denominator > 0 (log >= 0).
 */
/** log2(numerator/denominator) scaled by 2^20, floor-rounded — the exact
 * fixed-point core (20 fractional bits, granularity 2^-20 bits). */
export function log2Q20Floor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < denominator) {
    throw new Error(`log2-domain: ${numerator}/${denominator} not >= 1`);
  }
  let integerPart = 0n;
  let num = numerator;
  let den = denominator;
  while (num >= 2n * den) {
    den *= 2n;
    integerPart += 1n;
  }
  // num/den now in [1, 2). Extract 20 fractional bits by squaring.
  let fractionBits = 0n;
  for (let bit = 0; bit < 20; bit += 1) {
    num *= num;
    den *= den;
    fractionBits <<= 1n;
    if (num >= 2n * den) {
      den *= 2n;
      fractionBits |= 1n;
    }
  }
  return (integerPart << 20n) | fractionBits;
}

export function log2MilliBitsFloor(numerator: bigint, denominator: bigint): bigint {
  return (log2Q20Floor(numerator, denominator) * 1000n) >> 20n;
}

/**
 * Shannon entropy of an integer count distribution in MILLI-BITS (base 2),
 * floor-rounded ONCE at the end: H = Σ (c/N)·log2(N/c), computed as
 * floor( 1000 · Σ c·log2q20(N/c) / (N·2^20) ) — per-term error is below
 * 2^-20 bits, so the single final floor is exact to the milli-bit for any
 * realistic vocabulary size. Zero counts contribute nothing
 * (lim x→0 x·log x = 0); an empty or single-outcome distribution has
 * entropy 0. Fully deterministic — BigInt arithmetic only, never
 * `Math.log2`.
 */
export function entropyMilliBits(counts: readonly number[]): number {
  const positive = counts.filter((count) => count > 0);
  const total = positive.reduce((sum, count) => sum + count, 0);
  if (total === 0 || positive.length <= 1) return 0;
  const totalBig = BigInt(total);
  let sumQ20 = 0n;
  for (const count of positive) {
    sumQ20 += BigInt(count) * log2Q20Floor(totalBig, BigInt(count));
  }
  return Number((sumQ20 * 1000n) / (totalBig << 20n));
}

/**
 * Deterministic type-7 quantile (linear interpolation between closest
 * ranks, the R default) over INTEGER samples, in MILLI-units, floor-
 * rounded: for sorted values v[0..n-1] and percentile p, the exact rank is
 * p·(n−1)/100; result = 1000·v[lo] + floor(1000·(v[hi]−v[lo])·rem/100)
 * where lo = floor(p·(n−1)/100) and rem = p·(n−1) mod 100.
 */
export function quantileMilliFloor(sortedValues: readonly number[], percentile: number): number {
  if (sortedValues.length === 0) throw new Error('quantile-empty');
  if (!Number.isInteger(percentile) || percentile < 0 || percentile > 100) {
    throw new Error(`quantile-percentile-invalid: ${percentile}`);
  }
  const n = sortedValues.length;
  const scaled = percentile * (n - 1);
  const lo = Math.floor(scaled / 100);
  const rem = scaled % 100;
  const vLo = sortedValues[lo]!;
  if (rem === 0) return 1000 * vLo;
  const vHi = sortedValues[lo + 1]!;
  return 1000 * vLo + Math.floor((1000 * (vHi - vLo) * rem) / 100);
}

// --------------------------------------------------------------------------
// Output schema
// --------------------------------------------------------------------------

const nonNegInt = z.number().int().nonnegative();
const intOrNull = z.number().int().nullable();
const shortString = z.string().min(1).max(200);

export const distributionSummarySchema = z
  .object({
    count: nonNegInt,
    minimum: z.number().int(),
    maximum: z.number().int(),
    medianMilli: z.number().int(),
    p10Milli: z.number().int(),
    p25Milli: z.number().int(),
    p75Milli: z.number().int(),
    p90Milli: z.number().int(),
    quantileAlgorithm: z.literal('type-7-linear-interpolation-floor-milli'),
  })
  .strict();

export const calibrationPairSchema = z
  .object({
    left: shortString,
    right: shortString,
    pairing: shortString,
    compositeBp: z.number().int().min(0).max(10_000),
    distanceBp: z.number().int().min(0).max(10_000),
    matchedDecisionExclusionReason: z.string().nullable(),
    firstDivergence: z
      .object({
        comparableDecisions: nonNegInt,
        kind: z.enum(['selection-divergence', 'context-divergence', 'none']),
        atOrdinal: intOrNull,
        logicalTick: intOrNull,
        leftRequestId: z.string().nullable(),
        rightRequestId: z.string().nullable(),
        leftContextFingerprint: z.string().nullable(),
        rightContextFingerprint: z.string().nullable(),
        leftSelectedAffordanceId: z.string().nullable(),
        rightSelectedAffordanceId: z.string().nullable(),
        laterOrdinalMatchingValid: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const calibrationRunFactsSchema = z
  .object({
    executionId: shortString,
    runId: shortString,
    // Outcomes (§3.4.E) — mechanical terminal statuses under frozen VS001
    // rules, never validated moral blame.
    taskOutcome: shortString,
    taskCompletionTick: intOrNull,
    mealConsumedBy: z.string().nullable(),
    mealViolation: z.boolean(),
    commitmentTerminalStatus: shortString,
    treatmentOccurred: z.boolean(),
    injuryWorsened: z.boolean(),
    ownershipViolations: nonNegInt,
    // Operational facts (§3.4.F).
    externalRequestsEmitted: nonNegInt,
    upstreamCallsAttempted: nonNegInt,
    upstreamCallsCompleted: nonNegInt,
    acceptedModelResponses: nonNegInt,
    acceptedModelCoverageBp: z.number().int().min(0).max(10_000),
    failureCategories: z.record(z.string(), nonNegInt),
    inputTokensTotal: nonNegInt,
    outputTokensTotal: nonNegInt,
    rationaleRowsTotal: nonNegInt,
    rationaleNormalizedRows: nonNegInt,
    latencyMsDistribution: distributionSummarySchema,
    totalTokensDistribution: distributionSummarySchema,
    returnedModelIds: z.array(z.string()),
    servingProviderIds: z.array(z.string()),
    routeConsistencyVerdict: z.enum(['consistent', 'inconsistent']),
    // Entropy (§3.4.D) in milli-bits (base 2, floor; zero counts excluded;
    // populations documented in entropyParameters).
    actionCategoryEntropyMilliBits: nonNegInt,
    actionModeEntropyMilliBits: nonNegInt,
    categoryTransitionEntropyMilliBits: nonNegInt,
  })
  .strict();

export const calibrationVarianceReportSchema = z
  .object({
    analysisVersion: z.literal(M2_CALIBRATION_ANALYSIS_VERSION),
    sequenceId: shortString,
    scenarioId: shortString,
    seed: z.number().int(),
    runCount: nonNegInt,
    executionIds: z.array(shortString),
    excludedExecutions: z.array(
      z.object({ executionId: shortString, reason: shortString }).strict(),
    ),
    pairs: z.array(calibrationPairSchema),
    compositeSimilarityDistribution: distributionSummarySchema,
    entropyParameters: z
      .object({
        base: z.literal(2),
        unit: z.literal('milli-bits'),
        rounding: z.literal('floor'),
        zeroCounts: z.literal('excluded (0·log 0 = 0)'),
        actionCategoryPopulation: z.literal(
          'Mara ActionStarted events by category (startsByCategory)',
        ),
        actionModePopulation: z.literal('Mara ActionStarted events by mode (startsByMode)'),
        transitionPopulation: z.literal(
          'consecutive Mara accepted-start category pairs (categoryTransitions)',
        ),
      })
      .strict(),
    runs: z.array(calibrationRunFactsSchema),
    aggregate: z
      .object({
        taskOutcomeCounts: z.record(z.string(), nonNegInt),
        mealConsumedByCounts: z.record(z.string(), nonNegInt),
        commitmentTerminalStatusCounts: z.record(z.string(), nonNegInt),
        treatmentOccurredCount: nonNegInt,
        injuryWorsenedCount: nonNegInt,
        mealViolationCount: nonNegInt,
        ownershipViolationTotal: nonNegInt,
        externalRequestsEmittedTotal: nonNegInt,
        upstreamCallsAttemptedTotal: nonNegInt,
        upstreamCallsCompletedTotal: nonNegInt,
        acceptedModelResponsesTotal: nonNegInt,
        acceptedModelCoverageBp: z.number().int().min(0).max(10_000),
        failureCategories: z.record(z.string(), nonNegInt),
        latencyMsDistribution: distributionSummarySchema,
        totalTokensDistribution: distributionSummarySchema,
        rationaleNormalizationFrequencyBp: z.number().int().min(0).max(10_000),
        returnedModelIdsDistinct: z.array(z.string()),
        servingProviderIdsDistinct: z.array(z.string()),
        routeConsistencyVerdict: z.enum(['consistent', 'inconsistent']),
        pooledActionCategoryEntropyMilliBits: nonNegInt,
        pooledActionModeEntropyMilliBits: nonNegInt,
        pooledCategoryTransitionEntropyMilliBits: nonNegInt,
      })
      .strict(),
  })
  .strict();

export type CalibrationVarianceReport = z.infer<typeof calibrationVarianceReportSchema>;
