import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_RESPONSES_ENDPOINT,
  OpenRouterResponsesDecisionAdapter,
} from '../../gateway/adapters/openRouterResponsesAdapter';
import type { AdapterFailure, AdapterInput } from '../../gateway/adapters/modelDecisionAdapter';

function adapterInput(): AdapterInput {
  return {
    systemInstruction: 'system',
    userContent: 'user',
    offeredAffordanceIds: ['aff:work', 'aff:wait'],
    outputJsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedAffordanceId', 'reasonCode', 'confidenceBp', 'rationale'],
      properties: {
        selectedAffordanceId: { type: 'string', enum: ['aff:work', 'aff:wait'] },
        reasonCode: { type: 'string', enum: ['routine'] },
        confidenceBp: { type: 'integer', minimum: 0, maximum: 10_000 },
        rationale: { type: 'string', maxLength: 160 },
      },
    },
  };
}

function successPayload() {
  return {
    id: 'resp-openrouter-1',
    model: 'anthropic/claude-sonnet-test',
    status: 'completed',
    output_text: JSON.stringify({
      selectedAffordanceId: 'aff:work',
      reasonCode: 'routine',
      confidenceBp: 7_500,
      rationale: 'Continue the assigned task.',
    }),
    usage: { input_tokens: 123, output_tokens: 21, total_tokens: 144 },
    openrouter_metadata: {
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
      attempts: [{ provider: 'Anthropic', model: 'anthropic/claude-sonnet-test', status: 200 }],
    },
  };
}

describe('OpenRouterResponsesDecisionAdapter', () => {
  it('pins model/provider routing, structured output, attribution, and router metadata', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    let calls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      calls += 1;
      calledUrl = String(input);
      calledInit = init;
      return new Response(JSON.stringify(successPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const adapter = new OpenRouterResponsesDecisionAdapter({
      apiKey: 'test-openrouter-key',
      model: 'anthropic/claude-sonnet-test',
      provider: 'anthropic',
      maxOutputTokens: 300,
      httpReferer: 'http://localhost:5173',
      appTitle: 'The Last Meal',
      fetchImpl,
    });

    const result = await adapter.decide(adapterInput(), new AbortController().signal);

    expect(calls).toBe(1);
    expect(calledUrl).toBe(OPENROUTER_RESPONSES_ENDPOINT);
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-openrouter-key');
    expect(headers['x-openrouter-metadata']).toBe('enabled');
    expect(headers['http-referer']).toBe('http://localhost:5173');
    expect(headers['x-openrouter-title']).toBe('The Last Meal');

    const body = JSON.parse(String(calledInit?.body)) as Record<string, unknown>;
    expect(body.model).toBe('anthropic/claude-sonnet-test');
    expect(body.store).toBe(false);
    expect(body.provider).toEqual({
      only: ['anthropic'],
      allow_fallbacks: false,
      require_parameters: true,
    });
    expect(body.text).toEqual({
      format: {
        type: 'json_schema',
        name: 'mara_action_choice',
        strict: true,
        schema: adapterInput().outputJsonSchema,
      },
    });

    expect(result.choice).toEqual({
      selectedAffordanceId: 'aff:work',
      reasonCode: 'routine',
      confidenceBp: 7_500,
      rationale: 'Continue the assigned task.',
    });
    expect(result.meta.modelId).toBe('anthropic/claude-sonnet-test');
    expect(result.meta.upstreamResponseId).toBe('resp-openrouter-1');
    expect(result.meta.upstreamProviderId).toBe('Anthropic');
    expect(result.meta.inputTokens).toBe(123);
    expect(result.meta.outputTokens).toBe(21);
    expect(result.meta.totalTokens).toBe(144);
    expect(result.meta.routerMetadata).toMatchObject({ strategy: 'direct', attempt: 1 });
  });

  it('maps HTTP errors to one typed upstream failure without retrying', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: { code: 402, message: 'Insufficient credits' },
          openrouter_metadata: { requested: 'anthropic/claude-sonnet-test', attempt: 0 },
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new OpenRouterResponsesDecisionAdapter({
      apiKey: 'test-openrouter-key',
      model: 'anthropic/claude-sonnet-test',
      provider: 'anthropic',
      maxOutputTokens: 300,
      fetchImpl,
    });

    await expect(
      adapter.decide(adapterInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      failureCode: 'upstream-error',
      message: 'Insufficient credits',
    } satisfies Partial<AdapterFailure>);
    expect(calls).toBe(1);
  });

  it('surfaces a Responses-format refusal as a typed refusal', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'resp-refusal',
          model: 'anthropic/claude-sonnet-test',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot do that.' }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const adapter = new OpenRouterResponsesDecisionAdapter({
      apiKey: 'test-openrouter-key',
      model: 'anthropic/claude-sonnet-test',
      provider: 'anthropic',
      maxOutputTokens: 300,
      fetchImpl,
    });

    await expect(
      adapter.decide(adapterInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      failureCode: 'upstream-refusal',
      rawOutput: 'I cannot do that.',
    } satisfies Partial<AdapterFailure>);
  });

  it('rejects an incomplete response even when its partial text parses as a valid choice', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          ...successPayload(),
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const adapter = new OpenRouterResponsesDecisionAdapter({
      apiKey: 'test-openrouter-key',
      model: 'anthropic/claude-sonnet-test',
      provider: 'anthropic',
      maxOutputTokens: 300,
      fetchImpl,
    });

    await expect(
      adapter.decide(adapterInput(), new AbortController().signal),
    ).rejects.toMatchObject({
      failureCode: 'invalid-model-output',
      message: 'OpenRouter response status incomplete: max_output_tokens',
    } satisfies Partial<AdapterFailure>);
  });
});
