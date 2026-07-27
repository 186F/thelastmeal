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
  validateGatewayResultForRequest,
} from '../sim/decisions/externalSchemas';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
  MODEL_TARGET_NPC_ID,
} from '../shared/modelExperiment';
import { ModelClientTraceRecorder, type ModelClientTraceEntry } from './modelClientTraceRecorder';

/**
 * Main-thread model gateway client (milestone 001, section 16). The browser
 * stays an orchestrator, never an authority: it validates the worker's exact
 * decision-request, wraps it in the experiment envelope (with a
 * cryptographically random, noncanonical runId), forwards it to the LOCAL
 * gateway, validates whatever comes back, reconciles it against the request
 * it actually dispatched, and submits a response or a typed failure to the
 * worker — where the engine independently re-validates everything at its
 * acceptance gate.
 *
 * Limits (section 26): one in-flight upstream request, at most four queued,
 * a per-run call budget; overflow and every transport problem become typed
 * failures, so logical time never stops. Reset/scenario change aborts
 * in-flight work, and late responses from an old runId are discarded before
 * submission.
 *
 * Handshake pinning (re-audit remediation F2): connect() is tri-state. A
 * gateway that answers but advertises a contract different from the pinned
 * experiment literals is 'contract-mismatch' — that verdict LATCHES for the
 * current run (cleared by newRun()), every request fails fast with
 * 'invalid-gateway-response', and the config endpoint is NOT re-polled per
 * request. 'unreachable' keeps the original behavior: connect is retried per
 * dispatch and requests fail as 'gateway-unavailable'.
 *
 * Exact-request archive (1.5.0, C2): every request that passes the
 * schema/Mara/provider filter is archived as a COMPLETE prospective envelope
 * BEFORE the contract latch, budget, queue-cap, connect, and dispatch
 * decisions — so requests that never produce a gateway sidecar (overflow,
 * budget, latch, unreachable, post-stop) still leave exact bytes in the run
 * bundle. The archived and dispatched envelopes are built by the SAME
 * buildEnvelope() path and cannot diverge. A duplicate requestId with a
 * canonically identical envelope coalesces (first kept); a DIFFERING
 * duplicate never throws (the handler runs inside onmessage) — it records a
 * diagnostic and poisons the archive, which blocks bundle export.
 */

const providerConfigSchema = z
  .object({
    status: z.string(),
    experimentId: z.string().min(1),
    experimentVersion: z.string().min(1),
    conditionId: z.string().min(1),
    providerId: z.string().min(1),
    promptVersion: z.string().min(1),
    requestSchemaVersion: z.number().int(),
    modelId: z.string().min(1).nullable(),
  })
  .strict();

type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** The exact transport envelope shape POSTed to /v1/decision (and archived
 * client-side before any dispatch decision). */
type ExternalDecisionRequestEnvelope = z.infer<typeof externalDecisionRequestEnvelopeSchema>;

export type GatewayConnectResult = 'ok' | 'unreachable' | 'contract-mismatch';

/** Pinned contract fields, checked in order; the FIRST mismatch is recorded
 * for display. `modelId` is deliberately unchecked (operator-chosen). */
const CONTRACT_PINS: readonly [keyof ProviderConfig, string | number][] = [
  ['experimentId', MODEL_EXPERIMENT_ID],
  ['experimentVersion', MODEL_EXPERIMENT_VERSION],
  ['conditionId', MODEL_CONDITION_ID],
  ['providerId', EXTERNAL_MARA_PROVIDER_ID],
  ['promptVersion', MODEL_PROMPT_VERSION],
  ['requestSchemaVersion', EXTERNAL_REQUEST_SCHEMA_VERSION],
];

function firstContractMismatch(config: ProviderConfig): string | null {
  for (const [field, pinned] of CONTRACT_PINS) {
    if (config[field] !== pinned) return field;
  }
  return null;
}

export interface ModelGatewayStatus {
  connected: boolean;
  /** First provider-config field that mismatched the pinned contract; null
   * while no contract mismatch is latched for the current run. */
  contractMismatchField: string | null;
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
  /** True while ANY request is unresolved: pumping, in flight, or queued.
   * The export idle predicate uses THIS, not queued/pending — those report
   * a false idle in the window between queue.shift() and pendingRequestId
   * being set (1.5.0, C4). */
  busy: boolean;
  /** True once a duplicate requestId arrived with a canonically DIFFERENT
   * envelope (C2): the exact-request archive can no longer attest the run
   * and bundle export is blocked until newRun(). */
  archivePoisoned: boolean;
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

interface QueuedRequest {
  external: ExternalDecisionRequest;
  queuedAtUtc: string;
}

/** Wall-clock timing threaded alongside a request for the slim client trace
 * (noncanonical diagnostics only; never a join key). */
interface TraceTiming {
  queuedAtUtc: string;
  dispatchedAtUtc: string | null;
  latencyMs: number | null;
}

export class ModelGatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxQueued: number;
  private readonly maxCallsPerRun: number;
  private readonly fetchImpl: typeof fetch;
  private readonly makeRunId: () => string;
  private readonly trace = new ModelClientTraceRecorder();

  private runId: string;
  private providerConfig: ProviderConfig | null = null;
  /** Contract-mismatch latch (re-audit remediation F2): the first mismatched
   * provider-config field, held for the WHOLE run — cleared only by
   * newRun(). While latched connect() never re-polls the gateway. */
  private contractMismatchField: string | null = null;
  private queue: QueuedRequest[] = [];
  private inFlight: AbortController | null = null;
  /** Synchronous single-flight latch: set BEFORE any await inside the pump
   * loop, so re-entrant pump() calls can never dispatch concurrently
   * (adversarial review: the old guard claimed the slot only after the
   * connect() await, allowing N concurrent upstream POSTs). */
  private pumping = false;
  private callsThisRun = 0;
  private failedRequestIds = new Set<string>();
  /** Exact-request archive (C2): one deep-copied prospective envelope per
   * requestId, captured at handleDecisionRequest time BEFORE any dispatch
   * decision. `json` is the compact serialization of the FIRST-seen envelope,
   * kept for the canonical duplicate comparison. */
  private readonly requestArchive = new Map<
    string,
    { envelope: ExternalDecisionRequestEnvelope; json: string }
  >();
  /** Duplicate-conflict poison messages (C2); empty in healthy runs. */
  private archiveDiagnosticsLog: string[] = [];
  private archivePoisonedFlag = false;
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
      contractMismatchField: this.contractMismatchField,
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
      busy: this.pumping || this.inFlight !== null || this.queue.length > 0,
      archivePoisoned: this.archivePoisonedFlag,
    };
  }

  private publish(): void {
    this.status.queuedRequests = this.queue.length;
    this.status.busy = this.pumping || this.inFlight !== null || this.queue.length > 0;
    this.status.archivePoisoned = this.archivePoisonedFlag;
    this.options.onStatus?.({ ...this.status, failuresByCode: { ...this.status.failuresByCode } });
  }

  get currentRunId(): string {
    return this.runId;
  }

  /** Snapshot of the slim client trace (F4): one entry per request this
   * client ever saw for the current run, plus any late `discarded-stale-run`
   * entries recorded since the last newRun(). */
  clientTraceEntries(): ModelClientTraceEntry[] {
    return this.trace.entries();
  }

  /** Snapshot of the exact-request archive (C2): one complete prospective
   * envelope per requestId seen this run, deep-copied, sorted by requestId. */
  exactRequestEnvelopes(): ExternalDecisionRequestEnvelope[] {
    return [...this.requestArchive.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, entry]) => structuredClone(entry.envelope));
  }

  /** Duplicate-conflict poison messages (C2); empty in healthy runs. */
  archiveDiagnostics(): string[] {
    return [...this.archiveDiagnosticsLog];
  }

  /** True once a differing-duplicate conflict poisoned the archive (C2). */
  archivePoisoned(): boolean {
    return this.archivePoisonedFlag;
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

  /** Starts a fresh run: aborts in-flight work, clears the queue, the
   * client trace, and the exact-request archive (with its diagnostics and
   * poison flag), releases the contract-mismatch latch, mints a new
   * noncanonical runId. Called on scenario load and reset. */
  newRun(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.queue = [];
    this.callsThisRun = 0;
    this.failedRequestIds.clear();
    this.contractMismatchField = null;
    this.trace.reset();
    this.requestArchive.clear();
    this.archiveDiagnosticsLog = [];
    this.archivePoisonedFlag = false;
    this.runId = this.makeRunId();
    this.status = this.freshStatus();
    this.publish();
  }

  /** Fetches /v1/provider-config and pins the advertised contract against
   * the shared experiment literals. Safe to call repeatedly. Bounded by the
   * client timeout — a gateway that accepts connections but never answers
   * must degrade into typed gateway-unavailable failures, never a silently
   * stuck queue. A latched contract-mismatch short-circuits WITHOUT
   * re-polling until newRun(). */
  async connect(): Promise<GatewayConnectResult> {
    if (this.contractMismatchField !== null) return 'contract-mismatch';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let config: ProviderConfig | null = null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/provider-config`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const parsed = providerConfigSchema.safeParse(await response.json());
      if (parsed.success) config = parsed.data;
    } catch {
      config = null;
    } finally {
      clearTimeout(timer);
    }
    let result: GatewayConnectResult;
    if (config === null) {
      this.providerConfig = null;
      result = 'unreachable';
    } else {
      const mismatch = firstContractMismatch(config);
      if (mismatch !== null) {
        this.providerConfig = null;
        this.contractMismatchField = mismatch;
        result = 'contract-mismatch';
      } else {
        this.providerConfig = config;
        result = 'ok';
      }
    }
    this.status.connected = this.providerConfig !== null;
    this.status.contractMismatchField = this.contractMismatchField;
    this.status.providerId = this.providerConfig?.providerId ?? null;
    this.status.promptVersion = this.providerConfig?.promptVersion ?? null;
    this.status.modelId = this.providerConfig?.modelId ?? null;
    this.publish();
    return result;
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
    if (request.npcId !== MODEL_TARGET_NPC_ID || request.providerId !== EXTERNAL_MARA_PROVIDER_ID) {
      return;
    }

    // Exact-request archive (C2): capture the complete prospective envelope
    // BEFORE the contract latch, budget, queue-cap, connect, and dispatch —
    // so every typed failure below still leaves exact bytes in the bundle.
    this.archiveRequest(external);

    const queuedAtUtc = new Date().toISOString();
    if (this.contractMismatchField !== null) {
      // Latched contract mismatch: fail fast, never POST, never re-poll.
      this.failRequest(external, 'invalid-gateway-response', false, {
        queuedAtUtc,
        dispatchedAtUtc: null,
        latencyMs: null,
      });
      return;
    }
    if (this.callsThisRun >= this.maxCallsPerRun) {
      this.failRequest(external, 'budget-exhausted', false, {
        queuedAtUtc,
        dispatchedAtUtc: null,
        latencyMs: null,
      });
      return;
    }
    if (this.queue.length >= this.maxQueued) {
      this.failRequest(external, 'budget-exhausted', false, {
        queuedAtUtc,
        dispatchedAtUtc: null,
        latencyMs: null,
      });
      return;
    }
    this.queue.push({ external, queuedAtUtc });
    this.publish();
    void this.pump();
  }

  /** Builds the transport envelope for a request with the CURRENT runId and
   * the pinned prompt version. The single code path shared by the archive
   * (handleDecisionRequest time) and the dispatch POST (C2) — the archived
   * and dispatched bytes cannot diverge. */
  private buildEnvelope(external: ExternalDecisionRequest): ExternalDecisionRequestEnvelope {
    return {
      schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      conditionId: MODEL_CONDITION_ID,
      runId: this.runId,
      providerId: external.request.providerId,
      // Pinned constant, NOT the gateway-advertised value: connect() already
      // proved they match, and the envelope must never drift with a gateway.
      promptVersion: MODEL_PROMPT_VERSION,
      contextHash: external.contextHash,
      request: external.request,
      context: external.context,
      truncationCounts: external.truncationCounts,
    };
  }

  /** Archives a deep copy of the prospective envelope keyed by requestId
   * (C2). Duplicate rule: a canonically identical envelope coalesces (first
   * kept); a DIFFERING envelope for the same requestId records a diagnostic
   * and poisons the archive — it never throws (this runs inside onmessage
   * with no catch) and never replaces the earlier envelope. */
  private archiveRequest(external: ExternalDecisionRequest): void {
    const requestId = external.request.requestId;
    const envelope = this.buildEnvelope(external);
    const json = JSON.stringify(envelope);
    const existing = this.requestArchive.get(requestId);
    if (existing === undefined) {
      this.requestArchive.set(requestId, { envelope: structuredClone(envelope), json });
      return;
    }
    if (existing.json === json) return; // identical duplicate: keep the first
    this.archiveDiagnosticsLog.push(
      `duplicate-request-conflict: requestId ${requestId} re-seen with a ` +
        `canonically different envelope in run ${this.runId}; first envelope kept`,
    );
    this.archivePoisonedFlag = true;
    this.publish();
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
      // Publish the idle transition (C4): every publish during dispatch runs
      // while `pumping` is still true, so without this final publish the
      // status surface would latch `busy: true` after the last request and
      // the export button's idle predicate could never enable.
      this.publish();
    }
  }

  private async dispatchNext(item: QueuedRequest): Promise<void> {
    const { external, queuedAtUtc } = item;
    const requestRunId = this.runId;
    if (this.providerConfig === null) {
      if (this.contractMismatchField !== null) {
        this.failRequest(external, 'invalid-gateway-response', false, {
          queuedAtUtc,
          dispatchedAtUtc: null,
          latencyMs: null,
        });
        return;
      }
      const connectResult = await this.connect();
      if (this.runId !== requestRunId) {
        this.recordDiscardedStaleRun(external, requestRunId, {
          queuedAtUtc,
          dispatchedAtUtc: null,
          latencyMs: null,
        });
        return;
      }
      if (connectResult === 'contract-mismatch') {
        this.failRequest(external, 'invalid-gateway-response', false, {
          queuedAtUtc,
          dispatchedAtUtc: null,
          latencyMs: null,
        });
        return;
      }
      if (this.providerConfig === null) {
        this.failRequest(external, 'gateway-unavailable', true, {
          queuedAtUtc,
          dispatchedAtUtc: null,
          latencyMs: null,
        });
        return;
      }
    }

    this.callsThisRun += 1;
    this.status.callsAttempted += 1;
    this.status.pendingRequestId = external.request.requestId;
    this.publish();

    // Same construction path as the archive (C2): the dispatched bytes are
    // exactly the archived bytes for this runId.
    const envelope = this.buildEnvelope(external);
    const envelopeParsed = externalDecisionRequestEnvelopeSchema.safeParse(envelope);
    if (!envelopeParsed.success) {
      this.status.pendingRequestId = null;
      this.failRequest(external, 'invalid-gateway-response', false, {
        queuedAtUtc,
        dispatchedAtUtc: null,
        latencyMs: null,
      });
      return;
    }

    const controller = new AbortController();
    this.inFlight = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    const dispatchedAtUtc = new Date().toISOString();
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

    const latencyMs = Date.now() - startedAt;
    // Late results from an old run are discarded BEFORE submission; the
    // engine would reject them anyway, but they must never reach it. The
    // slim trace still records the discard (clientOutcome
    // 'discarded-stale-run').
    if (this.runId !== requestRunId) {
      this.recordDiscardedStaleRun(external, requestRunId, {
        queuedAtUtc,
        dispatchedAtUtc,
        latencyMs,
      });
      return;
    }
    this.status.pendingRequestId = null;
    this.status.lastLatencyMs = latencyMs;

    if (outcome.kind !== 'result') {
      this.failRequest(external, outcome.kind, outcome.kind !== 'client-aborted', {
        queuedAtUtc,
        dispatchedAtUtc,
        latencyMs,
      });
      return;
    }
    const result = gatewayDecisionResultSchema.safeParse(outcome.value);
    if (!result.success) {
      this.failRequest(external, 'invalid-gateway-response', false, {
        queuedAtUtc,
        dispatchedAtUtc,
        latencyMs,
      });
      return;
    }
    // Result reconciliation (re-audit remediation F3), BEFORE any counter
    // increments and for BOTH branches: a schema-valid result that answers a
    // different request (or picks an unoffered affordance) is a typed
    // failure for the ORIGINAL request; the mismatched identity is never
    // forwarded to the worker.
    if (validateGatewayResultForRequest(result.data, external.request) !== null) {
      this.failRequest(external, 'invalid-gateway-response', false, {
        queuedAtUtc,
        dispatchedAtUtc,
        latencyMs,
      });
      return;
    }
    if (result.data.outcome === 'response') {
      this.status.gatewayResponses += 1;
      this.status.inputTokens += result.data.usage?.inputTokens ?? 0;
      this.status.outputTokens += result.data.usage?.outputTokens ?? 0;
      this.trace.record(
        this.traceEntry(
          external,
          requestRunId,
          {
            queuedAtUtc,
            dispatchedAtUtc,
            latencyMs,
          },
          {
            clientOutcome: 'response',
            clientFailureCode: null,
            responseId: result.data.response.responseId,
            failureId: null,
            // Explicit stamp at the result-parse site (A2): this HTTP result
            // was produced by the gateway.
            gatewayResultObserved: true,
          },
        ),
      );
      this.publish();
      this.options.submitResponse(result.data.response);
    } else {
      this.trace.record(
        this.traceEntry(
          external,
          requestRunId,
          {
            queuedAtUtc,
            dispatchedAtUtc,
            latencyMs,
          },
          {
            clientOutcome: 'failure',
            clientFailureCode: result.data.failure.failureCode,
            responseId: null,
            failureId: result.data.failure.failureId,
            // Explicit stamp at the result-parse site (A2): a parsed gateway
            // failure BODY (gwf- id) is gateway evidence, unlike the
            // client-minted cf- failures below.
            gatewayResultObserved: true,
          },
        ),
      );
      this.recordFailure(result.data.failure.failureCode);
      this.options.submitFailure(result.data.failure);
    }
  }

  private traceEntry(
    external: ExternalDecisionRequest,
    runId: string,
    timing: TraceTiming,
    outcome: Pick<
      ModelClientTraceEntry,
      'clientOutcome' | 'clientFailureCode' | 'responseId' | 'failureId' | 'gatewayResultObserved'
    >,
  ): ModelClientTraceEntry {
    return {
      runId,
      conditionId: MODEL_CONDITION_ID,
      requestId: external.request.requestId,
      npcId: external.request.npcId,
      scenarioId: external.request.scenarioId,
      providerId: external.request.providerId,
      promptVersionExpected: MODEL_PROMPT_VERSION,
      requestedAtTick: external.request.requestedAtTick,
      contextHash: external.contextHash,
      queuedAtUtc: timing.queuedAtUtc,
      dispatchedAtUtc: timing.dispatchedAtUtc,
      completedAtUtc: new Date().toISOString(),
      clientOutcome: outcome.clientOutcome,
      clientFailureCode: outcome.clientFailureCode,
      responseId: outcome.responseId,
      failureId: outcome.failureId,
      clientLatencyMs: timing.latencyMs,
      gatewayResultObserved: outcome.gatewayResultObserved,
    };
  }

  private recordDiscardedStaleRun(
    external: ExternalDecisionRequest,
    runId: string,
    timing: TraceTiming,
  ): void {
    this.trace.record(
      this.traceEntry(external, runId, timing, {
        clientOutcome: 'discarded-stale-run',
        clientFailureCode: null,
        responseId: null,
        failureId: null,
        // A discarded stale result is never gateway evidence for the CURRENT
        // run's strict reconciliation (A2/A6 carve-out).
        gatewayResultObserved: false,
      }),
    );
  }

  private failRequest(
    external: ExternalDecisionRequest,
    failureCode: ExternalFailureCode,
    retryable: boolean,
    timing: TraceTiming,
  ): void {
    if (this.failedRequestIds.has(external.request.requestId)) return;
    this.failedRequestIds.add(external.request.requestId);
    if (this.failedRequestIds.size > 512) {
      const oldest = this.failedRequestIds.values().next().value;
      if (oldest !== undefined) this.failedRequestIds.delete(oldest);
    }
    this.trace.record(
      this.traceEntry(external, this.runId, timing, {
        clientOutcome: 'failure',
        clientFailureCode: failureCode,
        responseId: null,
        failureId: `cf-${external.request.requestId}`,
        // Client-minted cf- failure (A2): timeout/unreachable/budget/latch/
        // invalid transport result — the gateway produced NO parsed result.
        gatewayResultObserved: false,
      }),
    );
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
