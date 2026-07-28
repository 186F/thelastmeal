import { ROUTER_METADATA_MAX_CHARS } from '../../src/shared/modelArtifacts';
import {
  AdapterFailure,
  type AdapterInput,
  type AdapterResult,
  type ModelChoiceMeta,
  type ModelDecisionAdapter,
} from './modelDecisionAdapter';

/**
 * OpenRouter Responses API adapter.
 *
 * The adapter deliberately uses the stateless Responses endpoint directly
 * rather than hiding OpenRouter behind the legacy OpenAI adapter identity.
 * Every request:
 * - uses one exact OpenRouter model slug;
 * - allows one exact provider endpoint;
 * - disables provider fallbacks;
 * - requires support for every submitted parameter (including JSON Schema);
 * - opts into router metadata for noncanonical audit evidence;
 * - performs no automatic retries.
 */

export const OPENROUTER_RESPONSES_ENDPOINT = 'https://openrouter.ai/api/v1/responses';

/** Re-exported from the shared artifact contracts so the write-side bound and
 * the finalizer's read-side bound can never drift apart. */
export const OPENROUTER_ROUTER_METADATA_MAX_CHARS = ROUTER_METADATA_MAX_CHARS;

export interface OpenRouterResponsesAdapterOptions {
  apiKey: string;
  model: string;
  provider: string;
  maxOutputTokens: number;
  httpReferer?: string | null;
  appTitle?: string | null;
  /** Test seam only. Production uses the fixed official Responses endpoint. */
  endpoint?: string;
  /** Test seam only. */
  fetchImpl?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

/** Reduces router metadata to at most OPENROUTER_ROUTER_METADATA_MAX_CHARS of
 * serialized JSON. Every string the fallback copies is itself capped: an
 * uncapped passthrough could produce a "truncated" record LARGER than the
 * input it was meant to shrink (measured: 20,085 chars in, 20,101 out), which
 * the finalizer's read-side bound would then reject as a corrupt sidecar —
 * turning an oversize-but-honest upstream payload into a fatal contradiction.
 * The final guard makes the postcondition unconditional rather than inferred. */
function boundedRouterMetadata(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record === null) return null;
  const serialized = JSON.stringify(record);
  if (serialized.length <= OPENROUTER_ROUTER_METADATA_MAX_CHARS) {
    return record;
  }
  const reduced: Record<string, unknown> = {
    truncated: true,
    originalChars: serialized.length,
    requested: boundedString(record.requested, 512),
    strategy: boundedString(record.strategy, 512),
    attempt: nullableInteger(record.attempt),
    summary: boundedString(record.summary, 1_000),
  };
  if (JSON.stringify(reduced).length <= OPENROUTER_ROUTER_METADATA_MAX_CHARS) {
    return reduced;
  }
  return { truncated: true, originalChars: serialized.length };
}

function selectedProvider(metadata: Record<string, unknown> | null): string | null {
  if (metadata === null) return null;
  const endpoints = asRecord(metadata.endpoints);
  const available = endpoints?.available;
  if (Array.isArray(available)) {
    for (const candidate of available) {
      const record = asRecord(candidate);
      if (record?.selected === true && typeof record.provider === 'string') {
        return record.provider;
      }
    }
  }
  const attempts = metadata.attempts;
  if (Array.isArray(attempts)) {
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const record = asRecord(attempts[index]);
      const status = nullableInteger(record?.status);
      if (
        status !== null &&
        status >= 200 &&
        status < 300 &&
        typeof record?.provider === 'string'
      ) {
        return record.provider;
      }
    }
  }
  return null;
}

function extractRefusal(payload: Record<string, unknown>): string | null {
  const output = payload.output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const itemRecord = asRecord(item);
    const content = itemRecord?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === 'refusal' && typeof partRecord.refusal === 'string') {
        return partRecord.refusal;
      }
    }
  }
  return null;
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }
  const output = payload.output;
  if (!Array.isArray(output)) return null;
  const pieces: string[] = [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const content = itemRecord?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === 'output_text' && typeof partRecord.text === 'string') {
        pieces.push(partRecord.text);
      }
    }
  }
  return pieces.length > 0 ? pieces.join('') : null;
}

function metaFromPayload(
  payload: Record<string, unknown>,
  response: Response,
  configuredModel: string,
): ModelChoiceMeta {
  const usage = asRecord(payload.usage);
  // Selected provider is read from the RAW metadata, never from the bounded
  // copy: the truncation fallback carries neither `endpoints` nor `attempts`,
  // so deriving it post-bound would silently null the provider on exactly the
  // large-metadata responses where routing is most worth proving — and a null
  // provider skips the finalizer's substitution check entirely.
  const rawRouterMetadata = asRecord(payload.openrouter_metadata);
  const routerMetadata = boundedRouterMetadata(payload.openrouter_metadata);
  return {
    modelId: typeof payload.model === 'string' ? payload.model : configuredModel,
    upstreamResponseId:
      typeof payload.id === 'string'
        ? payload.id
        : (response.headers.get('x-generation-id') ?? null),
    inputTokens: nullableInteger(usage?.input_tokens),
    outputTokens: nullableInteger(usage?.output_tokens),
    totalTokens: nullableInteger(usage?.total_tokens),
    upstreamProviderId: selectedProvider(rawRouterMetadata),
    routerMetadata,
  };
}

export class OpenRouterResponsesDecisionAdapter implements ModelDecisionAdapter {
  readonly id = 'openrouter-responses-adapter-v1';
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterResponsesAdapterOptions) {
    this.endpoint = options.endpoint ?? OPENROUTER_RESPONSES_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async decide(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    const body = {
      model: this.options.model,
      store: false,
      max_output_tokens: this.options.maxOutputTokens,
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
      provider: {
        only: [this.options.provider],
        allow_fallbacks: false,
        require_parameters: true,
      },
    };

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiKey}`,
      'content-type': 'application/json',
      'x-openrouter-metadata': 'enabled',
    };
    if (this.options.httpReferer) headers['http-referer'] = this.options.httpReferer;
    if (this.options.appTitle) headers['x-openrouter-title'] = this.options.appTitle;

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new AdapterFailure('upstream-timeout', 'OpenRouter request aborted on timeout');
      }
      throw new AdapterFailure(
        'upstream-error',
        `OpenRouter request failed: ${(error as Error).message}`,
      );
    }

    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AdapterFailure(
        response.ok ? 'invalid-model-output' : 'upstream-error',
        `OpenRouter returned non-JSON content with status ${response.status}`,
        response.ok ? raw : undefined,
      );
    }
    const payload = asRecord(parsed);
    if (payload === null) {
      throw new AdapterFailure('invalid-model-output', 'OpenRouter response is not an object', raw);
    }
    const meta = metaFromPayload(payload, response, this.options.model);

    const error = asRecord(payload.error);
    if (!response.ok || error !== null) {
      const message =
        typeof error?.message === 'string'
          ? error.message
          : `OpenRouter upstream error: status ${response.status}`;
      throw new AdapterFailure('upstream-error', message, undefined, meta);
    }

    const refusal = extractRefusal(payload);
    if (refusal !== null) {
      throw new AdapterFailure('upstream-refusal', 'model refused the request', refusal, meta);
    }

    const responseStatus = payload.status;
    if (typeof responseStatus === 'string' && responseStatus !== 'completed') {
      const incompleteDetails = asRecord(payload.incomplete_details);
      const reason =
        typeof incompleteDetails?.reason === 'string' ? `: ${incompleteDetails.reason}` : '';
      const failureCode = responseStatus === 'failed' ? 'upstream-error' : 'invalid-model-output';
      throw new AdapterFailure(
        failureCode,
        `OpenRouter response status ${responseStatus}${reason}`,
        failureCode === 'invalid-model-output' ? raw : undefined,
        meta,
      );
    }

    const text = extractOutputText(payload);
    if (text === null) {
      throw new AdapterFailure('invalid-model-output', 'empty structured output', raw, meta);
    }

    let choice: unknown;
    try {
      choice = JSON.parse(text);
    } catch {
      throw new AdapterFailure(
        'invalid-model-output',
        'structured output is not valid JSON',
        text,
        meta,
      );
    }

    return {
      choice,
      rawOutput: text,
      meta,
    };
  }
}
