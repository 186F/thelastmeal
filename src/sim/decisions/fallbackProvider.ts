import { evaluateConstraints } from './constraints';
import type { DecisionContext, DecisionProvider, DecisionResult } from './provider';

/**
 * Deterministic fallback policy, always available (brief sections 13/14;
 * remediation 2).
 *
 * The fallback routes through the same provider-independent constraint layer
 * as every other decision source, so fallback choices are guaranteed legal:
 * survival overrides (care-seeking, survival eating) restrict its choices
 * exactly as they restrict the primary provider's.
 *
 * Rule, applied within the constraint-allowed set: continue the current
 * action when a continue affordance is allowed; otherwise wait; otherwise
 * take the lexicographically first allowed affordance. The allowed set is
 * never empty for a non-empty offer (constraint safety fall-through plus the
 * engine's unconditional `wait` affordance), so the fallback always answers.
 */
/** Engine-owned fallback identity, shared with provider binding at the gate
 * and with the import validator's fallback carve-out (re-audit findings 1/2). */
export const FALLBACK_PROVIDER_ID = 'fallback-continue-or-wait-v2';

export class FallbackProvider implements DecisionProvider {
  readonly id = FALLBACK_PROVIDER_ID;

  decide(ctx: DecisionContext): DecisionResult {
    const evaluation = evaluateConstraints(ctx, ctx.affordances);
    const allowedIds = new Set(evaluation.allowedAffordanceIds);
    const allowed = ctx.affordances.filter((a) => allowedIds.has(a.id));
    if (allowed.length === 0) {
      throw new Error('fallback-no-affordances');
    }
    const continueAff = allowed.find((a) => a.continuesActionId !== null);
    if (continueAff) {
      return result(continueAff.id, 'fallback-continue');
    }
    const wait = allowed.find((a) => a.mode === 'wait');
    if (wait) {
      return result(wait.id, 'fallback-wait');
    }
    const sorted = [...allowed].sort((a, b) => (a.id < b.id ? -1 : 1));
    return result(sorted[0]!.id, 'fallback-first-legal');
  }
}

function result(affordanceId: string, reasonCode: string): DecisionResult {
  return { affordanceId, confidenceBp: 1_000, reasonCode, scores: [] };
}
