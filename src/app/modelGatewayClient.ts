import { z } from 'zod';
import type {
  DecisionResponse,
  ExternalDecisionFailure,
  ExternalDecisionRequest,
  ExternalFailureCode,
} from '../shared/decisionContracts';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
  externalDecisionRequestSchema,
  gatewayDecisionResultSchema,
} from '../sim/decisions/externalSchemas';
import { MODEL_EXPERIMENT_ID, MODEL_EXPERIMENT_VERSION } from '../sim/decisions/conditions';
import { EXTERNAL_MARA_PROVIDER_ID } from '../sim/decisions/externalDeferredProvider';

/**
 * Main-thread model gateway client (milestone 001, section 16). The browser
 * stays an orchestrator, never an authority: it validates the worker's exact
 * decision-request, wraps it in the experiment envelope (with a
 * cryptographically random, noncanonical runId), forwards it to the LOCAL
 * gateway, validates whatever comes back, and submits a response or a typed
 * failure to the worker — where the engine independently re-validates
 * everything at its acceptance gate.
 *
 * Limits (section 26): one in-flight upstream request, at most four queued,
 * a per-run call budget; overflow and every transport problem become typed
 * failures, so logical time never stops. Reset/scenario change aborts
 * in-flight work, and late responses from an old runId are discarded before
 * submission.
 */

const providerConfigSchema = z
  .object({
    status: z.string(),
    providerId: z.string().min(1),
    promptVersion: z.string().min(1),
    modelId: z.string().min(1).nullable(),
    experimentVersion: z.string().min(1),
    requestSchemaVersion: z.number().int(),
  })
  .strict();

export interface ModelGatewayStatus {
  connected: boolean;
  providerId: string | null;
  promptVersion: string | null;
  modelId: string | null;
  runId: string;
  callsAttempted: number;
  gatewayResponses: number;
  gatewayFailures: number;
  failuresByCode: Record<string, number>;
  lastLatencyMs: number | null;
  queuedRequests: number;
  pendingRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelGatewayClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxQueued?: number;
  maxCallsPerRun?: number;
  fetchImpl?: typeof fetch;
  makeRunId?: () => string;
  submitResponse: (response: DecisionResponse) => void;
  submitFailure: (failure: ExternalDecisionFailure) => void;
  onStatus?: (status: ModelGatewayStatus) => void;
}

export class ModelGatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxQueued: number;
  private readonly maxCallsPerRun: number;
  private readonly fetchImpl: typeof fetch;
  private readonly makeRunId: () => string;

  private runId: string;
  private providerConfig: z.infer<typeof providerConfigSchema> | null = null;
  private queue: ExternalDecisionRequest[] = [];
  private inFlight: AbortController | null = null;
  /** Synchronous single-flight latch: set BEFORE any await inside the pump
   * loop, so re-entrant pump() calls can never dispatch concurrently
   * (adversarial review: the old guard claimed the slot only after the
   * connect() await, allowing N concurrent upstream POSTs). */
  private pumping = false;
  private callsThisRun = 0;
  private failedRequestIds = new Set<string>();
  private status: ModelGatewayStatus;

  constructor(private readonly options: ModelGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxQueued = options.maxQueued ?? 4;
    this.maxCallsPerRun = options.maxCallsPerRun ?? 80;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.makeRunId = options.makeRunId ?? (() => crypto.randomUUID());
    this.runId = this.makeRunId();
    this.status = this.freshStatus();
  }

  private freshStatus(): ModelGatewayStatus {
    return {
      connected: this.providerConfig !== null,
      providerId: this.providerConfig?.providerId ?? null,
      promptVersion: this.providerConfig?.promptVersion ?? null,
      modelId: this.providerConfig?.modelId ?? null,
      runId: this.runId,
      callsAttempted: 0,
      gatewayResponses: 0,
      gatewayFailures: 0,
      failuresByCode: {},
      lastLatencyMs: null,
      queuedRequests: 0,
      pendingRequestId: null,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  private publish(): void {
    this.status.queuedRequests = this.queue.length;
    this.options.onStatus?.({ ...this.status, failuresByCode: { ...this.status.failuresByCode } });
  }

  get currentRunId(): string {
    return this.runId;
  }

  /** Test/diagnostic helper: resolves once nothing is queued, pumping, or in
   * flight. */
  async settle(timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (this.pumping || this.inFlight !== null || this.queue.length > 0) {
      if (Date.now() - start > timeoutMs) throw new Error('gateway-client-settle-timeout');
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  /** Starts a fresh run: aborts in-flight work, clears the queue, mints a
   * new noncanonical runId. Called on scenario load and reset. */
  newRun(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.queue = [];
    this.callsThisRun = 0;
    this.failedRequestIds.clear();
    this.runId = this.makeRunId();
    this.status = this.freshStatus();
    this.publish();
  }

  /** Fetches /v1/provider-config; the envelope needs the gateway's pinned
   * prompt version. Safe to call repeatedly. Bounded by the client timeout —
   * a gateway that accepts connections but never answers must degrade into
   * typed gateway-unavailable failures, never a silently stuck queue. */
  async connect(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/provider-config`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const parsed = providerConfigSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.requestSchemaVersion !== EXTERNAL_REQUEST_SCHEMA_VERSION) {
        this.providerConfig = null;
      } else {
        this.providerConfig = parsed.data;
      }
    } catch {
      this.providerConfig = null;
    } finally {
      clearTimeout(timer);
    }
    this.status.connected = this.providerConfig !== null;
    this.status.providerId = this.providerConfig?.providerId ?? null;
    this.status.promptVersion = this.providerConfig?.promptVersion ?? null;
    this.status.modelId = this.providerConfig?.modelId ?? null;
    this.publish();
    return this.providerConfig !== null;
  }

  /**
   * Entry point for worker decision-requests. Only exact-valid requests for
   * Mara's registered external provider are forwarded — baseline conditions
   * and Jonas/Rin can never cause a gateway call (the caller additionally
   * gates on the selected condition).
   */
  handleDecisionRequest(external: ExternalDecisionRequest): void {
    const parsed = externalDecisionRequestSchema.safeParse(external);
    if (!parsed.success) return;
    const { request } = external;
    if (request.npcId !== 'mara' || request.providerId !== EXTERNAL_MARA_PROVIDER_ID) return;

    if (this.callsThisRun >= this.maxCallsPerRun) {
      this.failRequest(external, 'budget-exhausted', false);
      return;
    }
    if (this.queue.length >= this.maxQueued) {
      this.failRequest(external, 'budget-exhausted', false);
      return;
    }
    this.queue.push(external);
    this.publish();
    void this.pump();
  }

  private async pump(): Promise<void> {
    // The latch is taken and released SYNCHRONOUSLY around the whole loop:
    // between `pumping = true` and the first await there is no suspension
    // point, so a second pump() invocation can never pass the guard while a
    // request is being dispatched (single-flight, section 26).
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        await this.dispatchNext(this.queue.shift()!);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async dispatchNext(external: ExternalDecisionRequest): Promise<void> {
    const requestRunId = this.runId;
    if (this.providerConfig === null) {
      await this.connect();
      if (this.runId !== requestRunId) return;
      if (this.providerConfig === null) {
        this.failRequest(external, 'gateway-unavailable', true);
        return;
      }
    }

    this.callsThisRun += 1;
    this.status.callsAttempted += 1;
    this.status.pendingRequestId = external.request.requestId;
    this.publish();

    const envelope = {
      schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      conditionId: 'mara-model-per-decision-v1' as const,
      runId: this.runId,
      providerId: external.request.providerId,
      promptVersion: this.providerConfig.promptVersion,
      contextHash: external.contextHash,
      request: external.request,
      context: external.context,
      truncationCounts: external.truncationCounts,
    };
    const envelopeParsed = externalDecisionRequestEnvelopeSchema.safeParse(envelope);
    if (!envelopeParsed.success) {
      this.status.pendingRequestId = null;
      this.failRequest(external, 'invalid-gateway-response', false);
      return;
    }

    const controller = new AbortController();
    this.inFlight = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let outcome: { kind: 'result'; value: unknown } | { kind: ExternalFailureCode };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      outcome = response.ok
        ? { kind: 'result', value: await response.json() }
        : { kind: 'invalid-gateway-response' };
    } catch {
      outcome = controller.signal.aborted
        ? this.runId === requestRunId
          ? { kind: 'request-timeout' }
          : { kind: 'client-aborted' }
        : { kind: 'gateway-unavailable' };
    } finally {
      clearTimeout(timer);
      if (this.inFlight === controller) this.inFlight = null;
    }

    // Late results from an old run are discarded BEFORE submission; the
    // engine would reject them anyway, but they must never reach it.
    if (this.runId !== requestRunId) return;
    this.status.pendingRequestId = null;
    this.status.lastLatencyMs = Date.now() - startedAt;

    if (outcome.kind !== 'result') {
      this.failRequest(external, outcome.kind, outcome.kind !== 'client-aborted');
      return;
    }
    const result = gatewayDecisionResultSchema.safeParse(outcome.value);
    if (!result.success) {
      this.failRequest(external, 'invalid-gateway-response', false);
      return;
    }
    if (result.data.outcome === 'response') {
      this.status.gatewayResponses += 1;
      this.status.inputTokens += result.data.usage?.inputTokens ?? 0;
      this.status.outputTokens += result.data.usage?.outputTokens ?? 0;
      this.publish();
      this.options.submitResponse(result.data.response);
    } else {
      this.recordFailure(result.data.failure.failureCode);
      this.options.submitFailure(result.data.failure);
    }
  }

  private failRequest(
    external: ExternalDecisionRequest,
    failureCode: ExternalFailureCode,
    retryable: boolean,
  ): void {
    if (this.failedRequestIds.has(external.request.requestId)) return;
    this.failedRequestIds.add(external.request.requestId);
    if (this.failedRequestIds.size > 512) {
      const oldest = this.failedRequestIds.values().next().value;
      if (oldest !== undefined) this.failedRequestIds.delete(oldest);
    }
    this.recordFailure(failureCode);
    this.options.submitFailure({
      failureId: `cf-${external.request.requestId}`,
      requestId: external.request.requestId,
      npcId: external.request.npcId,
      scenarioId: external.request.scenarioId,
      providerId: external.request.providerId,
      failureCode,
      retryable,
    });
  }

  private recordFailure(code: string): void {
    this.status.gatewayFailures += 1;
    this.status.failuresByCode[code] = (this.status.failuresByCode[code] ?? 0) + 1;
    this.publish();
  }
}
