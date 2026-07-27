import { describe, expect, it } from 'vitest';
import type {
  AdapterInput,
  AdapterResult,
  ModelDecisionAdapter,
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
        selectedAffordanceId: input.offeredAffordanceIds[0],
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
      expect((await response.json()) as { outcome: string }).toMatchObject({ outcome: 'response' });
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
});
