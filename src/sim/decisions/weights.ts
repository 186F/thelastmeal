import type { NpcId } from '../../shared/ids';
import { IDENTITIES } from '../domain/identities';

/**
 * Centralized decision weights for the deterministic provider.
 *
 * All decision scores are integers on a nominal 0..~1,200,000 scale. Trait,
 * value, memory, relationship, and commitment effects are separate scoring
 * components so debug output can decompose every choice.
 *
 * Fields that mirror a brief-fixed identity trait are sourced FROM the
 * identity card (single source of truth; section 26 change control), and
 * `npm run validate` cross-checks the mapping. Fields marked "calibration"
 * have no corresponding fixed trait; their values were calibrated so the
 * scenario suite exhibits the behavioral signatures in brief section 8
 * without scripting any specific action sequence.
 */

/** Reads a brief-fixed trait from the identity card (throws if missing). */
function trait(npcId: NpcId, key: string): number {
  const value = IDENTITIES[npcId].traits[key];
  if (value === undefined) {
    throw new Error(`weights-missing-trait: ${npcId}.${key}`);
  }
  return value;
}

/** Declares which weight fields mirror which brief-fixed identity traits. */
export const WEIGHT_TRAIT_SOURCES: Record<
  NpcId,
  Partial<Record<keyof NpcDecisionWeights, string>>
> = {
  mara: {
    workDriveMicro: 'diligence',
    prideMicro: 'pride',
    empathyMicro: 'empathy',
    ruleAdherenceMicro: 'ruleAdherence',
  },
  jonas: {
    industriousnessMicro: 'conscientiousness',
    empathyMicro: 'empathy',
    prideMicro: 'pride',
    promiseDutyMicro: 'conscientiousness',
  },
  rin: {
    selfPreservationMicro: 'selfPreservation',
    suspicionMicro: 'suspicion',
    generosityMicro: 'generosity',
    directnessMicro: 'directness',
  },
};

export interface NpcDecisionWeights {
  /** Drive toward low-intensity routine duties. */
  industriousnessMicro: number;
  /** Drive toward bench repair work. */
  workDriveMicro: number;
  selfPreservationMicro: number;
  prideMicro: number;
  empathyMicro: number;
  ruleAdherenceMicro: number;
  directnessMicro: number;
  /** Weight on keeping formal promises. */
  promiseDutyMicro: number;
  generosityMicro: number;
  suspicionMicro: number;
  /** First-aid competence bonus applied to treat scoring. */
  firstAidBonus: number;
}

export const NPC_WEIGHTS: Record<NpcId, NpcDecisionWeights> = {
  mara: {
    industriousnessMicro: 850_000, // calibration (tracks diligence)
    workDriveMicro: trait('mara', 'diligence'),
    selfPreservationMicro: 300_000, // calibration
    prideMicro: trait('mara', 'pride'),
    empathyMicro: trait('mara', 'empathy'),
    ruleAdherenceMicro: trait('mara', 'ruleAdherence'),
    directnessMicro: 500_000, // calibration
    promiseDutyMicro: 600_000, // calibration
    generosityMicro: 400_000, // calibration
    suspicionMicro: 300_000, // calibration
    firstAidBonus: -100_000, // first aid: low
  },
  jonas: {
    industriousnessMicro: trait('jonas', 'conscientiousness'),
    workDriveMicro: 500_000, // calibration (repair skill: medium)
    selfPreservationMicro: 200_000, // calibration
    prideMicro: trait('jonas', 'pride'),
    empathyMicro: trait('jonas', 'empathy'),
    ruleAdherenceMicro: 700_000, // calibration
    directnessMicro: 400_000, // calibration
    promiseDutyMicro: trait('jonas', 'conscientiousness'),
    generosityMicro: 700_000, // calibration
    suspicionMicro: 200_000, // calibration
    firstAidBonus: 100_000, // first aid: high
  },
  rin: {
    industriousnessMicro: 300_000, // calibration
    workDriveMicro: 150_000, // calibration (repair skill: low)
    selfPreservationMicro: trait('rin', 'selfPreservation'),
    prideMicro: 400_000, // calibration
    empathyMicro: 250_000, // calibration
    ruleAdherenceMicro: 500_000, // calibration
    directnessMicro: trait('rin', 'directness'),
    promiseDutyMicro: 500_000, // calibration
    generosityMicro: trait('rin', 'generosity'),
    suspicionMicro: trait('rin', 'suspicion'),
    firstAidBonus: -100_000, // first aid: low
  },
};

/** Mode-base scores and global scoring constants. */
export const SCORING = {
  base: {
    wait: 10_000,
    rest: 20_000,
    routineWork: 60_000,
    work: 100_000,
    relieve: 80_000,
    treat: 300_000,
    stayAtCot: 700_000,
    askHelp: 300_000,
    respondToRequest: 700_000,
    respondToProposal: 900_000,
    proposeRenegotiation: 550_000,
  },
  /** Hysteresis bonus for continuing the current action. */
  continuityBonus: 80_000,
  /** Colony-survival pressure while the purifier is unfinished. */
  deadlinePressure: 50_000,
  /** Scale factors (applied to micro-unit weights). */
  workDriveScale: 0.4,
  industriousnessScale: 0.04,
  /** Hunger scoring for eating (legal). */
  eatCritical: 900_000,
  eatHigh: 500_000,
  eatModerate: 200_000,
  eatLow: 50_000,
  eatSelfPreservationScale: 0.1,
  /** Hunger drag on bench work above the high threshold. */
  workHungerDragFactor: 2,
  workHungerDragCap: 400_000,
  /** Ownership-violation penalty: base + ruleAdherence-scaled. */
  violationBasePenalty: 250_000,
  violationRuleScale: 0.4,
  violationRelationshipScale: 0.1,
  /** Meal transfer request scoring. */
  requestHighBase: 650_000,
  requestHighHungerFactor: 2,
  requestHighHungerCap: 200_000,
  requestModerateBase: 150_000,
  requestPrideScale: 0.1,
  /** Owner response scoring. */
  transferGenerosityScale: 0.3,
  transferRelationshipScale: 0.1,
  transferSelfNeedPenalty: 300_000,
  refuseDirectnessScale: 0.2,
  refuseSuspicionScale: 0.2,
  refuseSelfNeedBonus: 200_000,
  /** Break request scoring. */
  breakNeedBase: 300_000,
  breakHungerFactor: 3,
  breakFatigueFactor: 1,
  breakPrideScale: 0.15,
  /** Relieve scoring. */
  relieveCommitmentScale: 0.8,
  relieveEmpathyScale: 0.5,
  relieveSkillDeltaPerUnit: 6_000,
  relievePolitenessPenalty: 600_000,
  relieveProtectOwnReliefPenalty: 800_000,
  /** Treat scoring. */
  treatEmpathyScale: 0.5,
  treatAskedForHelpBonus: 100_000,
  /** Renegotiation. */
  proposePromiseDutyScale: 0.4,
  respondProposalMismatchScore: 100_000,
  /** Rest scoring. */
  restFatigueThreshold: 500_000,
  restFatigueFactor: 2,
  /** Ask-help scoring. */
  askHelpSelfPreservationScale: 0.2,
  /** Voluntary release scoring. */
  releaseGenerosityScale: 0.1,
  /** Renegotiation-rejection pride nudge. */
  rejectPrideScale: 0.05,
  /** Stay-at-cot self-preservation scale. */
  stayAtCotSelfPreservationScale: 0.2,
  /** Routine-duty industriousness scale. */
  routineIndustriousnessScale: 0.4,
  /** Conflict-avoidance drag on blunt refusals (reads the identity trait). */
  refuseConflictAvoidanceScale: 0.1,
  /** Memory effects (structured, per seed memory). */
  memoryCriticism: {
    workBonus: 150_000,
    requestBreakPenalty: 400_000,
    restPenalty: 100_000,
    askHelpPenalty: 150_000,
  },
  memoryShiftCovered: {
    relieveBonus: 60_000,
  },
  memorySupplyTaken: {
    refuseJonasBonus: 100_000,
    transferJonasPenalty: 200_000,
  },
  /** Confidence mapping. */
  confidenceBaseBp: 1_000,
  confidenceMarginDivisor: 200,
} as const;

/** Repair units/tick used for relieve skill-delta scoring (mirrors config). */
export const RELIEVE_SKILL_RATE: Record<NpcId, number> = {
  mara: 20,
  jonas: 14,
  rin: 7,
};
