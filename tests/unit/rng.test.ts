import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/sim/rng/rng';

describe('seeded deterministic RNG', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = new SeededRng(1001);
    const b = new SeededRng(1001);
    const seqA = Array.from({ length: 50 }, () => a.nextUint32());
    const seqB = Array.from({ length: 50 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.nextUint32());
    const seqB = Array.from({ length: 10 }, () => b.nextUint32());
    expect(seqA).not.toEqual(seqB);
  });

  it('counts draws and bounds nextInt', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i += 1) {
      const v = rng.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(rng.draws).toBe(100);
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(1.5)).toThrow();
  });
});
