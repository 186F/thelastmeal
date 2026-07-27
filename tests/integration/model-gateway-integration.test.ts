import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import type { WorkerCommand } from '../../src/shared/workerProtocol';
import type { DecisionResponse, ExternalDecisionFailure } from '../../src/shared/decisionContracts';
import { handleCommand, WorkerSession } from '../../src/worker/commandProcessor';
import { ModelGatewayClient } from '../../src/app/modelGatewayClient';
import { createGateway, type GatewayInstance } from '../../gateway/server';
import { FakeDecisionAdapter } from '../../gateway/adapters/fakeDecisionAdapter';
import { MemoryTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import type { GatewayConfig } from '../../gateway/config';

/**
 * Milestone 001, section 23.4: the browser/worker orchestration path against
 * a REAL local fake-adapter gateway — the same modules the browser composes
 * (WorkerSession command semantics + ModelGatewayClient), minus postMessage
 * and the DOM. No test needs a key or leaves localhost.
 */

let seq = 0;
function cmd(type: WorkerCommand['type'], extra: Record<string, unknown> = {}): WorkerCommand {
  seq += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-mg-${seq}`,
    commandSeq: seq,
    type,
    ...extra,
  } as WorkerCommand;
}

function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    adapterKind: 'fake',
    port: 0,
    requestTimeoutMs: 5_000,
    maxConcurrency: 1,
    maxCallsPerRun: 80,
    traceDir: 'unused',
    allowedBrowserOrigin: 'http://localhost:5173',
    openaiApiKey: null,
    openaiModel: null,
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    ...overrides,
  };
}

interface Harness {
  session: WorkerSession;
  client: ModelGatewayClient;
  fetchCalls: () => number;
  responsesSubmitted: () => DecisionResponse[];
  failuresSubmitted: () => ExternalDecisionFailure[];
}

function makeHarness(baseUrl: string): Harness {
  const session = new WorkerSession();
  const responses: DecisionResponse[] = [];
  const failures: ExternalDecisionFailure[] = [];
  let fetches = 0;
  const countingFetch: typeof fetch = (input, init) => {
    fetches += 1;
    return fetch(input, init);
  };
  let runCounter = 0;
  const client = new ModelGatewayClient({
    baseUrl,
    fetchImpl: countingFetch,
    makeRunId: () => {
      runCounter += 1;
      return `run-inttest-${String(runCounter).padStart(4, '0')}`;
    },
    submitResponse: (response) => {
      responses.push(response);
      handleCommand(session, cmd('submit-decision-response', { response }));
    },
    submitFailure: (failure) => {
      failures.push(failure);
      handleCommand(session, cmd('submit-decision-failure', { failure }));
    },
  });
  return {
    session,
    client,
    fetchCalls: () => fetches,
    responsesSubmitted: () => responses,
    failuresSubmitted: () => failures,
  };
}

/** Steps the worker one tick at a time, routing decision-request messages to
 * the gateway client and awaiting its settlement — the paced equivalent of
 * the browser loop. */
async function driveTicks(harness: Harness, ticks: number): Promise<void> {
  for (let i = 0; i < ticks && !harness.session.host.terminal; i += 1) {
    const out = handleCommand(harness.session, cmd('step', { ticks: 1 }));
    for (const message of out) {
      if (message.type === 'decision-request') {
        harness.client.handleDecisionRequest(message.request);
      }
    }
    await harness.client.settle();
  }
}

describe('browser/worker/gateway integration (fake adapter)', () => {
  let gateway: GatewayInstance;
  let trace: MemoryTraceWriter;
  let baseUrl: string;

  beforeAll(async () => {
    trace = new MemoryTraceWriter();
    gateway = createGateway(testConfig(), new FakeDecisionAdapter(), trace);
    const port = await gateway.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await gateway.stop();
  });

  it('decision-request messages carry the worker runSeq, incremented on load and reset (stale-run drop key)', () => {
    const session = new WorkerSession();
    handleCommand(
      session,
      cmd('load-scenario', { scenarioId: 'A', conditionId: 'mara-model-per-decision-v1' }),
    );
    let firstSeq: number | null = null;
    for (let i = 0; i < 65 && firstSeq === null; i += 1) {
      for (const message of handleCommand(session, cmd('step', { ticks: 1 }))) {
        if (message.type === 'decision-request') firstSeq = message.runSeq;
      }
    }
    expect(firstSeq).toBe(1);
    handleCommand(session, cmd('reset'));
    let secondSeq: number | null = null;
    for (let i = 0; i < 65 && secondSeq === null; i += 1) {
      for (const message of handleCommand(session, cmd('step', { ticks: 1 }))) {
        if (message.type === 'decision-request') secondSeq = message.runSeq;
      }
    }
    expect(secondSeq).toBe(2);
  });

  it('a baseline run makes ZERO gateway calls', async () => {
    const harness = makeHarness(baseUrl);
    handleCommand(harness.session, cmd('load-scenario', { scenarioId: 'A' }));
    harness.client.newRun();
    await driveTicks(harness, 150);
    expect(harness.fetchCalls()).toBe(0);
    expect(trace.entries.filter((e) => e.runId.startsWith('run-inttest'))).toHaveLength(0);
  });

  it('the model condition drives only Mara through the gateway; accepted responses reach the engine; the run completes and round-trips', async () => {
    const harness = makeHarness(baseUrl);
    handleCommand(
      harness.session,
      cmd('load-scenario', { scenarioId: 'A', conditionId: 'mara-model-per-decision-v1' }),
    );
    harness.client.newRun();
    await harness.client.connect();
    await driveTicks(harness, 2_700);
    expect(harness.session.host.terminal).toBe(true);

    // Only Mara ever generated model traffic.
    const runEntries = trace.entries.filter((e) => e.runId === harness.client.currentRunId);
    expect(runEntries.length).toBeGreaterThan(0);
    expect(runEntries.every((e) => e.npcId === 'mara')).toBe(true);
    expect(harness.responsesSubmitted().length).toBeGreaterThan(0);

    // Engine acceptances of gateway responses are recorded canonically.
    const run = harness.session.host.activeRun!;
    const acceptedGateway = run.ledger.events.filter(
      (e) =>
        e.type === 'DecisionResponseAccepted' &&
        (e.payload as { responseId: string }).responseId.startsWith('gw-'),
    );
    expect(acceptedGateway.length).toBeGreaterThan(0);

    // Export -> import -> replay round-trips through worker commands.
    const exported = handleCommand(harness.session, cmd('export-ledger')).find(
      (r) => r.type === 'ledger-export',
    );
    if (!exported || exported.type !== 'ledger-export') throw new Error('no export');
    const imported = handleCommand(
      harness.session,
      cmd('import-ledger', { fileText: exported.json }),
    ).find((r) => r.type === 'import-result');
    expect(imported && imported.type === 'import-result' ? imported.ok : false).toBe(true);
    const replayed = handleCommand(harness.session, cmd('replay', { source: 'imported' })).find(
      (r) => r.type === 'replay-result',
    );
    expect(replayed && replayed.type === 'replay-result' ? replayed.match : false).toBe(true);
  }, 120_000);

  it('gateway unavailability never stops logical time: failures are typed and the run completes', async () => {
    const harness = makeHarness('http://127.0.0.1:9');
    handleCommand(
      harness.session,
      cmd('load-scenario', { scenarioId: 'A', conditionId: 'mara-model-per-decision-v1' }),
    );
    harness.client.newRun();
    await driveTicks(harness, 2_700);
    expect(harness.session.host.terminal).toBe(true);
    expect(harness.failuresSubmitted().length).toBeGreaterThan(0);
    expect(harness.failuresSubmitted().every((f) => f.failureCode === 'gateway-unavailable')).toBe(
      true,
    );

    const run = harness.session.host.activeRun!;
    const providerFailed = run.ledger.events.filter(
      (e) =>
        e.type === 'DecisionProviderFailed' &&
        (e.payload as { errorCode: string }).errorCode === 'gateway-unavailable',
    );
    expect(providerFailed.length).toBeGreaterThan(0);
    const externalExpiries = run.ledger.events.filter(
      (e) =>
        e.type === 'DecisionRequestExpired' &&
        (e.payload as { reasonCode: string }).reasonCode === 'external-failure',
    );
    expect(externalExpiries.length).toBeGreaterThan(0);
  }, 120_000);

  it('reset aborts in-flight work and a response from an earlier runId is never submitted', async () => {
    const slowTrace = new MemoryTraceWriter();
    const slowGateway = createGateway(
      testConfig(),
      new FakeDecisionAdapter({ delayMs: 400 }),
      slowTrace,
    );
    const port = await slowGateway.start();
    try {
      const harness = makeHarness(`http://127.0.0.1:${port}`);
      handleCommand(
        harness.session,
        cmd('load-scenario', { scenarioId: 'A', conditionId: 'mara-model-per-decision-v1' }),
      );
      harness.client.newRun();
      await harness.client.connect();
      // Step until the first Mara request goes in flight.
      for (let i = 0; i < 65; i += 1) {
        const out = handleCommand(harness.session, cmd('step', { ticks: 1 }));
        for (const message of out) {
          if (message.type === 'decision-request') {
            harness.client.handleDecisionRequest(message.request);
          }
        }
        if (harness.fetchCalls() > 1) break; // provider-config + first decision POST
      }
      expect(harness.fetchCalls()).toBeGreaterThan(1);
      // Reset mid-flight: the old run's HTTP result must be discarded.
      harness.client.newRun();
      await harness.client.settle();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(harness.responsesSubmitted()).toHaveLength(0);
    } finally {
      await slowGateway.stop();
    }
  }, 30_000);
});
