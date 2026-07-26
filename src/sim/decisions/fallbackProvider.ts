import type { DecisionContext, DecisionProvider, DecisionResult } from './provider';

/**
 * Deterministic fallback policy, always available (brief sections 13/14).
 *
 * Rule: continue the current action when a continue affordance is offered;
 * otherwise wait; otherwise take the lexicographically first offered
 * affordance. Minimal, legal, and fully predictable — it keeps the
 * simulation moving when the active provider fails.
 */
export class FallbackProvider implements DecisionProvider {
  readonly id = 'fallback-continue-or-wait-v1';

  decide(ctx: DecisionContext): DecisionResult {
    const continueAff = ctx.affordances.find((a) => a.continuesActionId !== null);
    if (continueAff) {
      return result(continueAff.id, 'fallback-continue');
    }
    const wait = ctx.affordances.find((a) => a.mode === 'wait');
    if (wait) {
      return result(wait.id, 'fallback-wait');
    }
    const sorted = [...ctx.affordances].sort((a, b) => (a.id < b.id ? -1 : 1));
    const first = sorted[0];
    if (!first) throw new Error('fallback-no-affordances');
    return result(first.id, 'fallback-first-legal');
  }
}

function result(affordanceId: string, reasonCode: string): DecisionResult {
  return { affordanceId, confidenceBp: 1_000, reasonCode, scores: [] };
}
