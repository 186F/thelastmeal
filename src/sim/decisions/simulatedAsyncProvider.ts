import type { DecisionResponse } from '../../shared/decisionContracts';
import type {
  DecisionContext,
  DecisionProvider,
  DecisionResult,
  ProviderDecision,
  ScheduledResponseSource,
} from './provider';

/**
 * Simulated asynchronous decision provider (remediation 1, section 5.10).
 *
 * A deterministic test harness that schedules decision responses by LOGICAL
 * tick — never setTimeout, Date.now, or real latency. On each decision
 * request it consults a scripted behavior (keyed by request ordinal), computes
 * the would-be choice with an inner synchronous provider, and enqueues the
 * response(s) for later ticks. The engine drains due responses at the fixed
 * response-drain point inside stepTick and routes them through the same
 * acceptance gate as every other response.
 *
 * Supported behaviors: respond after N ticks, never respond, duplicate the
 * same response, send additional distinct responses (out-of-order arrival),
 * and select an arbitrary (possibly unoffered) affordance ID.
 */

export interface SimulatedAsyncBehavior {
  /** Ticks until the response is due; null = never respond (timeout path). */
  delayTicks: number | null;
  /** Respond with this affordance ID instead of the inner provider's choice
   * (use to exercise the unoffered-affordance rejection). */
  overrideAffordanceId?: string;
  /** Re-deliver the SAME response (same responseId) at these extra delays. */
  repeatAtDelays?: number[];
  /** Deliver an additional DISTINCT response at this delay. */
  extraResponse?: { delayTicks: number; overrideAffordanceId?: string };
}

export type SimulatedAsyncScript = (
  requestOrdinal: number,
  ctx: DecisionContext,
) => SimulatedAsyncBehavior;

interface QueuedResponse {
  dueTick: number;
  order: number;
  response: DecisionResponse;
}

export class SimulatedAsyncProvider implements DecisionProvider, ScheduledResponseSource {
  readonly id = 'simulated-async-v1';
  private ordinal = 0;
  private insertions = 0;
  private readonly queue: QueuedResponse[] = [];

  constructor(
    private readonly inner: DecisionProvider,
    private readonly script: SimulatedAsyncScript,
  ) {}

  decide(ctx: DecisionContext): ProviderDecision {
    this.ordinal += 1;
    const behavior = this.script(this.ordinal, ctx);
    if (behavior.delayTicks === null) {
      return { deferred: true };
    }

    const innerDecision = this.inner.decide(ctx);
    if ('deferred' in innerDecision) {
      throw new Error('simulated-async-inner-provider-deferred');
    }
    const chosen = behavior.overrideAffordanceId ?? innerDecision.affordanceId;
    if (behavior.delayTicks === 0 && !behavior.repeatAtDelays && !behavior.extraResponse) {
      // Same-tick synchronous response through the normal return path.
      return { ...innerDecision, affordanceId: chosen } satisfies DecisionResult;
    }

    const base = this.buildResponse(ctx, this.ordinal, 1, chosen, innerDecision);
    this.enqueue(ctx.tick + behavior.delayTicks, base);
    for (const extraDelay of behavior.repeatAtDelays ?? []) {
      this.enqueue(ctx.tick + extraDelay, base);
    }
    if (behavior.extraResponse) {
      const extraChosen = behavior.extraResponse.overrideAffordanceId ?? chosen;
      const extra = this.buildResponse(ctx, this.ordinal, 2, extraChosen, innerDecision);
      this.enqueue(ctx.tick + behavior.extraResponse.delayTicks, extra);
    }
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

  private buildResponse(
    ctx: DecisionContext,
    ordinal: number,
    variant: number,
    selectedAffordanceId: string,
    innerDecision: DecisionResult,
  ): DecisionResponse {
    return {
      responseId: `res-${String(ordinal).padStart(4, '0')}-${variant}`,
      requestId: ctx.requestId,
      npcId: ctx.npcId,
      scenarioId: ctx.scenarioId,
      providerId: this.id,
      selectedAffordanceId,
      confidenceBp: innerDecision.confidenceBp,
      reasonCode: innerDecision.reasonCode,
      scores: [],
    };
  }

  private enqueue(dueTick: number, response: DecisionResponse): void {
    this.insertions += 1;
    this.queue.push({ dueTick, order: this.insertions, response });
  }
}
