import {
  appendFileSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeRunDirectory } from '../../scripts/model/finalize';
import { prepareRunDirectory } from '../../scripts/model/prepareRun';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { evaluateConstraints } from '../../src/sim/decisions/constraints';
import { EXTERNAL_REQUEST_SCHEMA_VERSION } from '../../src/sim/decisions/externalSchemas';
import type { PendingDecisionState } from '../../src/sim/domain/state';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import type { ModelClientTraceEntry } from '../../src/app/modelClientTraceRecorder';
import type { ModelGatewayStatus } from '../../src/app/modelGatewayClient';
import { buildRunBundle } from '../../src/app/runBundle';
import { ViewStore } from '../../src/app/store';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';

/**
 * Full fixture-bundle finalization (re-audit remediation S3/S4). A REAL
 * completed model-condition run provides the canonical ledger and the exact
 * request envelopes; the gateway trace, sidecars, and client bundle are
 * fabricated to match — then the finalizer must join every request, source
 * the submitted tick from ledger events, and bind the whole directory under
 * one aggregate hash. The failure matrix proves every cross-artifact
 * CONTRADICTION is fatal; the absence matrix proves a missing OPTIONAL
 * source only degrades the recorded completeness (deviation D2).
 * No live key, no network — everything runs against a tmpdir.
 */

const RUN_ID = 'run-bundle-0001';

interface FixtureRequest {
  requestId: string;
  role: 'response' | 'client-budget' | 'upstream-timeout';
  requestedAtTick: number;
  contextHash: string;
  selectedAffordanceId: string | null;
  external: ExternalDecisionRequest;
}

type TraceEntryV2 = ModelTraceEntry & {
  responseId: string | null;
  failureId: string | null;
  offeredAffordanceIds: string[];
  rawModelOutput: string | null;
};

/** Picks an offered affordance the acceptance gate will take at drain time
 * (mirrors the helper in model-reconciliation-gap.test.ts). */
function gateViableAffordanceId(run: EngineRun, pending: PendingDecisionState): string {
  const npc = run.state.npcs.mara;
  const evaluation = evaluateConstraints(
    {
      npcId: npc.id,
      hungerMicro: npc.hungerMicro,
      injury: npc.injury,
      incapacitated: npc.incapacitated,
      beliefs: npc.beliefs,
    },
    pending.offeredAffordances,
  );
  const viable = pending.offeredAffordances.filter(
    (a) =>
      evaluation.allowedAffordanceIds.includes(a.id) &&
      (a.continuesActionId !== null
        ? npc.currentAction?.id === a.continuesActionId
        : npc.transit === null &&
          (!npc.currentAction ||
            (npc.currentAction.phase === 'active' && npc.currentAction.interruptible))),
  );
  if (viable.length === 0) throw new Error('fixture: no gate-viable affordance');
  const chosen =
    viable.find((a) => a.continuesActionId !== null) ??
    viable.find((a) => a.id.includes(':wait')) ??
    viable[0]!;
  return chosen.id;
}

/** Drives a model-condition run to completion, answering every external
 * request through the engine's real inboxes: ordinal 2 dies client-side
 * (budget, never dispatched), ordinal 3 times out upstream, everything else
 * gets a gateway-shaped response. */
function buildFixtureRun(): { run: EngineRun; requests: FixtureRequest[] } {
  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  const requests: FixtureRequest[] = [];
  let seen = 0;
  while (!run.state.terminal) {
    stepTick(run);
    while (seen < run.externalRequests.length) {
      const external = run.externalRequests[seen]!;
      seen += 1;
      const ordinal = seen;
      const requestId = external.request.requestId;
      const pending = run.state.npcs.mara.pendingDecision;
      if (pending?.requestId !== requestId) {
        throw new Error(`fixture: request ${requestId} not pending at emission`);
      }
      const role: FixtureRequest['role'] =
        ordinal === 2 ? 'client-budget' : ordinal === 3 ? 'upstream-timeout' : 'response';
      let selectedAffordanceId: string | null = null;
      if (role === 'response') {
        selectedAffordanceId = gateViableAffordanceId(run, pending);
        run.responseInbox.push({
          responseId: `gw-${requestId}`,
          requestId,
          npcId: 'mara',
          scenarioId: 'A',
          providerId: EXTERNAL_MARA_PROVIDER_ID,
          selectedAffordanceId,
          confidenceBp: 5_000,
          reasonCode: 'routine',
          scores: [],
        });
      } else {
        run.failureInbox.push({
          failureId: role === 'upstream-timeout' ? `gwf-${requestId}` : `cf-${requestId}`,
          requestId,
          npcId: 'mara',
          scenarioId: 'A',
          providerId: EXTERNAL_MARA_PROVIDER_ID,
          failureCode: role === 'upstream-timeout' ? 'upstream-timeout' : 'budget-exhausted',
          retryable: false,
        });
      }
      requests.push({
        requestId,
        role,
        requestedAtTick: external.request.requestedAtTick,
        contextHash: external.contextHash,
        selectedAffordanceId,
        external,
      });
    }
  }
  return { run, requests };
}

function traceRowFor(request: FixtureRequest): TraceEntryV2 {
  const response = request.role === 'response';
  return {
    runId: RUN_ID,
    requestId: request.requestId,
    npcId: 'mara',
    scenarioId: 'A',
    logicalRequestedTick: request.requestedAtTick,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: response ? 'fake-adapter' : null,
    contextHash: request.contextHash,
    truncationCounts: request.external.truncationCounts as unknown as Record<string, number>,
    upstreamResponseId: response ? `up-${request.requestId}` : null,
    responseId: response ? `gw-${request.requestId}` : null,
    failureId: response ? null : `gwf-${request.requestId}`,
    offeredAffordanceIds: [...request.external.request.offeredAffordanceIds],
    rawModelOutput: null,
    selectedAffordanceId: request.selectedAffordanceId,
    reasonCode: response ? 'routine' : null,
    confidenceBp: response ? 5_000 : null,
    rationale: null,
    inputTokens: response ? 100 : null,
    outputTokens: response ? 20 : null,
    totalTokens: response ? 120 : null,
    latencyMs: response ? 42 : 2_000,
    concurrentInFlight: 1,
    gatewayOutcome: response ? 'response' : 'upstream-timeout',
    engineOutcome: null,
    engineRejectionReason: null,
  };
}

function clientEntryFor(request: FixtureRequest): ModelClientTraceEntry {
  const base = {
    runId: RUN_ID,
    conditionId: MODEL_CONDITION_ID,
    requestId: request.requestId,
    npcId: 'mara' as const,
    scenarioId: 'A' as const,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersionExpected: MODEL_PROMPT_VERSION,
    requestedAtTick: request.requestedAtTick,
    contextHash: request.contextHash,
    queuedAtUtc: '2026-07-27T10:00:00.000Z',
  };
  if (request.role === 'client-budget') {
    return {
      ...base,
      dispatchedAtUtc: null,
      completedAtUtc: '2026-07-27T10:00:00.010Z',
      clientOutcome: 'failure',
      clientFailureCode: 'budget-exhausted',
      responseId: null,
      failureId: null,
      clientLatencyMs: null,
    };
  }
  if (request.role === 'upstream-timeout') {
    return {
      ...base,
      dispatchedAtUtc: '2026-07-27T10:00:00.020Z',
      completedAtUtc: '2026-07-27T10:00:02.020Z',
      clientOutcome: 'failure',
      clientFailureCode: 'upstream-timeout',
      responseId: null,
      failureId: `gwf-${request.requestId}`,
      clientLatencyMs: 2_000,
    };
  }
  return {
    ...base,
    dispatchedAtUtc: '2026-07-27T10:00:00.020Z',
    completedAtUtc: '2026-07-27T10:00:00.062Z',
    clientOutcome: 'response',
    clientFailureCode: null,
    responseId: `gw-${request.requestId}`,
    failureId: null,
    clientLatencyMs: 42,
  };
}

function sidecarEnvelopeFor(request: FixtureRequest): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId: RUN_ID,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    contextHash: request.contextHash,
    request: request.external.request,
    context: request.external.context,
    truncationCounts: request.external.truncationCounts,
  };
}

const LEDGER_NAME = `ledger-A-${RUN_ID}.json`;
let templateDir: string;
let ledger: LedgerFile;
let fixtureRequests: FixtureRequest[];
let stagingDir: string;

function freshDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'model-bundle-case-')), RUN_ID);
  cpSync(templateDir, dir, { recursive: true });
  return dir;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

interface FinalRow {
  requestId: string;
  npcId: string;
  conditionId: string;
  providerId: string;
  modelId: string | null;
  requestedAtLogicalTick: number | null;
  logicalSubmittedTick: number | null;
  requestEnvelopeFile: string | null;
  contextHash: string | null;
  responseId: string | null;
  failureId: string | null;
  clientLatencyMs: number | null;
  gatewayLatencyMs: number | null;
  clientOutcome: string | null;
  gatewayOutcome: string | null;
  /** null == unresolved: no engine lifecycle event for the result. */
  engineOutcome: 'accepted' | 'rejected' | 'expired' | null;
  engineRejectionReason: string | null;
  engineResolutionEventId: string | null;
}

function readFinalRows(dir: string): Map<string, FinalRow> {
  const rows = readFileSync(join(dir, 'finalized-trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as FinalRow);
  return new Map(rows.map((row) => [row.requestId, row]));
}

beforeAll(() => {
  const { run, requests } = buildFixtureRun();
  fixtureRequests = requests;
  ledger = buildLedgerFile(run);
  expect(requests.length).toBeGreaterThanOrEqual(4);
  expect(requests.filter((r) => r.role === 'client-budget')).toHaveLength(1);
  expect(requests.filter((r) => r.role === 'upstream-timeout')).toHaveLength(1);

  // Gateway-side files land first (as the gateway itself would write them).
  const root = mkdtempSync(join(tmpdir(), 'model-bundle-template-'));
  templateDir = join(root, RUN_ID);
  mkdirSync(join(templateDir, 'requests'), { recursive: true });
  writeJson(join(templateDir, 'run-manifest.json'), {
    traceSchemaVersion: 2,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId: RUN_ID,
    scenarioId: 'A',
    providerPlanId: MODEL_CONDITION_ID,
    externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: 'fake-adapter',
    modelSettings: { temperature: 0 },
    startedAtUtc: '2026-07-27T09:59:59.000Z',
  });
  const dispatched = requests.filter((r) => r.role !== 'client-budget');
  writeFileSync(
    join(templateDir, 'model-trace.jsonl'),
    dispatched.map((r) => JSON.stringify(traceRowFor(r))).join('\n') + '\n',
    'utf8',
  );
  for (const request of dispatched) {
    writeJson(
      join(templateDir, 'requests', `${request.requestId}.json`),
      sidecarEnvelopeFor(request),
    );
  }

  // Operator-side placement goes through the S1 helper (validate-then-copy).
  const acceptedModelResponses = ledger.events.filter(
    (e) =>
      e.type === 'DecisionResponseAccepted' &&
      String((e.payload as { responseId: string }).responseId).startsWith('gw-'),
  ).length;
  // The client bundle comes from the REAL producer (re-audit F9): a terminal
  // model-condition view state + gateway status fed to buildRunBundle, so
  // prepareRun/finalize consume the exact artifact the panel exports rather
  // than a hand-written literal that merely resembles it.
  const exportState = new ViewStore().state;
  exportState.runStatus = 'complete';
  exportState.selectedConditionId = MODEL_CONDITION_ID;
  exportState.selectedScenarioId = 'A';
  exportState.finalWorldHash = ledger.worldStateHash;
  exportState.finalLedgerHash = ledger.canonicalLedgerHash;
  exportState.model.acceptedModelResponses = acceptedModelResponses;
  const gatewayStatus: ModelGatewayStatus = {
    connected: true,
    contractMismatchField: null,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: 'fake-adapter',
    runId: RUN_ID,
    callsAttempted: dispatched.length,
    gatewayResponses: requests.filter((r) => r.role === 'response').length,
    gatewayFailures: 2,
    failuresByCode: { 'upstream-timeout': 1, 'budget-exhausted': 1 },
    lastLatencyMs: 42,
    queuedRequests: 0,
    pendingRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
  };
  exportState.model.gateway = gatewayStatus;
  const clientBundle = buildRunBundle(
    exportState,
    requests.map((r) => clientEntryFor(r)),
    RUN_ID,
    '2026-07-27T10:45:00.000Z',
  );
  stagingDir = mkdtempSync(join(tmpdir(), 'model-bundle-staging-'));
  writeFileSync(join(stagingDir, LEDGER_NAME), JSON.stringify(ledger), 'utf8');
  writeJson(join(stagingDir, 'client-bundle-export.json'), clientBundle);
  prepareRunDirectory({
    runId: RUN_ID,
    ledgerPath: join(stagingDir, LEDGER_NAME),
    bundlePath: join(stagingDir, 'client-bundle-export.json'),
    destRoot: root,
  });
});

describe('prepareRun (S1)', () => {
  it('refuses a bundle whose handoff contradicts the run id or the ledger hashes — and copies nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'model-bundle-prep-'));
    const wrongRun = readJson<{ handoff: { runId: string } }>(
      join(stagingDir, 'client-bundle-export.json'),
    );
    wrongRun.handoff.runId = 'run-bundle-9999';
    writeJson(join(stagingDir, 'wrong-run.json'), wrongRun);
    expect(() =>
      prepareRunDirectory({
        runId: RUN_ID,
        ledgerPath: join(stagingDir, LEDGER_NAME),
        bundlePath: join(stagingDir, 'wrong-run.json'),
        destRoot: root,
      }),
    ).toThrow(/does not match --run-id/);
    expect(existsSync(join(root, RUN_ID))).toBe(false);

    const wrongHash = readJson<{ handoff: { worldStateHash: string } }>(
      join(stagingDir, 'client-bundle-export.json'),
    );
    wrongHash.handoff.worldStateHash = '0123456789abcdef';
    writeJson(join(stagingDir, 'wrong-hash.json'), wrongHash);
    expect(() =>
      prepareRunDirectory({
        runId: RUN_ID,
        ledgerPath: join(stagingDir, LEDGER_NAME),
        bundlePath: join(stagingDir, 'wrong-hash.json'),
        destRoot: root,
      }),
    ).toThrow(/worldStateHash/);
    expect(existsSync(join(root, RUN_ID))).toBe(false);
  });

  it('refuses a ledger whose filename does not match ledger-*.json before any copy (F8)', () => {
    const root = mkdtempSync(join(tmpdir(), 'model-bundle-prep-'));
    // A renamed download passes every schema/hash cross-check but would be
    // invisible to finalize's ledger-*.json selection glob.
    const renamed = join(stagingDir, 'runC-final.json');
    copyFileSync(join(stagingDir, LEDGER_NAME), renamed);
    expect(() =>
      prepareRunDirectory({
        runId: RUN_ID,
        ledgerPath: renamed,
        bundlePath: join(stagingDir, 'client-bundle-export.json'),
        destRoot: root,
      }),
    ).toThrow(/must match ledger-\*\.json/);
    expect(existsSync(join(root, RUN_ID))).toBe(false);
  });
});

describe('finalize success path (S3)', () => {
  it('joins every request, sources submitted ticks from ledger events, and binds the bundle', () => {
    const dir = freshDir();
    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.joinedRequests).toBe(fixtureRequests.length);
    expect(result.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    expect(result.completeness.notes).toEqual([]);

    // The raw gateway trace is untouched (deviation D1: derived join goes to
    // a NEW file).
    expect(readFileSync(join(dir, 'model-trace.jsonl'), 'utf8')).toBe(
      readFileSync(join(templateDir, 'model-trace.jsonl'), 'utf8'),
    );

    const rows = readFinalRows(dir);
    expect(rows.size).toBe(fixtureRequests.length);
    for (const request of fixtureRequests) {
      const row = rows.get(request.requestId);
      expect(row).toBeDefined();
      expect(row!.npcId).toBe('mara');
      expect(row!.conditionId).toBe(MODEL_CONDITION_ID);
      expect(row!.providerId).toBe(EXTERNAL_MARA_PROVIDER_ID);
      expect(row!.requestedAtLogicalTick).toBe(request.requestedAtTick);
      expect(row!.contextHash).toBe(request.contextHash);
    }

    // logicalSubmittedTick and the resolution event id come from the LEDGER,
    // never from wall-clock: responses join on DecisionResponseReceived …
    const responded = fixtureRequests.filter((r) => r.role === 'response');
    let acceptedSeen = 0;
    for (const request of responded) {
      const received = ledger.events.find(
        (e) =>
          e.type === 'DecisionResponseReceived' &&
          (e.payload as { responseId: string }).responseId === `gw-${request.requestId}`,
      );
      const row = rows.get(request.requestId)!;
      expect(row.gatewayOutcome).toBe('response');
      expect(row.responseId).toBe(`gw-${request.requestId}`);
      expect(row.engineOutcome).not.toBeNull();
      if (received) {
        expect(row.logicalSubmittedTick).toBe(received.tick);
        expect(row.engineResolutionEventId).toBe(received.id);
        expect(row.logicalSubmittedTick).toBe(request.requestedAtTick + 1);
      }
      if (row.engineOutcome === 'accepted') acceptedSeen += 1;
    }
    expect(acceptedSeen).toBeGreaterThan(0);

    // … explicit failures join on DecisionProviderFailed.
    const timeout = fixtureRequests.find((r) => r.role === 'upstream-timeout')!;
    const failedEvent = ledger.events.find(
      (e) =>
        e.type === 'DecisionProviderFailed' &&
        (e.payload as { requestId: string }).requestId === timeout.requestId,
    )!;
    const timeoutRow = rows.get(timeout.requestId)!;
    expect(timeoutRow.gatewayOutcome).toBe('upstream-timeout');
    expect(timeoutRow.failureId).toBe(`gwf-${timeout.requestId}`);
    expect(timeoutRow.engineOutcome).toBe('expired');
    expect(timeoutRow.logicalSubmittedTick).toBe(failedEvent.tick);
    expect(timeoutRow.engineResolutionEventId).toBe(failedEvent.id);

    // The client-only death never reached the gateway: no trace row, no
    // sidecar — but the join still covers it via the client entry + ledger.
    const budget = fixtureRequests.find((r) => r.role === 'client-budget')!;
    const budgetRow = rows.get(budget.requestId)!;
    expect(budgetRow.gatewayOutcome).toBeNull();
    expect(budgetRow.clientOutcome).toBe('failure');
    expect(budgetRow.requestEnvelopeFile).toBeNull();
    expect(budgetRow.engineOutcome).toBe('expired');
    expect(budgetRow.logicalSubmittedTick).not.toBeNull();

    // Finalized manifest: seed + ledger facts, totals, and full completeness.
    const manifest = readJson<{
      manifestFinalSchemaVersion: number;
      status: string;
      runId: string;
      scenarioId: string;
      scenarioVersion: string;
      seed: number;
      configVersion: string;
      providerPlanId: string;
      externalProviderId: string;
      promptVersion: string;
      requestedModelId: string | null;
      returnedModelIds: string[];
      startedAtUtc: string;
      worldStateHash: string;
      canonicalLedgerHash: string;
      externalRequestsEmitted: number;
      upstreamCallsAttempted: number;
      callsCompleted: number;
      acceptedModelResponses: number;
      completeness: { sources: string[]; notes: string[] };
    }>(join(dir, 'run-manifest.final.json'));
    expect(manifest.manifestFinalSchemaVersion).toBe(1);
    expect(manifest.status).toBe('completed');
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.scenarioId).toBe('A');
    expect(manifest.scenarioVersion).toBe(ledger.scenario.version);
    expect(manifest.seed).toBe(ledger.scenario.seed);
    expect(manifest.configVersion).toBe(ledger.scenario.configVersion);
    expect(manifest.worldStateHash).toBe(ledger.worldStateHash);
    expect(manifest.canonicalLedgerHash).toBe(ledger.canonicalLedgerHash);
    expect(manifest.requestedModelId).toBe('fake-adapter');
    expect(manifest.returnedModelIds).toEqual(['fake-adapter']);
    expect(manifest.externalRequestsEmitted).toBe(fixtureRequests.length);
    expect(manifest.upstreamCallsAttempted).toBe(fixtureRequests.length - 1);
    expect(manifest.callsCompleted).toBe(fixtureRequests.length - 2);
    expect(manifest.acceptedModelResponses).toBeGreaterThan(0);
    expect(manifest.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    expect(manifest.completeness.notes).toEqual([]);

    // The seed manifest was NOT mutated.
    expect(readFileSync(join(dir, 'run-manifest.json'), 'utf8')).toBe(
      readFileSync(join(templateDir, 'run-manifest.json'), 'utf8'),
    );

    // Client/engine demand metrics ride the summary when a client trace is
    // present (§10.1: not derivable from gateway trace length).
    const summary = readJson<{
      clientDemand: {
        externalRequestsEmittedByEngine: number;
        requestsSeenByClient: number;
        requestsDispatchedToGateway: number;
        requestsFailedBeforeDispatch: number;
        requestsFailedBeforeDispatchByCode: Record<string, number>;
      };
    }>(join(dir, 'model-summary.json'));
    expect(summary.clientDemand.requestsSeenByClient).toBe(fixtureRequests.length);
    expect(summary.clientDemand.requestsDispatchedToGateway).toBe(fixtureRequests.length - 1);
    expect(summary.clientDemand.requestsFailedBeforeDispatch).toBe(1);
    expect(summary.clientDemand.requestsFailedBeforeDispatchByCode).toEqual({
      'budget-exhausted': 1,
    });
    // Engine demand counts ONLY the external provider's DecisionRequested
    // events. This fixture's ledger also carries deterministic-provider
    // requests for jonas/rin, which must NOT inflate the §10.1 denominator
    // (F10: an inequality here would stay green with the provider filter
    // removed).
    const allRequested = ledger.events.filter((e) => e.type === 'DecisionRequested').length;
    const externalRequested = ledger.events.filter(
      (e) =>
        e.type === 'DecisionRequested' &&
        (e.payload as { providerId: string }).providerId === EXTERNAL_MARA_PROVIDER_ID,
    ).length;
    expect(allRequested).toBeGreaterThan(externalRequested);
    expect(externalRequested).toBe(fixtureRequests.length);
    expect(summary.clientDemand.externalRequestsEmittedByEngine).toBe(externalRequested);

    // Bundle manifest covers EVERY file in the directory except itself, and
    // the aggregate hash is sha256 over the sorted `<name>:<sha256>` lines.
    const bundleManifest = readJson<{
      bundleManifestSchemaVersion: number;
      producer: string;
      files: { name: string; sha256: string }[];
      aggregateSha256: string;
    }>(join(dir, 'bundle-manifest.json'));
    // Producer discriminator (F4/F7/F16): the finalizer's whole-directory
    // binding is self-describing, never confusable with the informal
    // model:summarize manifest that shares the filename.
    expect(bundleManifest.bundleManifestSchemaVersion).toBe(1);
    expect(bundleManifest.producer).toBe('model:finalize');
    const expectedNames = [
      'client-bundle.json',
      'finalized-trace.jsonl',
      LEDGER_NAME,
      'model-summary.json',
      'model-trace.jsonl',
      ...fixtureRequests
        .filter((r) => r.role !== 'client-budget')
        .map((r) => `requests/${r.requestId}.json`),
      'run-manifest.final.json',
      'run-manifest.json',
    ].sort();
    expect(bundleManifest.files.map((f) => f.name).sort()).toEqual(expectedNames);
    const lines = bundleManifest.files.map((f) => `${f.name}:${f.sha256}`).sort();
    expect(bundleManifest.aggregateSha256).toBe(
      createHash('sha256').update(lines.join('\n')).digest('hex'),
    );

    // Modifying any covered file changes its sha256 and thus the aggregate.
    const traceEntry = bundleManifest.files.find((f) => f.name === 'model-trace.jsonl')!;
    appendFileSync(join(dir, 'model-trace.jsonl'), '\n');
    const modifiedSha = createHash('sha256')
      .update(readFileSync(join(dir, 'model-trace.jsonl')))
      .digest('hex');
    expect(modifiedSha).not.toBe(traceEntry.sha256);
    const modifiedLines = bundleManifest.files.map((f) =>
      f.name === 'model-trace.jsonl' ? `${f.name}:${modifiedSha}` : `${f.name}:${f.sha256}`,
    );
    expect(createHash('sha256').update(modifiedLines.sort().join('\n')).digest('hex')).not.toBe(
      bundleManifest.aggregateSha256,
    );
  });
});

describe('finalize failure matrix (S3: contradiction -> throws)', () => {
  it('rejects a run-manifest runId that contradicts the directory', () => {
    const dir = freshDir();
    const seed = readJson<{ runId: string }>(join(dir, 'run-manifest.json'));
    seed.runId = 'run-bundle-9999';
    writeJson(join(dir, 'run-manifest.json'), seed);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
  });

  it('rejects a scenario mismatch between manifest and ledger/trace', () => {
    const dir = freshDir();
    const seed = readJson<{ scenarioId: string }>(join(dir, 'run-manifest.json'));
    seed.scenarioId = 'B1';
    writeJson(join(dir, 'run-manifest.json'), seed);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
  });

  it('rejects a tampered sidecar whose contextHash no longer recomputes', () => {
    const dir = freshDir();
    const target = fixtureRequests.find((r) => r.role === 'response')!;
    const sidecarPath = join(dir, 'requests', `${target.requestId}.json`);
    const envelope = readJson<{ contextHash: string }>(sidecarPath);
    envelope.contextHash = 'f'.repeat(16);
    writeJson(sidecarPath, envelope);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
  });

  it('rejects a ledger whose hashes contradict the client handoff', () => {
    const dir = freshDir();
    const tampered = readJson<{ worldStateHash: string }>(join(dir, LEDGER_NAME));
    tampered.worldStateHash = '0123456789abcdef';
    writeJson(join(dir, LEDGER_NAME), tampered);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/worldStateHash/);
  });

  it('refuses two ledgers without a handoff designation (never first-match)', () => {
    const dir = freshDir();
    copyFileSync(join(dir, LEDGER_NAME), join(dir, 'ledger-A-second.json'));
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/ambiguous/);
  });

  it('hard-fails an unresolved gateway response row the client trace cannot explain', () => {
    const dir = freshDir();
    const phantom: TraceEntryV2 = {
      ...traceRowFor(fixtureRequests.find((r) => r.role === 'response')!),
      requestId: 'dec-9999',
      responseId: 'gw-dec-9999',
      upstreamResponseId: 'up-dec-9999',
      contextHash: '0'.repeat(16),
    };
    appendFileSync(join(dir, 'model-trace.jsonl'), `${JSON.stringify(phantom)}\n`);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/no client explanation/);
  });
});

describe('finalize absence matrix (S3: absence degrades, never fails)', () => {
  it('finalizes without a client bundle at completeness gateway+ledger (deviation D2)', () => {
    const dir = freshDir();
    rmSync(join(dir, 'client-bundle.json'));
    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.completeness.sources).toEqual(['gateway', 'ledger']);
    expect(result.completeness.notes.some((n) => n.includes('client-bundle.json absent'))).toBe(
      true,
    );
    // F11: with no handoff, nothing binds the copied ledger to this run —
    // the finalizer says so instead of implying only metrics were lost.
    expect(
      result.completeness.notes.some((n) =>
        n.includes('ledger-to-run binding is operator-asserted'),
      ),
    ).toBe(true);
    // Without the client view, the never-dispatched request is invisible.
    const rows = readFinalRows(dir);
    expect(rows.size).toBe(fixtureRequests.length - 1);
    const budget = fixtureRequests.find((r) => r.role === 'client-budget')!;
    expect(rows.has(budget.requestId)).toBe(false);
    const manifest = readJson<{ externalRequestsEmitted: number }>(
      join(dir, 'run-manifest.final.json'),
    );
    expect(manifest.externalRequestsEmitted).toBe(fixtureRequests.length - 1);
  });

  it('finalizes with a missing envelope sidecar, noting the gap', () => {
    const dir = freshDir();
    const target = fixtureRequests.find((r) => r.role === 'response')!;
    rmSync(join(dir, 'requests', `${target.requestId}.json`));
    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    expect(
      result.completeness.notes.some((n) => n.includes(target.requestId) && n.includes('sidecar')),
    ).toBe(true);
    const rows = readFinalRows(dir);
    expect(rows.get(target.requestId)!.requestEnvelopeFile).toBeNull();
  });
});
