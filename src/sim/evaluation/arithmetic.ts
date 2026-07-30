/**
 * Exact integer arithmetic for the behavioral evaluator (M2 brief §10.5–10.7).
 *
 * Everything here is deterministic, integer-only, and side-effect free. The
 * canonical serializer (`src/sim/replay/serialize.ts`) throws on non-integer
 * numbers, so any float leaking out of this module fails loudly downstream.
 */

import { BASIS_POINTS } from '../../shared/units';

/**
 * Round half away from zero (M2 brief §10.7). `Math.round` rounds -0.5 to 0,
 * which is round-half-toward-positive-infinity; the brief requires the
 * symmetric rule, defined here once for the whole evaluator.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) throw new Error('round-half-away-non-finite');
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Deterministic largest-remainder allocation of integer counts into basis
 * points summing to exactly 10_000 (M2 brief §10.5).
 *
 * - `keys` fixes both the complete vocabulary and the tie-break order:
 *   remainders tie-break by larger remainder first, then by earlier key
 *   position, so the result is stable across platforms and insertion orders.
 * - A zero total returns all-zero allocations (the caller decides whether a
 *   zero-total distribution is comparable; see total-variation rules).
 */
export function largestRemainderBp(
  counts: ReadonlyMap<string, number>,
  keys: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const key of keys) {
    const count = counts.get(key) ?? 0;
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`largest-remainder-invalid-count:${key}`);
    }
    total += count;
  }
  if (total === 0) {
    for (const key of keys) out.set(key, 0);
    return out;
  }
  const floors: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const count = counts.get(keys[i]!) ?? 0;
    const exactNumerator = count * BASIS_POINTS;
    const floor = Math.floor(exactNumerator / total);
    floors.push(floor);
    allocated += floor;
    remainders.push({ index: i, remainder: exactNumerator % total });
  }
  let leftover = BASIS_POINTS - allocated;
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : b.remainder - a.remainder,
  );
  for (const entry of remainders) {
    if (leftover <= 0) break;
    floors[entry.index] = floors[entry.index]! + 1;
    leftover -= 1;
  }
  for (let i = 0; i < keys.length; i += 1) out.set(keys[i]!, floors[i]!);
  return out;
}

/**
 * Total-variation similarity over two complete basis-point distributions
 * (M2 brief §10.6): `10_000 - 0.5 * Σ|left_i - right_i|`.
 *
 * Both maps must cover the identical vocabulary and each sum to exactly
 * 10_000 or exactly 0 (the zero-total degenerate produced by
 * `largestRemainderBp`). Rules for degenerate inputs follow §10.6C:
 * both empty → 10_000; exactly one empty → 0.
 *
 * The absolute-difference sum of two 10_000-sum distributions is always
 * even, so the halving is exact integer arithmetic.
 */
export function totalVariationSimilarityBp(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
  keys: readonly string[],
): number {
  let leftTotal = 0;
  let rightTotal = 0;
  let absoluteDifference = 0;
  for (const key of keys) {
    const l = left.get(key);
    const r = right.get(key);
    if (l === undefined || r === undefined) {
      throw new Error(`total-variation-missing-key:${key}`);
    }
    leftTotal += l;
    rightTotal += r;
    absoluteDifference += Math.abs(l - r);
  }
  const leftEmpty = leftTotal === 0;
  const rightEmpty = rightTotal === 0;
  if (leftEmpty && rightEmpty) return BASIS_POINTS;
  if (leftEmpty || rightEmpty) return 0;
  if (leftTotal !== BASIS_POINTS || rightTotal !== BASIS_POINTS) {
    throw new Error('total-variation-not-normalized');
  }
  return BASIS_POINTS - absoluteDifference / 2;
}

/**
 * Bounded-numeric similarity (M2 brief §10.6E):
 * `10_000 - min(10_000, |left - right| * 10_000 / fixedRange)`, computed with
 * integer arithmetic and round-half-away-from-zero on the scaled difference.
 * `fixedRange` must come from scenario/metric configuration, never from
 * observed data.
 */
export function boundedDifferenceSimilarityBp(
  left: number,
  right: number,
  fixedRange: number,
): number {
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    throw new Error('bounded-difference-non-integer');
  }
  if (!Number.isInteger(fixedRange) || fixedRange <= 0) {
    throw new Error('bounded-difference-invalid-range');
  }
  const scaled = roundHalfAwayFromZero((Math.abs(left - right) * BASIS_POINTS) / fixedRange);
  return BASIS_POINTS - Math.min(BASIS_POINTS, scaled);
}

/** Exact-match similarity for categorical outcome subcomponents. */
export function exactMatchSimilarityBp(left: unknown, right: unknown): number {
  return Object.is(left, right) ? BASIS_POINTS : 0;
}

/**
 * Integer mean of basis-point values with round-half-away-from-zero, for
 * averaging outcome subcomponents (M2 brief §10.6E).
 */
export function meanBp(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean-bp-empty');
  let sum = 0;
  for (const value of values) {
    if (!Number.isInteger(value)) throw new Error('mean-bp-non-integer');
    sum += value;
  }
  return roundHalfAwayFromZero(sum / values.length);
}
