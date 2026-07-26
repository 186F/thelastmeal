import { canonicalSerialize } from './serialize';

/**
 * FNV-1a 64-bit hash over the UTF-8 bytes of the canonical serialization.
 * Implemented with BigInt so browser-worker and Node produce identical
 * results. Output: 16 lowercase hex characters.
 */
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64Hex(text: string): string {
  const bytes = utf8Bytes(text);
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function hashCanonicalState(state: unknown): string {
  return fnv1a64Hex(canonicalSerialize(state));
}

function utf8Bytes(text: string): Uint8Array {
  // TextEncoder exists in browsers, workers, and Node >= 18.
  return new TextEncoder().encode(text);
}
