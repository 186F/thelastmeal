import type { DecisionResponse } from '../../shared/decisionContracts';
import type {
  DecisionContext,
  DecisionProvider,
  ProviderDecision,
  ScheduledResponseSource,
} from './provider';

/**
 * Recorded-response fixture provider (milestone 001, section 22): replays
 * saved model choices and logical delays with NO network, proving that a
 * recorded external request/response exchange reproduces the exact same
 * canonical event stream and hashes. Deterministic by construction — the
 * fixture script is a pure function of the request ordinal and context.
 */

export interface FixtureChoice {
  /** Logical ticks until the response is due (>= 1). */
  delayTicks: number;
  /** Explicit recorded affordance ID, or a pure selector over the offer. */
  select: string | ((ctx: DecisionContext) => string);
  confidenceBp: number;
  reasonCode: string;
}

export type FixtureScript = (requestOrdinal: number, ctx: DecisionContext) => FixtureChoice | null;

interface QueuedResponse {
  dueTick: number;
  order: number;
  response: DecisionResponse;
}

export class FixtureResponseProvider implements DecisionProvider, ScheduledResponseSource {
  private ordinal = 0;
  private insertions = 0;
  private readonly queue: QueuedResponse[] = [];

  constructor(
    readonly id: string,
    private readonly script: FixtureScript,
  ) {}

  decide(ctx: DecisionContext): ProviderDecision {
    this.ordinal += 1;
    const choice = this.script(this.ordinal, ctx);
    if (choice === null) {
      return { deferred: true };
    }
    const selected = typeof choice.select === 'function' ? choice.select(ctx) : choice.select;
    this.insertions += 1;
    this.queue.push({
      dueTick: ctx.tick + Math.max(1, choice.delayTicks),
      order: this.insertions,
      response: {
        responseId: `gw-${ctx.requestId}`,
        requestId: ctx.requestId,
        npcId: ctx.npcId,
        scenarioId: ctx.scenarioId,
        providerId: this.id,
        selectedAffordanceId: selected,
        confidenceBp: choice.confidenceBp,
        reasonCode: choice.reasonCode,
        scores: [],
      },
    });
    return { deferred: true };
  }

  dueResponses(tick: number): DecisionResponse[] {
    const due: QueuedResponse[] = [];
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]!.dueTick <= tick) {
        due.push(...this.queue.splice(i, 1));
      }
    }
    due.sort((a, b) => a.dueTick - b.dueTick || a.order - b.order);
    return due.map((q) => q.response);
  }
}

/** The fake gateway adapter's documented deterministic choice rule, mirrored
 * for fixtures so a sim-only fixture run can reproduce a fake-gateway run.
 * A drift test pins the two implementations together. */
export function fakeAdapterChoiceRule(ctx: DecisionContext): string {
  const ids = ctx.affordances.map((a) => a.id);
  return (
    ids.find((id) => id.includes(':continue')) ??
    ids.find((id) => id.includes(':work')) ??
    ids.find((id) => id.includes(':relieve')) ??
    ids.find((id) => id.includes(':routine-work')) ??
    ids.find((id) => id.includes(':wait')) ??
    ids[0]!
  );
}
