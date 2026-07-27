import { describe, expect, it } from 'vitest';
import { ModelGatewayClient, type ModelGatewayStatus } from '../../src/app/modelGatewayClient';
import { buildRunBundle, canExportRunBundle } from '../../src/app/runBundle';
import { ViewStore, type ViewState } from '../../src/app/store';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { runBundleSchema, type RunBundle } from '../../src/shared/modelArtifacts';
import {
  BASELINE_CONDITION_ID,
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';
import type {
  DecisionResponse,
  ExternalDecisionFailure,
  ExternalDecisionRequest,
} from '../../src/shared/decisionContracts';

/**
 * Re-audit remediation F9: the run-bundle exporter (the ONLY producer of
 * client-bundle.json) previously lived untyped and untested inside the model
 * panel's click handler. These tests drive a mixed run through the real
 * ModelGatewayClient (same stub-harness pattern as
 * model-gateway-client.test.ts), assemble the bundle with the extracted pure
 * buildRunBundle(), and hold it against the shared `runBundleSchema` — the
 * exact schema scripts/model/prepareRun.ts parses after a paid live run.
 */

const PROVIDER_CONFIG = JSON.stringify({
  status: 'ok',
  experimentId: 'model-backed-npc-001',
  experimentVersion: '1.0.0',
  conditionId: 'mara-model-per-decision-v1',
  providerId: 'openai-mara-action-v1',
  promptVersion: 'mara-action-selection-1.0.0',
  requestSchemaVersion: 1,
  modelId: 'fake-adapter',
});

let requestPool: ExternalDecisionRequest[] | null = null;
function genuineRequests(count: number): ExternalDecisionRequest[] {
  if (!requestPool || requestPool.length < count) {
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    while (run.externalRequests.length < count && run.state.tick < 2_000) stepTick(run);
    requestPool = [...run.externalRequests];
  }
  expect(requestPool.length).toBeGreaterThanOrEqual(count);
  return requestPool.slice(0, count);
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function decisionResultFor(request: ExternalDecisionRequest): string {
  return JSON.stringify({
    outcome: 'response',
    response: {
      responseId: `gw-${request.request.requestId}`,
      requestId: request.request.requestId,
      npcId: request.request.npcId,
      scenarioId: request.request.scenarioId,
      providerId: request.request.providerId,
      selectedAffordanceId: request.request.offeredAffordanceIds[0]!,
      confidenceBp: 5_000,
      reasonCode: 'routine',
      scores: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
}

interface StubOptions {
  decisionDelayMs?: number;
  ignoreAbort?: boolean;
  /** Per-request /v1/decision body override; undefined = default success. */
  decisionBodyFor?: (requestId: string, request: ExternalDecisionRequest) => string | undefined;
}

function makeClient(options: StubOptions) {
  const responses: DecisionResponse[] = [];
  const failures: ExternalDecisionFailure[] = [];
  const statuses: ModelGatewayStatus[] = [];

  const fetchImpl: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      const signal = init?.signal ?? null;
      if (url.endsWith('/v1/provider-config')) {
        setTimeout(() => resolve(jsonResponse(PROVIDER_CONFIG)), 0);
        return;
      }
      const body = JSON.parse(String(init?.body)) as { request: { requestId: string } };
      const request = requestPool!.find((r) => r.request.requestId === body.request.requestId)!;
      if (!options.ignoreAbort) {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }
      setTimeout(
        () =>
          resolve(
            jsonResponse(
              options.decisionBodyFor?.(request.request.requestId, request) ??
                decisionResultFor(request),
            ),
          ),
        options.decisionDelayMs ?? 0,
      );
    });

  let runCounter = 0;
  const client = new ModelGatewayClient({
    baseUrl: 'http://gateway.test',
    timeoutMs: 200,
    fetchImpl,
    makeRunId: () => `run-bundle-${String((runCounter += 1)).padStart(4, '0')}`,
    submitResponse: (response) => responses.push(response),
    submitFailure: (failure) => failures.push(failure),
    onStatus: (status) => statuses.push(status),
  });
  return {
    client,
    responses,
    failures,
    lastStatus: () => statuses[statuses.length - 1],
  };
}

/** A terminal model-condition ViewState, the shape the panel exports from. */
function terminalState(gateway: ModelGatewayStatus | null): ViewState {
  const state = new ViewStore().state;
  state.runStatus = 'complete';
  state.selectedConditionId = MODEL_CONDITION_ID;
  state.selectedScenarioId = 'A';
  state.finalWorldHash = '0123456789abcdef';
  state.finalLedgerHash = 'fedcba9876543210';
  state.model.gateway = gateway;
  return state;
}

/** Mirror of the panel's export flow: the enable predicate gates assembly. */
function attemptExport(state: ViewState, client: ModelGatewayClient): RunBundle | null {
  if (!canExportRunBundle(state)) return null;
  return buildRunBundle(
    state,
    client.clientTraceEntries(),
    client.currentRunId,
    '2026-07-27T12:00:00.000Z',
  );
}

describe('buildRunBundle (re-audit remediation F9)', () => {
  it('emits a schema-valid bundle for a mixed run whose handoff matches the terminal state', async () => {
    const requests = genuineRequests(7);
    const staleRequest = requests[0]!;
    const phaseTwo = requests.slice(1); // 6 requests: 1 dispatching + 4 queued + 1 overflow
    const failTarget = phaseTwo[1]!.request.requestId;
    const harness = makeClient({
      decisionDelayMs: 30,
      ignoreAbort: true,
      decisionBodyFor: (requestId, request) =>
        requestId === failTarget
          ? JSON.stringify({
              outcome: 'failure',
              failure: {
                failureId: `gwf-${requestId}`,
                requestId,
                npcId: request.request.npcId,
                scenarioId: request.request.scenarioId,
                providerId: request.request.providerId,
                failureCode: 'upstream-error',
                retryable: false,
              },
            })
          : undefined,
    });

    // Phase 1: dispatch one request, supersede the run mid-flight — its late
    // result must ride along as a discarded-stale-run trace entry.
    harness.client.newRun();
    const staleRunId = harness.client.currentRunId;
    await harness.client.connect();
    harness.client.handleDecisionRequest(staleRequest);
    await new Promise((resolve) => setTimeout(resolve, 10));
    harness.client.newRun();
    await new Promise((resolve) => setTimeout(resolve, 80)); // let the stale result land
    await harness.client.connect();

    // Phase 2: four responses, one gateway failure, one queue overflow.
    for (const request of phaseTwo) harness.client.handleDecisionRequest(request);
    await harness.client.settle();

    const gw = harness.lastStatus()!;
    const state = terminalState(gw);
    state.model.acceptedModelResponses = harness.responses.length;

    const bundle = attemptExport(state, harness.client);
    expect(bundle).not.toBeNull();
    // The exact contract prepareRun/finalize parse (strict zod, no widening).
    const parsed = runBundleSchema.parse(bundle);
    expect(parsed).toEqual(bundle);

    expect(bundle!.handoff.runId).toBe(harness.client.currentRunId);
    expect(bundle!.handoff.runId).toBe(gw.runId);
    expect(bundle!.handoff.conditionId).toBe(MODEL_CONDITION_ID);
    expect(bundle!.handoff.scenarioId).toBe('A'); // snapshot null → selectedScenarioId
    expect(bundle!.handoff.providerId).toBe(EXTERNAL_MARA_PROVIDER_ID);
    expect(bundle!.handoff.promptVersion).toBe(MODEL_PROMPT_VERSION);
    expect(bundle!.handoff.experimentId).toBe(MODEL_EXPERIMENT_ID);
    expect(bundle!.handoff.experimentVersion).toBe(MODEL_EXPERIMENT_VERSION);
    expect(bundle!.handoff.worldStateHash).toBe(state.finalWorldHash);
    expect(bundle!.handoff.canonicalLedgerHash).toBe(state.finalLedgerHash);
    expect(bundle!.handoff.callsAttempted).toBe(gw.callsAttempted);
    expect(bundle!.handoff.callsAttempted).toBe(5); // phase-2 dispatches only
    expect(bundle!.handoff.gatewayResponses).toBe(4);
    expect(bundle!.handoff.acceptedModelResponses).toBe(harness.responses.length);
    expect(bundle!.handoff.failuresByCode).toEqual({
      'upstream-error': 1,
      'budget-exhausted': 1,
    });
    expect(bundle!.handoff.exportedAtUtc).toBe('2026-07-27T12:00:00.000Z');

    // The slim client trace rides along whole: one entry per request the
    // client ever saw, including the stale discard keyed to its OLD run.
    expect(bundle!.clientTrace).toHaveLength(7);
    const outcomes = bundle!.clientTrace.map((entry) => entry.clientOutcome);
    expect(outcomes.filter((o) => o === 'response')).toHaveLength(4);
    expect(outcomes.filter((o) => o === 'failure')).toHaveLength(2);
    const stale = bundle!.clientTrace.find((e) => e.clientOutcome === 'discarded-stale-run')!;
    expect(stale.runId).toBe(staleRunId);
    expect(stale.requestId).toBe(staleRequest.request.requestId);

    // The handoff copies, never aliases, the live failure counters.
    bundle!.handoff.failuresByCode['upstream-error'] = 999;
    expect(gw.failuresByCode['upstream-error']).toBe(1);
  });

  it('parses with null hashes when the terminal surface genuinely lacked them', () => {
    const state = terminalState(null);
    state.finalWorldHash = null;
    state.finalLedgerHash = null;
    state.snapshot = null;

    const bundle = buildRunBundle(state, [], 'run-fallback-0001', '2026-07-27T12:00:00.000Z');
    const parsed = runBundleSchema.parse(bundle);
    expect(parsed.handoff.worldStateHash).toBeNull();
    expect(parsed.handoff.canonicalLedgerHash).toBeNull();
    // No gateway status published yet: the fallback runId and zeroed counters.
    expect(parsed.handoff.runId).toBe('run-fallback-0001');
    expect(parsed.handoff.callsAttempted).toBe(0);
    expect(parsed.handoff.gatewayResponses).toBe(0);
    expect(parsed.handoff.failuresByCode).toEqual({});
    expect(parsed.clientTrace).toEqual([]);
  });

  it('produces no bundle for non-terminal or baseline states (enable predicate)', async () => {
    const harness = makeClient({});
    harness.client.newRun();
    await harness.client.connect();

    const running = terminalState(harness.lastStatus()!);
    running.runStatus = 'running';
    expect(canExportRunBundle(running)).toBe(false);
    expect(attemptExport(running, harness.client)).toBeNull();

    const baseline = terminalState(harness.lastStatus()!);
    baseline.selectedConditionId = BASELINE_CONDITION_ID;
    expect(canExportRunBundle(baseline)).toBe(false);
    expect(attemptExport(baseline, harness.client)).toBeNull();

    const terminal = terminalState(harness.lastStatus()!);
    expect(canExportRunBundle(terminal)).toBe(true);
    expect(attemptExport(terminal, harness.client)).not.toBeNull();
  });
});
