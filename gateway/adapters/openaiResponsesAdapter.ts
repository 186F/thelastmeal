import OpenAI, { APIError } from 'openai';
import {
  AdapterFailure,
  type AdapterInput,
  type AdapterResult,
  type ModelDecisionAdapter,
} from './modelDecisionAdapter';

/**
 * OpenAI Responses API adapter (milestone 001, section 12). Instantiated
 * ONLY inside the server-side gateway process:
 * - `OPENAI_API_KEY` / `OPENAI_MODEL` are read by the gateway config, never
 *   by browser, worker, shared, or simulation code (the architecture
 *   validator enforces the import ban).
 * - `store: false`; no background mode; no tools, web search, file search,
 *   code execution, function calling, or MCP; no conversation persistence.
 * - JSON Schema Structured Outputs with a dynamic enum of offered IDs.
 * - Output tokens are bounded to a small value fit for one action choice.
 * - The gateway's AbortSignal aborts the upstream request on timeout.
 * - Refusals, invalid output, upstream errors, and timeouts surface as
 *   typed failures; the exact returned model identifier, provider response
 *   ID, and token usage go to the noncanonical trace only.
 */
export class OpenAIResponsesDecisionAdapter implements ModelDecisionAdapter {
  readonly id = 'openai-responses-adapter-v1';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly maxOutputTokens: number,
  ) {
    // maxRetries: 0 — the milestone forbids automatic upstream retries (one
    // engine request => at most ONE model call; the SDK default of 2 silent
    // retries would corrupt latency/cost/duplication measurements).
    this.client = new OpenAI({ apiKey, maxRetries: 0 });
  }

  async decide(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    let response;
    try {
      response = await this.client.responses.create(
        {
          model: this.model,
          store: false,
          max_output_tokens: this.maxOutputTokens,
          input: [
            { role: 'system', content: input.systemInstruction },
            { role: 'user', content: input.userContent },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'mara_action_choice',
              strict: true,
              schema: input.outputJsonSchema,
            },
          },
        },
        { signal },
      );
    } catch (error) {
      if (signal.aborted) {
        throw new AdapterFailure('upstream-timeout', 'upstream request aborted on timeout');
      }
      if (error instanceof APIError) {
        throw new AdapterFailure(
          'upstream-error',
          `upstream API error: status ${String(error.status)}`,
        );
      }
      throw new AdapterFailure(
        'upstream-error',
        `upstream call failed: ${(error as Error).message}`,
      );
    }

    for (const item of response.output ?? []) {
      if (item.type === 'message') {
        for (const content of item.content ?? []) {
          if (content.type === 'refusal') {
            throw new AdapterFailure('upstream-refusal', 'model refused the request');
          }
        }
      }
    }

    const text = response.output_text;
    if (!text) {
      throw new AdapterFailure('invalid-model-output', 'empty structured output');
    }
    let choice: unknown;
    try {
      choice = JSON.parse(text);
    } catch {
      throw new AdapterFailure('invalid-model-output', 'structured output is not valid JSON');
    }
    return {
      choice,
      meta: {
        modelId: response.model ?? this.model,
        upstreamResponseId: response.id ?? null,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      },
    };
  }
}
