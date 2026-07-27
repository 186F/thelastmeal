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
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeRunDirectory } from '../../scripts/model/finalize';
import { prepareRunDirectory } from '../../scripts/model/prepareRun';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { evaluateConstraints } from '../../src/sim/decisions/constraints';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
} from '../../src/sim/decisions/externalSchemas';
import type { PendingDecisionState } from '../../src/sim/domain/state';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import type { ModelClientTraceEntry } from '../../src/app/modelClientTraceRecorder';
import type { ModelGatewayStatus } from '../../src/app/modelGatewayClient';
import { buildRunBundle } from '../../src/app/runBundle';
import { ViewStore } from '../../src/app/store';
import type { RunBundle } from '../../src/shared/modelArtifacts';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';

/**
 * Full fixture-bundle finalization (re-audit remediation S3/S4; strict/
 * degraded v2 semantics in 1.5.0 V3-V6). A REAL completed model-condition
 * run provides the canonical ledger and the exact request envelopes; the
 * gateway trace, sidecars, and client bundle are fabricated to match — then
 * the finalizer must join every request, source the submitted tick from
 * ledger events, classify every row's strict disposition, and bind the whole
 * directory under one aggregate hash. The failure matrix proves every
 * cross-artifact CONTRADICTION is fatal in BOTH modes; the strict/degraded
 * matrix proves a missing OPTIONAL source fails STRICT finalization with
 * zero derived writes and degrades only under --allow-degraded (this
 * reverses the 1.4.0 "absence degrades, never fails" behavior — the reversal
 * is spec-mandated by brief §6/spec V3, not a regression). No live key, no
 * network — everything runs against a tmpdir.
 */

const RUN_ID = 'run-bundle-0001';
const RUN_COMPLETED_AT = '2026-07-27T10:30:00.000Z';
const EXPORTED_AT = '2026-07-27T10:45:00.000Z';
const DERIVED_FILES = [
  'finalized-trace.jsonl',
  'run-manifest.final.json',
  'model-summary.json',
  'bundle-manifest.json',
] as const;

interface FixtureRequest {
  requestId: string;
  /** response — gateway answered (row + sidecar, gatewayResultObserved);
   * client-budget — died client-side pre-dispatch (nothing gateway-side);
   * upstream-timeout — gateway FAILURE body (gwf-, row + sidecar, observed);
   * gateway-interrupted — sidecar only, NO row (client timeout racing the
   * gateway / gateway killed mid-adapter — A2/V4). */
  role: 'response' | 'client-budget' | 'upstream-timeout' | 'gateway-interrupted';
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
 * (budget, never dispatched), ordinal 3 gets a gateway failure body
 * (upstream timeout), ordinal 4 is interrupted (client timeout entered the
 * engine; the gateway left only a sidecar), everything else gets a
 * gateway-shaped response. */
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
        ordinal === 2
          ? 'client-budget'
          : ordinal === 3
            ? 'upstream-timeout'
            : ordinal === 4
              ? 'gateway-interrupted'
              : 'response';
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
        const failureCode =
          role === 'upstream-timeout'
            ? 'upstream-timeout'
            : role === 'gateway-interrupted'
              ? 'request-timeout'
              : 'budget-exhausted';
        run.failureInbox.push({
          failureId: role === 'upstream-timeout' ? `gwf-${requestId}` : `cf-${requestId}`,
          requestId,
          npcId: 'mara',
          scenarioId: 'A',
          providerId: EXTERNAL_MARA_PROVIDER_ID,
          failureCode,
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
      failureId: `cf-${request.requestId}`,
      clientLatencyMs: null,
      // Client-minted cf- failure: the gateway produced no parsed result (A2).
      gatewayResultObserved: false,
    };
  }
  if (request.role === 'gateway-interrupted') {
    return {
      ...base,
      dispatchedAtUtc: '2026-07-27T10:00:00.020Z',
      completedAtUtc: '2026-07-27T10:00:20.020Z',
      clientOutcome: 'failure',
      clientFailureCode: 'request-timeout',
      responseId: null,
      failureId: `cf-${request.requestId}`,
      clientLatencyMs: 20_000,
      // The POST was sent (sidecar exists) but no gateway result was ever
      // parsed — dispatchedAtUtc is NOT gateway evidence (A2).
      gatewayResultObserved: false,
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
      // A parsed gateway FAILURE body (gwf-) is gateway evidence (A2).
      gatewayResultObserved: true,
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
    gatewayResultObserved: true,
  };
}

function envelopeFor(request: FixtureRequest): Record<string, unknown> {
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

function canonicalSha256(envelope: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(externalDecisionRequestEnvelopeSchema.parse(envelope)))
    .digest('hex');
}

function gatewayStatusFor(
  runId: string,
  dispatched: number,
  responses: number,
): ModelGatewayStatus {
  return {
    connected: true,
    contractMismatchField: null,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: 'fake-adapter',
    runId,
    callsAttempted: dispatched,
    gatewayResponses: responses,
    gatewayFailures: 2,
    failuresByCode: {},
    lastLatencyMs: 42,
    queuedRequests: 0,
    pendingRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    busy: false,
    archivePoisoned: false,
  };
}

/** The client bundle comes from the REAL v2 producer (re-audit F9): a
 * terminal model-condition view state + gateway status fed to buildRunBundle,
 * so prepareRun/finalize consume the exact artifact the panel exports. */
function buildFixtureBundle(
  runId: string,
  ledgerFile: LedgerFile,
  entries: ModelClientTraceEntry[],
  envelopes: unknown[],
  dispatched: number,
  responses: number,
): RunBundle {
  const exportState = new ViewStore().state;
  exportState.runStatus = 'complete';
  exportState.selectedConditionId = MODEL_CONDITION_ID;
  exportState.selectedScenarioId = 'A';
  exportState.finalWorldHash = ledgerFile.worldStateHash;
  exportState.finalLedgerHash = ledgerFile.canonicalLedgerHash;
  exportState.runCompletedAtUtc = RUN_COMPLETED_AT;
  exportState.model.acceptedModelResponses = ledgerFile.events.filter(
    (e) =>
      e.type === 'DecisionResponseAccepted' &&
      String((e.payload as { responseId: string }).responseId).startsWith('gw-'),
  ).length;
  exportState.model.gateway = gatewayStatusFor(runId, dispatched, responses);
  return buildRunBundle(exportState, entries, runId, EXPORTED_AT, envelopes, []);
}

const LEDGER_NAME = `ledger-A-${RUN_ID}.json`;
let templateDir: string;
let ledger: LedgerFile;
let fixtureRequests: FixtureRequest[];
let sortedEnvelopes: Record<string, unknown>[];
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

/** V2 atomicity: a failed finalization must leave NO derived output and no
 * staging residue — no bundle manifest is the unambiguous not-finalized
 * signal. */
function expectNotFinalized(dir: string): void {
  for (const derived of DERIVED_FILES) {
    expect(existsSync(join(dir, derived)), derived).toBe(false);
  }
  expect(existsSync(join(dirname(dir), `.${RUN_ID}.finalize-tmp`)), 'staging dir').toBe(false);
}

interface FinalRow {
  requestId: string;
  npcId: string;
  conditionId: string;
  providerId: string;
  modelId: string | null;
  requestedAtLogicalTick: number | null;
  logicalSubmittedTick: number | null;
  exactRequestSources: ('client' | 'gateway')[];
  envelopeSha256: string | null;
  requestEnvelopeFile: string | null;
  clientEnvelopeIndex: number | null;
  strictDisposition:
    | 'gateway-answered'
    | 'never-dispatched'
    | 'gateway-interrupted'
    | 'moot-after-resolution'
    | 'stale-run-discard'
    | null;
  contextHash: string | null;
  responseId: string | null;
  failureId: string | null;
  clientLatencyMs: number | null;
  gatewayLatencyMs: number | null;
  clientOutcome: string | null;
  gatewayOutcome: string | null;
  /** null == unresolved: no engine lifecycle event for the result. */
  engineOutcome: 'accepted' | 'rejected' | 'expired' | 'superseded' | null;
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
  expect(requests.length).toBeGreaterThanOrEqual(5);
  expect(requests.filter((r) => r.role === 'client-budget')).toHaveLength(1);
  expect(requests.filter((r) => r.role === 'upstream-timeout')).toHaveLength(1);
  expect(requests.filter((r) => r.role === 'gateway-interrupted')).toHaveLength(1);

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
  const traced = requests.filter((r) => r.role === 'response' || r.role === 'upstream-timeout');
  writeFileSync(
    join(templateDir, 'model-trace.jsonl'),
    traced.map((r) => JSON.stringify(traceRowFor(r))).join('\n') + '\n',
    'utf8',
  );
  // Sidecars exist for everything that REACHED the gateway — including the
  // interrupted request, whose sidecar was written before the adapter call.
  for (const request of requests.filter((r) => r.role !== 'client-budget')) {
    writeJson(join(templateDir, 'requests', `${request.requestId}.json`), envelopeFor(request));
  }

  // The client-side exact-request archive covers EVERY request the client
  // saw (C2), in the client's requestId-sorted order.
  sortedEnvelopes = [...requests]
    .sort((a, b) => (a.requestId < b.requestId ? -1 : 1))
    .map((r) => envelopeFor(r));
  const clientBundle = buildFixtureBundle(
    RUN_ID,
    ledger,
    requests.map((r) => clientEntryFor(r)),
    sortedEnvelopes,
    requests.length - 1,
    requests.filter((r) => r.role === 'response').length,
  );

  // Operator-side placement goes through the S1 helper (validate-then-copy).
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

describe('prepareRun (S1 + V1)', () => {
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

  it('hard-rejects a bundle carrying schema version 1 with the migration message (A8)', () => {
    const root = mkdtempSync(join(tmpdir(), 'model-bundle-prep-'));
    const v1 = readJson<Record<string, unknown>>(join(stagingDir, 'client-bundle-export.json'));
    v1.bundleSchemaVersion = 1;
    writeJson(join(stagingDir, 'v1-bundle.json'), v1);
    expect(() =>
      prepareRunDirectory({
        runId: RUN_ID,
        ledgerPath: join(stagingDir, LEDGER_NAME),
        bundlePath: join(stagingDir, 'v1-bundle.json'),
        destRoot: root,
      }),
    ).toThrow(
      /run-bundle schema version 1 is not supported — re-export the run bundle under release 1\.5\.0/,
    );
    expect(existsSync(join(root, RUN_ID))).toBe(false);
  });
});

describe('finalize strict success path (S3 + V3/V4)', () => {
  it('joins every request, classifies dispositions, records v2 provenance, and binds the bundle', () => {
    const dir = freshDir();
    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.status).toBe('completed');
    expect(result.failedCriteria).toEqual([]);
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
    const envelopeIndexOf = (requestId: string): number =>
      sortedEnvelopes.findIndex(
        (e) => (e.request as { requestId: string }).requestId === requestId,
      );
    for (const request of fixtureRequests) {
      const row = rows.get(request.requestId);
      expect(row).toBeDefined();
      expect(row!.npcId).toBe('mara');
      expect(row!.conditionId).toBe(MODEL_CONDITION_ID);
      expect(row!.providerId).toBe(EXTERNAL_MARA_PROVIDER_ID);
      expect(row!.requestedAtLogicalTick).toBe(request.requestedAtTick);
      expect(row!.contextHash).toBe(request.contextHash);
      // A3: rows POINT at the once-per-source envelopes — index + sha256 —
      // never embed the bytes a third time.
      expect(row!.clientEnvelopeIndex).toBe(envelopeIndexOf(request.requestId));
      expect(row!.envelopeSha256).toBe(canonicalSha256(envelopeFor(request)));
      expect(row!.exactRequestSources).toEqual(
        request.role === 'client-budget' ? ['client'] : ['client', 'gateway'],
      );
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
      expect(row.strictDisposition).toBe('gateway-answered');
      if (received) {
        expect(row.logicalSubmittedTick).toBe(received.tick);
        expect(row.engineResolutionEventId).toBe(received.id);
        expect(row.logicalSubmittedTick).toBe(request.requestedAtTick + 1);
      }
      if (row.engineOutcome === 'accepted') acceptedSeen += 1;
    }
    expect(acceptedSeen).toBeGreaterThan(0);

    // … explicit failures join on DecisionProviderFailed. A parsed gateway
    // FAILURE body is gateway evidence (A2): disposition gateway-answered.
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
    expect(timeoutRow.strictDisposition).toBe('gateway-answered');
    expect(timeoutRow.logicalSubmittedTick).toBe(failedEvent.tick);
    expect(timeoutRow.engineResolutionEventId).toBe(failedEvent.id);

    // The client-only death never reached the gateway: no trace row, no
    // sidecar — but the join still covers it via the client entry + archive.
    const budget = fixtureRequests.find((r) => r.role === 'client-budget')!;
    const budgetRow = rows.get(budget.requestId)!;
    expect(budgetRow.gatewayOutcome).toBeNull();
    expect(budgetRow.clientOutcome).toBe('failure');
    expect(budgetRow.requestEnvelopeFile).toBeNull();
    expect(budgetRow.strictDisposition).toBe('never-dispatched');
    expect(budgetRow.engineOutcome).toBe('expired');
    expect(budgetRow.logicalSubmittedTick).not.toBeNull();

    // Sidecar-present-but-no-trace-row with a typed client timeout is the
    // LEGAL gateway-interrupted disposition (A2/V4) — strict-complete, never
    // fatal.
    const interrupted = fixtureRequests.find((r) => r.role === 'gateway-interrupted')!;
    const interruptedRow = rows.get(interrupted.requestId)!;
    expect(interruptedRow.gatewayOutcome).toBeNull();
    expect(interruptedRow.clientOutcome).toBe('failure');
    expect(interruptedRow.requestEnvelopeFile).toBe(`requests/${interrupted.requestId}.json`);
    expect(interruptedRow.strictDisposition).toBe('gateway-interrupted');
    expect(interruptedRow.engineOutcome).toBe('expired');

    // Finalized v2 manifest: seed + ledger facts, V5 counters, timestamps.
    const manifest = readJson<{
      manifestFinalSchemaVersion: number;
      status: string;
      runId: string;
      scenarioId: string;
      scenarioVersion: string;
      seed: number;
      configVersion: string;
      requestedModelId: string | null;
      returnedModelIds: string[];
      startedAtUtc: string;
      runCompletedAtUtc: string | null;
      exportedAtUtc: string | null;
      finalizedAtUtc: string;
      worldStateHash: string;
      canonicalLedgerHash: string;
      externalRequestsEmitted: number;
      requestsSeenByClient: number | null;
      requestsWithGatewayResult: number | null;
      requestsDispatchedToGateway: number | null;
      upstreamCallsAttempted: number;
      callsCompleted: number;
      acceptedModelResponses: number;
      failedCriteria: string[];
      completeness: { sources: string[]; notes: string[] };
    }>(join(dir, 'run-manifest.final.json'));
    expect(manifest.manifestFinalSchemaVersion).toBe(2);
    expect(manifest.status).toBe('completed');
    expect(manifest.failedCriteria).toEqual([]);
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.scenarioId).toBe('A');
    expect(manifest.scenarioVersion).toBe(ledger.scenario.version);
    expect(manifest.seed).toBe(ledger.scenario.seed);
    expect(manifest.configVersion).toBe(ledger.scenario.configVersion);
    expect(manifest.worldStateHash).toBe(ledger.worldStateHash);
    expect(manifest.canonicalLedgerHash).toBe(ledger.canonicalLedgerHash);
    expect(manifest.requestedModelId).toBe('fake-adapter');
    expect(manifest.returnedModelIds).toEqual(['fake-adapter']);
    // V5: ONE shared counters helper — engine-emitted count, runId-scoped
    // client counts, the A2 gateway-result count, and "POST attempted".
    expect(manifest.externalRequestsEmitted).toBe(fixtureRequests.length);
    expect(manifest.requestsSeenByClient).toBe(fixtureRequests.length);
    expect(manifest.requestsWithGatewayResult).toBe(fixtureRequests.length - 2);
    expect(manifest.requestsDispatchedToGateway).toBe(fixtureRequests.length - 1);
    expect(manifest.upstreamCallsAttempted).toBe(fixtureRequests.length - 2);
    expect(manifest.callsCompleted).toBe(fixtureRequests.length - 3);
    expect(manifest.acceptedModelResponses).toBeGreaterThan(0);
    // A5: monotonic NON-decreasing timestamps (equality legal, never
    // asserted distinct).
    expect(manifest.runCompletedAtUtc).toBe(RUN_COMPLETED_AT);
    expect(manifest.exportedAtUtc).toBe(EXPORTED_AT);
    expect(manifest.runCompletedAtUtc! <= manifest.exportedAtUtc!).toBe(true);
    expect(manifest.exportedAtUtc! <= manifest.finalizedAtUtc).toBe(true);
    expect(manifest.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    expect(manifest.completeness.notes).toEqual([]);

    // The seed manifest was NOT mutated.
    expect(readFileSync(join(dir, 'run-manifest.json'), 'utf8')).toBe(
      readFileSync(join(templateDir, 'run-manifest.json'), 'utf8'),
    );

    // Client/engine demand metrics derive from the SAME V5 helper as the
    // manifest counters.
    const summary = readJson<{
      clientDemand: {
        externalRequestsEmittedByEngine: number;
        requestsSeenByClient: number;
        requestsWithGatewayResult: number;
        requestsDispatchedToGateway: number;
        requestsFailedBeforeDispatch: number;
        requestsFailedBeforeDispatchByCode: Record<string, number>;
      };
      outcomes: { requestId: string; engineOutcome: string; engineExpiryReason: string | null }[];
    }>(join(dir, 'model-summary.json'));
    expect(summary.clientDemand.requestsSeenByClient).toBe(fixtureRequests.length);
    expect(summary.clientDemand.requestsWithGatewayResult).toBe(fixtureRequests.length - 2);
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

    // model-summary.json and finalized-trace.jsonl are hash-bound into the
    // SAME bundle manifest, so they must never disagree per requestId: both
    // verdicts come from the one shared resolution ladder, in the finalized
    // enum's closed vocabulary. (The summary's private ladder used to report
    // the raw DecisionRequestExpired reasonCode — 'external-failure' for the
    // upstream-timeout row below — and had no supersede lookup at all.)
    const CLOSED_VOCABULARY = ['accepted', 'rejected', 'expired', 'superseded', 'unresolved'];
    expect(summary.outcomes.length).toBeGreaterThan(0);
    for (const outcome of summary.outcomes) {
      expect(CLOSED_VOCABULARY, outcome.requestId).toContain(outcome.engineOutcome);
      expect(outcome.engineOutcome, outcome.requestId).toBe(
        rows.get(outcome.requestId)!.engineOutcome ?? 'unresolved',
      );
    }
    const timeoutOutcome = summary.outcomes.find((o) => o.requestId === timeout.requestId)!;
    expect(timeoutOutcome.engineOutcome).toBe('expired');
    expect(timeoutOutcome.engineExpiryReason).toBe('external-failure');

    // Bundle manifest v2 covers EVERY file in the directory except itself,
    // carries the finalizer's status, and the aggregate hash is sha256 over
    // the sorted `<name>:<sha256>` lines.
    const bundleManifest = readJson<{
      bundleManifestSchemaVersion: number;
      producer: string;
      status: string | null;
      files: { name: string; sha256: string }[];
      aggregateSha256: string;
    }>(join(dir, 'bundle-manifest.json'));
    // Producer discriminator (F4/F7/F16): the finalizer's whole-directory
    // binding is self-describing, never confusable with the informal
    // model:summarize manifest that shares the filename.
    expect(bundleManifest.bundleManifestSchemaVersion).toBe(2);
    expect(bundleManifest.producer).toBe('model:finalize');
    expect(bundleManifest.status).toBe('completed');
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

describe('a live gateway that answers AFTER the client gave up (V4 gateway-interrupted, row present)', () => {
  /** The gateway's abort deadline is armed strictly LATER than the client's
   * (gateway/server.ts arms it after body read + validation + seed + sidecar
   * write; modelGatewayClient.ts arms its identically-defaulted timer
   * immediately before the POST) and nothing wires client disconnect to the
   * handler — so on any upstream call slower than the client deadline the
   * client mints a cf- transport failure while the STILL-RUNNING gateway
   * reaches a terminal result and appends its trace row. That leaves sidecar
   * + row + gatewayResultObserved:false, which is the SAME legal shape as the
   * sidecar-only (gateway killed mid-adapter) case pinned above — with strictly
   * MORE evidence. Requiring the row's absence made every such run
   * un-finalizable in strict mode; these cases fail without that fix. */
  function appendRow(dir: string, row: TraceEntryV2): void {
    appendFileSync(join(dir, 'model-trace.jsonl'), `${JSON.stringify(row)}\n`);
  }

  function patchClientEntry(
    dir: string,
    requestId: string,
    patch: Partial<ModelClientTraceEntry>,
  ): void {
    const bundle = readJson<{ clientTrace: ModelClientTraceEntry[] }>(
      join(dir, 'client-bundle.json'),
    );
    const entry = bundle.clientTrace.find((e) => e.requestId === requestId)!;
    Object.assign(entry, patch);
    writeJson(join(dir, 'client-bundle.json'), bundle);
  }

  it("classifies a client request-timeout whose gateway later wrote its OWN upstream-timeout row as 'gateway-interrupted' and strict-completes", () => {
    const dir = freshDir();
    const interrupted = fixtureRequests.find((r) => r.role === 'gateway-interrupted')!;
    appendRow(dir, traceRowFor(interrupted));

    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.status).toBe('completed');
    expect(result.failedCriteria).toEqual([]);
    expect(result.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    // The extra evidence is RECORDED (a paid call the client discarded), not
    // treated as a contradiction.
    expect(
      result.completeness.notes.some(
        (n) =>
          n.includes(interrupted.requestId) &&
          n.includes('gateway trace row the client never observed'),
      ),
    ).toBe(true);

    const row = readFinalRows(dir).get(interrupted.requestId)!;
    expect(row.strictDisposition).toBe('gateway-interrupted');
    expect(row.clientOutcome).toBe('failure');
    expect(row.gatewayOutcome).toBe('upstream-timeout');
    expect(row.engineOutcome).toBe('expired');
    expect(row.exactRequestSources).toEqual(['client', 'gateway']);
    expect(readJson<{ status: string }>(join(dir, 'run-manifest.final.json')).status).toBe(
      'completed',
    );
  });

  it("classifies a client gateway-unavailable whose gateway still wrote a full 'response' row as 'gateway-interrupted' and strict-completes", () => {
    const dir = freshDir();
    const interrupted = fixtureRequests.find((r) => r.role === 'gateway-interrupted')!;
    // A mid-flight Ctrl-C / socket reset: the client mints gateway-unavailable
    // while the handler completes and lands a response row the client never
    // parsed (so the engine only ever saw the cf- failure).
    patchClientEntry(dir, interrupted.requestId, { clientFailureCode: 'gateway-unavailable' });
    appendRow(dir, {
      ...traceRowFor(interrupted),
      modelId: 'fake-adapter',
      upstreamResponseId: `up-${interrupted.requestId}`,
      responseId: `gw-${interrupted.requestId}`,
      failureId: null,
      selectedAffordanceId: interrupted.external.request.offeredAffordanceIds[0] ?? null,
      reasonCode: 'routine',
      confidenceBp: 5_000,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      latencyMs: 42,
      gatewayOutcome: 'response',
    });

    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.status).toBe('completed');
    expect(result.failedCriteria).toEqual([]);
    const row = readFinalRows(dir).get(interrupted.requestId)!;
    expect(row.strictDisposition).toBe('gateway-interrupted');
    expect(row.gatewayOutcome).toBe('response');
    // The engine only ever recorded the client's typed failure.
    expect(row.engineOutcome).toBe('expired');
  });
});

describe('ledger-proven gateway result with no trace row (V3 trace coverage)', () => {
  it('is FATAL in both modes when a present client entry denies observing the result', () => {
    const dir = freshDir();
    const answered = fixtureRequests.find((r) => r.role === 'response')!;
    // Gateway-side truncation/mis-staging: the row and the sidecar are gone,
    // but the fully validated ledger still holds DecisionResponseAccepted for
    // gw-<id> — positive proof the gateway answered. A client entry claiming
    // it never saw a gateway result contradicts a present, sealed source.
    const kept = readFileSync(join(dir, 'model-trace.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes(`"${answered.requestId}"`));
    writeFileSync(join(dir, 'model-trace.jsonl'), kept.join('\n') + '\n', 'utf8');
    rmSync(join(dir, 'requests', `${answered.requestId}.json`));
    const bundle = readJson<{ clientTrace: ModelClientTraceEntry[] }>(
      join(dir, 'client-bundle.json'),
    );
    const entry = bundle.clientTrace.find((e) => e.requestId === answered.requestId)!;
    entry.clientOutcome = 'failure';
    entry.clientFailureCode = 'request-timeout';
    entry.responseId = null;
    entry.failureId = `cf-${answered.requestId}`;
    entry.gatewayResultObserved = false;
    writeJson(join(dir, 'client-bundle.json'), bundle);

    const message = /the validated ledger holds gateway response 'gw-/;
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(message);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(message);
    expectNotFinalized(dir);
  });

  it('is a strict failed criterion (never a mere note) when no client entry denies it', () => {
    const dir = freshDir();
    const answered = fixtureRequests.find((r) => r.role === 'response')!;
    rmSync(join(dir, 'client-bundle.json'));
    const kept = readFileSync(join(dir, 'model-trace.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes(`"${answered.requestId}"`));
    writeFileSync(join(dir, 'model-trace.jsonl'), kept.join('\n') + '\n', 'utf8');

    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/gateway-trace-coverage/);
    expectNotFinalized(dir);
    const degraded = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(degraded.status).toBe('degraded');
    expect(degraded.failedCriteria.some((c) => c.startsWith('gateway-trace-coverage'))).toBe(true);
    expect(degraded.completeness.sources).toEqual(['ledger']);
  });
});

describe('finalize failure matrix (contradictions -> fatal in BOTH modes, zero derived writes)', () => {
  it('rejects a run-manifest runId that contradicts the directory', () => {
    const dir = freshDir();
    const seed = readJson<{ runId: string }>(join(dir, 'run-manifest.json'));
    seed.runId = 'run-bundle-9999';
    writeJson(join(dir, 'run-manifest.json'), seed);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
    expectNotFinalized(dir);
  });

  it('rejects a scenario mismatch between manifest and ledger/trace', () => {
    const dir = freshDir();
    const seed = readJson<{ scenarioId: string }>(join(dir, 'run-manifest.json'));
    seed.scenarioId = 'B1';
    writeJson(join(dir, 'run-manifest.json'), seed);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
    expectNotFinalized(dir);
  });

  it('rejects a tampered sidecar whose contextHash no longer recomputes', () => {
    const dir = freshDir();
    const target = fixtureRequests.find((r) => r.role === 'response')!;
    const sidecarPath = join(dir, 'requests', `${target.requestId}.json`);
    const envelope = readJson<{ contextHash: string }>(sidecarPath);
    envelope.contextHash = 'f'.repeat(16);
    writeJson(sidecarPath, envelope);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/contradiction/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(
      /contradiction/,
    );
    expectNotFinalized(dir);
  });

  it('rejects a sidecar that no longer deep-equals the client archive envelope', () => {
    const dir = freshDir();
    const target = fixtureRequests.find((r) => r.role === 'response')!;
    const sidecarPath = join(dir, 'requests', `${target.requestId}.json`);
    const envelope = readJson<{ request: { expiresAtTick: number } }>(sidecarPath);
    // Outside context/contextHash, so ONLY the canonical deep-equality proof
    // can catch it — matching hashes are not accepted as a substitute (V3).
    envelope.request.expiresAtTick += 1;
    writeJson(sidecarPath, envelope);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/deep-equal/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(/deep-equal/);
    expectNotFinalized(dir);
  });

  it('rejects an orphan sidecar naming a request the engine never emitted (V3 orphan fatality)', () => {
    const dir = freshDir();
    const source = fixtureRequests.find((r) => r.role === 'response')!;
    const orphan = readJson<{ request: { requestId: string } }>(
      join(dir, 'requests', `${source.requestId}.json`),
    );
    orphan.request.requestId = 'dec-99990';
    writeJson(join(dir, 'requests', 'dec-99990.json'), orphan);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/orphan/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(/orphan/);
    expectNotFinalized(dir);
  });

  it('rejects an orphan gateway trace row (replaces the 1.4.0 unexplained-row probe)', () => {
    const dir = freshDir();
    const phantom: TraceEntryV2 = {
      ...traceRowFor(fixtureRequests.find((r) => r.role === 'response')!),
      requestId: 'dec-9999',
      responseId: 'gw-dec-9999',
      upstreamResponseId: 'up-dec-9999',
      contextHash: '0'.repeat(16),
    };
    appendFileSync(join(dir, 'model-trace.jsonl'), `${JSON.stringify(phantom)}\n`);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/orphan/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(/orphan/);
    expectNotFinalized(dir);
  });

  it('rejects a ledger whose bytes were tampered — full validation, not schema parsing (V1)', () => {
    const dir = freshDir();
    const tampered = readJson<{ worldStateHash: string }>(join(dir, LEDGER_NAME));
    tampered.worldStateHash = '0123456789abcdef';
    writeJson(join(dir, LEDGER_NAME), tampered);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/failed full validation/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(
      /failed full validation/,
    );
    expectNotFinalized(dir);
  });

  it('refuses two ledgers without a handoff designation (never first-match)', () => {
    const dir = freshDir();
    copyFileSync(join(dir, LEDGER_NAME), join(dir, 'ledger-A-second.json'));
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/ambiguous/);
    expectNotFinalized(dir);
  });

  it('rejects a poisoned exact-request archive in BOTH modes (C2/V3)', () => {
    const dir = freshDir();
    const bundle = readJson<{ archiveDiagnostics: string[] }>(join(dir, 'client-bundle.json'));
    bundle.archiveDiagnostics = ['duplicate-request-conflict: fixture poison'];
    writeJson(join(dir, 'client-bundle.json'), bundle);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/poisoned/);
    expect(() => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true })).toThrow(/poisoned/);
    expectNotFinalized(dir);
  });

  it('hard-rejects a v1 client bundle with the migration message (A8)', () => {
    const dir = freshDir();
    const bundle = readJson<Record<string, unknown>>(join(dir, 'client-bundle.json'));
    bundle.bundleSchemaVersion = 1;
    writeJson(join(dir, 'client-bundle.json'), bundle);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(
      /run-bundle schema version 1 is not supported — re-export the run bundle under release 1\.5\.0/,
    );
    expectNotFinalized(dir);
  });
});

describe('strict/degraded matrix (V3: strict fails on absence with zero writes; --allow-degraded degrades; spec-mandated reversal of the 1.4.0 absence semantics, brief §6)', () => {
  it('strict refuses a missing client bundle and writes NOTHING', () => {
    const dir = freshDir();
    rmSync(join(dir, 'client-bundle.json'));
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/client-bundle-present/);
    expectNotFinalized(dir);
  });

  it('--allow-degraded archives the bundle-less run as status degraded with failedCriteria', () => {
    const dir = freshDir();
    rmSync(join(dir, 'client-bundle.json'));
    const result = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(result.status).toBe('degraded');
    expect(result.failedCriteria).toEqual(['client-bundle-present: client-bundle.json is absent']);
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
    // Without the client view, the never-dispatched request is invisible;
    // the ENGINE-emitted count (V5) still reports the full demand.
    const rows = readFinalRows(dir);
    expect(rows.size).toBe(fixtureRequests.length - 1);
    const budget = fixtureRequests.find((r) => r.role === 'client-budget')!;
    expect(rows.has(budget.requestId)).toBe(false);
    const manifest = readJson<{
      status: string;
      failedCriteria: string[];
      externalRequestsEmitted: number;
      requestsSeenByClient: number | null;
      requestsWithGatewayResult: number | null;
      requestsDispatchedToGateway: number | null;
      runCompletedAtUtc: string | null;
      exportedAtUtc: string | null;
    }>(join(dir, 'run-manifest.final.json'));
    expect(manifest.status).toBe('degraded');
    expect(manifest.failedCriteria).toHaveLength(1);
    expect(manifest.externalRequestsEmitted).toBe(fixtureRequests.length);
    expect(manifest.requestsSeenByClient).toBeNull();
    expect(manifest.requestsWithGatewayResult).toBeNull();
    expect(manifest.requestsDispatchedToGateway).toBeNull();
    expect(manifest.runCompletedAtUtc).toBeNull();
    expect(manifest.exportedAtUtc).toBeNull();
    const bundleManifest = readJson<{ status: string | null }>(join(dir, 'bundle-manifest.json'));
    expect(bundleManifest.status).toBe('degraded');
  });

  it('strict refuses a missing archived envelope for an engine request (A6 coverage)', () => {
    const dir = freshDir();
    const bundle = readJson<{ exactRequestEnvelopes: unknown[] }>(join(dir, 'client-bundle.json'));
    bundle.exactRequestEnvelopes = bundle.exactRequestEnvelopes.slice(1);
    writeJson(join(dir, 'client-bundle.json'), bundle);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/exact-envelope-coverage/);
    expectNotFinalized(dir);
    const degraded = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(degraded.status).toBe('degraded');
    expect(degraded.failedCriteria.some((c) => c.startsWith('exact-envelope-coverage'))).toBe(true);
  });

  it('strict refuses a missing gateway trace row for a gatewayResultObserved entry (A2)', () => {
    const dir = freshDir();
    const timeout = fixtureRequests.find((r) => r.role === 'upstream-timeout')!;
    const kept = readFileSync(join(dir, 'model-trace.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes(`"${timeout.requestId}"`));
    writeFileSync(join(dir, 'model-trace.jsonl'), kept.join('\n') + '\n', 'utf8');
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/gateway-result-evidence/);
    expectNotFinalized(dir);
    // Degraded keeps the F6 content-aware semantics: the gateway source is
    // dropped because a row is provably missing.
    const degraded = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(degraded.status).toBe('degraded');
    expect(degraded.completeness.sources).toEqual(['ledger', 'client']);
  });

  it('strict refuses a missing envelope sidecar for a gatewayResultObserved entry', () => {
    const dir = freshDir();
    const target = fixtureRequests.find((r) => r.role === 'response')!;
    rmSync(join(dir, 'requests', `${target.requestId}.json`));
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/gateway-result-evidence/);
    expectNotFinalized(dir);
    const degraded = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(degraded.status).toBe('degraded');
    const rows = readFinalRows(dir);
    expect(rows.get(target.requestId)!.requestEnvelopeFile).toBeNull();
    expect(rows.get(target.requestId)!.exactRequestSources).toEqual(['client']);
  });

  it('strict refuses non-monotonic run timestamps (A5)', () => {
    const dir = freshDir();
    const bundle = readJson<{ handoff: { runCompletedAtUtc: string | null } }>(
      join(dir, 'client-bundle.json'),
    );
    bundle.handoff.runCompletedAtUtc = '2026-07-27T11:00:00.000Z'; // after exportedAtUtc
    writeJson(join(dir, 'client-bundle.json'), bundle);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/monotonic-timestamps/);
    expectNotFinalized(dir);
  });

  it('strict refuses null handoff hashes — the ledger-to-run binding is unproven (F11/C3)', () => {
    const dir = freshDir();
    const bundle = readJson<{
      handoff: { worldStateHash: string | null; canonicalLedgerHash: string | null };
    }>(join(dir, 'client-bundle.json'));
    // Both hash comparisons are `!== null`-guarded, so null silently skipped
    // them: a present bundle with null hashes is evidentially identical to an
    // absent handoff and must be recorded the same way, never certified
    // 'completed' in silence (ledgers carry no runId).
    bundle.handoff.worldStateHash = null;
    bundle.handoff.canonicalLedgerHash = null;
    writeJson(join(dir, 'client-bundle.json'), bundle);
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/handoff-ledger-binding/);
    expectNotFinalized(dir);

    const degraded = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(degraded.status).toBe('degraded');
    expect(degraded.failedCriteria.some((c) => c.startsWith('handoff-ledger-binding'))).toBe(true);
    expect(
      degraded.completeness.notes.some((n) =>
        n.includes('ledger-to-run binding is operator-asserted'),
      ),
    ).toBe(true);
  });

  it('refuses to downgrade a completed run to degraded; allows degraded -> completed upgrade', () => {
    const downgradeDir = freshDir();
    expect(finalizeRunDirectory(downgradeDir, RUN_ID).status).toBe('completed');
    rmSync(join(downgradeDir, 'client-bundle.json'));
    expect(() => finalizeRunDirectory(downgradeDir, RUN_ID, { allowDegraded: true })).toThrow(
      /refusing to overwrite a status 'completed'/,
    );
    // The completed manifest survived the refused downgrade.
    expect(readJson<{ status: string }>(join(downgradeDir, 'run-manifest.final.json')).status).toBe(
      'completed',
    );

    const upgradeDir = freshDir();
    rmSync(join(upgradeDir, 'client-bundle.json'));
    expect(finalizeRunDirectory(upgradeDir, RUN_ID, { allowDegraded: true }).status).toBe(
      'degraded',
    );
    copyFileSync(join(templateDir, 'client-bundle.json'), join(upgradeDir, 'client-bundle.json'));
    const upgraded = finalizeRunDirectory(upgradeDir, RUN_ID);
    expect(upgraded.status).toBe('completed');
    expect(upgraded.failedCriteria).toEqual([]);
    expect(
      readJson<{ status: string | null }>(join(upgradeDir, 'bundle-manifest.json')).status,
    ).toBe('completed');
  });
});

describe('superseded resolutions strict-complete (A1)', () => {
  const RUN_ID_2 = 'run-bundle-0002';

  it('a run whose requests were superseded (never answered) is COMPLETE evidence', () => {
    // Never answer anything: outstanding external requests are superseded by
    // the next decision opportunity (or expired at scenario end) — the
    // canonical third resolution the 1.4.0 finalizer could not represent.
    const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
    while (!run.state.terminal) stepTick(run);
    const requests = [...run.externalRequests];
    expect(requests.length).toBeGreaterThan(0);
    const lateLedger = buildLedgerFile(run);
    const supersededIds = new Set(
      lateLedger.events
        .filter((e) => e.type === 'DecisionRequestSuperseded')
        .map((e) => (e.payload as { requestId: string }).requestId),
    );
    expect(supersededIds.size).toBeGreaterThan(0);

    // Client view: every request dispatched and timed out with a cf- id and
    // NO observed gateway result; every failure arrived after its request
    // was already resolved, so the engine dropped it without an event (the
    // moot-failure carve-out, A1).
    const entries: ModelClientTraceEntry[] = requests.map((r) => ({
      runId: RUN_ID_2,
      conditionId: MODEL_CONDITION_ID,
      requestId: r.request.requestId,
      npcId: 'mara',
      scenarioId: 'A',
      providerId: EXTERNAL_MARA_PROVIDER_ID,
      promptVersionExpected: MODEL_PROMPT_VERSION,
      requestedAtTick: r.request.requestedAtTick,
      contextHash: r.contextHash,
      queuedAtUtc: '2026-07-27T10:00:00.000Z',
      dispatchedAtUtc: '2026-07-27T10:00:00.020Z',
      completedAtUtc: '2026-07-27T10:00:20.020Z',
      clientOutcome: 'failure',
      clientFailureCode: 'request-timeout',
      responseId: null,
      failureId: `cf-${r.request.requestId}`,
      clientLatencyMs: 20_000,
      gatewayResultObserved: false,
    }));
    const envelopes = [...requests]
      .sort((a, b) => (a.request.requestId < b.request.requestId ? -1 : 1))
      .map((r) => ({
        schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
        experimentId: MODEL_EXPERIMENT_ID,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
        conditionId: MODEL_CONDITION_ID,
        runId: RUN_ID_2,
        providerId: EXTERNAL_MARA_PROVIDER_ID,
        promptVersion: MODEL_PROMPT_VERSION,
        contextHash: r.contextHash,
        request: r.request,
        context: r.context,
        truncationCounts: r.truncationCounts,
      }));
    const bundle = buildFixtureBundle(RUN_ID_2, lateLedger, entries, envelopes, requests.length, 0);

    const root = mkdtempSync(join(tmpdir(), 'model-bundle-superseded-'));
    const ledgerPath = join(root, `ledger-A-${RUN_ID_2}.json`);
    const bundlePath = join(root, 'client-bundle-export.json');
    writeFileSync(ledgerPath, JSON.stringify(lateLedger), 'utf8');
    writeJson(bundlePath, bundle);
    const { dir } = prepareRunDirectory({
      runId: RUN_ID_2,
      ledgerPath,
      bundlePath,
      destRoot: root,
    });
    // The gateway never produced a terminal result: seed manifest only (G3
    // seeds at first sight), no trace file, no sidecars.
    writeJson(join(dir, 'run-manifest.json'), {
      traceSchemaVersion: 2,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      conditionId: MODEL_CONDITION_ID,
      runId: RUN_ID_2,
      scenarioId: 'A',
      providerPlanId: MODEL_CONDITION_ID,
      externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
      promptVersion: MODEL_PROMPT_VERSION,
      modelId: 'fake-adapter',
      modelSettings: { temperature: 0 },
      startedAtUtc: '2026-07-27T09:59:59.000Z',
    });

    // STRICT completes: a request whose only resolution is superseded is
    // COMPLETE evidence (A1), and gatewayResultObserved=false entries need
    // no gateway evidence (A2).
    const result = finalizeRunDirectory(dir, RUN_ID_2);
    expect(result.status).toBe('completed');
    expect(result.failedCriteria).toEqual([]);
    expect(result.joinedRequests).toBe(requests.length);
    expect(result.completeness.sources).toEqual(['ledger', 'client']);

    const rows = readFileSync(join(dir, 'finalized-trace.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as FinalRow);
    const supersededRows = rows.filter((row) => supersededIds.has(row.requestId));
    expect(supersededRows.length).toBeGreaterThan(0);
    for (const row of supersededRows) {
      // A1: engineOutcome 'superseded' (no late answer ever landed, so no
      // response-level verdict outranks the request resolution).
      expect(row.engineOutcome).toBe('superseded');
      expect(row.strictDisposition).toBe('moot-after-resolution');
      expect(row.exactRequestSources).toEqual(['client']);
      expect(row.requestEnvelopeFile).toBeNull();
      expect(row.envelopeSha256).not.toBeNull();
    }
    const manifest = readJson<{
      status: string;
      requestsWithGatewayResult: number | null;
      requestsDispatchedToGateway: number | null;
    }>(join(dir, 'run-manifest.final.json'));
    expect(manifest.status).toBe('completed');
    expect(manifest.requestsWithGatewayResult).toBe(0);
    expect(manifest.requestsDispatchedToGateway).toBe(requests.length);
  });
});
