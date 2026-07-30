import { z } from 'zod';
import {
  ACTION_CATEGORIES,
  ACTION_MODES,
  NPC_IDS,
  SCENARIO_IDS,
  type ActionCategory,
  type ActionMode,
  type NpcId,
} from './ids';
import { DECISION_REJECTION_REASONS, EXTERNAL_FAILURE_CODES } from './decisionContracts';

/**
 * Complete provider-failure vocabulary for fingerprints (§10.5). The frozen
 * engine emits either a gateway-client failure code (EXTERNAL_FAILURE_CODES),
 * a scripted provider's own code (`scripted-failure-mode`, scenario F's frozen
 * failing provider — inside the hashed event stream and therefore immutable),
 * or the engine's catch-all `provider-exception`. Any code outside this closed
 * set is vocabulary drift and fails loudly (a new fingerprint version is then
 * required per §10.3).
 */
export const PROVIDER_FAILURE_CODE_VOCABULARY: readonly string[] = [
  ...EXTERNAL_FAILURE_CODES,
  'provider-exception',
  'scripted-failure-mode',
];

/**
 * Versioned contracts for the Milestone 2 behavioral-evaluation laboratory
 * (M2 brief §10). One source of truth for the fingerprint and similarity
 * document shapes, their version literals, and the fixed metric constants.
 *
 * Rules inherited from the brief:
 *  - §10.1: exact integer / basis-point arithmetic only — no floats anywhere
 *    in canonical evaluation JSON (canonicalSerialize throws on them).
 *  - §10.3: any formula, event interpretation, normalization denominator, or
 *    component weight change requires a new version literal.
 *  - §10.5: every distribution map carries the complete fixed vocabulary,
 *    including zero-count entries, normalized by largest-remainder allocation
 *    to exactly 10_000 basis points.
 *  - §10.11: `commitmentTerminalStatus` is the mechanical commitment terminal
 *    status produced under VS001 rules. It is NOT a validated attribution of
 *    moral responsibility or realistic blame.
 */

export const BEHAVIOR_FINGERPRINT_VERSION = 'behavior-fingerprint-1.0.0';
export const BEHAVIOR_SIMILARITY_VERSION = 'behavior-similarity-1.0.0';

/** Integer similarity-component weights, summing to exactly 10_000 (§10.7). */
export const SIMILARITY_WEIGHTS_BP = {
  categoryTime: 3_500,
  modeStarts: 2_000,
  transitions: 1_500,
  targetOrientation: 1_000,
  outcomes: 2_000,
} as const;

/**
 * Fixed ranges for bounded-numeric outcome subcomponents (§10.6E). Metric
 * constants versioned with BEHAVIOR_SIMILARITY_VERSION — fixed by
 * configuration, never derived from observed data.
 */
export const OWNERSHIP_VIOLATION_SIMILARITY_RANGE = 4;
export const RELATIONSHIP_DELTA_SIMILARITY_RANGE_MICRO = 2_000_000;
export const TREATMENT_LATENCY_SIMILARITY_RANGE_TICKS = 2_700;

/**
 * Target-orientation buckets (§10.6D): stable role and resource buckets,
 * never raw generated IDs. Roles follow the exported-ledger V1 role
 * assignment (exports are v1-roles-only by construction).
 */
export const TARGET_ORIENTATION_BUCKETS = [
  'role:benchWorker',
  'role:debtor',
  'role:mealOwner',
  'resource:meal',
  'resource:workbench',
  'untargeted',
] as const;
export type TargetOrientationBucket = (typeof TARGET_ORIENTATION_BUCKETS)[number];

/** Category-transition vocabulary keys: `<previous>-><next>` over all 10×10 pairs. */
export const CATEGORY_TRANSITION_KEYS: readonly string[] = ACTION_CATEGORIES.flatMap((from) =>
  ACTION_CATEGORIES.map((to) => `${from}->${to}`),
);

/** Mode-transition vocabulary keys: `<previous>-><next>` over all 19×19 pairs. */
export const MODE_TRANSITION_KEYS: readonly string[] = ACTION_MODES.flatMap((from) =>
  ACTION_MODES.map((to) => `${from}->${to}`),
);

const intCount = z.number().int().nonnegative();
const intTick = z.number().int().nonnegative();
const bp = z.number().int().min(0).max(10_000);
const micro = z.number().int().min(0).max(1_000_000);
const signedMicro = z.number().int().min(-1_000_000).max(1_000_000);
const hash16 = z.string().regex(/^[0-9a-f]{16}$/);

function completeRecord<V extends z.ZodTypeAny>(keys: readonly string[], value: V) {
  return z.record(z.string(), value).superRefine((record, ctx) => {
    const expected = new Set(keys);
    for (const key of Object.keys(record)) {
      if (!expected.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unexpected-key:${key}` });
      }
    }
    for (const key of keys) {
      if (!(key in record)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing-key:${key}` });
      }
    }
  });
}

/** `not-observable` marks responses the frozen scenario offers no action for (§10.4). */
export const notObservable = z.literal('not-observable');
export type CountOrNotObservable = number | 'not-observable';

/**
 * Provenance rule (Phase 2 audit, blocking finding 4): `providerPlanId` is the
 * provider-plan identity the ledger itself proves (`ledger.providerId`);
 * `registeredConditionId` is an experimental condition PROVEN by a manifest or
 * study plan. A bare ledger proves no condition — the evaluator reports
 * `not-observable` rather than inventing one, and a condition is never
 * inferred from a provider plan.
 */
export const behaviorFingerprintSchema = z
  .object({
    fingerprintVersion: z.literal(BEHAVIOR_FINGERPRINT_VERSION),
    scenarioId: z.enum(SCENARIO_IDS),
    scenarioVersion: z.string().min(1),
    seed: z.number().int(),
    providerPlanId: z.string().min(1),
    registeredConditionId: z.union([z.string().min(1), notObservable]),
    npcId: z.enum(NPC_IDS),
    finalTick: intTick,
    worldStateHash: hash16,
    canonicalLedgerHash: hash16,

    // Action participation (§10.4).
    decisionOpportunities: intCount,
    actionsProposed: intCount,
    actionsStarted: intCount,
    actionsCompleted: intCount,
    actionsInterrupted: intCount,
    actionsRejected: intCount,
    activeTicks: intCount,
    timeByCategoryTicks: completeRecord(ACTION_CATEGORIES, intCount),
    timeByCategoryBp: completeRecord(ACTION_CATEGORIES, bp),
    startsByCategory: completeRecord(ACTION_CATEGORIES, intCount),
    startsByCategoryBp: completeRecord(ACTION_CATEGORIES, bp),
    startsByMode: completeRecord(ACTION_MODES, intCount),
    startsByModeBp: completeRecord(ACTION_MODES, bp),
    continuationSelections: intCount,
    violationSelections: intCount,
    fallbackSelections: intCount,
    policyPatchSelections: intCount,

    // Transition behavior (§10.4): counted between accepted action starts only.
    categoryTransitions: completeRecord(CATEGORY_TRANSITION_KEYS, intCount),
    categoryTransitionBp: completeRecord(CATEGORY_TRANSITION_KEYS, bp),
    modeTransitions: completeRecord(MODE_TRANSITION_KEYS, intCount),

    // Target and social behavior (§10.4).
    targetNpcCounts: completeRecord(NPC_IDS, intCount),
    targetResourceCounts: completeRecord(['meal-1', 'workbench-slot'], intCount),
    targetOrientation: completeRecord(TARGET_ORIENTATION_BUCKETS, intCount),
    targetOrientationBp: completeRecord(TARGET_ORIENTATION_BUCKETS, bp),
    helpRequestsSent: intCount,
    helpRequestsAnswered: z.union([intCount, notObservable]),
    reliefRequestsSent: intCount,
    mealTransferRequests: intCount,
    mealTransferAcceptances: intCount,
    mealTransferRefusals: intCount,
    renegotiationProposals: intCount,
    renegotiationAcceptances: intCount,
    renegotiationRejections: intCount,
    commitmentsFulfilledAsDebtor: intCount,
    commitmentsBrokenAsDebtor: intCount,
    ownershipViolations: intCount,

    // Need and safety behavior (§10.4). Patient-perspective treatment fields.
    firstTreatmentStartTick: intTick.nullable(),
    treatmentCompletionTick: intTick.nullable(),
    injuryWorsened: z.boolean(),
    incapacitatedAtEnd: z.boolean(),
    mealConsumedBy: z.enum(NPC_IDS).nullable(),
    mealViolation: z.boolean(),
    hungerAtEnd: micro,
    fatigueAtEnd: micro,

    // Task behavior (§10.4).
    taskOutcome: z.enum(['completed', 'deadline-missed']),
    taskCompletionTick: intTick.nullable(),
    purifierContributionUnits: intCount,
    purifierContributionBp: bp,
    workSessionCount: intCount,
    longestWorkSessionTicks: intCount,

    // Commitment terminal status (§10.11): the MECHANICAL status produced
    // under VS001 rules — never a validated attribution of blame.
    commitmentTerminalStatus: z.enum([
      'fulfilled',
      'fulfilled-after-renegotiation',
      'broken',
      'broken-after-renegotiation',
      'none',
    ]),

    // End-of-run relationship values toward the other two NPCs (micro units),
    // used by the relationship-delta outcome subcomponent (§10.6E).
    relationshipsAtEnd: completeRecord(NPC_IDS, signedMicro),

    // Decision-source behavior (§10.4), under the explicit provider-source
    // taxonomy (audit finding 1). Request-derived counts are canonical ledger
    // facts and never claim upstream dispatch; upstream call counts are
    // transport facts a plain ledger cannot prove, reported `not-observable`
    // unless gateway-trace evidence supplies them.
    externalActionRequestsEmitted: intCount,
    acceptedExternalActions: intCount,
    policyExecutorDecisions: intCount,
    policyCompilationRequestsEmitted: intCount,
    upstreamActionCallsAttempted: z.union([intCount, notObservable]),
    upstreamActionCallsCompleted: z.union([intCount, notObservable]),
    upstreamPolicyCompilationCallsAttempted: z.union([intCount, notObservable]),
    upstreamPolicyCompilationCallsCompleted: z.union([intCount, notObservable]),
    acceptedPolicyPatches: intCount,
    policyPatchUses: intCount,
    policyPatchMisses: intCount,
    policyPatchInvalidationsByReason: z.record(z.string(), intCount),
    deterministicFallbackDecisions: intCount,
    providerFailuresByCode: completeRecord(PROVIDER_FAILURE_CODE_VOCABULARY, intCount),
    engineRejectionsByReason: completeRecord(DECISION_REJECTION_REASONS, intCount),
  })
  .strict();

export type BehaviorFingerprint = z.infer<typeof behaviorFingerprintSchema>;

/** One fingerprint document per ledger: all three NPCs plus shared provenance. */
export const behaviorFingerprintSetSchema = z
  .object({
    fingerprintVersion: z.literal(BEHAVIOR_FINGERPRINT_VERSION),
    scenarioId: z.enum(SCENARIO_IDS),
    scenarioVersion: z.string().min(1),
    seed: z.number().int(),
    providerPlanId: z.string().min(1),
    registeredConditionId: z.union([z.string().min(1), notObservable]),
    finalTick: intTick,
    worldStateHash: hash16,
    canonicalLedgerHash: hash16,
    npcs: z
      .object({
        mara: behaviorFingerprintSchema,
        jonas: behaviorFingerprintSchema,
        rin: behaviorFingerprintSchema,
      })
      .strict(),
  })
  .strict();

export type BehaviorFingerprintSet = z.infer<typeof behaviorFingerprintSetSchema>;

export const OUTCOME_SUBCOMPONENT_KEYS = [
  'taskOutcomeMatch',
  'mealConsumerMatch',
  'commitmentTerminalStatusMatch',
  'injuryWorsenedMatch',
  'treatmentOccurredMatch',
  'ownershipViolationSimilarity',
  'relationshipDeltaSimilarity',
  'treatmentLatencySimilarity',
] as const;
export type OutcomeSubcomponentKey = (typeof OUTCOME_SUBCOMPONENT_KEYS)[number];

export const behaviorSimilaritySchema = z
  .object({
    similarityVersion: z.literal(BEHAVIOR_SIMILARITY_VERSION),
    fingerprintVersion: z.literal(BEHAVIOR_FINGERPRINT_VERSION),
    npcId: z.enum(NPC_IDS),
    left: z
      .object({
        scenarioId: z.enum(SCENARIO_IDS),
        seed: z.number().int(),
        providerPlanId: z.string().min(1),
        registeredConditionId: z.union([z.string().min(1), notObservable]),
        canonicalLedgerHash: hash16,
      })
      .strict(),
    right: z
      .object({
        scenarioId: z.enum(SCENARIO_IDS),
        seed: z.number().int(),
        providerPlanId: z.string().min(1),
        registeredConditionId: z.union([z.string().min(1), notObservable]),
        canonicalLedgerHash: hash16,
      })
      .strict(),
    components: z
      .object({
        categoryTime: bp,
        modeStarts: bp,
        transitions: bp,
        targetOrientation: bp,
        outcomes: bp,
      })
      .strict(),
    outcomeSubcomponents: z
      .object({
        taskOutcomeMatch: bp,
        mealConsumerMatch: bp,
        commitmentTerminalStatusMatch: bp,
        injuryWorsenedMatch: bp,
        treatmentOccurredMatch: bp,
        ownershipViolationSimilarity: bp,
        relationshipDeltaSimilarity: bp,
        treatmentLatencySimilarity: bp.nullable(),
      })
      .strict(),
    compositeBp: bp,
  })
  .strict();

export type BehaviorSimilarity = z.infer<typeof behaviorSimilaritySchema>;

export const behaviorComparisonSchema = z
  .object({
    similarityVersion: z.literal(BEHAVIOR_SIMILARITY_VERSION),
    fingerprintVersion: z.literal(BEHAVIOR_FINGERPRINT_VERSION),
    pairing: z.enum(['same-scenario', 'registered-ablation-pair']),
    npcs: z
      .object({
        mara: behaviorSimilaritySchema,
        jonas: behaviorSimilaritySchema,
        rin: behaviorSimilaritySchema,
      })
      .strict(),
  })
  .strict();

export type BehaviorComparison = z.infer<typeof behaviorComparisonSchema>;

/**
 * Comparability rule (§10.6, §10.9): similarity is defined for fingerprints
 * from the same scenario and seed, plus the one registered memory-ablation
 * pair (B1/B2 at the shared seed).
 */
export function comparablePairing(
  left: { scenarioId: string; seed: number },
  right: { scenarioId: string; seed: number },
): 'same-scenario' | 'registered-ablation-pair' | null {
  if (left.seed !== right.seed) return null;
  if (left.scenarioId === right.scenarioId) return 'same-scenario';
  const pair = new Set([left.scenarioId, right.scenarioId]);
  if (pair.has('B1') && pair.has('B2')) return 'registered-ablation-pair';
  return null;
}

export type { ActionCategory, ActionMode, NpcId };
