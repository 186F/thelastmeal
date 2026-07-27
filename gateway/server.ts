import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { GatewayConfig } from './config';
import { DEFAULT_MAX_TOTAL_CALLS, publicConfig } from './config';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_TARGET_NPC_ID,
  externalContextHash,
  externalDecisionRequestEnvelopeSchema,
  type ExternalDecisionRequestEnvelope,
  type GatewayDecisionResult,
} from './schemas';
import {
  MODEL_TRACE_SCHEMA_VERSION,
  RAW_MODEL_OUTPUT_MAX_CHARS,
} from '../src/shared/modelArtifacts';
import {
  AdapterFailure,
  modelChoiceSchema,
  type ModelChoice,
  type ModelChoiceMeta,
  type ModelDecisionAdapter,
} from './adapters/modelDecisionAdapter';
import {
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  buildModelChoiceJsonSchema,
  buildUserContent,
} from './prompts/maraActionSelection';
import type { ModelTraceWriter } from './tracing/modelTraceWriter';
import type { ExternalFailureCode } from '../src/shared/decisionContracts';

/**
 * The model gateway: a small server-side HTTP boundary between the browser
 * orchestrator and the model adapter.
 *
 * For ALL routes, before dispatch: a present Origin header must be equivalent
 * to the configured browser origin and a present Host header must name a
 * loopback host. An absent Origin remains allowed for loopback CLI clients.
 *
 * The engine independently repeats provider binding, request identity,
 * duplicate/expiry/offer/staleness/constraint/validity checks. Gateway
 * validation is defense in depth, never a replacement for engine authority.
 */

export interface GatewayInstance {
  server: Server;
  start(): Promise<number>;
  stop(): Promise<void>;
}

interface TerminalResult {
  statusCode: number;
  body: unknown;
}

type IdempotencyRecord = { contextHash: string } & (
  | { status: 'in-flight'; promise: Promise<TerminalResult> }
  | { status: 'done'; result: TerminalResult }
);

interface RunBudgetState {
  calls: number;
  results: Map<string, IdempotencyRecord>;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseOrigin(value: string): { scheme: string; host: string; port: string } | null {
  try {
    const url = new URL(value.trim().replace(/\/$/, ''));
    return { scheme: url.protocol, host: url.hostname.toLowerCase(), port: url.port };
  } catch {
    return null;
  }
}

export function originEquivalent(origin: string, allowed: string): boolean {
  const a = parseOrigin(origin);
  const b = parseOrigin(allowed);
  if (a === null || b === null) {
    return origin.trim().replace(/\/$/, '') === allowed;
  }
  if (a.scheme !== b.scheme || a.port !== b.port) return false;
  if (a.host === b.host) return true;
  return LOOPBACK_HOSTNAMES.has(a.host) && LOOPBACK_HOSTNAMES.has(b.host);
}

export function isLoopbackHost(value: string): boolean {
  const host = value.trim().toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return LOOPBACK_HOSTNAMES.has(name);
}

export function createGateway(
  config: GatewayConfig,
  adapter: ModelDecisionAdapter,
  trace: ModelTraceWriter,
): GatewayInstance {
  let inFlight = 0;
  let totalCalls = 0;
  const maxTotalCalls = config.maxTotalCalls ?? DEFAULT_MAX_TOTAL_CALLS;
  let duplicateReplays = 0;
  const runBudgets = new Map<string, RunBudgetState>();

  const server = createServer((req, res) => {
    void route(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal-error' }));
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (origin !== undefined && !originEquivalent(origin, config.allowedBrowserOrigin)) {
      json(res, 403, { error: 'origin-forbidden' });
      return;
    }
    const host = req.headers.host;
    if (host !== undefined && !isLoopbackHost(host)) {
      json(res, 403, { error: 'host-forbidden' });
      return;
    }
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/provider-config')) {
      json(res, 200, publicView());
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/decision') {
      await handleDecision(req, res);
      return;
    }
    json(res, 404, { error: 'not-found' });
  }

  function applyCors(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('access-control-allow-origin', req.headers.origin ?? config.allowedBrowserOrigin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }

  function publicView(): Record<string, unknown> {
    return publicConfig(
      config,
      EXTERNAL_MARA_PROVIDER_ID,
      PROMPT_VERSION,
      EXTERNAL_REQUEST_SCHEMA_VERSION,
      MODEL_EXPERIMENT_VERSION,
    );
  }

  async function handleDecision(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.headers['content-type'] ?? '').split(';')[0]!.trim() !== 'application/json') {
      json(res, 415, { error: 'json-only' });
      return;
    }
    const declaredLength = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > config.maxRequestBodyBytes) {
      json(res, 413, { error: 'request-too-large' });
      return;
    }
    let body: string;
    try {
      body = await readBody(req, config.maxRequestBodyBytes);
    } catch {
      json(res, 413, { error: 'request-too-large' });
      req.resume();
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'invalid-json' });
      return;
    }
    const parsed = externalDecisionRequestEnvelopeSchema.safeParse(parsedJson);
    if (!parsed.success) {
      json(res, 400, {
        error: 'invalid-envelope',
        detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }
    const envelope = parsed.data as ExternalDecisionRequestEnvelope;

    if (
      envelope.providerId !== EXTERNAL_MARA_PROVIDER_ID ||
      envelope.request.npcId !== MODEL_TARGET_NPC_ID ||
      envelope.conditionId !== MODEL_CONDITION_ID ||
      envelope.promptVersion !== PROMPT_VERSION
    ) {
      json(res, 400, { error: 'unregistered-request' });
      return;
    }
    if (externalContextHash(envelope.context) !== envelope.contextHash) {
      json(res, 400, { error: 'context-hash-mismatch' });
      return;
    }

    const budget = runBudgets.get(envelope.runId) ?? { calls: 0, results: new Map() };
    runBudgets.set(envelope.runId, budget);
    if (runBudgets.size > 64) {
      const oldest = runBudgets.keys().next().value;
      if (oldest !== undefined && oldest !== envelope.runId) runBudgets.delete(oldest);
    }
    const requestId = envelope.request.requestId;
    const prior = budget.results.get(requestId);
    if (prior !== undefined) {
      if (prior.contextHash !== envelope.contextHash) {
        json(res, 400, { error: 'idempotency-conflict' });
        return;
      }
      duplicateReplays += 1;
      console.warn(
        `model-gateway: idempotent replay #${duplicateReplays} ` +
          `(runId=${envelope.runId}, requestId=${requestId})`,
      );
      const terminal = prior.status === 'done' ? prior.result : await prior.promise;
      res.setHeader('x-idempotent-replay', 'true');
      json(res, terminal.statusCode, terminal.body);
      return;
    }
    const promise = dispatchDecision(envelope, budget).catch((): TerminalResult => ({
      statusCode: 500,
      body: { error: 'internal-error' },
    }));
    budget.results.set(requestId, {
      contextHash: envelope.contextHash,
      status: 'in-flight',
      promise,
    });
    const terminal = await promise;
    if (runBudgets.get(envelope.runId) === budget) {
      budget.results.set(requestId, {
        contextHash: envelope.contextHash,
        status: 'done',
        result: terminal,
      });
    }
    json(res, terminal.statusCode, terminal.body);
  }

  async function dispatchDecision(
    envelope: ExternalDecisionRequestEnvelope,
    budget: RunBudgetState,
  ): Promise<TerminalResult> {
    const startedAt = Date.now();
    let dispatchedConcurrency = 0;
    const failureResult = (
      failureCode: ExternalFailureCode,
      retryable: boolean,
      meta: ModelChoiceMeta | null = null,
      rawOutput: string | null = null,
    ): TerminalResult => {
      const result: GatewayDecisionResult = {
        outcome: 'failure',
        failure: {
          failureId: `gwf-${envelope.request.requestId}`,
          requestId: envelope.request.requestId,
          npcId: envelope.request.npcId,
          scenarioId: envelope.request.scenarioId,
          providerId: envelope.providerId,
          failureCode,
          retryable,
        },
      };
      writeTrace(
        envelope,
        failureCode,
        null,
        meta,
        rawOutput,
        Date.now() - startedAt,
        dispatchedConcurrency,
      );
      return { statusCode: 200, body: result };
    };

    seedRunManifest(envelope);
    trace.writeRequest(envelope.runId, envelope.request.requestId, envelope);

    if (budget.calls >= config.maxCallsPerRun) {
      return failureResult('budget-exhausted', false);
    }
    if (totalCalls >= maxTotalCalls) {
      return failureResult('budget-exhausted', false);
    }
    if (inFlight >= config.maxConcurrency) {
      return failureResult('budget-exhausted', true);
    }
    budget.calls += 1;
    totalCalls += 1;
    inFlight += 1;
    dispatchedConcurrency = inFlight;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const offeredIds = envelope.request.offeredAffordanceIds;
      const adapterResult = await adapter.decide(
        {
          systemInstruction: SYSTEM_INSTRUCTION,
          userContent: buildUserContent(envelope),
          outputJsonSchema: buildModelChoiceJsonSchema(offeredIds),
          offeredAffordanceIds: offeredIds,
        },
        controller.signal,
      );
      const choiceParsed = modelChoiceSchema(offeredIds).safeParse(adapterResult.choice);
      if (!choiceParsed.success) {
        return failureResult(
          'invalid-model-output',
          false,
          adapterResult.meta,
          adapterResult.rawOutput ?? JSON.stringify(adapterResult.choice),
        );
      }
      const choice = choiceParsed.data as ModelChoice;
      const result: GatewayDecisionResult = {
        outcome: 'response',
        response: {
          responseId: `gw-${envelope.request.requestId}`,
          requestId: envelope.request.requestId,
          npcId: envelope.request.npcId,
          scenarioId: envelope.request.scenarioId,
          providerId: envelope.providerId,
          selectedAffordanceId: choice.selectedAffordanceId,
          confidenceBp: choice.confidenceBp,
          reasonCode: choice.reasonCode,
          scores: [],
        },
        usage: {
          inputTokens: adapterResult.meta.inputTokens,
          outputTokens: adapterResult.meta.outputTokens,
          totalTokens: adapterResult.meta.totalTokens,
        },
      };
      writeTrace(
        envelope,
        'response',
        choice,
        adapterResult.meta,
        null,
        Date.now() - startedAt,
        dispatchedConcurrency,
      );
      return { statusCode: 200, body: result };
    } catch (error) {
      if (error instanceof AdapterFailure) {
        return failureResult(
          error.failureCode,
          error.failureCode === 'upstream-timeout',
          error.meta ?? null,
          error.rawOutput ?? null,
        );
      }
      if (controller.signal.aborted) {
        return failureResult('upstream-timeout', true);
      }
      return failureResult('upstream-error', false);
    } finally {
      clearTimeout(timer);
      inFlight -= 1;
    }
  }

  function seedRunManifest(envelope: ExternalDecisionRequestEnvelope): void {
    const requestedModelId =
      config.adapterKind === 'openrouter'
        ? (config.openRouterModel ?? adapter.id)
        : config.adapterKind === 'openai'
          ? config.openaiModel
          : adapter.id;
    trace.seedManifest({
      traceSchemaVersion: MODEL_TRACE_SCHEMA_VERSION,
      experimentId: envelope.experimentId,
      experimentVersion: envelope.experimentVersion,
      conditionId: envelope.conditionId,
      runId: envelope.runId,
      scenarioId: envelope.request.scenarioId,
      providerPlanId: envelope.conditionId,
      externalProviderId: envelope.providerId,
      promptVersion: envelope.promptVersion,
      modelId: requestedModelId,
      modelSettings: {
        adapter: adapter.id,
        adapterKind: config.adapterKind,
        requestTimeoutMs: config.requestTimeoutMs,
        maxOutputTokens: config.maxOutputTokens,
        maxCallsPerRun: config.maxCallsPerRun,
        maxConcurrency: config.maxConcurrency,
        maxTotalCalls,
        maxRequestBodyBytes: config.maxRequestBodyBytes,
        ...(config.adapterKind === 'openrouter'
          ? {
              openRouterProvider: config.openRouterProvider ?? null,
              openRouterRequireParameters: true,
              openRouterAllowFallbacks: false,
              openRouterRouterMetadata: true,
            }
          : {}),
      },
      startedAtUtc: new Date().toISOString(),
    });
  }

  function writeTrace(
    envelope: ExternalDecisionRequestEnvelope,
    gatewayOutcome: 'response' | ExternalFailureCode,
    choice: ModelChoice | null,
    meta: ModelChoiceMeta | null,
    rawOutput: string | null,
    latencyMs: number,
    concurrentInFlight: number,
  ): void {
    const requestId = envelope.request.requestId;
    const keepRaw =
      gatewayOutcome === 'invalid-model-output' || gatewayOutcome === 'upstream-refusal';
    trace.append({
      runId: envelope.runId,
      requestId,
      npcId: envelope.request.npcId,
      scenarioId: envelope.request.scenarioId,
      logicalRequestedTick: envelope.request.requestedAtTick,
      providerId: envelope.providerId,
      promptVersion: envelope.promptVersion,
      modelId: meta?.modelId ?? null,
      contextHash: envelope.contextHash,
      truncationCounts: { ...envelope.truncationCounts },
      offeredAffordanceIds: [...envelope.request.offeredAffordanceIds],
      upstreamResponseId: meta?.upstreamResponseId ?? null,
      responseId: gatewayOutcome === 'response' ? `gw-${requestId}` : null,
      failureId: gatewayOutcome === 'response' ? null : `gwf-${requestId}`,
      selectedAffordanceId: choice?.selectedAffordanceId ?? null,
      reasonCode: choice?.reasonCode ?? null,
      confidenceBp: choice?.confidenceBp ?? null,
      rationale: choice?.rationale ?? null,
      rawModelOutput:
        keepRaw && rawOutput !== null ? rawOutput.slice(0, RAW_MODEL_OUTPUT_MAX_CHARS) : null,
      inputTokens: meta?.inputTokens ?? null,
      outputTokens: meta?.outputTokens ?? null,
      totalTokens: meta?.totalTokens ?? null,
      latencyMs,
      concurrentInFlight,
      gatewayOutcome,
      engineOutcome: null,
      engineRejectionReason: null,
    });
    if (meta?.routerMetadata !== undefined || meta?.upstreamProviderId !== undefined) {
      trace.writeRouterMetadata({
        routingSchemaVersion: 1,
        runId: envelope.runId,
        requestId,
        upstreamProviderId: meta.upstreamProviderId ?? null,
        metadata: meta.routerMetadata ?? null,
      });
    }
  }

  return {
    server,
    start: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : config.port);
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export async function stopWithFallback(
  gateway: GatewayInstance,
  fallbackMs = 2_000,
): Promise<void> {
  const stopping = gateway.stop();
  const timer = setTimeout(() => gateway.server.closeAllConnections(), fallbackMs);
  try {
    await stopping;
  } finally {
    clearTimeout(timer);
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  if (!res.headersSent) {
    res.writeHead(status, { 'content-type': 'application/json' });
  }
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > maxBytes) {
        overflowed = true;
        chunks = [];
        reject(new Error('body-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
