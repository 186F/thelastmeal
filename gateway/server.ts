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
 * The model gateway (milestone 001, section 10): a small server-side HTTP
 * boundary between the browser orchestrator and the model adapter.
 *
 * For ALL routes, before dispatch: a present Origin header must be
 * equivalent to the single configured browser origin (403 origin-forbidden
 * otherwise) and a present Host header must name a loopback host —
 * localhost / 127.0.0.1 / [::1], any port (403 host-forbidden otherwise).
 * An ABSENT Origin stays allowed for loopback CLI clients and tests.
 *
 * Responsibilities, in order, for POST /v1/decision:
 *   1. exact envelope validation (size-limited, JSON-only)
 *   2. registered provider / experiment / condition / prompt / Mara identity
 *   3. context-hash recomputation
 *   4. reduced idempotency (re-audit remediation G3): a repeat of an already
 *      seen runId+requestId with the SAME contextHash replays the first
 *      terminal result (no adapter call, no budget, no trace row, no
 *      sidecar); the SAME requestId with a DIFFERENT contextHash is a 400
 *      idempotency-conflict — a forgery/bug, never a duplicate
 *   5. exact-envelope sidecar persisted as requests/<requestId>.json (G2)
 *   6. concurrency, per-run budget, and the process-wide spend cap
 *   7. server-owned prompt construction
 *   8. adapter call under an abort-on-timeout signal
 *   9. strict structured-output validation over the DYNAMIC offered-ID enum
 *  10. engine DecisionResponse constructed HERE, identity fields copied from
 *      the validated request — never from model text
 *  11. noncanonical trace entry (schema v2)
 *  12. a valid response or a typed failure — the transport never throws
 *      free-form errors at the client
 *
 * The engine independently repeats provider binding, request identity,
 * duplicate/expiry/offer/staleness/constraint/validity checks: gateway
 * validation is defense in depth, never a replacement (section 14).
 */

export interface GatewayInstance {
  server: Server;
  start(): Promise<number>;
  stop(): Promise<void>;
}

/** Terminal HTTP result of one dispatched decision, replayed verbatim to
 * every idempotent duplicate waiter. */
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
  /** Reduced idempotency store (G3): first terminal result per requestId.
   * Rides inside the run's budget state so the 64-run FIFO evicts budget and
   * idempotency together — best-effort semantics: an evicted run forgets its
   * results, and a completion write-back never resurrects it. */
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

/** Origin equivalence (G4): lowercase scheme+host, trailing slash stripped,
 * with localhost / 127.0.0.1 / [::1] interchangeable when scheme and port
 * match. Unparsable values fall back to an exact normalized string compare. */
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

/** Host-header check (G4): loopback hosts only (any port). */
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
  /** Process-wide upstream spend counter (G4): increments in lockstep with
   * every per-run budget consumption; at/over the cap every call fails as a
   * typed budget-exhausted BEFORE the adapter. */
  let totalCalls = 0;
  const maxTotalCalls = config.maxTotalCalls ?? DEFAULT_MAX_TOTAL_CALLS;
  let duplicateReplays = 0;
  const runBudgets = new Map<string, RunBudgetState>();

  const server = createServer((req, res) => {
    void route(req, res).catch(() => {
      // Absolute backstop: the route handler already maps every known
      // failure to a typed result; anything else becomes a bare 500 with no
      // internals echoed.
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal-error' }));
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Origin + Host enforcement for ALL routes, before any dispatch (G4).
    // No `connection: close` on the 403s — the connection stays reusable.
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
    // The origin gate above already rejected anything not equivalent to the
    // configured browser origin, so a present Origin here is safe to echo —
    // CORS requires ACAO to equal the request origin exactly, otherwise the
    // accepted loopback alias (127.0.0.1 / [::1]) is unusable in a browser.
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
    // Declared-size precheck so oversized clients get a clean 413 before the
    // body streams; the in-stream guard below remains the hard backstop and
    // drains (never destroys) on overflow, so chunked bodies with no
    // content-length get the same clean 413. No `connection: close` — the
    // old close+resume pair ECONNRESET multi-megabyte uploads.
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
      req.resume(); // body already past the cap; drain the rest so the socket stays clean
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

    // Registered identity checks beyond schema shape (section 10.3): only
    // the registered Mara model provider, only Mara, only the registered
    // condition, only the pinned prompt version — all against the shared
    // experiment literals (src/shared/modelExperiment.ts).
    if (
      envelope.providerId !== EXTERNAL_MARA_PROVIDER_ID ||
      envelope.request.npcId !== MODEL_TARGET_NPC_ID ||
      envelope.conditionId !== MODEL_CONDITION_ID ||
      envelope.promptVersion !== PROMPT_VERSION
    ) {
      json(res, 400, { error: 'unregistered-request' });
      return;
    }
    // Context-hash recomputation (section 10.4).
    if (externalContextHash(envelope.context) !== envelope.contextHash) {
      json(res, 400, { error: 'context-hash-mismatch' });
      return;
    }

    // Reduced idempotency (G3): looked up AFTER full validation, BEFORE any
    // budget/concurrency accounting. The budget state (with its results map)
    // is created here so the existing 64-run FIFO drops both together.
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
        // Same requestId, different content: a forgery or client bug, never
        // a duplicate — reject instead of replaying or double-spending.
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
    // The shared promise never rejects: waiters must always receive a
    // serializable terminal result.
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
    // Best-effort write-back: if the FIFO evicted this run mid-flight, the
    // run has forgotten its results — do NOT resurrect it.
    if (runBudgets.get(envelope.runId) === budget) {
      budget.results.set(requestId, {
        contextHash: envelope.contextHash,
        status: 'done',
        result: terminal,
      });
    }
    json(res, terminal.statusCode, terminal.body);
  }

  /** Owns everything after validation/idempotency for ONE non-duplicate
   * dispatch: the envelope sidecar, budget/concurrency/spend-cap checks, the
   * adapter call, identity-copying response construction, and the trace
   * write. The HTTP handler serializes the returned TerminalResult per
   * waiter. */
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

    // Envelope sidecar (G2, deviation D3): the exact validated envelope,
    // persisted once per non-duplicate dispatch — replays and rejects never
    // reach this point.
    trace.writeRequest(envelope.runId, envelope.request.requestId, envelope);

    // Budget, spend-cap, and concurrency limits (section 26 + G4): typed
    // failures, never a frozen simulation and never a silent drop.
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
        // Adapter-captured raw text when present, else the serialized parsed
        // choice — bounded by writeTrace before persisting.
        return failureResult(
          'invalid-model-output',
          false,
          adapterResult.meta,
          adapterResult.rawOutput ?? JSON.stringify(adapterResult.choice),
        );
      }
      const choice = choiceParsed.data as ModelChoice;
      // The gateway constructs the COMPLETE engine response itself; request,
      // NPC, scenario, and provider identity come from the validated
      // request, never from model text (section 14).
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
          null,
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

  function writeTrace(
    envelope: ExternalDecisionRequestEnvelope,
    gatewayOutcome: 'response' | ExternalFailureCode,
    choice: ModelChoice | null,
    meta: ModelChoiceMeta | null,
    rawOutput: string | null,
    latencyMs: number,
    concurrentInFlight: number,
  ): void {
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
      // The REQUESTED model (configuration), so run-manifest.final.json's
      // requestedModelId can be cross-checked against returnedModelIds
      // derived from the trace rows' upstream-reported modelId (S2).
      modelId: config.adapterKind === 'openai' ? config.openaiModel : adapter.id,
      modelSettings: {
        adapter: adapter.id,
        requestTimeoutMs: config.requestTimeoutMs,
        maxOutputTokens: config.maxOutputTokens,
        maxCallsPerRun: config.maxCallsPerRun,
        maxConcurrency: config.maxConcurrency,
      },
      startedAtUtc: new Date().toISOString(),
    });
    const requestId = envelope.request.requestId;
    // Raw model text is persisted (bounded) ONLY on invalid-model-output /
    // upstream-refusal outcomes; every other outcome — success included —
    // records null (trace schema v2).
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
      if (overflowed) return; // keep draining, buffer nothing
      size += chunk.length;
      if (size > maxBytes) {
        overflowed = true;
        chunks = []; // release what was buffered
        reject(new Error('body-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
