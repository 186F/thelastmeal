import {
  ProviderFailureError,
  type DecisionContext,
  type DecisionProvider,
  type DecisionResult,
} from './provider';

/**
 * Wraps a provider with a deterministic scripted failure mode (scenario F):
 * from `failFromTick` onward every decision call throws, simulating future
 * model unavailability without any model. The engine records
 * DecisionProviderFailed + FallbackDecisionUsed and continues.
 */
export class ScriptedFailureProvider implements DecisionProvider {
  readonly id: string;

  constructor(
    private readonly inner: DecisionProvider,
    private readonly failFromTick: number,
  ) {
    this.id = inner.id;
  }

  decide(ctx: DecisionContext): DecisionResult {
    if (ctx.tick >= this.failFromTick) {
      throw new ProviderFailureError('scripted-failure-mode');
    }
    return this.inner.decide(ctx);
  }
}
