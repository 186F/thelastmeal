import type { LocationId, NpcId } from '../../shared/ids';

/**
 * Structured NPC identity cards (brief section 8). Identity is data; any
 * display biography is generated from these fields and is never authoritative.
 * Trait and skill magnitudes are micro units (1.0 == 1_000_000).
 */

export type SkillLevel = 'low' | 'medium' | 'high';

export interface NpcIdentity {
  id: NpcId;
  displayName: string;
  /** Trait keys are NPC-specific, exactly as specified in the brief. */
  traits: Record<string, number>;
  values: string[];
  skills: { repair: SkillLevel; firstAid: SkillLevel };
  goalId: string;
  goalText: string;
  hardBoundaryId: string;
  hardBoundaryText: string;
  initial: {
    hungerMicro: number;
    fatigueMicro: number;
    locationId: LocationId;
    /** Structured initial-action mode (started as a scripted event at tick 0). */
    initialActionMode: 'work' | 'routine-work' | 'deliver-materials';
  };
}

export interface SeedMemory {
  id: string;
  npcId: NpcId;
  /** The canonical fact: what objectively occurred (pre-scenario facts are flagged). */
  canonicalFact: string;
  preScenario: boolean;
  /** What the NPC was in a position to observe. */
  perception: string;
  /** The NPC's structured interpretation of the fact. */
  interpretation: string;
  confidenceMicro: number;
  importanceMicro: number;
}

export const IDENTITIES: Record<NpcId, NpcIdentity> = {
  mara: {
    id: 'mara',
    displayName: 'Mara',
    traits: {
      diligence: 850_000,
      pride: 800_000,
      empathy: 350_000,
      ruleAdherence: 600_000,
    },
    values: ['competence', 'personal-dignity', 'colony-survival'],
    skills: { repair: 'high', firstAid: 'low' },
    goalId: 'finish-purifier-repair',
    goalText: 'Finish the purifier repair and demonstrate that she is dependable.',
    hardBoundaryId: 'never-ignore-lethal-injury-when-sole-helper',
    hardBoundaryText:
      'Mara will not ignore a life-threatening injury when nobody else can intervene.',
    initial: {
      hungerMicro: 720_000,
      fatigueMicro: 350_000,
      locationId: 'purifier-workbench',
      initialActionMode: 'work',
    },
  },
  jonas: {
    id: 'jonas',
    displayName: 'Jonas',
    traits: {
      empathy: 850_000,
      conscientiousness: 750_000,
      conflictAvoidance: 650_000,
      pride: 250_000,
    },
    values: ['caring-for-others', 'keeping-promises', 'colony-stability'],
    skills: { repair: 'medium', firstAid: 'high' },
    goalId: 'keep-group-functioning',
    goalText: 'Keep the group functioning without letting anyone feel abandoned.',
    hardBoundaryId: 'never-consume-reserved-food',
    hardBoundaryText: 'Jonas will not knowingly consume food reserved for someone else.',
    initial: {
      hungerMicro: 450_000,
      fatigueMicro: 300_000,
      locationId: 'routine-work-station',
      initialActionMode: 'routine-work',
    },
  },
  rin: {
    id: 'rin',
    displayName: 'Rin',
    traits: {
      selfPreservation: 850_000,
      suspicion: 750_000,
      generosity: 250_000,
      directness: 750_000,
    },
    values: ['personal-autonomy', 'survival', 'fair-treatment'],
    skills: { repair: 'low', firstAid: 'low' },
    goalId: 'protect-health-and-resources',
    goalText: 'Protect her health and retain control over resources assigned to her.',
    hardBoundaryId: 'never-surrender-essential-food-while-vulnerable',
    hardBoundaryText:
      'Rin will not voluntarily surrender essential food while medically vulnerable.',
    initial: {
      hungerMicro: 800_000,
      fatigueMicro: 400_000,
      locationId: 'purifier-workbench',
      initialActionMode: 'deliver-materials',
    },
  },
};

/**
 * Pre-scenario structured memories. Each stores the canonical fact, the NPC's
 * perception channel, interpretation, confidence, and importance separately.
 */
export const SEED_MEMORIES: SeedMemory[] = [
  {
    id: 'mem-mara-criticism',
    npcId: 'mara',
    canonicalFact: 'player-criticized-mara-for-giving-up-when-work-becomes-difficult',
    preScenario: true,
    perception: 'heard-directly',
    interpretation: 'attack-on-competence',
    confidenceMicro: 900_000,
    importanceMicro: 900_000,
  },
  {
    id: 'mem-jonas-shift-covered',
    npcId: 'jonas',
    canonicalFact: 'mara-covered-jonas-shift-several-days-ago',
    preScenario: true,
    perception: 'experienced-directly',
    interpretation: 'owes-mara-reliability',
    confidenceMicro: 900_000,
    importanceMicro: 700_000,
  },
  {
    id: 'mem-rin-supply-taken',
    npcId: 'rin',
    canonicalFact: 'jonas-used-rins-supply-without-asking',
    preScenario: true,
    perception: 'discovered-afterward',
    interpretation: 'jonas-disrespects-ownership',
    confidenceMicro: 850_000,
    importanceMicro: 800_000,
  },
];
