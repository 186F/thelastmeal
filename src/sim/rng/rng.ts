/**
 * The single deterministic pseudo-random source owned by the simulation core
 * (mulberry32). Seeded from the scenario definition.
 *
 * This slice's deterministic provider and engine intentionally consume no
 * randomness, so replay never needs to reconstruct RNG state. If a future
 * system draws from this source, every random-influenced outcome must be
 * recorded as an event so replay stays reducer-only. `Math.random()` is
 * forbidden throughout the core (enforced by lint and `npm run validate`).
 */
export class SeededRng {
  private stateWord: number;
  private drawCount = 0;

  constructor(seed: number) {
    this.stateWord = seed >>> 0;
  }

  get draws(): number {
    return this.drawCount;
  }

  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number {
    this.drawCount += 1;
    let t = (this.stateWord += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('rng-invalid-bound');
    }
    return this.nextUint32() % maxExclusive;
  }
}
