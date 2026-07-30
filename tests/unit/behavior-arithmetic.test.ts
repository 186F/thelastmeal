import { describe, expect, it } from 'vitest';
import {
  boundedDifferenceSimilarityBp,
  exactMatchSimilarityBp,
  largestRemainderBp,
  meanBp,
  roundHalfAwayFromZero,
  totalVariationSimilarityBp,
} from '../../src/sim/evaluation/arithmetic';

/**
 * Exact-arithmetic pins for the evaluator primitives (M2 brief §10.5–10.7).
 * Every expectation is a hand-computed constant: any formula, rounding, or
 * tie-break drift fails here before it can distort a similarity report
 * (the Phase 2 mutation-test requirement for metric formulas).
 */

describe('roundHalfAwayFromZero', () => {
  it('rounds halves away from zero in both directions', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });

  it('differs from Math.round exactly on negative halves (the reason it exists)', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('rejects non-finite input', () => {
    expect(() => roundHalfAwayFromZero(Number.NaN)).toThrow('round-half-away-non-finite');
    expect(() => roundHalfAwayFromZero(Number.POSITIVE_INFINITY)).toThrow(
      'round-half-away-non-finite',
    );
  });
});

describe('largestRemainderBp', () => {
  const keys = ['a', 'b', 'c'] as const;

  it('allocates exactly 10_000 with hand-computed values', () => {
    const out = largestRemainderBp(
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
      keys,
    );
    // 3333.33… each; two largest remainders (ties broken by key order) get +1.
    expect(out.get('a')).toBe(3_334);
    expect(out.get('b')).toBe(3_333);
    expect(out.get('c')).toBe(3_333);
    expect([...out.values()].reduce((s, v) => s + v, 0)).toBe(10_000);
  });

  it('ties break by earlier key position, deterministically', () => {
    const out = largestRemainderBp(
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 2],
      ]),
      keys,
    );
    // exact: a=2500, b=2500, c=5000 — no remainder, no tie to break.
    expect(out.get('a')).toBe(2_500);
    expect(out.get('b')).toBe(2_500);
    expect(out.get('c')).toBe(5_000);
    const tie = largestRemainderBp(
      new Map([
        ['a', 1],
        ['b', 1],
        ['c', 4],
      ]),
      keys,
    );
    // 1/6 = 1666.67 (rem 4), 1/6 (rem 4), 4/6 = 6666.67 (rem 4): three-way
    // remainder tie; two +1 slots go to a then b by key order.
    expect(tie.get('a')).toBe(1_667);
    expect(tie.get('b')).toBe(1_667);
    expect(tie.get('c')).toBe(6_666);
    expect([...tie.values()].reduce((s, v) => s + v, 0)).toBe(10_000);
  });

  it('returns all zeros for a zero total (degenerate distribution)', () => {
    const out = largestRemainderBp(new Map(), keys);
    expect([...out.values()]).toEqual([0, 0, 0]);
  });

  it('treats missing keys as zero counts and rejects invalid counts', () => {
    const out = largestRemainderBp(new Map([['a', 5]]), keys);
    expect(out.get('a')).toBe(10_000);
    expect(out.get('b')).toBe(0);
    expect(() => largestRemainderBp(new Map([['a', -1]]), keys)).toThrow(
      'largest-remainder-invalid-count:a',
    );
    expect(() => largestRemainderBp(new Map([['a', 1.5]]), keys)).toThrow(
      'largest-remainder-invalid-count:a',
    );
  });
});

describe('totalVariationSimilarityBp', () => {
  const keys = ['x', 'y'] as const;

  it('pins hand-computed values', () => {
    const left = new Map([
      ['x', 7_000],
      ['y', 3_000],
    ]);
    const right = new Map([
      ['x', 4_000],
      ['y', 6_000],
    ]);
    // TV = 0.5 * (3000 + 3000) = 3000 → similarity 7000.
    expect(totalVariationSimilarityBp(left, right, keys)).toBe(7_000);
    expect(totalVariationSimilarityBp(left, left, keys)).toBe(10_000);
    expect(
      totalVariationSimilarityBp(
        new Map([
          ['x', 10_000],
          ['y', 0],
        ]),
        new Map([
          ['x', 0],
          ['y', 10_000],
        ]),
        keys,
      ),
    ).toBe(0);
  });

  it('applies the §10.6C degenerate rules: both empty 10_000, one-sided 0', () => {
    const empty = new Map([
      ['x', 0],
      ['y', 0],
    ]);
    const full = new Map([
      ['x', 10_000],
      ['y', 0],
    ]);
    expect(totalVariationSimilarityBp(empty, empty, keys)).toBe(10_000);
    expect(totalVariationSimilarityBp(empty, full, keys)).toBe(0);
    expect(totalVariationSimilarityBp(full, empty, keys)).toBe(0);
  });

  it('rejects unnormalized and incomplete inputs', () => {
    expect(() =>
      totalVariationSimilarityBp(
        new Map([
          ['x', 5_000],
          ['y', 4_000],
        ]),
        new Map([
          ['x', 10_000],
          ['y', 0],
        ]),
        keys,
      ),
    ).toThrow('total-variation-not-normalized');
    expect(() =>
      totalVariationSimilarityBp(
        new Map([['x', 10_000]]),
        new Map([
          ['x', 10_000],
          ['y', 0],
        ]),
        keys,
      ),
    ).toThrow('total-variation-missing-key:y');
  });
});

describe('boundedDifferenceSimilarityBp', () => {
  it('pins the §10.6E bounded formula', () => {
    expect(boundedDifferenceSimilarityBp(0, 0, 2_700)).toBe(10_000);
    // |870-990| * 10000 / 2700 = 444.44 → 444 → 9556.
    expect(boundedDifferenceSimilarityBp(870, 990, 2_700)).toBe(9_556);
    expect(boundedDifferenceSimilarityBp(0, 2_700, 2_700)).toBe(0);
    expect(boundedDifferenceSimilarityBp(0, 5_400, 2_700)).toBe(0); // clamped
    expect(boundedDifferenceSimilarityBp(1, 3, 4)).toBe(5_000);
  });

  it('rejects non-integer values and invalid ranges', () => {
    expect(() => boundedDifferenceSimilarityBp(1.5, 0, 10)).toThrow(
      'bounded-difference-non-integer',
    );
    expect(() => boundedDifferenceSimilarityBp(1, 0, 0)).toThrow(
      'bounded-difference-invalid-range',
    );
  });
});

describe('exactMatchSimilarityBp and meanBp', () => {
  it('exact match is all or nothing', () => {
    expect(exactMatchSimilarityBp('completed', 'completed')).toBe(10_000);
    expect(exactMatchSimilarityBp('completed', 'deadline-missed')).toBe(0);
    expect(exactMatchSimilarityBp(null, null)).toBe(10_000);
  });

  it('meanBp rounds half away from zero and rejects bad input', () => {
    expect(meanBp([10_000, 0])).toBe(5_000);
    expect(meanBp([10_000, 10_000, 0])).toBe(6_667);
    expect(meanBp([1, 0])).toBe(1); // 0.5 → 1 (away from zero)
    expect(() => meanBp([])).toThrow('mean-bp-empty');
    expect(() => meanBp([1.5])).toThrow('mean-bp-non-integer');
  });
});
