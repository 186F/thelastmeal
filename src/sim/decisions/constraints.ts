import { HUNGER_CRITICAL, HUNGER_HIGH, INJURY_NEEDS_TREATMENT_SEVERITY } from '../config';
import type { OfferedAffordance } from '../../shared/decisionContracts';
import type { NpcId } from '../../shared/ids';
import type { BeliefState } from '../domain/state';

/**
 * Provider-independent survival and hard identity constraints (remediation 2).
 *
 * One shared, pure implementation consumed by:
 *  - the deterministic provider (so prohibited choices are never scored),
 *  - the engine's decision-response acceptance gate (authoritative
 *    enforcement — a provider cannot opt out), and
 *  - the fallback provider (so fallback choices are also legal).
 *
 * Semantics are ported bit-exactly from the v1.0 provider-internal
 * `applyHardLayers`, in the same order: L1a (untreated serious own injury →
 * care-seeking) before L1b (critical hunger + legal meal → eating) before the
 * L2 identity boundaries. L0 (incapacitated NPCs make no decisions) stays in
 * the engine/affordance/validation layers, which already enforce it
 * provider-independently.
 *
 * The Mara sole-helper rule is deliberately belief-scoped ("according to her
 * valid beliefs"): the evaluation consumes the same belief snapshot the
 * provider sees, never ground-truth state, so the provider's pre-filter and
 * the engine's gate can never disagree about it.
 *
 * The engine must still allow physically possible norm violations for NPCs
 * whose constraints permit them: eat-violation is forbidden only for Jonas.
 */

export interface ConstraintContext {
  npcId: NpcId;
  hungerMicro: number;
  injury: { severityMicro: number; treatmentStartedTick: number | null };
  incapacitated: boolean;
  beliefs: readonly BeliefState[];
}

export interface ForbiddenAffordance {
  affordanceId: string;
  reasonCodes: string[];
}

export interface ConstraintEvaluation {
  /** Offer-order IDs the acting NPC may choose. Never empty when the input
   * list is non-empty (the L1a safety fall-through keeps the full list when
   * no care action is offered; the engine always offers `wait`). */
  allowedAffordanceIds: string[];
  forbidden: ForbiddenAffordance[];
  /** Modes forced by an active survival/identity override, or null. */
  mandatoryModes: string[] | null;
  /** Structured codes for every constraint that fired. */
  activeConstraintCodes: string[];
}

export const CONSTRAINT_CODES = {
  survivalInjuryCare: 'survival-injury-care',
  survivalCriticalHungerEat: 'survival-critical-hunger-eat',
  jonasNoReservedFood: 'boundary-jonas-never-eats-reserved-food',
  rinKeepsFoodWhileVulnerable: 'boundary-rin-keeps-food-while-vulnerable',
  maraSoleHelper: 'boundary-mara-sole-helper-emergency',
} as const;

export function evaluateConstraints(
  ctx: ConstraintContext,
  affordances: readonly OfferedAffordance[],
): ConstraintEvaluation {
  const all = [...affordances];

  // L1a — untreated serious own injury: restrict to care-seeking when any
  // care action is offered (safety fall-through to the full list otherwise).
  if (
    ctx.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY &&
    ctx.injury.treatmentStartedTick === null &&
    !ctx.incapacitated
  ) {
    const careModes = new Set(['stay-at-cot', 'ask-help']);
    const care = all.filter((a) => careModes.has(a.mode));
    if (care.length > 0) {
      return restrictTo(all, care, [CONSTRAINT_CODES.survivalInjuryCare], [...careModes]);
    }
    return allowAll(all, []);
  }

  // L1b — critical hunger with a legally available meal: survival eating.
  if (ctx.hungerMicro >= HUNGER_CRITICAL) {
    const legalEat = all.filter((a) => a.mode === 'eat');
    if (legalEat.length > 0) {
      return restrictTo(all, legalEat, [CONSTRAINT_CODES.survivalCriticalHungerEat], ['eat']);
    }
  }

  // L2 — hard identity boundaries.
  const activeCodes: string[] = [];
  const forbidden: ForbiddenAffordance[] = [];
  let list = all;

  if (ctx.npcId === 'jonas') {
    const violating = list.filter((a) => a.mode === 'eat-violation');
    if (violating.length > 0) {
      activeCodes.push(CONSTRAINT_CODES.jonasNoReservedFood);
      for (const a of violating) {
        forbidden.push({ affordanceId: a.id, reasonCodes: [CONSTRAINT_CODES.jonasNoReservedFood] });
      }
      list = list.filter((a) => a.mode !== 'eat-violation');
    }
  }
  if (ctx.npcId === 'rin') {
    const vulnerable =
      ctx.injury.severityMicro >= INJURY_NEEDS_TREATMENT_SEVERITY || ctx.hungerMicro >= HUNGER_HIGH;
    if (vulnerable) {
      const surrendering = list.filter((a) => a.mode === 'transfer' || a.mode === 'release');
      if (surrendering.length > 0) {
        activeCodes.push(CONSTRAINT_CODES.rinKeepsFoodWhileVulnerable);
        for (const a of surrendering) {
          forbidden.push({
            affordanceId: a.id,
            reasonCodes: [CONSTRAINT_CODES.rinKeepsFoodWhileVulnerable],
          });
        }
        list = list.filter((a) => a.mode !== 'transfer' && a.mode !== 'release');
      }
    }
  }
  if (ctx.npcId === 'mara') {
    const lethalTreat = list.filter(
      (a) =>
        a.mode === 'treat' &&
        a.targetNpcId !== null &&
        soleHelperEmergency(ctx.beliefs, a.targetNpcId),
    );
    if (lethalTreat.length > 0) {
      const evaluation = restrictTo(
        all,
        lethalTreat,
        [...activeCodes, CONSTRAINT_CODES.maraSoleHelper],
        ['treat'],
      );
      // Keep any L2 forbidden entries recorded above alongside the override.
      const restricted = new Set(evaluation.allowedAffordanceIds);
      evaluation.forbidden = all
        .filter((a) => !restricted.has(a.id))
        .map((a) => {
          const prior = forbidden.find((f) => f.affordanceId === a.id);
          const codes = prior ? [...prior.reasonCodes] : [];
          codes.push(CONSTRAINT_CODES.maraSoleHelper);
          return { affordanceId: a.id, reasonCodes: codes };
        });
      return evaluation;
    }
  }

  return {
    allowedAffordanceIds: list.map((a) => a.id),
    forbidden,
    mandatoryModes: null,
    activeConstraintCodes: activeCodes,
  };
}

/**
 * Mara is the sole capable helper — according to her current beliefs — when
 * the patient's injury is believed incapacitating and the only other
 * treatment-capable NPC (Jonas, in this slice) is the patient or is himself
 * believed incapacitated.
 */
export function soleHelperEmergency(beliefs: readonly BeliefState[], patientId: string): boolean {
  const patientInjury = beliefs.find((b) => b.subject === `injury:${patientId}`);
  if (!patientInjury || patientInjury.value !== 'incapacitating') return false;
  if (patientId === 'jonas') return true;
  const jonasInjury = beliefs.find((b) => b.subject === 'injury:jonas');
  return jonasInjury !== undefined && jonasInjury.value === 'incapacitating';
}

function restrictTo(
  all: readonly OfferedAffordance[],
  kept: readonly OfferedAffordance[],
  codes: string[],
  mandatoryModes: string[],
): ConstraintEvaluation {
  const keptIds = new Set(kept.map((a) => a.id));
  return {
    allowedAffordanceIds: kept.map((a) => a.id),
    forbidden: all
      .filter((a) => !keptIds.has(a.id))
      .map((a) => ({ affordanceId: a.id, reasonCodes: [...codes] })),
    mandatoryModes: [...mandatoryModes].sort(),
    activeConstraintCodes: [...codes],
  };
}

function allowAll(all: readonly OfferedAffordance[], codes: string[]): ConstraintEvaluation {
  return {
    allowedAffordanceIds: all.map((a) => a.id),
    forbidden: [],
    mandatoryModes: null,
    activeConstraintCodes: codes,
  };
}
