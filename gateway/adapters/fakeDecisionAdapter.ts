import {
  AdapterFailure,
  type AdapterInput,
  type AdapterResult,
  type ModelDecisionAdapter,
} from './modelDecisionAdapter';

/**
 * Deterministic fake adapter: the CI default (milestone 001, section 11).
 * Needs no network and no secret, and its choice is a pure function of the
 * offered IDs, so fake-gateway runs are reproducible end to end.
 *
 * Choice rule (documented, mechanical): prefer a continuation offer, then a
 * work-flavored mode, then wait, then the first offered ID. Behavior
 * overrides let tests exercise every failure path.
 */

export interface FakeAdapterOptions {
  behavior?: 'valid' | 'unoffered' | 'invalid-output' | 'refusal' | 'hang';
  delayMs?: number;
}

export class FakeDecisionAdapter implements ModelDecisionAdapter {
  readonly id = 'fake-decision-adapter-v1';

  constructor(private readonly options: FakeAdapterOptions = {}) {}

  async decide(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    const behavior = this.options.behavior ?? 'valid';
    if (behavior === 'hang') {
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new AdapterFailure('upstream-timeout', 'fake adapter aborted')),
          { once: true },
        );
      });
    }
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new AdapterFailure('upstream-timeout', 'fake adapter aborted'));
          },
          { once: true },
        );
      });
    }
    if (behavior === 'refusal') {
      throw new AdapterFailure(
        'upstream-refusal',
        'fake adapter scripted refusal',
        'scripted refusal: the fake model declines this request',
      );
    }

    const meta = {
      modelId: this.id,
      upstreamResponseId: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
    if (behavior === 'unoffered') {
      return {
        choice: {
          selectedAffordanceId: 'aff:fake:0:never-offered',
          reasonCode: 'routine',
          confidenceBp: 5_000,
          rationale: 'scripted unoffered selection',
        },
        meta,
      };
    }
    if (behavior === 'invalid-output') {
      const choice = { not: 'a-model-choice' };
      return { choice, meta, rawOutput: JSON.stringify(choice) };
    }

    const ids = input.offeredAffordanceIds;
    const chosen =
      ids.find((id) => id.includes(':continue')) ??
      ids.find((id) => id.includes(':work')) ??
      ids.find((id) => id.includes(':relieve')) ??
      ids.find((id) => id.includes(':routine-work')) ??
      ids.find((id) => id.includes(':wait')) ??
      ids[0];
    return {
      choice: {
        selectedAffordanceId: chosen,
        reasonCode: 'routine',
        confidenceBp: 5_000,
        rationale: 'deterministic fake-adapter choice',
      },
      meta,
    };
  }
}
