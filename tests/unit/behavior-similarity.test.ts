import { describe, expect, it } from 'vitest';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { compareBehaviorFingerprintSets } from '../../src/sim/evaluation/behaviorSimilarity';
import {
  SIMILARITY_WEIGHTS_BP,
  behaviorComparisonSchema,
  comparablePairing,
} from '../../src/shared/behaviorArtifacts';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { exportedFile } from '../ledgerCorruption';
import { NPC_IDS } from '../../src/shared/ids';

/**
 * Behavioral similarity over genuine deterministic exports
 * (M2 brief §10.6–10.7). The B1/B2 pins are frozen-behavior regression
 * constants in the golden-hash tradition: any change to a component formula,
 * weight, normalization, or event interpretation moves them and fails here
 * (the Phase 2 mutation-test requirement).
 */

describe('behavior similarity', () => {
  const a = buildBehaviorFingerprints(exportedFile('A'));
  const b1 = buildBehaviorFingerprints(exportedFile('B1'));
  const b2 = buildBehaviorFingerprints(exportedFile('B2'));

  it('integer weights sum to exactly 10_000', () => {
    const sum =
      SIMILARITY_WEIGHTS_BP.categoryTime +
      SIMILARITY_WEIGHTS_BP.modeStarts +
      SIMILARITY_WEIGHTS_BP.transitions +
      SIMILARITY_WEIGHTS_BP.targetOrientation +
      SIMILARITY_WEIGHTS_BP.outcomes;
    expect(sum).toBe(10_000);
  });

  it('self-comparison is 10_000 on every component for every NPC', () => {
    const cmp = compareBehaviorFingerprintSets(a, a);
    expect(() => behaviorComparisonSchema.parse(cmp)).not.toThrow();
    expect(() => canonicalSerialize(cmp as unknown)).not.toThrow();
    for (const npcId of NPC_IDS) {
      const c = cmp.npcs[npcId];
      expect(c.compositeBp).toBe(10_000);
      expect(Object.values(c.components)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000]);
    }
  });

  it('B1 versus B2 uses the registered ablation pairing with pinned values', () => {
    const cmp = compareBehaviorFingerprintSets(b1, b2);
    expect(cmp.pairing).toBe('registered-ablation-pair');
    // FROZEN-BEHAVIOR PINS (deterministic provider, frozen scenarios): the
    // criticism memory drives Mara's work/rest split apart while Rin remains
    // identical. Values are movement-inclusive per the Phase 2 audit
    // finding 3 (travel legs are behaviorally consequential time); recompute
    // only under a new BEHAVIOR_SIMILARITY_VERSION.
    expect(cmp.npcs.mara.components.categoryTime).toBe(5_634);
    expect(cmp.npcs.mara.compositeBp).toBe(7_189);
    expect(cmp.npcs.mara.compositeBp).toBeLessThan(cmp.npcs.rin.compositeBp);
  });

  it('treatment latency participates only when both sides observed treatment', () => {
    const cmp = compareBehaviorFingerprintSets(a, a);
    // Scenario A has no injury: latency must be null (excluded), never zero.
    for (const npcId of NPC_IDS) {
      expect(cmp.npcs[npcId].outcomeSubcomponents.treatmentLatencySimilarity).toBeNull();
    }
    const cmpC = compareBehaviorFingerprintSets(
      buildBehaviorFingerprints(exportedFile('C')),
      buildBehaviorFingerprints(exportedFile('C')),
    );
    expect(cmpC.npcs.rin.outcomeSubcomponents.treatmentLatencySimilarity).toBe(10_000);
  });

  it('refuses non-comparable pairings', () => {
    expect(
      comparablePairing({ scenarioId: 'A', seed: 1 }, { scenarioId: 'C', seed: 1 }),
    ).toBeNull();
    expect(
      comparablePairing({ scenarioId: 'A', seed: 1 }, { scenarioId: 'A', seed: 2 }),
    ).toBeNull();
    expect(comparablePairing({ scenarioId: 'B1', seed: 5 }, { scenarioId: 'B2', seed: 5 })).toBe(
      'registered-ablation-pair',
    );
    const c = buildBehaviorFingerprints(exportedFile('C'));
    expect(() => compareBehaviorFingerprintSets(a, c)).toThrow('similarity-not-comparable');
  });
});
