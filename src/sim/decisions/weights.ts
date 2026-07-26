import type { NpcId } from '../../shared/ids';

/**
 * Centralized decision weights for the deterministic provider.
 *
 * All decision scores are integers on a nominal 0..~1,200,000 scale. Trait,
 * value, memory, relationship, and commitment effects are separate scoring
 * components so debug output can decompose every choice. These weights were
 * calibrated so the scenario suite exhibits the behavioral signatures in
 * brief section 8 without scripting any specific action sequence.
 */

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
    industriousnessMicro: 850_000,
    workDriveMicro: 850_000,
    selfPreservationMicro: 300_000,
    prideMicro: 800_000,
    empathyMicro: 350_000,
    ruleAdherenceMicro: 600_000,
    directnessMicro: 500_000,
    promiseDutyMicro: 600_000,
    generosityMicro: 400_000,
    suspicionMicro: 300_000,
    firstAidBonus: -100_000, // first aid: low
  },
  jonas: {
    industriousnessMicro: 750_000,
    workDriveMicro: 500_000,
    selfPreservationMicro: 200_000,
    prideMicro: 250_000,
    empathyMicro: 850_000,
    ruleAdherenceMicro: 700_000,
    directnessMicro: 400_000,
    promiseDutyMicro: 750_000,
    generosityMicro: 700_000,
    suspicionMicro: 200_000,
    firstAidBonus: 100_000, // first aid: high
  },
  rin: {
    industriousnessMicro: 300_000,
    workDriveMicro: 150_000,
    selfPreservationMicro: 850_000,
    prideMicro: 400_000,
    empathyMicro: 250_000,
    ruleAdherenceMicro: 500_000,
    directnessMicro: 750_000,
    promiseDutyMicro: 500_000,
    generosityMicro: 250_000,
    suspicionMicro: 750_000,
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
