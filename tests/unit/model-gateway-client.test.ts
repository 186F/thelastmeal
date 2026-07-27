import { describe, expect, it } from 'vitest';
import { ModelGatewayClient } from '../../src/app/modelGatewayClient';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import type {
  DecisionResponse,
  ExternalDecisionFailure,
  ExternalDecisionRequest,
} from '../../src/shared/decisionContracts';

/**
 * Adversarial-review regressions for the main-thread gateway client:
 * single-flight across the connect() window, queue back-pressure, per-run
 * budget, connect timeout mapping, and the stale-runId discard on the
 * NON-abort path (a completed HTTP result from a superseded run must be
 * dropped before submission even when the transport ignored the abort).
 */

const PROVIDER_CONFIG = JSON.stringify({
  status: 'ok',
  providerId: 'openai-mara-action-v1',
  promptVersion: 'mara-action-selection-1.0.0',
  modelId: 'fake-adapter',
  experimentVersion: '1.0.0',
  requestSchemaVersion: 1,
});

let requestPool: ExternalDecisionRequest[] | null = null;
function genuineRequests(count: number): ExternalDecisionRequest[] {
  if (!requestPool || requestPool.length < count) {
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    while (run.externalRequests.length < count && run.state.tick < 2_000) stepTick(run);
    requestPool = [...run.externalRequests];
  }
  expect(requestPool.length).toBeGreaterThanOrEqual(count);
  return requestPool.slice(0, count);
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function decisionResultFor(request: ExternalDecisionRequest): string {
  return JSON.stringify({
    outcome: 'response',
    response: {
      responseId: `gw-${request.request.requestId}`,
      requestId: request.request.requestId,
      npcId: request.request.npcId,
      scenarioId: request.request.scenarioId,
      providerId: request.request.providerId,
      selectedAffordanceId: request.request.offeredAffordanceIds[0]!,
      confidenceBp: 5_000,
      reasonCode: 'routine',
      scores: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
}

interface StubOptions {
  configDelayMs?: number;
  decisionDelayMs?: number;
  configHangs?: boolean;
  ignoreAbort?: boolean;
}

function makeClient(options: StubOptions & { timeoutMs?: number; maxCallsPerRun?: number }) {
  const responses: DecisionResponse[] = [];
  const failures: ExternalDecisionFailure[] = [];
  let concurrentPosts = 0;
  let maxConcurrentPosts = 0;
  let totalPosts = 0;

  const fetchImpl: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      const signal = init?.signal ?? null;
      if (url.endsWith('/v1/provider-config')) {
        if (options.configHangs) {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          return;
        }
        setTimeout(() => resolve(jsonResponse(PROVIDER_CONFIG)), options.configDelayMs ?? 0);
        return;
      }
      totalPosts += 1;
      concurrentPosts += 1;
      maxConcurrentPosts = Math.max(maxConcurrentPosts, concurrentPosts);
      const body = JSON.parse(String(init?.body)) as { request: { requestId: string } };
      const request = requestPool!.find((r) => r.request.requestId === body.request.requestId)!;
      const finish = (): void => {
        concurrentPosts -= 1;
        resolve(jsonResponse(decisionResultFor(request)));
      };
      if (!options.ignoreAbort) {
        signal?.addEventListener(
          'abort',
          () => {
            concurrentPosts -= 1;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }
      setTimeout(finish, options.decisionDelayMs ?? 0);
    });

  let runCounter = 0;
  const client = new ModelGatewayClient({
    baseUrl: 'http://gateway.test',
    timeoutMs: options.timeoutMs ?? 100,
    maxCallsPerRun: options.maxCallsPerRun ?? 80,
    fetchImpl,
    makeRunId: () => `run-unit-${String((runCounter += 1)).padStart(4, '0')}`,
    submitResponse: (response) => responses.push(response),
    submitFailure: (failure) => failures.push(failure),
  });
  return {
    client,
    responses,
    failures,
    posts: () => totalPosts,
    maxConcurrent: () => maxConcurrentPosts,
  };
}

describe('ModelGatewayClient (adversarial-review regressions)', () => {
  it('holds single-flight even when requests arrive during the connect() window', async () => {
    const harness = makeClient({ configDelayMs: 30, decisionDelayMs: 10 });
    const requests = genuineRequests(3);
    harness.client.newRun();
    for (const request of requests) harness.client.handleDecisionRequest(request);
    await harness.client.settle();
    expect(harness.maxConcurrent()).toBe(1);
    expect(harness.posts()).toBe(3);
    expect(harness.responses).toHaveLength(3);
  });

  it('enforces the queue cap with typed budget-exhausted failures', async () => {
    const harness = makeClient({ configDelayMs: 50, decisionDelayMs: 20 });
    const requests = genuineRequests(6);
    harness.client.newRun();
    for (const request of requests) harness.client.handleDecisionRequest(request);
    await harness.client.settle();
    // One dispatching + four queued; the sixth overflows.
    expect(harness.failures.filter((f) => f.failureCode === 'budget-exhausted')).toHaveLength(1);
    expect(harness.responses).toHaveLength(5);
  });

  it('enforces the per-run call budget', async () => {
    const harness = makeClient({ decisionDelayMs: 1, maxCallsPerRun: 2 });
    const requests = genuineRequests(3);
    harness.client.newRun();
    await harness.client.connect();
    for (const request of requests) {
      harness.client.handleDecisionRequest(request);
      await harness.client.settle();
    }
    expect(harness.posts()).toBe(2);
    expect(harness.failures.filter((f) => f.failureCode === 'budget-exhausted')).toHaveLength(1);
  });

  it('maps a hanging gateway to typed gateway-unavailable failures (bounded connect)', async () => {
    const harness = makeClient({ configHangs: true, timeoutMs: 40 });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    harness.client.handleDecisionRequest(request!);
    await harness.client.settle(5_000);
    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]!.failureCode).toBe('gateway-unavailable');
  });

  it('discards a COMPLETED result from a superseded run even when the transport ignored the abort', async () => {
    const harness = makeClient({ decisionDelayMs: 60, ignoreAbort: true });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    await harness.client.connect();
    harness.client.handleDecisionRequest(request!);
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.client.newRun(); // supersede while the POST is still pending
    await new Promise((resolve) => setTimeout(resolve, 120));
    await harness.client.settle();
    expect(harness.posts()).toBe(1);
    expect(harness.responses).toHaveLength(0);
    expect(harness.failures).toHaveLength(0);
  });
});
