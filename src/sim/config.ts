import type { LocationId, NpcId } from '../shared/ids';
import { MICRO, TICKS_PER_MINUTE } from '../shared/units';

/**
 * Frozen experiment configuration for Vertical Slice 001 — v1.0.
 *
 * Every value marked "fixed" in the coding brief lives here (or in
 * `decisions/weights.ts` for decision weights and `scenarios/definitions.ts`
 * for per-scenario data). Values are exact integers in canonical units:
 *
 * - Time: integer ticks; 1 tick == 1 simulated second.
 * - Normalized 0..1 quantities: integer micro units (1.0 == 1_000_000).
 * - Purifier progress: integer REPAIR units. The total repair job is
 *   120_000 units == 100%, chosen so that every fixed per-minute repair rate
 *   is an exact integer number of units per tick:
 *     1.00 pp/min == 20 units/tick, 0.70 pp/min == 14, 0.35 pp/min == 7.
 *   1 percentage point == 1_200 units.
 *
 * Change control: material changes to these values require a new experiment
 * version (see brief section 26).
 */

// --- Time -------------------------------------------------------------------

/** Scenario duration: 45 simulated minutes. */
export const SCENARIO_END_TICK = 45 * TICKS_PER_MINUTE; // 2700

/** Travel between any two distinct locations: exactly 30 simulated seconds. */
export const TRAVEL_TICKS = 30;

// --- Needs (micro units) -----------------------------------------------------

/** Hunger increases by 0.003 per simulated minute -> 50 micro per tick. */
export const HUNGER_RATE_PER_TICK = 50;
/** Fatigue increases by 0.0015 per simulated minute while awake -> 25 micro per tick. */
export const FATIGUE_RATE_PER_TICK = 25;

export const HUNGER_MODERATE = 650_000; // 0.65
export const HUNGER_HIGH = 800_000; // 0.80
export const HUNGER_CRITICAL = 950_000; // 0.95

/** Eating takes 3 simulated minutes after arrival at the shelf. */
export const EAT_DURATION_TICKS = 3 * TICKS_PER_MINUTE; // 180
/** Successful consumption lowers hunger by 0.55, clamped at 0. */
export const MEAL_HUNGER_REDUCTION = 550_000;

/** A five-minute rest action reduces fatigue by 0.10, clamped at 0. */
export const REST_DURATION_TICKS = 5 * TICKS_PER_MINUTE; // 300
export const REST_FATIGUE_REDUCTION = 100_000;

// --- Purifier repair (REPAIR units) ------------------------------------------

export const REPAIR_TOTAL_UNITS = 120_000; // == 100%
export const REPAIR_UNITS_PER_PERCENT_POINT = 1_200;
/** Initial purifier repair progress: 60%. */
export const REPAIR_INITIAL_UNITS = 72_000;

/** Fixed repair rates in units per tick (see conversion note above). */
export const REPAIR_RATE_PER_TICK: Record<NpcId, number> = {
  mara: 20, // 1.00 percentage point per simulated minute
  jonas: 14, // 0.70 pp/min
  rin: 7, // 0.35 pp/min, while medically capable
};

/**
 * An NPC is medically capable of repair work while injury severity is below
 * this threshold. Rin's untreated injury (0.55) blocks repair; both possible
 * post-treatment severities (0.15, 0.25) permit it again.
 */
export const REPAIR_CAPABLE_SEVERITY_LIMIT = 300_000;

// --- Injury -------------------------------------------------------------------

/** Initial severity of Rin's scripted injury. */
export const INJURY_INITIAL_SEVERITY = 550_000; // 0.55
/** If treatment has not begun within 10 minutes (minute 12 -> minute 22)... */
export const INJURY_WORSEN_DELAY_TICKS = 10 * TICKS_PER_MINUTE; // 600
/** ...severity becomes 0.85 and the NPC becomes incapacitated. */
export const INJURY_WORSENED_SEVERITY = 850_000;
export const INCAPACITATION_SEVERITY = 850_000;

export interface TreatmentCapability {
  durationTicks: number;
  resultSeverity: number;
}

/** The engine — not the decision provider — determines treatment outcome. */
export const TREATMENT_BY_HEALER: Partial<Record<NpcId, TreatmentCapability>> = {
  jonas: { durationTicks: 4 * TICKS_PER_MINUTE, resultSeverity: 150_000 },
  mara: { durationTicks: 8 * TICKS_PER_MINUTE, resultSeverity: 250_000 },
  // Rin cannot treat herself in this slice; she has no treatment capability.
};

/** Injured NPCs at or above this severity trigger survival/care logic. */
export const INJURY_NEEDS_TREATMENT_SEVERITY = 300_000;

/** Treatment happens at the Medical Cot unless the patient is incapacitated in place. */
export const TREATMENT_LOCATION: LocationId = 'medical-cot';

// --- Jonas's pre-existing commitment ------------------------------------------

export const COMMITMENT_RELIEF_ID = 'cmt-jonas-relieves-mara';
export const COMMITMENT_RELIEF_START_TICK = 15 * TICKS_PER_MINUTE; // 900
export const COMMITMENT_RELIEF_GRACE_TICK = 17 * TICKS_PER_MINUTE; // 1020
export const COMMITMENT_RELIEF_MIN_DURATION_TICKS = 5 * TICKS_PER_MINUTE; // 300

/**
 * Deterministic renegotiation proposal construction: the proposed new start is
 * the earliest tick the debtor can plausibly take the bench (current
 * obligation end + travel + buffer), rounded up to a whole minute; the
 * proposed grace preserves the original two-minute grace span.
 */
export const RENEGOTIATION_BUFFER_TICKS = 60;
export const RENEGOTIATION_GRACE_SPAN_TICKS = 2 * TICKS_PER_MINUTE; // 120

// --- Social actions ------------------------------------------------------------

/** Quick social/communication actions (requests, responses, proposals). */
export const SOCIAL_ACTION_DURATION_TICKS = 30;
/** Wait: a short idle action ensuring frequent re-decision. */
export const WAIT_DURATION_TICKS = 30;
/** Routine duty blocks (routine work, delivering materials). */
export const ROUTINE_WORK_BLOCK_TICKS = 300;
export const DELIVER_MATERIALS_DURATION_TICKS = 180;
/** After a refused meal-transfer request, the requester waits before asking again. */
export const REQUEST_REFUSAL_COOLDOWN_TICKS = 10 * TICKS_PER_MINUTE; // 600

/** Social signals (help/relief requests) count as "recent" for this window. */
export const SOCIAL_SIGNAL_RECENCY_TICKS = 10 * TICKS_PER_MINUTE; // 600

// --- Decision cadence ------------------------------------------------------------

/** Decisions re-evaluate on relevant events and at this fixed maximum interval. */
export const MAX_REEVALUATION_INTERVAL_TICKS = 60;

/**
 * The commitment relief affordance opens this many ticks before the promised
 * start so the debtor can travel and take the bench on time.
 */
export const COMMITMENT_LEAD_TICKS = 90;

// --- Relationship consequences (micro units) -------------------------------------

export const RELATIONSHIP_MIN = -1_000_000;
export const RELATIONSHIP_MAX = 1_000_000;

/** Taking a reserved meal without permission: owner -> actor. */
export const REL_DELTA_MEAL_VIOLATION = -250_000;
/** Breaking the promise without successful renegotiation: creditor -> debtor. */
export const REL_DELTA_PROMISE_BROKEN = -150_000;
/** Successful treatment: patient -> healer (specified for Jonas treating Rin,
 *  applied uniformly to any successful treatment; documented generalization). */
export const REL_DELTA_TREATMENT_SUCCESS = 100_000;

// --- Survival / hard-boundary thresholds ------------------------------------------

/** Own untreated injury at/above this severity forces care-seeking behavior. */
export const SURVIVAL_INJURY_SEVERITY = 300_000;
/**
 * Rin's hard boundary: she will not voluntarily surrender essential food while
 * medically vulnerable. Vulnerable == injured at/above SURVIVAL_INJURY_SEVERITY
 * or hunger at/above the high threshold.
 */
export const VULNERABLE_HUNGER = HUNGER_HIGH;

// --- Misc ---------------------------------------------------------------------------

export const TASK_ID = 'purifier-repair';
export const MEAL_RESOURCE_ID = 'meal-1';
export const BENCH_RESOURCE_ID = 'workbench-slot';
export const MEAL_LOCATION: LocationId = 'food-shelf';
export const BENCH_LOCATION: LocationId = 'purifier-workbench';

export const FULL_MICRO = MICRO;
