import { ACTION_CATEGORIES, ACTION_MODES, NPC_IDS, type NpcId } from '../../shared/ids';
import {
  BEHAVIOR_FINGERPRINT_VERSION,
  BEHAVIOR_SIMILARITY_VERSION,
  CATEGORY_TRANSITION_KEYS,
  OWNERSHIP_VIOLATION_SIMILARITY_RANGE,
  RELATIONSHIP_DELTA_SIMILARITY_RANGE_MICRO,
  SIMILARITY_WEIGHTS_BP,
  TARGET_ORIENTATION_BUCKETS,
  TREATMENT_LATENCY_SIMILARITY_RANGE_TICKS,
  behaviorComparisonSchema,
  comparablePairing,
  type BehaviorComparison,
  type BehaviorFingerprint,
  type BehaviorFingerprintSet,
  type BehaviorSimilarity,
} from '../../shared/behaviorArtifacts';
import {
  boundedDifferenceSimilarityBp,
  exactMatchSimilarityBp,
  meanBp,
  roundHalfAwayFromZero,
  totalVariationSimilarityBp,
} from './arithmetic';

/**
 * Deterministic behavioral similarity between two fingerprints
 * (M2 brief §10.6–10.7). Five weighted components with integer weights
 * summing to 10_000, exact basis-point arithmetic throughout.
 *
 * Comparability (§10.6, §10.9): defined for fingerprints from the same
 * scenario and seed, plus the single registered memory-ablation pair
 * (B1 versus B2 at the shared seed). Any other pairing is refused rather
 * than silently computed.
 */

function asMap(record: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(record));
}

function compareNpc(left: BehaviorFingerprint, right: BehaviorFingerprint): BehaviorSimilarity {
  if (left.npcId !== right.npcId) throw new Error('similarity-npc-mismatch');

  const categoryTime = totalVariationSimilarityBp(
    asMap(left.timeByCategoryBp),
    asMap(right.timeByCategoryBp),
    ACTION_CATEGORIES,
  );
  const modeStarts = totalVariationSimilarityBp(
    asMap(left.startsByModeBp),
    asMap(right.startsByModeBp),
    ACTION_MODES,
  );
  const transitions = totalVariationSimilarityBp(
    asMap(left.categoryTransitionBp),
    asMap(right.categoryTransitionBp),
    CATEGORY_TRANSITION_KEYS,
  );
  const targetOrientation = totalVariationSimilarityBp(
    asMap(left.targetOrientationBp),
    asMap(right.targetOrientationBp),
    TARGET_ORIENTATION_BUCKETS,
  );

  const treatmentOccurredLeft = left.firstTreatmentStartTick !== null;
  const treatmentOccurredRight = right.firstTreatmentStartTick !== null;
  const treatmentLatencySimilarity =
    treatmentOccurredLeft && treatmentOccurredRight
      ? boundedDifferenceSimilarityBp(
          left.firstTreatmentStartTick!,
          right.firstTreatmentStartTick!,
          TREATMENT_LATENCY_SIMILARITY_RANGE_TICKS,
        )
      : null;

  const otherNpcs = NPC_IDS.filter((id) => id !== left.npcId);
  const relationshipDeltaSimilarity = meanBp(
    otherNpcs.map((other) =>
      boundedDifferenceSimilarityBp(
        left.relationshipsAtEnd[other] ?? 0,
        right.relationshipsAtEnd[other] ?? 0,
        RELATIONSHIP_DELTA_SIMILARITY_RANGE_MICRO,
      ),
    ),
  );

  const outcomeSubcomponents = {
    taskOutcomeMatch: exactMatchSimilarityBp(left.taskOutcome, right.taskOutcome),
    mealConsumerMatch: exactMatchSimilarityBp(left.mealConsumedBy, right.mealConsumedBy),
    commitmentTerminalStatusMatch: exactMatchSimilarityBp(
      left.commitmentTerminalStatus,
      right.commitmentTerminalStatus,
    ),
    injuryWorsenedMatch: exactMatchSimilarityBp(left.injuryWorsened, right.injuryWorsened),
    treatmentOccurredMatch: exactMatchSimilarityBp(treatmentOccurredLeft, treatmentOccurredRight),
    ownershipViolationSimilarity: boundedDifferenceSimilarityBp(
      left.ownershipViolations,
      right.ownershipViolations,
      OWNERSHIP_VIOLATION_SIMILARITY_RANGE,
    ),
    relationshipDeltaSimilarity,
    treatmentLatencySimilarity,
  };

  // §10.6E: the latency subcomponent participates only when both sides are
  // observable; otherwise the average runs over the remaining fixed
  // subcomponents (occurrence mismatch is already captured above).
  const outcomeValues = [
    outcomeSubcomponents.taskOutcomeMatch,
    outcomeSubcomponents.mealConsumerMatch,
    outcomeSubcomponents.commitmentTerminalStatusMatch,
    outcomeSubcomponents.injuryWorsenedMatch,
    outcomeSubcomponents.treatmentOccurredMatch,
    outcomeSubcomponents.ownershipViolationSimilarity,
    outcomeSubcomponents.relationshipDeltaSimilarity,
    ...(treatmentLatencySimilarity === null ? [] : [treatmentLatencySimilarity]),
  ];
  const outcomes = meanBp(outcomeValues);

  const compositeBp = roundHalfAwayFromZero(
    (categoryTime * SIMILARITY_WEIGHTS_BP.categoryTime +
      modeStarts * SIMILARITY_WEIGHTS_BP.modeStarts +
      transitions * SIMILARITY_WEIGHTS_BP.transitions +
      targetOrientation * SIMILARITY_WEIGHTS_BP.targetOrientation +
      outcomes * SIMILARITY_WEIGHTS_BP.outcomes) /
      10_000,
  );

  return {
    similarityVersion: BEHAVIOR_SIMILARITY_VERSION,
    fingerprintVersion: BEHAVIOR_FINGERPRINT_VERSION,
    npcId: left.npcId,
    left: {
      scenarioId: left.scenarioId,
      seed: left.seed,
      conditionId: left.conditionId,
      canonicalLedgerHash: left.canonicalLedgerHash,
    },
    right: {
      scenarioId: right.scenarioId,
      seed: right.seed,
      conditionId: right.conditionId,
      canonicalLedgerHash: right.canonicalLedgerHash,
    },
    components: { categoryTime, modeStarts, transitions, targetOrientation, outcomes },
    outcomeSubcomponents,
    compositeBp,
  };
}

/**
 * Compares two fingerprint sets NPC by NPC. Refuses non-comparable pairings
 * (§10.6) with a typed error rather than producing a misleading number.
 */
export function compareBehaviorFingerprintSets(
  left: BehaviorFingerprintSet,
  right: BehaviorFingerprintSet,
): BehaviorComparison {
  const pairing = comparablePairing(
    { scenarioId: left.scenarioId, seed: left.seed },
    { scenarioId: right.scenarioId, seed: right.seed },
  );
  if (pairing === null) {
    throw new Error(
      `similarity-not-comparable:${left.scenarioId}/${left.seed} vs ${right.scenarioId}/${right.seed}`,
    );
  }
  const npcs = {} as Record<NpcId, BehaviorSimilarity>;
  for (const npcId of NPC_IDS) {
    npcs[npcId] = compareNpc(left.npcs[npcId], right.npcs[npcId]);
  }
  const comparison: BehaviorComparison = {
    similarityVersion: BEHAVIOR_SIMILARITY_VERSION,
    fingerprintVersion: BEHAVIOR_FINGERPRINT_VERSION,
    pairing,
    npcs: npcs as BehaviorComparison['npcs'],
  };
  return behaviorComparisonSchema.parse(comparison);
}
