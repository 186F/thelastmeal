import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { fnv1a64Hex, hashCanonicalState } from '../../src/sim/replay/hash';

describe('canonical serialization', () => {
  it('sorts object keys and preserves array order', () => {
    expect(canonicalSerialize({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
  });

  it('serializes nested structures deterministically regardless of insertion order', () => {
    const first = canonicalSerialize({ x: { b: 2, a: 1 }, y: null });
    const second = canonicalSerialize({ y: null, x: { a: 1, b: 2 } });
    expect(first).toBe(second);
  });

  it('rejects non-integer numbers', () => {
    expect(() => canonicalSerialize({ v: 0.5 })).toThrow(/non-integer/);
    expect(() => canonicalSerialize({ v: NaN })).toThrow(/non-integer/);
    expect(() => canonicalSerialize({ v: Infinity })).toThrow(/non-integer/);
  });

  it('rejects undefined values, functions, Maps, Sets, and class instances', () => {
    expect(() => canonicalSerialize({ v: undefined })).toThrow(/undefined/);
    expect(() => canonicalSerialize({ v: () => 0 })).toThrow(/unsupported/);
    expect(() => canonicalSerialize({ v: new Map() })).toThrow(/non-plain-object/);
    expect(() => canonicalSerialize({ v: new Set() })).toThrow(/non-plain-object/);
    class Weird {}
    expect(() => canonicalSerialize({ v: new Weird() })).toThrow(/non-plain-object/);
  });
});

describe('FNV-1a 64-bit hashing', () => {
  it('matches published FNV-1a test vectors', () => {
    expect(fnv1a64Hex('')).toBe('cbf29ce484222325');
    expect(fnv1a64Hex('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64Hex('foobar')).toBe('85944171f73967e8');
  });

  it('hashes canonical state stably and independent of key order', () => {
    const h1 = hashCanonicalState({ tick: 5, npc: { hunger: 100 } });
    const h2 = hashCanonicalState({ npc: { hunger: 100 }, tick: 5 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });
});
