import { beforeAll, describe, expect, it } from 'vitest';
import type { GatewayConfig } from '../../gateway/config';
import { createGateway, stopWithFallback } from '../../gateway/server';
import { FakeDecisionAdapter } from '../../gateway/adapters/fakeDecisionAdapter';
import {
  AdapterFailure,
  type AdapterInput,
  type AdapterResult,
  type ModelDecisionAdapter,
} from '../../gateway/adapters/modelDecisionAdapter';
import { PROMPT_VERSION } from '../../gateway/prompts/maraActionSelection';
import { MemoryTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import { EXTERNAL_REQUEST_SCHEMA_VERSION } from '../../src/sim/decisions/externalSchemas';
import {
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../src/shared/modelExperiment';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { ExternalDecisionRequestEnvelope } from '../../gateway/schemas';

/**
 * 1.5.0 G1/G3/G4: graceful shutdown (stopWithFallback — the unit-testable
 * body of main.ts's SIGINT/SIGTERM handlers) and seed-at-first-sight (the
 * run manifest is seeded alongside the envelope sidecar on the first
 * validated non-duplicate envelope, so a request killed mid-adapter still
 * leaves a manifest). Everything runs through the fake/gate adapters on
 * loopback; no key, no live network.
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

/** Resolves `reached` the moment the gateway actually invokes the adapter —
 * i.e. strictly AFTER the seed + sidecar writes — then hangs until the
 * gateway's own timeout abort. This freezes a request mid-adapter, the exact
 * state a killed gateway leaves behind. */
class GateAdapter implements ModelDecisionAdapter {
  readonly id = 'gate-adapter-v1';
  readonly reached: Promise<void>;
  private signalReached!: () => void;

  constructor() {
    this.reached = new Promise((resolve) => {
      this.signalReached = resolve;
    });
  }

  decide(_input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    this.signalReached();
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new AdapterFailure('upstream-timeout', 'gate adapter aborted')),
        { once: true },
      );
    });
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
    runId: 'run-shut-0001',
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

beforeAll(() => {
  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  genuine = run.externalRequests[0]!;
});

describe('graceful shutdown: stopWithFallback (1.5.0 G1/G4)', () => {
  it('an idle gateway stops promptly and refuses subsequent connections', async () => {
    const gateway = createGateway(testConfig(), new FakeDecisionAdapter(), new MemoryTraceWriter());
    const port = await gateway.start();
    const settled = await post(port, envelope());
    expect(settled.status).toBe(200);
    await stopWithFallback(gateway);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('a hung in-flight request cannot block shutdown: the fallback force-closes connections and stop() completes', async () => {
    const adapter = new GateAdapter();
    // The gateway's own timeout (5s) is far beyond the 100ms fallback, so
    // ONLY closeAllConnections() can unblock the drain this fast.
    const gateway = createGateway(
      testConfig({ requestTimeoutMs: 5_000 }),
      adapter,
      new MemoryTraceWriter(),
    );
    const port = await gateway.start();
    const inFlight = post(port, envelope()).then(
      () => 'settled' as const,
      () => 'rejected' as const,
    );
    await adapter.reached;
    const begun = Date.now();
    await stopWithFallback(gateway, 100);
    expect(Date.now() - begun).toBeLessThan(3_000);
    // The in-flight client saw a socket teardown, never a gateway result.
    expect(await inFlight).toBe('rejected');
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 15_000);
});

describe('seed-at-first-sight (1.5.0 G3)', () => {
  it('a validated request whose adapter hangs (or dies mid-adapter) has already seeded the manifest and sidecar, before any trace row', async () => {
    const adapter = new GateAdapter();
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(
      testConfig({
        requestTimeoutMs: 5_000,
        adapterKind: 'openai',
        openaiModel: 'gpt-test-configured',
      }),
      adapter,
      trace,
    );
    const port = await gateway.start();
    try {
      const inFlight = post(port, envelope()).catch(() => null);
      await adapter.reached;
      // Mid-adapter: no terminal result and no trace row yet — but the
      // manifest seed and the exact-envelope sidecar are already durable.
      // A gateway killed at this exact point leaves both on disk.
      expect(trace.entries).toHaveLength(0);
      expect(trace.manifests).toHaveLength(1);
      expect(trace.requests.has(`run-shut-0001:${genuine.request.requestId}`)).toBe(true);
      const seed = trace.manifests[0]!;
      expect(seed.runId).toBe('run-shut-0001');
      expect(seed.scenarioId).toBe(genuine.request.scenarioId);
      // Seed modelId stays the CONFIGURED model (1.4.0 F5/S2) — adapter
      // metadata does not even exist yet at seed time.
      expect(seed.modelId).toBe('gpt-test-configured');
      // startedAtUtc is first-validated-envelope time: a real parseable
      // timestamp stamped NOW, while the first request is still mid-adapter.
      expect(Date.parse(seed.startedAtUtc)).not.toBeNaN();
      await stopWithFallback(gateway, 100);
      // The killed request never got a gateway result.
      expect(await inFlight).toBeNull();
    } finally {
      await stopWithFallback(gateway, 100).catch(() => undefined);
    }
  }, 15_000);

  it('a pre-validation reject never seeds: the manifest appears only with the first VALIDATED non-duplicate envelope', async () => {
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(testConfig(), new FakeDecisionAdapter(), trace);
    const port = await gateway.start();
    try {
      const tampered = envelope();
      (tampered.context as { state: { hungerMicro: number } }).state.hungerMicro += 1;
      const rejected = await post(port, tampered);
      expect(rejected.status).toBe(400);
      expect(trace.manifests).toHaveLength(0);
      expect(trace.requests.size).toBe(0);
      const accepted = await post(port, envelope());
      expect(accepted.status).toBe(200);
      expect(trace.manifests).toHaveLength(1);
    } finally {
      await gateway.stop();
    }
  });

  it('the seed is written once per run: later dispatches never re-seed or move startedAtUtc', async () => {
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(testConfig(), new FakeDecisionAdapter(), trace);
    const port = await gateway.start();
    try {
      const first = await post(port, envelopeWithRequestId('dec-9201'));
      expect(first.status).toBe(200);
      const seededAt = trace.manifests[0]!.startedAtUtc;
      const second = await post(port, envelopeWithRequestId('dec-9202'));
      expect(second.status).toBe(200);
      expect(trace.entries).toHaveLength(2);
      expect(trace.manifests).toHaveLength(1);
      expect(trace.manifests[0]!.startedAtUtc).toBe(seededAt);
    } finally {
      await gateway.stop();
    }
  });
});
