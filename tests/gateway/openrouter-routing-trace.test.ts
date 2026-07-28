import { describe, expect, it } from 'vitest';
import {
  AdapterFailure,
  type AdapterInput,
  type AdapterResult,
  type ModelDecisionAdapter,
} from '../../gateway/adapters/modelDecisionAdapter';
import type { GatewayConfig } from '../../gateway/config';
import { createGateway } from '../../gateway/server';
import { MemoryTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import { PROMPT_VERSION } from '../../gateway/prompts/maraActionSelection';
import { EXTERNAL_REQUEST_SCHEMA_VERSION } from '../../src/sim/decisions/externalSchemas';
import {
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../src/shared/modelExperiment';
import { createRun, stepTick } from '../../src/sim/runtime/engine';

class RoutedAdapter implements ModelDecisionAdapter {
  readonly id = 'routed-test-adapter';

  async decide(input: AdapterInput): Promise<AdapterResult> {
    return {
      choice: {
        selectedAffordanceId: input.offeredAffordanceIds[0]!,
        reasonCode: 'routine',
        confidenceBp: 6_000,
        rationale: 'Use the first offered action.',
      },
      meta: {
        modelId: 'anthropic/claude-sonnet-test',
        upstreamResponseId: 'resp-router-test',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        upstreamProviderId: 'Anthropic',
        routerMetadata: {
          requested: 'anthropic/claude-sonnet-test',
          strategy: 'direct',
          attempt: 1,
          endpoints: {
            total: 1,
            available: [
              {
                provider: 'Anthropic',
                model: 'anthropic/claude-sonnet-test',
                selected: true,
              },
            ],
          },
        },
      },
    };
  }
}

/** Mirrors the real adapter's HTTP-error path: meta is built from the error
 * payload BEFORE the throw, so it carries both router keys with null values. */
class FailingRoutedAdapter implements ModelDecisionAdapter {
  readonly id = 'failing-routed-test-adapter';

  async decide(): Promise<AdapterResult> {
    throw new AdapterFailure('upstream-error', 'Insufficient credits', undefined, {
      modelId: 'anthropic/claude-sonnet-test',
      upstreamResponseId: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      upstreamProviderId: null,
      routerMetadata: null,
    });
  }
}

function config(): GatewayConfig {
  return {
    adapterKind: 'openrouter',
    port: 0,
    requestTimeoutMs: 2_000,
    maxConcurrency: 1,
    maxCallsPerRun: 80,
    maxTotalCalls: 400,
    traceDir: 'unused',
    allowedBrowserOrigin: 'http://localhost:5173',
    openaiApiKey: null,
    openaiModel: null,
    openRouterApiKey: 'test-key',
    openRouterModel: 'anthropic/claude-sonnet-test',
    openRouterProvider: 'anthropic',
    openRouterHttpReferer: null,
    openRouterAppTitle: 'The Last Meal',
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
  };
}

function externalRequest() {
  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  const external = run.externalRequests[0];
  if (!external) throw new Error('test did not produce an external request');
  return external;
}

describe('OpenRouter routing trace persistence', () => {
  it('writes the selected provider and opaque metadata as one routing sidecar', async () => {
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(config(), new RoutedAdapter(), trace);
    const external = externalRequest();
    const runId = 'router-evidence-0001';
    const envelope = {
      schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      conditionId: MODEL_CONDITION_ID,
      runId,
      providerId: external.request.providerId,
      promptVersion: PROMPT_VERSION,
      contextHash: external.contextHash,
      request: external.request,
      context: external.context,
      truncationCounts: external.truncationCounts,
    };

    const port = await gateway.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as { outcome: string }).toMatchObject({
        outcome: 'response',
      });
    } finally {
      await gateway.stop();
    }

    const requestId = external.request.requestId;
    expect(trace.routing.get(`${runId}:${requestId}`)).toEqual({
      routingSchemaVersion: 1,
      runId,
      requestId,
      upstreamProviderId: 'Anthropic',
      metadata: {
        requested: 'anthropic/claude-sonnet-test',
        strategy: 'direct',
        attempt: 1,
        endpoints: {
          total: 1,
          available: [
            {
              provider: 'Anthropic',
              model: 'anthropic/claude-sonnet-test',
              selected: true,
            },
          ],
        },
      },
    });
    expect(trace.entries).toHaveLength(1);
    expect(trace.manifests[0]?.modelSettings).toMatchObject({
      adapterKind: 'openrouter',
      openRouterProvider: 'anthropic',
      openRouterRequireParameters: true,
      openRouterAllowFallbacks: false,
      openRouterRouterMetadata: true,
    });
  });

  it('writes a routing sidecar with a NULL provider when the upstream returns an HTTP error', async () => {
    // The write side of a defect the finalizer had to be taught about: the
    // adapter builds `meta` before it throws on an HTTP error, and
    // metaFromPayload always sets both router keys, so the gateway's guard
    // fires and persists routing evidence for a call nothing served. Any
    // finalizer criterion that reads routing sidecars must therefore scope
    // itself to ANSWERED requests, or one upstream 402 makes a run
    // unfinalizable. Asserted here at the gateway so the integration fixture
    // cannot drift back to a prettier version of reality.
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(config(), new FailingRoutedAdapter(), trace);
    const external = externalRequest();
    const runId = 'router-failure-0001';
    const envelope = {
      schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      conditionId: MODEL_CONDITION_ID,
      runId,
      providerId: external.request.providerId,
      promptVersion: PROMPT_VERSION,
      contextHash: external.contextHash,
      request: external.request,
      context: external.context,
      truncationCounts: external.truncationCounts,
    };

    const port = await gateway.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      expect((await response.json()) as { outcome: string }).toMatchObject({
        outcome: 'failure',
      });
    } finally {
      await gateway.stop();
    }

    const requestId = external.request.requestId;
    expect(trace.entries[0]?.gatewayOutcome).toBe('upstream-error');
    expect(trace.routing.get(`${runId}:${requestId}`)).toMatchObject({
      routingSchemaVersion: 1,
      runId,
      requestId,
      upstreamProviderId: null,
    });
  });
});
