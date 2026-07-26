import { MEMORY_THEMES, type MemoryTheme, type NpcId } from '../../shared/ids';
import type { MemoryState } from '../domain/state';
import type { AffordanceScoreComponent } from '../events/types';
import { MEMORY_STACKING_CAP_FACTOR, MEMORY_THEME_WEIGHTS } from './weights';

/**
 * Generic memory-appraisal influence (remediation 6).
 *
 * This is the ONLY path from memories to decision scores. It never inspects
 * memory IDs or prose fields — it reads typed themes, the social target,
 * confidence, and importance. Effects are scaled by confidence x importance
 * with a single rounding point per memory contribution; target-specific
 * themes apply only when the decision's counterparty matches the memory's
 * socialTargetId; contributions sharing a component code are summed and then
 * clamped to +/- MEMORY_STACKING_CAP_FACTOR x base (documented bounded
 * combination rule). Memories are iterated in canonical append order.
 *
 * Effect kinds map to the decision situations the v1.0 provider scored:
 *  - 'work'                  work/relieve persistence (competence-threat +)
 *  - 'relieve-commitment-due' honoring a due commitment toward the
 *                             counterparty (reciprocity-debt +)
 *  - 'transfer'              giving a resource to the counterparty
 *                             (ownership-violation -, care-received +,
 *                              promise-broken -)
 *  - 'refuse-request'        refusing the counterparty's request
 *                             (ownership-violation +, care-received -,
 *                              promise-broken +)
 *  - 'ask-help'              seeking help (competence-threat -)
 *  - 'request-break'         admitting need for relief (competence-threat -)
 *  - 'rest'                  visibly resting (competence-threat -)
 */
export type MemoryEffectKind =
  | 'work'
  | 'relieve-commitment-due'
  | 'transfer'
  | 'refuse-request'
  | 'ask-help'
  | 'request-break'
  | 'rest';

interface ThemeEffect {
  base: number;
  sign: 1 | -1;
}

const W = MEMORY_THEME_WEIGHTS;

const EFFECTS: Record<MemoryEffectKind, Partial<Record<MemoryTheme, ThemeEffect>>> = {
  work: {
    'competence-threat': { base: W['competence-threat'].workBonus, sign: 1 },
  },
  'relieve-commitment-due': {
    'reciprocity-debt': { base: W['reciprocity-debt'].relieveBonus, sign: 1 },
  },
  transfer: {
    'ownership-violation': { base: W['ownership-violation'].transferPenalty, sign: -1 },
    'care-received': { base: W['care-received'].cooperationBonus, sign: 1 },
    'promise-broken': { base: W['promise-broken'].trustPenalty, sign: -1 },
  },
  'refuse-request': {
    'ownership-violation': { base: W['ownership-violation'].refuseBonus, sign: 1 },
    'care-received': { base: W['care-received'].cooperationBonus, sign: -1 },
    'promise-broken': { base: W['promise-broken'].trustPenalty, sign: 1 },
  },
  'ask-help': {
    'competence-threat': { base: W['competence-threat'].askHelpPenalty, sign: -1 },
  },
  'request-break': {
    'competence-threat': { base: W['competence-threat'].requestBreakPenalty, sign: -1 },
  },
  rest: {
    'competence-threat': { base: W['competence-threat'].restPenalty, sign: -1 },
  },
};

/** Themes whose effects apply only when the counterparty matches the memory target. */
const TARGET_SPECIFIC: ReadonlySet<MemoryTheme> = new Set([
  'reciprocity-debt',
  'ownership-violation',
  'care-received',
  'promise-broken',
]);

export function memoryInfluence(
  memories: readonly MemoryState[],
  effect: MemoryEffectKind,
  counterpartyId: NpcId | null,
): AffordanceScoreComponent[] {
  const effects = EFFECTS[effect];
  const sums = new Map<MemoryTheme, { value: number; cap: number }>();

  for (const memory of memories) {
    for (const theme of memory.themes) {
      const themeEffect = effects[theme];
      if (!themeEffect) continue;
      if (TARGET_SPECIFIC.has(theme)) {
        if (memory.socialTargetId === null || memory.socialTargetId !== counterpartyId) continue;
      }
      const scaled = Math.round(
        themeEffect.base *
          (memory.confidenceMicro / 1_000_000) *
          (memory.importanceMicro / 1_000_000),
      );
      const contribution = themeEffect.sign * scaled;
      const cap = MEMORY_STACKING_CAP_FACTOR * themeEffect.base;
      const entry = sums.get(theme) ?? { value: 0, cap };
      entry.value += contribution;
      sums.set(theme, entry);
    }
  }

  const components: AffordanceScoreComponent[] = [];
  for (const theme of MEMORY_THEMES) {
    const entry = sums.get(theme);
    if (!entry || entry.value === 0) continue;
    const clamped = Math.max(-entry.cap, Math.min(entry.cap, entry.value));
    components.push({ code: `memory:${theme}`, value: clamped });
  }
  return components;
}
