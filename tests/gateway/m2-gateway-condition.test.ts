import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GatewayConfig } from '../../gateway/config';
import { loadGatewayConfig } from '../../gateway/config';
import { createGateway, type GatewayInstance } from '../../gateway/server';
import { FakeDecisionAdapter } from '../../gateway/adapters/fakeDecisionAdapter';
import type {
  AdapterInput,
  AdapterResult,
  ModelDecisionAdapter,
} from '../../gateway/adapters/modelDecisionAdapter';
import { MODEL_RATIONALE_MAX_CHARS } from '../../gateway/adapters/modelDecisionAdapter';
import { MemoryTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  gatewayDecisionResultSchema,
} from '../../src/sim/decisions/externalSchemas';
import {
  M2_ACTION_PROMPT_VERSION,
  M2_ACTION_PROVIDER_ID,
  M2_EXPERIMENT_ID,
  M2_EXPERIMENT_VERSION,
  M2_PER_DECISION_CONDITION_ID,
  M2_RATIONALE_TRACE_MAX_CHARS,
} from '../../src/shared/m2Experiment';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';

/**
 * The gateway serving the Phase 4 M2 per-decision condition end to end
 * through the fake adapter: contract-derived advertisement, the per-process
 * single-pairing identity gate, and the §17.5 normalized diagnostic-output
 * contract on the wire — while the frozen Milestone 1 strict contract stays
 * byte-identical when the M1 condition is served.
 */

function m2Config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    adapterKind: 'fake',
    port: 0,
    requestTimeoutMs: 2_000,
    maxConcurrency: 1,
    maxCallsPerRun: 80,
    traceDir: 'unused',
    allowedBrowserOrigin: 'http://localhost:5173',
    openaiApiKey: null,
    openaiModel: null,
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    maxTotalCalls: 400,
    servedConditionId: M2_PER_DECISION_CONDITION_ID,
    ...overrides,
  };
}

/** Adapter returning a fixed raw choice object, for driving normalization
 * and structural-failure paths through the real HTTP dispatch. */
class FixedChoiceAdapter implements ModelDecisionAdapter {
  readonly id = 'fixed-choice-adapter-v1';
  constructor(private readonly choice: (input: AdapterInput) => unknown) {}
  decide(input: AdapterInput, _signal: AbortSignal): Promise<AdapterResult> {
    return Promise.resolve({
      choice: this.choice(input),
      meta: {
        modelId: this.id,
        upstreamResponseId: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    });
  }
}

let genuineM2: ExternalDecisionRequest;

function m2Envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: M2_EXPERIMENT_ID,
    experimentVersion: M2_EXPERIMENT_VERSION,
    conditionId: M2_PER_DECISION_CONDITION_ID,
    runId: 'run-m2gw-0001',
    providerId: genuineM2.request.providerId,
    promptVersion: M2_ACTION_PROMPT_VERSION,
    contextHash: genuineM2.contextHash,
    request: JSON.parse(JSON.stringify(genuineM2.request)) as unknown,
    context: JSON.parse(JSON.stringify(genuineM2.context)) as unknown,
    truncationCounts: { ...genuineM2.truncationCounts },
    ...overrides,
  };
}

function withRequestId(body: Record<string, unknown>, requestId: string): Record<string, unknown> {
  (body.request as { requestId: string }).requestId = requestId;
  return body;
}

async function post(port: number, body: unknown) {
  return fetch(`http://127.0.0.1:${port}/v1/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  const run = createRun('A', { conditionId: M2_PER_DECISION_CONDITION_ID });
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  genuineM2 = run.externalRequests[0]!;
});

describe('gateway serving the M2 condition', () => {
  let gateway: GatewayInstance;
  let trace: MemoryTraceWriter;
  let port: number;

  beforeAll(async () => {
    trace = new MemoryTraceWriter();
    gateway = createGateway(m2Config(), new FakeDecisionAdapter(), trace);
    port = await gateway.start();
  });
  afterAll(async () => {
    await gateway.stop();
  });

  it('advertises the complete M2 pairing from the registered contract', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/provider-config`);
    const view = (await response.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      experimentId: M2_EXPERIMENT_ID,
      experimentVersion: M2_EXPERIMENT_VERSION,
      conditionId: M2_PER_DECISION_CONDITION_ID,
      providerId: M2_ACTION_PROVIDER_ID,
      promptVersion: M2_ACTION_PROMPT_VERSION,
      requestSchemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
      modelId: 'fake-adapter',
      servingProviderId: 'local',
    });
  });

  it('accepts a genuine M2 envelope and returns a complete response through the fake adapter', async () => {
    const response = await post(port, withRequestId(m2Envelope(), 'dec-9101'));
    expect(response.status).toBe(200);
    const result = gatewayDecisionResultSchema.parse(await response.json());
    expect(result.outcome).toBe('response');
    if (result.outcome !== 'response') return;
    expect(result.response.providerId).toBe(M2_ACTION_PROVIDER_ID);
    expect(genuineM2.request.offeredAffordanceIds).toContain(result.response.selectedAffordanceId);
    // The fake adapter emits a full M1-shaped choice (bounded rationale,
    // integer confidence): under the M2 contract nothing needed altering.
    const row = trace.entries.find((entry) => entry.requestId === 'dec-9101')!;
    expect(row.promptVersion).toBe(M2_ACTION_PROMPT_VERSION);
    expect(row.providerId).toBe(M2_ACTION_PROVIDER_ID);
    expect(row.rationaleNormalized).toBe(false);
    // Ruling R7 §9.2: the claim also appears under its required explicit
    // name, mirroring confidenceBp on M2 rows.
    expect(row.selfReportedConfidenceBp).toBe(row.confidenceBp);
  });

  it('refuses an M1-pairing envelope while serving the M2 condition', async () => {
    const m1Shaped = withRequestId(
      m2Envelope({
        experimentId: MODEL_EXPERIMENT_ID,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
        conditionId: MODEL_CONDITION_ID,
        providerId: EXTERNAL_MARA_PROVIDER_ID,
        promptVersion: MODEL_PROMPT_VERSION,
      }),
      'dec-9102',
    );
    (m1Shaped.request as { providerId: string }).providerId = EXTERNAL_MARA_PROVIDER_ID;
    const response = await post(port, m1Shaped);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('unregistered-request');
  });

  it('refuses the M2 prompt version it does not serve', async () => {
    const wrongPrompt = withRequestId(
      m2Envelope({ promptVersion: 'mara-action-selection-1.0.0' }),
      'dec-9103',
    );
    const response = await post(port, wrongPrompt);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('unregistered-request');
  });
});

describe('the §17.5 normalized contract on the wire', () => {
  async function dispatchWithChoice(
    choice: (input: AdapterInput) => unknown,
    requestId: string,
  ): Promise<{ status: number; body: unknown; trace: MemoryTraceWriter }> {
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(m2Config(), new FixedChoiceAdapter(choice), trace);
    const port = await gateway.start();
    try {
      const response = await post(port, withRequestId(m2Envelope(), requestId));
      return { status: response.status, body: await response.json(), trace };
    } finally {
      await gateway.stop();
    }
  }

  it('an overlong rationale is ACCEPTED, truncated into the trace, and flagged — never invalid-model-output', async () => {
    const overlong = 'z'.repeat(M2_RATIONALE_TRACE_MAX_CHARS + 200);
    const { status, body, trace } = await dispatchWithChoice(
      (input) => ({
        selectedAffordanceId: input.offeredAffordanceIds[0],
        reasonCode: 'goal',
        confidenceBp: 5500,
        rationale: overlong,
      }),
      'dec-9110',
    );
    expect(status).toBe(200);
    const result = gatewayDecisionResultSchema.parse(body);
    expect(result.outcome).toBe('response');
    const row = trace.entries.find((entry) => entry.requestId === 'dec-9110')!;
    expect(row.gatewayOutcome).toBe('response');
    expect(row.rationale).toHaveLength(M2_RATIONALE_TRACE_MAX_CHARS);
    expect(row.rationaleNormalized).toBe(true);
    expect(row.rawModelOutput).toBeNull();
  });

  it('a choice with NO rationale and NO confidence is accepted; the response carries the fixed compatibility value', async () => {
    const { status, body, trace } = await dispatchWithChoice(
      (input) => ({
        selectedAffordanceId: input.offeredAffordanceIds[0],
        reasonCode: 'routine',
      }),
      'dec-9111',
    );
    expect(status).toBe(200);
    const result = gatewayDecisionResultSchema.parse(body);
    expect(result.outcome).toBe('response');
    if (result.outcome !== 'response') return;
    expect(result.response.confidenceBp).toBe(0);
    const row = trace.entries.find((entry) => entry.requestId === 'dec-9111')!;
    expect(row.rationale).toBeNull();
    expect(row.rationaleNormalized).toBe(true);
    expect(row.confidenceBp).toBeNull();
    expect(row.selfReportedConfidenceBp).toBeNull();
  });

  it('a structural failure still fails: an unoffered affordance is invalid-model-output with bounded raw capture', async () => {
    const { status, body, trace } = await dispatchWithChoice(
      () => ({
        selectedAffordanceId: 'aff:not-offered',
        reasonCode: 'goal',
      }),
      'dec-9112',
    );
    expect(status).toBe(200);
    const result = gatewayDecisionResultSchema.parse(body);
    expect(result.outcome).toBe('failure');
    if (result.outcome !== 'failure') return;
    expect(result.failure.failureCode).toBe('invalid-model-output');
    const row = trace.entries.find((entry) => entry.requestId === 'dec-9112')!;
    expect(row.rawModelOutput).not.toBeNull();
    // A failure row carries no accepted choice, hence no normalization flag.
    expect(row.rationaleNormalized).toBeUndefined();
  });
});

describe('the frozen M1 contract is untouched when the M1 condition is served', () => {
  it('an overlong rationale under the M1 condition remains invalid-model-output', async () => {
    const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
    while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
    const genuineM1 = run.externalRequests[0]!;
    const trace = new MemoryTraceWriter();
    const gateway = createGateway(
      m2Config({ servedConditionId: MODEL_CONDITION_ID }),
      new FixedChoiceAdapter((input) => ({
        selectedAffordanceId: input.offeredAffordanceIds[0],
        reasonCode: 'goal',
        confidenceBp: 5000,
        rationale: 'q'.repeat(MODEL_RATIONALE_MAX_CHARS + 1),
      })),
      trace,
    );
    const port = await gateway.start();
    try {
      const body = {
        schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
        experimentId: MODEL_EXPERIMENT_ID,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
        conditionId: MODEL_CONDITION_ID,
        runId: 'run-m1gw-0001',
        providerId: genuineM1.request.providerId,
        promptVersion: MODEL_PROMPT_VERSION,
        contextHash: genuineM1.contextHash,
        request: genuineM1.request,
        context: genuineM1.context,
        truncationCounts: genuineM1.truncationCounts,
      };
      const response = await post(port, body);
      expect(response.status).toBe(200);
      const result = gatewayDecisionResultSchema.parse(await response.json());
      expect(result.outcome).toBe('failure');
      if (result.outcome !== 'failure') return;
      expect(result.failure.failureCode).toBe('invalid-model-output');
      const row = trace.entries[trace.entries.length - 1]!;
      // M1 rows never carry the M2 normalization flag.
      expect(row.rationaleNormalized).toBeUndefined();
    } finally {
      await gateway.stop();
    }
  });

  it('config refuses an unregistered served condition and defaults to the M1 condition', () => {
    expect(() =>
      loadGatewayConfig('fake', { MODEL_GATEWAY_CONDITION_ID: 'not-a-condition' }),
    ).toThrow(/gateway-config-invalid: MODEL_GATEWAY_CONDITION_ID/);
    const fake = loadGatewayConfig('fake', {});
    expect(fake.servedConditionId).toBe(MODEL_CONDITION_ID);
    const m2 = loadGatewayConfig('fake', {
      MODEL_GATEWAY_CONDITION_ID: M2_PER_DECISION_CONDITION_ID,
    });
    expect(m2.servedConditionId).toBe(M2_PER_DECISION_CONDITION_ID);
  });
});
