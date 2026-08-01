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

function bitLength(x: bigint): number {
  let length = 0;
  let value = x;
  while (value > 0n) {
    value >>= 1n;
    length += 1;
  }
  return length;
}

/** Guard bits appended to the working precision of every directed-rounding
 * logarithm run; 64 bits absorbs the error growth of up to ~2^6 more
 * squaring steps than any refinement level uses. */
const LOG2_GUARD_BITS = 64n;

/** One digit-by-digit base-2 logarithm run over the mantissa of x with
 * DIRECTED rounding. With exact arithmetic this algorithm emits exactly
 * floor(2^fracBits·log2 x); monotone directed rounding therefore
 * guarantees the down-run returns ≤ that floor and the up-run returns
 * ≥ that floor. Only the down-run's guarantee transfers to the real
 * value (≤ floor ≤ 2^fracBits·log2 x). The up-run's does NOT — for a
 * non-power-of-two x the true value lies STRICTLY above its floor, so a
 * strict upper bound needs the +1 applied by the caller
 * (log2BoundsFixed); the +1 carries the soundness, it is not slack. */
function log2Directed(x: bigint, fracBits: bigint, roundUp: boolean): bigint {
  const integerPart = BigInt(bitLength(x) - 1);
  const scale = fracBits + LOG2_GUARD_BITS;
  // Mantissa y = x / 2^integerPart ∈ [1, 2), held as z = y·2^scale —
  // exact at the start because scale exceeds any realistic bit length.
  let z = x << (scale - integerPart);
  const two = 2n << scale;
  const mask = (1n << scale) - 1n;
  let bits = 0n;
  for (let i = 0n; i < fracBits; i += 1n) {
    const squared = z * z;
    z = squared >> scale;
    if (roundUp && (squared & mask) !== 0n) z += 1n;
    bits <<= 1n;
    if (z >= two) {
      bits |= 1n;
      if (roundUp) z = (z + 1n) >> 1n;
      else z >>= 1n;
    }
  }
  return (integerPart << fracBits) | bits;
}

/**
 * Rigorous fixed-point bounds on log2(x) for an integer x ≥ 1:
 * lo/2^fracBits ≤ log2(x) ≤ hi/2^fracBits, with lo === hi exactly when x
 * is a power of two (the logarithm is then exactly representable).
 */
export function log2BoundsFixed(x: bigint, fracBits: bigint): { lo: bigint; hi: bigint } {
  if (x < 1n) throw new Error(`log2-domain: ${x} is not >= 1`);
  if ((x & (x - 1n)) === 0n) {
    const exact = BigInt(bitLength(x) - 1) << fracBits;
    return { lo: exact, hi: exact };
  }
  const lo = log2Directed(x, fracBits, false);
  // The +1 is REQUIRED for soundness, never slack: the up-run bounds the
  // FLOOR of 2^fracBits·log2(x) from above, and this branch only runs for
  // non-powers-of-two, whose true value is strictly above that floor.
  const hi = log2Directed(x, fracBits, true) + 1n;
  return { lo, hi };
}

/** Smallest odd-prime factor exponents of n: returns a map prime → v_p(n)
 * for every odd prime, plus the power of two separately. Trial division —
 * counts are event tallies, far below any size where this matters. */
function factorExponents(n: number): { twos: bigint; odd: Map<number, bigint> } {
  let value = n;
  let twos = 0n;
  while (value % 2 === 0) {
    value /= 2;
    twos += 1n;
  }
  const odd = new Map<number, bigint>();
  for (let p = 3; p * p <= value; p += 2) {
    while (value % p === 0) {
      value /= p;
      odd.set(p, (odd.get(p) ?? 0n) + 1n);
    }
  }
  if (value > 1) odd.set(value, (odd.get(value) ?? 0n) + 1n);
  return { twos, odd };
}

/** Refinement ladder for the interval pass. The rationality test below
 * PROVES the target is irrational whenever this ladder runs, so a bucket
 * boundary can only be approached, never hit; the cap is a refusal
 * (never a wrong value) against adversarial near-boundary inputs. */
const ENTROPY_FRACTION_BITS = [48n, 96n, 192n, 384n, 768n, 1536n];

/**
 * Shannon entropy of an integer count distribution in MILLI-BITS (base 2):
 *
 *   entropyMilliBits(counts) = floor(1000 · H),  H = Σ (c/T)·log2(T/c)
 *
 * — the TRUE floor, deterministically, on every platform. Two exact paths:
 *
 * 1. RATIONAL SHORTCUT. T·H = log2(T^T / Π c^c). Factoring T and each
 *    count, the odd-prime exponents of that quotient either all cancel —
 *    then H = e₂/T exactly (e₂ = the surviving power of two) and the floor
 *    is one integer division — or at least one survives, in which case
 *    unique factorization makes 1000·H irrational (Q^1000 = 2^(m·T) would
 *    force every odd exponent to zero), so path 2 must terminate.
 * 2. INTERVAL REFINEMENT. Directed-rounding BigInt logarithm bounds
 *    (log2BoundsFixed) give rigorous lower/upper bounds on 1000·H; the
 *    fraction-bit budget doubles until both bounds floor to the same
 *    integer, which is then the proven exact answer. Repeated (total,
 *    count) logarithms are cached per precision level.
 *
 * Zero counts contribute nothing (lim x→0 x·log x = 0); empty and
 * single-outcome distributions have entropy 0. Never `Math.log2`.
 */
export function entropyMilliBits(counts: readonly number[]): number {
  const positive = counts.filter((count) => count > 0);
  const total = positive.reduce((sum, count) => sum + count, 0);
  if (total === 0 || positive.length <= 1) return 0;
  if (!positive.every((count) => Number.isSafeInteger(count))) {
    throw new Error('entropy-domain: counts must be safe integers');
  }
  const totalBig = BigInt(total);

  // Path 1: exact rationality via odd-prime cancellation.
  const oddExponents = new Map<number, bigint>();
  let twosExponent = 0n;
  const accumulate = (value: number, weight: bigint) => {
    const { twos, odd } = factorExponents(value);
    twosExponent += weight * twos;
    for (const [prime, exponent] of odd) {
      const next = (oddExponents.get(prime) ?? 0n) + weight * exponent;
      if (next === 0n) oddExponents.delete(prime);
      else oddExponents.set(prime, next);
    }
  };
  accumulate(total, totalBig);
  for (const count of positive) accumulate(count, -BigInt(count));
  if (oddExponents.size === 0) {
    // H = twosExponent / T exactly (entropy > 0 here, so e₂ > 0).
    return Number((1000n * twosExponent) / totalBig);
  }

  // Path 2: interval refinement (target proven irrational above).
  for (const fracBits of ENTROPY_FRACTION_BITS) {
    const cache = new Map<number, { lo: bigint; hi: bigint }>();
    const bounds = (value: number): { lo: bigint; hi: bigint } => {
      const hit = cache.get(value);
      if (hit) return hit;
      const computed = log2BoundsFixed(BigInt(value), fracBits);
      cache.set(value, computed);
      return computed;
    };
    const totalBounds = bounds(total);
    let sumLo = 0n;
    let sumHi = 0n;
    for (const count of positive) {
      const countBounds = bounds(count);
      sumLo += BigInt(count) * countBounds.lo;
      sumHi += BigInt(count) * countBounds.hi;
    }
    // T·H ∈ [T·log2(T) − Σc·log2(c)] bounded from both sides.
    const numeratorLo = 1000n * (totalBig * totalBounds.lo - sumHi);
    const numeratorHi = 1000n * (totalBig * totalBounds.hi - sumLo);
    const denominator = totalBig << fracBits;
    const floorDiv = (a: bigint, b: bigint): bigint => {
      const q = a / b;
      return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
    };
    const floorLo = floorDiv(numeratorLo, denominator);
    const floorHi = floorDiv(numeratorHi, denominator);
    if (floorLo === floorHi) return Number(floorLo);
  }
  throw new Error(
    'entropy-refinement-exhausted: bounds did not converge within the precision ladder',
  );
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

/** Bounded structural facts extracted from a VALIDATED archived request
 * envelope (final targeted remediation B §4.3): only fields the envelope
 * actually carries, no prompt text, deterministic order, hard caps. */
const boundedFact = z.string().min(1).max(200);
const boundedFacts = z.array(boundedFact).max(24);
export const decisionContextFactsSchema = z
  .object({
    locationId: z.string().max(200).nullable(),
    currentActivity: z.string().max(200).nullable(),
    hungerMicro: intOrNull,
    fatigueMicro: intOrNull,
    injurySeverityMicro: intOrNull,
    injuryTreatmentStarted: z.boolean().nullable(),
    beliefs: boundedFacts,
    memories: boundedFacts,
    commitments: boundedFacts,
    relationships: boundedFacts,
    offeredAffordances: boundedFacts,
  })
  .strict();
export type DecisionContextFacts = z.infer<typeof decisionContextFactsSchema>;

/** The interpretable first-divergence record (§4.3): the tick, both
 * sides' bounded semantic context, the field-level differences made
 * EXPLICIT, and the hard-dependency fingerprints — never two opaque
 * hashes alone. Null when the pair never diverges or when an archived
 * envelope carries no context for the divergent ordinal (facts are never
 * inferred). */
export const divergenceSemanticContextSchema = z
  .object({
    /** Which sides carried an archived envelope. Field-level differences
     * are computed ONLY when both are present — an absent envelope is an
     * explicit marker, never a fabricated difference (facts are never
     * inferred). */
    comparison: z.enum(['both-present', 'left-envelope-absent', 'right-envelope-absent']),
    left: decisionContextFactsSchema.nullable(),
    right: decisionContextFactsSchema.nullable(),
    differingFields: z.array(z.string().min(1).max(60)).max(16),
    leftHardDependencyFingerprint: z.string().nullable(),
    rightHardDependencyFingerprint: z.string().nullable(),
  })
  .strict();
export type DivergenceSemanticContext = z.infer<typeof divergenceSemanticContextSchema>;

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
        semanticContext: divergenceSemanticContextSchema.nullable(),
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
