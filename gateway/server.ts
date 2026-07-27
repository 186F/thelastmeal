import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { GatewayConfig } from './config';
import { publicConfig } from './config';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  MODEL_EXPERIMENT_VERSION,
  externalContextHash,
  externalDecisionRequestEnvelopeSchema,
  type ExternalDecisionRequestEnvelope,
  type GatewayDecisionResult,
} from './schemas';
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
 * Responsibilities, in order, for POST /v1/decision:
 *   1. exact envelope validation (size-limited, JSON-only, origin-checked)
 *   2. registered provider / experiment / condition / prompt / Mara identity
 *   3. context-hash recomputation
 *   4. concurrency and per-run budget limits
 *   5. server-owned prompt construction
 *   6. adapter call under an abort-on-timeout signal
 *   7. strict structured-output validation over the DYNAMIC offered-ID enum
 *   8. engine DecisionResponse constructed HERE, identity fields copied from
 *      the validated request — never from model text
 *   9. noncanonical trace entry
 *  10. a valid response or a typed failure — the transport never throws
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

interface RunBudgetState {
  calls: number;
}

export function createGateway(
  config: GatewayConfig,
  adapter: ModelDecisionAdapter,
  trace: ModelTraceWriter,
): GatewayInstance {
  let inFlight = 0;
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
    applyCors(res);
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

  function applyCors(res: ServerResponse): void {
    res.setHeader('access-control-allow-origin', config.allowedBrowserOrigin);
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
    // body streams; the in-stream guard below remains the hard backstop.
    const declaredLength = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > config.maxRequestBodyBytes) {
      res.setHeader('connection', 'close');
      json(res, 413, { error: 'request-too-large' });
      req.resume();
      return;
    }
    let body: string;
    try {
      body = await readBody(req, config.maxRequestBodyBytes);
    } catch {
      json(res, 413, { error: 'request-too-large' });
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

    const startedAt = Date.now();
    let dispatchedConcurrency = 0;
    const finishFailure = (failureCode: ExternalFailureCode, retryable: boolean): void => {
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
      writeTrace(envelope, failureCode, null, null, Date.now() - startedAt, dispatchedConcurrency);
      json(res, 200, result);
    };

    // Registered identity checks beyond schema shape (section 10.3): only
    // the registered Mara model provider, only Mara, only the registered
    // condition, only the pinned prompt version.
    if (
      envelope.providerId !== EXTERNAL_MARA_PROVIDER_ID ||
      envelope.request.npcId !== 'mara' ||
      envelope.conditionId !== 'mara-model-per-decision-v1' ||
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

    // Budget and concurrency limits (section 26): typed failures, never a
    // frozen simulation and never a silent drop.
    const budget = runBudgets.get(envelope.runId) ?? { calls: 0 };
    runBudgets.set(envelope.runId, budget);
    if (runBudgets.size > 64) {
      const oldest = runBudgets.keys().next().value;
      if (oldest !== undefined && oldest !== envelope.runId) runBudgets.delete(oldest);
    }
    if (budget.calls >= config.maxCallsPerRun) {
      finishFailure('budget-exhausted', false);
      return;
    }
    if (inFlight >= config.maxConcurrency) {
      finishFailure('budget-exhausted', true);
      return;
    }
    budget.calls += 1;
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
        writeTrace(
          envelope,
          'invalid-model-output',
          null,
          adapterResult.meta,
          Date.now() - startedAt,
          dispatchedConcurrency,
        );
        json(res, 200, {
          outcome: 'failure',
          failure: {
            failureId: `gwf-${envelope.request.requestId}`,
            requestId: envelope.request.requestId,
            npcId: envelope.request.npcId,
            scenarioId: envelope.request.scenarioId,
            providerId: envelope.providerId,
            failureCode: 'invalid-model-output',
            retryable: false,
          },
        } satisfies GatewayDecisionResult);
        return;
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
        Date.now() - startedAt,
        dispatchedConcurrency,
      );
      json(res, 200, result);
    } catch (error) {
      if (error instanceof AdapterFailure) {
        finishFailure(error.failureCode, error.failureCode === 'upstream-timeout');
      } else if (controller.signal.aborted) {
        finishFailure('upstream-timeout', true);
      } else {
        finishFailure('upstream-error', false);
      }
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
    latencyMs: number,
    concurrentInFlight: number,
  ): void {
    trace.seedManifest({
      traceSchemaVersion: 1,
      experimentId: envelope.experimentId,
      experimentVersion: envelope.experimentVersion,
      conditionId: envelope.conditionId,
      runId: envelope.runId,
      scenarioId: envelope.request.scenarioId,
      providerPlanId: envelope.conditionId,
      externalProviderId: envelope.providerId,
      promptVersion: envelope.promptVersion,
      modelId: meta?.modelId ?? null,
      modelSettings: {
        adapter: adapter.id,
        requestTimeoutMs: config.requestTimeoutMs,
        maxOutputTokens: config.maxOutputTokens,
        maxCallsPerRun: config.maxCallsPerRun,
        maxConcurrency: config.maxConcurrency,
      },
      startedAtUtc: new Date().toISOString(),
    });
    trace.append({
      runId: envelope.runId,
      requestId: envelope.request.requestId,
      npcId: envelope.request.npcId,
      scenarioId: envelope.request.scenarioId,
      logicalRequestedTick: envelope.request.requestedAtTick,
      providerId: envelope.providerId,
      promptVersion: envelope.promptVersion,
      modelId: meta?.modelId ?? null,
      contextHash: envelope.contextHash,
      truncationCounts: { ...envelope.truncationCounts },
      upstreamResponseId: meta?.upstreamResponseId ?? null,
      selectedAffordanceId: choice?.selectedAffordanceId ?? null,
      reasonCode: choice?.reasonCode ?? null,
      confidenceBp: choice?.confidenceBp ?? null,
      rationale: choice?.rationale ?? null,
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
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
