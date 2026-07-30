import { randomBytes } from 'node:crypto';
import { NPC_IDS, type NpcId } from '../../src/shared/ids';
import type { BlindingMap } from '../../src/shared/traces';

/**
 * Cryptographic blinding helpers shared by the individuality CLI and the
 * live-run reviewer-package CLI (M2 brief §10.12). Blinding randomness is
 * presentation/evaluation metadata: never seed-derived, never touching
 * simulation state or hashes, and never co-located with answer keys.
 */

export function token(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function cryptoShuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    // Rejection sampling for an unbiased index from crypto bytes.
    let j = 0;
    for (;;) {
      const byte = randomBytes(1)[0]!;
      const limit = 256 - (256 % (i + 1));
      if (byte < limit) {
        j = byte % (i + 1);
        break;
      }
    }
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

export function makeBlinding(): BlindingMap {
  const labels = cryptoShuffle(['agent-A', 'agent-B', 'agent-C']);
  const labelByNpc = {} as Record<NpcId, string>;
  NPC_IDS.forEach((npcId, index) => {
    labelByNpc[npcId] = labels[index]!;
  });
  return { sessionLabel: `session-${token(6)}`, labelByNpc };
}
