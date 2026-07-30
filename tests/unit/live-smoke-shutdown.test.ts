import { describe, expect, it } from 'vitest';
import { runSmokeOnce, type SmokeGateway } from '../../scripts/model/liveSmoke';
import { gatewayDecisionResultSchema } from '../../src/sim/decisions/externalSchemas';

/**
 * liveSmoke shutdown contract (M2 brief §27.8, per the Advisor's R9 ruling):
 * `gateway.stop()` must complete on every smoke path — success,
 * schema-invalid gateway response, typed upstream failure, and fetch or
 * transport exception. Nothing may call `process.exit` before cleanup.
 */

class FakeGateway implements SmokeGateway {
  started = false;
  stopCalled = false;
  stopCompleted = false;

  async start(): Promise<number> {
    this.started = true;
    return 65_000;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
    // Yield the event loop so an unwaited stop() would be observable.
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.stopCompleted = true;
  }
}

const VALID_RESPONSE_RESULT = {
  outcome: 'response',
  response: {
    responseId: 'ext-1',
    requestId: 'dec-0001',
    npcId: 'mara',
    scenarioId: 'A',
    providerId: 'openrouter-mara-action-v1',
    selectedAffordanceId: 'aff:mara:60:continue:work',
    confidenceBp: 9_500,
    reasonCode: 'goal',
    scores: [
      { affordanceId: 'aff:mara:60:continue:work', mode: 'work', totalScore: 12, components: [] },
    ],
  },
  usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
};

const VALID_FAILURE_RESULT = {
  outcome: 'failure',
  failure: {
    failureId: 'gwf-dec-0001',
    requestId: 'dec-0001',
    npcId: 'mara',
    scenarioId: 'A',
    providerId: 'openrouter-mara-action-v1',
    failureCode: 'upstream-error',
    retryable: false,
  },
};

function fetchReturning(body: unknown): typeof fetch {
  return (async () => ({ json: async () => body }) as Response) as typeof fetch;
}

const silent = { log: () => undefined, errorLog: () => undefined };

describe('runSmokeOnce shutdown contract', () => {
  it('fixtures are genuinely schema-valid / schema-invalid', () => {
    expect(gatewayDecisionResultSchema.safeParse(VALID_RESPONSE_RESULT).success).toBe(true);
    expect(gatewayDecisionResultSchema.safeParse(VALID_FAILURE_RESULT).success).toBe(true);
    expect(gatewayDecisionResultSchema.safeParse({}).success).toBe(false);
  });

  it('completes gateway.stop() after a successful smoke response (exit 0)', async () => {
    const gateway = new FakeGateway();
    const code = await runSmokeOnce({
      gateway,
      envelope: {},
      fetchFn: fetchReturning(VALID_RESPONSE_RESULT),
      ...silent,
    });
    expect(code).toBe(0);
    expect(gateway.stopCompleted).toBe(true);
  });

  it('completes gateway.stop() after a schema-invalid gateway response (exit 1)', async () => {
    const gateway = new FakeGateway();
    const code = await runSmokeOnce({
      gateway,
      envelope: {},
      fetchFn: fetchReturning({ nonsense: true }),
      ...silent,
    });
    expect(code).toBe(1);
    expect(gateway.stopCompleted).toBe(true);
  });

  it('completes gateway.stop() after a typed upstream failure (exit 1)', async () => {
    const gateway = new FakeGateway();
    const code = await runSmokeOnce({
      gateway,
      envelope: {},
      fetchFn: fetchReturning(VALID_FAILURE_RESULT),
      ...silent,
    });
    expect(code).toBe(1);
    expect(gateway.stopCompleted).toBe(true);
  });

  it('completes gateway.stop() when fetch throws, then rethrows to the caller', async () => {
    const gateway = new FakeGateway();
    const transportError = new Error('ECONNREFUSED');
    const throwingFetch = (async () => {
      throw transportError;
    }) as typeof fetch;
    await expect(
      runSmokeOnce({ gateway, envelope: {}, fetchFn: throwingFetch, ...silent }),
    ).rejects.toThrow('ECONNREFUSED');
    expect(gateway.stopCompleted).toBe(true);
  });
});
