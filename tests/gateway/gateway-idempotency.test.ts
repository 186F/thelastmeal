import { beforeAll, describe, expect, it } from 'vitest';
import type { GatewayConfig } from '../../gateway/config';
import { createGateway, type GatewayInstance } from '../../gateway/server';
import { FakeDecisionAdapter } from '../../gateway/adapters/fakeDecisionAdapter';
import type {
  AdapterInput,
  AdapterResult,
  ModelDecisionAdapter,
} from '../../gateway/adapters/modelDecisionAdapter';
import { PROMPT_VERSION } from '../../gateway/prompts/maraActionSelection';
import { MemoryTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  gatewayDecisionResultSchema,
} from '../../src/sim/decisions/externalSchemas';
import {
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../src/shared/modelExperiment';
import { externalContextHash } from '../../src/sim/decisions/externalContext';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { ExternalDecisionRequestEnvelope } from '../../gateway/schemas';

/**
 * Reduced idempotency (re-audit remediation G3): a repeat POST of an
 * already-seen runId+requestId with the SAME contextHash replays the first
 * terminal result — one adapter call, one budget unit, one trace row, one
 * envelope sidecar, `x-idempotent-replay: true` on the replay. The SAME
 * requestId with a DIFFERENT contextHash is a 400 idempotency-conflict.
 * Results ride inside the per-run budget state, so the 64-run FIFO evicts
 * budget and idempotency together (best-effort: an evicted run forgets).
 */

function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    adapterKind: 'fake',
    port: 0,
    requestTimeoutMs: 2_000,
    maxConcurrency: 1,
    maxCallsPerRun: 80,
    traceDir: 'unused',
    allowedBrowserOrigin: 'http://localhost:5173',
    openaiApiKey: null,
    openaiModel: null,
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    maxTotalCalls: 400,
    ...overrides,
  };
}

/** Counts upstream invocations: replay tests must prove the adapter was hit
 * exactly once, never that a cache silently faked the second answer. */
class CountingAdapter implements ModelDecisionAdapter {
  readonly id: string;
  calls = 0;

  constructor(private readonly inner: ModelDecisionAdapter) {
    this.id = inner.id;
  }

  decide(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    this.calls += 1;
    return this.inner.decide(input, signal);
  }
}

let genuine: ExternalDecisionRequest;

function envelope(
  overrides: Partial<ExternalDecisionRequestEnvelope> = {},
): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId: 'run-idem-0001',
    providerId: genuine.request.providerId,
    promptVersion: PROMPT_VERSION,
    contextHash: genuine.contextHash,
    request: JSON.parse(JSON.stringify(genuine.request)) as unknown,
    context: JSON.parse(JSON.stringify(genuine.context)) as unknown,
    truncationCounts: { ...genuine.truncationCounts },
    ...overrides,
  };
}

function envelopeWithRequestId(
  requestId: string,
  overrides: Partial<ExternalDecisionRequestEnvelope> = {},
): Record<string, unknown> {
  const body = envelope(overrides);
  (body.request as { requestId: string }).requestId = requestId;
  return body;
}

async function post(port: number, body: unknown) {
  return fetch(`http://127.0.0.1:${port}/v1/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function withGateway<T>(
  adapter: ModelDecisionAdapter,
  overrides: Partial<GatewayConfig>,
  body: (port: number, trace: MemoryTraceWriter) => Promise<T>,
): Promise<T> {
  const trace = new MemoryTraceWriter();
  const gateway: GatewayInstance = createGateway(testConfig(overrides), adapter, trace);
  const port = await gateway.start();
  try {
    return await body(port, trace);
  } finally {
    await gateway.stop();
  }
}

beforeAll(() => {
  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  genuine = run.externalRequests[0]!;
});

describe('gateway reduced idempotency (G3)', () => {
  it('a sequential duplicate replays the first terminal result: one adapter call, one trace row, one budget unit', async () => {
    const adapter = new CountingAdapter(new FakeDecisionAdapter());
    await withGateway(adapter, { maxCallsPerRun: 2 }, async (port, trace) => {
      const body = envelopeWithRequestId('dec-9001');
      const first = await post(port, body);
      expect(first.status).toBe(200);
      expect(first.headers.get('x-idempotent-replay')).toBeNull();
      const firstResult = (await first.json()) as unknown;
      expect(gatewayDecisionResultSchema.parse(firstResult).outcome).toBe('response');

      const second = await post(port, body);
      expect(second.status).toBe(200);
      expect(second.headers.get('x-idempotent-replay')).toBe('true');
      expect((await second.json()) as unknown).toEqual(firstResult);

      // No second adapter call, no second trace row, no second sidecar.
      expect(adapter.calls).toBe(1);
      expect(trace.entries).toHaveLength(1);
      expect(trace.requests.size).toBe(1);

      // The replay consumed no budget unit: with maxCallsPerRun 2 a second
      // DISTINCT request still succeeds, and only a third is exhausted.
      const distinct = gatewayDecisionResultSchema.parse(
        await (await post(port, envelopeWithRequestId('dec-9002'))).json(),
      );
      expect(distinct.outcome).toBe('response');
      const exhausted = gatewayDecisionResultSchema.parse(
        await (await post(port, envelopeWithRequestId('dec-9003'))).json(),
      );
      expect(exhausted.outcome === 'failure' && exhausted.failure.failureCode).toBe(
        'budget-exhausted',
      );
    });
  });

  it('a concurrent duplicate shares the in-flight dispatch (no budget-exhausted row, identical bodies)', async () => {
    const adapter = new CountingAdapter(new FakeDecisionAdapter({ delayMs: 200 }));
    await withGateway(adapter, { maxConcurrency: 1 }, async (port, trace) => {
      const body = envelopeWithRequestId('dec-9010');
      const [a, b] = await Promise.all([
        post(port, body),
        new Promise((resolve) => setTimeout(resolve, 20)).then(() => post(port, body)),
      ]);
      const bodyA = (await a.json()) as unknown;
      const bodyB = (await b.json()) as unknown;
      expect(gatewayDecisionResultSchema.parse(bodyA).outcome).toBe('response');
      expect(bodyB).toEqual(bodyA);
      // Exactly one of the two was the replay; before G3 the in-flight
      // duplicate got a spurious budget-exhausted failure row instead.
      const replays = [a, b].filter((r) => r.headers.get('x-idempotent-replay') === 'true');
      expect(replays).toHaveLength(1);
      expect(adapter.calls).toBe(1);
      expect(trace.entries).toHaveLength(1);
      expect(trace.entries[0]!.gatewayOutcome).toBe('response');
      expect(trace.requests.size).toBe(1);
    });
  });

  it('the same requestId with a DIFFERENT contextHash is a 400 idempotency-conflict, never a replay or re-dispatch', async () => {
    const adapter = new CountingAdapter(new FakeDecisionAdapter());
    await withGateway(adapter, {}, async (port, trace) => {
      const first = await post(port, envelopeWithRequestId('dec-9020'));
      expect(first.status).toBe(200);

      // Same requestId, legitimately resealed DIFFERENT context: a forgery
      // or client bug, not a duplicate.
      const forged = envelopeWithRequestId('dec-9020');
      (forged.context as { state: { hungerMicro: number } }).state.hungerMicro += 1;
      forged.contextHash = externalContextHash(
        forged.context as never as Parameters<typeof externalContextHash>[0],
      );
      const conflict = await post(port, forged);
      expect(conflict.status).toBe(400);
      expect(((await conflict.json()) as { error: string }).error).toBe('idempotency-conflict');
      expect(conflict.headers.get('x-idempotent-replay')).toBeNull();

      // No second adapter call, trace row, or sidecar for the conflict.
      expect(adapter.calls).toBe(1);
      expect(trace.entries).toHaveLength(1);
      expect(trace.requests.size).toBe(1);
    });
  });

  it('idempotency is scoped per run and rides run eviction: the 64-run FIFO forgets, without resurrection', async () => {
    const adapter = new CountingAdapter(new FakeDecisionAdapter());
    await withGateway(adapter, {}, async (port, trace) => {
      const runId = (n: number): string => `run-evict-${String(n).padStart(4, '0')}`;
      const body = (run: string): Record<string, unknown> =>
        envelopeWithRequestId('dec-9030', { runId: run });

      const first = await post(port, body(runId(1)));
      expect(first.headers.get('x-idempotent-replay')).toBeNull();
      const replay = await post(port, body(runId(1)));
      expect(replay.headers.get('x-idempotent-replay')).toBe('true');
      expect(adapter.calls).toBe(1);

      // The SAME requestId under 64 OTHER runs is never a cross-run replay —
      // and pushes run 1 out of the FIFO.
      for (let n = 2; n <= 65; n += 1) {
        const response = await post(port, body(runId(n)));
        expect(response.status).toBe(200);
        expect(response.headers.get('x-idempotent-replay')).toBeNull();
      }
      expect(adapter.calls).toBe(65);

      // Run 1 was evicted: its budget AND idempotency results are gone
      // together, so the byte-identical repeat is a fresh dispatch (the
      // documented best-effort semantics — no resurrection of evicted state).
      const afterEviction = await post(port, body(runId(1)));
      expect(afterEviction.status).toBe(200);
      expect(afterEviction.headers.get('x-idempotent-replay')).toBeNull();
      expect(adapter.calls).toBe(66);
      expect(trace.entries).toHaveLength(66);
    });
  }, 30_000);
});
