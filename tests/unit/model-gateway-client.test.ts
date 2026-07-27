import { describe, expect, it } from 'vitest';
import { ModelGatewayClient, type ModelGatewayStatus } from '../../src/app/modelGatewayClient';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import type {
  DecisionResponse,
  ExternalDecisionFailure,
  ExternalDecisionRequest,
} from '../../src/shared/decisionContracts';

/**
 * Adversarial-review regressions for the main-thread gateway client:
 * single-flight across the connect() window, queue back-pressure, per-run
 * budget, connect timeout mapping, the stale-runId discard on the NON-abort
 * path (a completed HTTP result from a superseded run must be dropped before
 * submission even when the transport ignored the abort), plus the re-audit
 * remediation seams: contract pinning with a per-run mismatch latch (F2),
 * result reconciliation before counters (F3), and the slim client trace (F4).
 */

const PROVIDER_CONFIG_SHAPE = {
  status: 'ok',
  experimentId: 'model-backed-npc-001',
  experimentVersion: '1.0.0',
  conditionId: 'mara-model-per-decision-v1',
  providerId: 'openai-mara-action-v1',
  promptVersion: 'mara-action-selection-1.0.0',
  requestSchemaVersion: 1,
  modelId: 'fake-adapter',
};
const PROVIDER_CONFIG = JSON.stringify(PROVIDER_CONFIG_SHAPE);

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
  /** Overrides the /v1/provider-config body (contract-mismatch cases). */
  configBody?: string;
  /** Per-request /v1/decision body override; undefined = default success. */
  decisionBodyFor?: (requestId: string, request: ExternalDecisionRequest) => string | undefined;
}

function makeClient(options: StubOptions & { timeoutMs?: number; maxCallsPerRun?: number }) {
  const responses: DecisionResponse[] = [];
  const failures: ExternalDecisionFailure[] = [];
  const statuses: ModelGatewayStatus[] = [];
  let concurrentPosts = 0;
  let maxConcurrentPosts = 0;
  let totalPosts = 0;
  let configFetches = 0;

  const fetchImpl: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      const signal = init?.signal ?? null;
      if (url.endsWith('/v1/provider-config')) {
        configFetches += 1;
        if (options.configHangs) {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          return;
        }
        setTimeout(
          () => resolve(jsonResponse(options.configBody ?? PROVIDER_CONFIG)),
          options.configDelayMs ?? 0,
        );
        return;
      }
      totalPosts += 1;
      concurrentPosts += 1;
      maxConcurrentPosts = Math.max(maxConcurrentPosts, concurrentPosts);
      const body = JSON.parse(String(init?.body)) as { request: { requestId: string } };
      const request = requestPool!.find((r) => r.request.requestId === body.request.requestId)!;
      const finish = (): void => {
        concurrentPosts -= 1;
        resolve(
          jsonResponse(
            options.decisionBodyFor?.(request.request.requestId, request) ??
              decisionResultFor(request),
          ),
        );
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
    onStatus: (status) => statuses.push(status),
  });
  return {
    client,
    responses,
    failures,
    posts: () => totalPosts,
    configFetches: () => configFetches,
    maxConcurrent: () => maxConcurrentPosts,
    lastStatus: () => statuses[statuses.length - 1],
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

describe('contract pinning and the tri-state connect (F2)', () => {
  const MISMATCH_CASES: [keyof typeof PROVIDER_CONFIG_SHAPE, string | number][] = [
    ['experimentId', 'some-other-experiment'],
    ['experimentVersion', '9.9.9'],
    ['conditionId', 'some-other-condition'],
    ['providerId', 'someone-else-v1'],
    ['promptVersion', 'mara-action-selection-9.9.9'],
    ['requestSchemaVersion', 99],
  ];

  for (const [field, wrongValue] of MISMATCH_CASES) {
    it(`a mismatched ${field} latches contract-mismatch: typed failures, no POST, no re-poll`, async () => {
      const harness = makeClient({
        configBody: JSON.stringify({ ...PROVIDER_CONFIG_SHAPE, [field]: wrongValue }),
      });
      const requests = genuineRequests(3);
      harness.client.newRun();
      expect(await harness.client.connect()).toBe('contract-mismatch');
      for (const request of requests) harness.client.handleDecisionRequest(request);
      await harness.client.settle();
      expect(harness.failures).toHaveLength(3);
      expect(harness.failures.every((f) => f.failureCode === 'invalid-gateway-response')).toBe(
        true,
      );
      // Never 'gateway-unavailable': the gateway answered, it is incompatible.
      expect(harness.posts()).toBe(0);
      // The latch prevents a per-request re-poll storm.
      expect(harness.configFetches()).toBe(1);
      expect(harness.lastStatus()?.contractMismatchField).toBe(field);
      expect(harness.lastStatus()?.connected).toBe(false);
    });
  }

  it('a compatible gateway yields connect() === ok', async () => {
    const harness = makeClient({});
    harness.client.newRun();
    expect(await harness.client.connect()).toBe('ok');
    expect(harness.lastStatus()?.contractMismatchField).toBeNull();
    expect(harness.lastStatus()?.connected).toBe(true);
  });

  it('newRun() releases the latch: the next run polls the config again', async () => {
    const harness = makeClient({
      configBody: JSON.stringify({ ...PROVIDER_CONFIG_SHAPE, providerId: 'someone-else-v1' }),
    });
    harness.client.newRun();
    expect(await harness.client.connect()).toBe('contract-mismatch');
    expect(await harness.client.connect()).toBe('contract-mismatch'); // latched: no re-poll
    expect(harness.configFetches()).toBe(1);
    harness.client.newRun();
    expect(await harness.client.connect()).toBe('contract-mismatch'); // re-polled once
    expect(harness.configFetches()).toBe(2);
  });

  it('an unreachable gateway stays gateway-unavailable and keeps the per-dispatch connect retry', async () => {
    const harness = makeClient({ configHangs: true, timeoutMs: 30 });
    const requests = genuineRequests(2);
    harness.client.newRun();
    expect(await harness.client.connect()).toBe('unreachable');
    for (const request of requests) {
      harness.client.handleDecisionRequest(request);
      await harness.client.settle(5_000);
    }
    expect(harness.failures).toHaveLength(2);
    expect(harness.failures.every((f) => f.failureCode === 'gateway-unavailable')).toBe(true);
    // No latch for unreachability: connect IS retried per dispatch.
    expect(harness.configFetches()).toBe(3);
  });
});

describe('result reconciliation before counters (F3)', () => {
  it('a schema-valid response answering a DIFFERENT requestId fails the original request', async () => {
    const harness = makeClient({
      decisionBodyFor: (_requestId, request) =>
        JSON.stringify({
          outcome: 'response',
          response: {
            responseId: 'gw-dec-9999',
            requestId: 'dec-9999', // not the dispatched request
            npcId: request.request.npcId,
            scenarioId: request.request.scenarioId,
            providerId: request.request.providerId,
            selectedAffordanceId: request.request.offeredAffordanceIds[0]!,
            confidenceBp: 5_000,
            reasonCode: 'routine',
            scores: [],
          },
          usage: { inputTokens: 7, outputTokens: 7, totalTokens: 14 },
        }),
    });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    await harness.client.connect();
    harness.client.handleDecisionRequest(request!);
    await harness.client.settle();
    expect(harness.responses).toHaveLength(0); // nothing forwarded to the worker
    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]!.requestId).toBe(request!.request.requestId); // the ORIGINAL
    expect(harness.failures[0]!.failureCode).toBe('invalid-gateway-response');
    // Counters were never incremented for the mismatched result.
    expect(harness.lastStatus()!.gatewayResponses).toBe(0);
    expect(harness.lastStatus()!.inputTokens).toBe(0);
    expect(harness.lastStatus()!.outputTokens).toBe(0);
  });

  it('a schema-valid response selecting an UNOFFERED affordance fails the original request', async () => {
    const harness = makeClient({
      decisionBodyFor: (requestId, request) =>
        JSON.stringify({
          outcome: 'response',
          response: {
            responseId: `gw-${requestId}`,
            requestId,
            npcId: request.request.npcId,
            scenarioId: request.request.scenarioId,
            providerId: request.request.providerId,
            selectedAffordanceId: 'affordance-never-offered',
            confidenceBp: 5_000,
            reasonCode: 'routine',
            scores: [],
          },
          usage: null,
        }),
    });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    await harness.client.connect();
    harness.client.handleDecisionRequest(request!);
    await harness.client.settle();
    expect(harness.responses).toHaveLength(0);
    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]!.requestId).toBe(request!.request.requestId);
    expect(harness.failures[0]!.failureCode).toBe('invalid-gateway-response');
    expect(harness.lastStatus()!.gatewayResponses).toBe(0);
  });

  it('a schema-valid FAILURE with mismatched identity is reconciled too, never passed through', async () => {
    const harness = makeClient({
      decisionBodyFor: (requestId, request) =>
        JSON.stringify({
          outcome: 'failure',
          failure: {
            failureId: `gwf-${requestId}`,
            requestId,
            npcId: 'jonas', // wrong NPC — a mislabeled failure identity
            scenarioId: request.request.scenarioId,
            providerId: request.request.providerId,
            failureCode: 'upstream-error',
            retryable: false,
          },
        }),
    });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    await harness.client.connect();
    harness.client.handleDecisionRequest(request!);
    await harness.client.settle();
    expect(harness.responses).toHaveLength(0);
    expect(harness.failures).toHaveLength(1);
    // The typed failure carries the ORIGINAL identity, not the gateway's.
    expect(harness.failures[0]!.failureId).toBe(`cf-${request!.request.requestId}`);
    expect(harness.failures[0]!.npcId).toBe('mara');
    expect(harness.failures[0]!.failureCode).toBe('invalid-gateway-response');
    expect(harness.lastStatus()!.failuresByCode['upstream-error']).toBeUndefined();
  });
});

describe('slim client trace (F4)', () => {
  it('records one entry per request across a mixed run and clears on newRun()', async () => {
    const requests = genuineRequests(7);
    const staleRequest = requests[0]!;
    const phaseTwo = requests.slice(1); // 6 requests: 1 dispatching + 4 queued + 1 overflow
    const failTarget = phaseTwo[1]!.request.requestId;
    const harness = makeClient({
      decisionDelayMs: 30,
      ignoreAbort: true,
      decisionBodyFor: (requestId, request) =>
        requestId === failTarget
          ? JSON.stringify({
              outcome: 'failure',
              failure: {
                failureId: `gwf-${requestId}`,
                requestId,
                npcId: request.request.npcId,
                scenarioId: request.request.scenarioId,
                providerId: request.request.providerId,
                failureCode: 'upstream-error',
                retryable: false,
              },
            })
          : undefined,
    });

    // Phase 1: dispatch one request, then start a new run while the POST is
    // still in flight — its late result must trace as discarded-stale-run.
    harness.client.newRun();
    const staleRunId = harness.client.currentRunId;
    await harness.client.connect();
    harness.client.handleDecisionRequest(staleRequest);
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.client.newRun(); // resets the trace; the discard entry arrives later
    await new Promise((resolve) => setTimeout(resolve, 80)); // let the stale result land
    await harness.client.connect();

    // Phase 2: a response, a gateway failure, three more responses, and one
    // queue overflow, all in the current run.
    for (const request of phaseTwo) harness.client.handleDecisionRequest(request);
    await harness.client.settle();

    const entries = harness.client.clientTraceEntries();
    expect(entries).toHaveLength(7);
    const byRequestId = new Map(entries.map((e) => [e.requestId, e]));

    const stale = byRequestId.get(staleRequest.request.requestId)!;
    expect(stale.clientOutcome).toBe('discarded-stale-run');
    expect(stale.runId).toBe(staleRunId); // keyed to the run it belonged to
    expect(stale.dispatchedAtUtc).not.toBeNull();
    expect(stale.responseId).toBeNull();
    expect(stale.failureId).toBeNull();

    const failed = byRequestId.get(failTarget)!;
    expect(failed.clientOutcome).toBe('failure');
    expect(failed.clientFailureCode).toBe('upstream-error');
    expect(failed.failureId).toBe(`gwf-${failTarget}`);

    const overflow = byRequestId.get(phaseTwo[5]!.request.requestId)!;
    expect(overflow.clientOutcome).toBe('failure');
    expect(overflow.clientFailureCode).toBe('budget-exhausted');
    expect(overflow.dispatchedAtUtc).toBeNull(); // never dispatched
    expect(overflow.clientLatencyMs).toBeNull();

    for (const request of [phaseTwo[0]!, phaseTwo[2]!, phaseTwo[3]!, phaseTwo[4]!]) {
      const entry = byRequestId.get(request.request.requestId)!;
      expect(entry.clientOutcome).toBe('response');
      expect(entry.responseId).toBe(`gw-${request.request.requestId}`);
      expect(entry.dispatchedAtUtc).not.toBeNull();
      expect(entry.completedAtUtc).not.toBeNull();
      expect(entry.clientLatencyMs).toBeGreaterThanOrEqual(0);
      expect(entry.runId).toBe(harness.client.currentRunId);
      expect(entry.conditionId).toBe('mara-model-per-decision-v1');
      expect(entry.promptVersionExpected).toBe('mara-action-selection-1.0.0');
      expect(entry.contextHash).toBe(request.contextHash);
    }

    harness.client.newRun();
    expect(harness.client.clientTraceEntries()).toHaveLength(0);
  });

  it('contract-mismatch fast-fails are traced without a dispatch', async () => {
    const harness = makeClient({
      configBody: JSON.stringify({ ...PROVIDER_CONFIG_SHAPE, promptVersion: 'other-2.0.0' }),
    });
    const [request] = genuineRequests(1);
    harness.client.newRun();
    await harness.client.connect();
    harness.client.handleDecisionRequest(request!);
    await harness.client.settle();
    const entries = harness.client.clientTraceEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.clientOutcome).toBe('failure');
    expect(entries[0]!.clientFailureCode).toBe('invalid-gateway-response');
    expect(entries[0]!.dispatchedAtUtc).toBeNull();
  });
});
