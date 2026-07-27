import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DecisionResponse, ExternalDecisionFailure } from '../../src/shared/decisionContracts';
import type { WorkerCommand, WorkerResponse } from '../../src/shared/workerProtocol';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import { handleCommand, WorkerSession } from '../../src/worker/commandProcessor';
import { ModelGatewayClient } from '../../src/app/modelGatewayClient';
import { ViewStore } from '../../src/app/store';
import { buildRunBundle, canExportRunBundle, validateRunBundle } from '../../src/app/runBundle';
import { createGateway, stopWithFallback } from '../../gateway/server';
import { FakeDecisionAdapter } from '../../gateway/adapters/fakeDecisionAdapter';
import { ModelTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import type { GatewayConfig } from '../../gateway/config';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import {
  bundleManifestSchema,
  finalManifestSchema,
  finalizedTraceEntrySchema,
  runManifestSeedSchema,
  type FinalManifest,
  type FinalizedTraceEntry,
  type RunBundle,
} from '../../src/shared/modelArtifacts';
import { EXTERNAL_MARA_PROVIDER_ID, MODEL_CONDITION_ID } from '../../src/shared/modelExperiment';
import { prepareRunDirectory } from './prepareRun';
import { finalizeRunDirectory, type FinalizeResult } from './finalize';

/**
 * Keyless formal model-run rehearsal (1.5.0 R1, brief §10 as amended).
 *
 *   npm run model:rehearse -- [--ci] [--out <dir>]
 *
 * Drives THREE complete rehearsal runs through the REAL infrastructure
 * modules — WorkerSession -> ModelGatewayClient -> real localhost gateway
 * with FakeDecisionAdapter -> real ModelTraceWriter -> real buildRunBundle
 * over a Node ViewStore -> prepareRunDirectory -> STRICT finalizeRunDirectory
 * -> full validateLedgerFile import/replay — never synthetic insertion:
 *
 *   A `normal`       — Scenario A to terminal with per-tick client
 *                      settlement; every request answered and accepted;
 *                      strict assertions per brief §10.3.
 *   B `gateway-stop` — the gateway is stopped (graceful stop + connection
 *                      teardown fallback) only AFTER >=1 engine-accepted
 *                      response AND with the client fully settled (A9: a
 *                      mid-flight stop measurably lingers ~3.7s and can
 *                      deliver one more response — nondeterministic); the
 *                      run then drives to terminal on typed
 *                      gateway-unavailable failures. Strict assertions per
 *                      brief §10.4 under the A2 predicate: post-stop
 *                      requests need an archived exact envelope and NO
 *                      gateway evidence (gatewayResultObserved=false), and
 *                      the run still finalizes status 'completed'.
 *   C `latency` (A9) — FakeDecisionAdapter with delayMs plus long unsettled
 *                      drive chunks, so answers land >60 logical ticks after
 *                      emission and the run exercises the SUPERSEDE regime:
 *                      >=1 superseded resolution, late answers rejected as
 *                      'superseded-request', tail answers dropped
 *                      post-terminal so their rows join with engineOutcome
 *                      'superseded' (A1) — and strict finalize still writes
 *                      status 'completed'.
 *
 * Layout (finalize hard-requires basename(dir) === runId):
 *   <out>/report.json + report.md
 *   <out>/normal/<runId>/ ...        (traceDir = <out>/normal)
 *   <out>/gateway-stop/<runId>/ ...  (traceDir = <out>/gateway-stop)
 *   <out>/latency/<runId>/ ...       (traceDir = <out>/latency)
 * Run ids are fixed, hyphen-only (envelope schema ^[a-zA-Z0-9-]{8,64}$);
 * --ci switches to 'rehearsal-ci-*' ids, defaults the output root to
 * artifacts/model-rehearsal, and clears it at start.
 *
 * Frozen invariants honored here: NO key ever leaves the gateway process
 * because no key exists — this script NEVER calls loadGatewayConfig (the
 * only reader of .env.gateway / OPENAI_API_KEY); it builds a GatewayConfig
 * literal with openaiApiKey: null and the fake adapter, on an ephemeral
 * loopback port, closed in `finally` on success and failure alike.
 *
 * Timestamps in the report come from their four REAL producers, never
 * minted by this harness after the fact: startedAtUtc from the
 * gateway-seeded run-manifest.json (first-validated-envelope time, excluded
 * from the A5 ordering), runCompletedAtUtc stamped at the worker's
 * run-complete receipt (exactly where src/app/workerClient.ts stamps it),
 * exportedAtUtc at buildRunBundle time, finalizedAtUtc from
 * run-manifest.final.json.
 *
 * Exit is nonzero on ANY failed assertion; report.json/report.md are still
 * written where practicable so CI can upload evidence of the failure.
 */

const SCENARIO_ID = 'A' as const;
/** Pinned per-run call budget on BOTH the client and the gateway (R1): the
 * default 80 is too thin — a gateway-stop run alone emits ~75 requests. */
const PINNED_MAX_CALLS_PER_RUN = 200;
/** Scenario A ends at tick 2700; every drive loop is budgeted past it. */
const TICK_BUDGET = 3_000;
/** Latency case (A9): chunk length for the unsettled drive. 150 ticks — NOT
 * 100 — because with the engine's 60-tick re-evaluation cadence a 100-tick
 * chunk phase-locks (accept drains at the chunk start, the next emission
 * lands 60 ticks in, and its answer is only ~40 ticks late — every request
 * accepted, zero supersedes). At 150 the steady state emits twice per chunk
 * and the first emission is always superseded in-chunk. */
const LATENCY_CHUNK_TICKS = 150;
/** Latency case: settle between chunks for the first 2400 ticks, then drive
 * the tail to terminal WITHOUT settling so the last emissions are answered
 * only after the run is over — those gateway responses are dropped at the
 * worker gate ('run-already-complete') and the requests' ONLY resolution is
 * the supersede/scenario-end record (A1: engineOutcome 'superseded'). */
const LATENCY_SETTLED_TICKS = 2_400;
const LATENCY_ADAPTER_DELAY_MS = 25;

export type RehearsalCaseName = 'normal' | 'gateway-stop' | 'latency';

const CASE_NAMES: readonly RehearsalCaseName[] = ['normal', 'gateway-stop', 'latency'];

/** Test-only instrumentation (R4). The CLI never passes hooks. */
export interface RehearsalHooks {
  /** Called with each case's live ephemeral gateway port, so tests can
   * prove every server is closed after success AND failure. */
  onGatewayStarted?: (caseName: RehearsalCaseName, port: number) => void;
  /** Called after prepareRunDirectory, before strict finalization — the
   * R4 induced-evidence-gap insertion point. */
  beforeFinalize?: (caseName: RehearsalCaseName, runDir: string) => void;
}

/** Per-run report entry (brief §10.5 field list, A4 naming). */
export interface RehearsalRunReport {
  caseName: RehearsalCaseName;
  runId: string;
  scenarioId: string;
  conditionId: string;
  providerId: string;
  promptVersion: string;
  fakeAdapterId: string;
  gatewayPort: number;
  /** Gateway first-sight time from the seed manifest (producer 1 of 4). */
  startedAtUtc: string;
  /** Stamped at run-complete receipt, read back from the bundle handoff
   * (producer 2 of 4; A4 name — never `completedAtUtc`). */
  runCompletedAtUtc: string;
  /** Stamped at buildRunBundle time, read back from the handoff (3 of 4). */
  exportedAtUtc: string;
  /** From run-manifest.final.json (producer 4 of 4). */
  finalizedAtUtc: string;
  externalRequestsEmitted: number;
  clientTraceRows: number;
  clientExactEnvelopes: number;
  requestsDispatched: number | null;
  requestsWithGatewayResult: number | null;
  upstreamCallsAttempted: number;
  acceptedResponses: number;
  engineRejectionsByReason: Record<string, number>;
  externalFailuresByCode: Record<string, number>;
  supersededRequests: number;
  worldStateHash: string;
  canonicalLedgerHash: string;
  replayMatch: boolean;
  finalManifestStatus: 'completed' | 'degraded';
  failedCriteria: string[];
  completenessSources: string[];
  completenessNotes: string[];
  bundleAggregateSha256: string;
  onlyMara: boolean;
}

export interface RehearsalReport {
  ok: boolean;
  packageVersion: string;
  repositoryCommit: string | null;
  normalRun: RehearsalRunReport | null;
  gatewayStopRun: RehearsalRunReport | null;
  latencyRun: RehearsalRunReport | null;
  failures: string[];
}

export interface RehearseOptions {
  /** Output root; the CLI defaults to artifacts/model-rehearsal. */
  outDir: string;
  /** CI mode: 'rehearsal-ci-*' run ids and a fully cleared output root. */
  ci?: boolean;
  /** Test-only instrumentation (R4). */
  hooks?: RehearsalHooks;
}

export class RehearsalAssertionError extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RehearsalAssertionError(message);
}

/** Keyless gateway config LITERAL (frozen invariant: loadGatewayConfig is
 * never called — it is the one function that reads .env.gateway and
 * OPENAI_API_KEY). Ephemeral loopback port; per-run budget pinned (R1). */
function rehearsalGatewayConfig(traceDir: string): GatewayConfig {
  return {
    adapterKind: 'fake',
    port: 0,
    requestTimeoutMs: 10_000,
    maxConcurrency: 1,
    maxCallsPerRun: PINNED_MAX_CALLS_PER_RUN,
    traceDir,
    allowedBrowserOrigin: 'http://localhost:5173',
    openaiApiKey: null,
    openaiModel: null,
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    maxTotalCalls: 400,
  };
}

let commandSeq = 0;

interface Harness {
  session: WorkerSession;
  store: ViewStore;
  client: ModelGatewayClient;
  /** External requestIds in worker-emission order, as routed to the client. */
  routedRequestIds: string[];
  /** Issues one worker command and routes every response (decision-request
   * -> client, events -> store, run-complete -> completion stamp). */
  command(type: WorkerCommand['type'], extra?: Record<string, unknown>): WorkerResponse[];
  /** Synchronous drive with NO settling: the event loop never turns, so no
   * POST progresses and requests pile up client-side (latency case). */
  stepTicks(ticks: number): void;
  /** Browser-loop equivalent (per-tick settlement), stopping at terminal,
   * the tick budget, or the optional predicate. */
  driveSettled(maxTicks: number, until?: () => boolean): Promise<void>;
}

function createHarness(baseUrl: string, runId: string): Harness {
  const session = new WorkerSession();
  const store = new ViewStore();
  const routedRequestIds: string[] = [];
  store.update((s) => {
    s.selectedScenarioId = SCENARIO_ID;
    s.selectedConditionId = MODEL_CONDITION_ID;
  });

  const route = (messages: WorkerResponse[]): void => {
    for (const message of messages) {
      if (message.type === 'decision-request') {
        routedRequestIds.push(message.request.request.requestId);
        client.handleDecisionRequest(message.request);
      } else if (message.type === 'events') {
        store.appendEvents(message.events, message.totalCount);
      } else if (message.type === 'run-complete') {
        // runCompletedAtUtc producer (A4): the run-complete RECEIPT, stamped
        // exactly where src/app/workerClient.ts stamps it in the browser.
        store.update((s) => {
          s.runStatus = 'complete';
          s.finalWorldHash = message.worldStateHash;
          s.finalLedgerHash = message.canonicalLedgerHash;
          s.runCompletedAtUtc = new Date().toISOString();
        });
      }
    }
  };

  const command = (
    type: WorkerCommand['type'],
    extra: Record<string, unknown> = {},
  ): WorkerResponse[] => {
    commandSeq += 1;
    const messages = handleCommand(session, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: `cmd-rehearse-${commandSeq}`,
      commandSeq,
      type,
      ...extra,
    } as WorkerCommand);
    route(messages);
    return messages;
  };

  const client = new ModelGatewayClient({
    baseUrl,
    maxCallsPerRun: PINNED_MAX_CALLS_PER_RUN,
    makeRunId: () => runId,
    submitResponse: (response: DecisionResponse) => {
      command('submit-decision-response', { response });
    },
    submitFailure: (failure: ExternalDecisionFailure) => {
      command('submit-decision-failure', { failure });
    },
    onStatus: (status) => {
      store.update((s) => {
        s.model.gateway = status;
      });
    },
  });

  return {
    session,
    store,
    client,
    routedRequestIds,
    command,
    stepTicks: (ticks) => {
      for (let i = 0; i < ticks && !session.host.terminal; i += 1) {
        command('step', { ticks: 1 });
      }
    },
    driveSettled: async (maxTicks, until) => {
      for (let i = 0; i < maxTicks && !session.host.terminal; i += 1) {
        command('step', { ticks: 1 });
        await client.settle();
        if (until?.()) return;
      }
    },
  };
}

/** External-request lifecycle scraped from the VALIDATED ledger: requested
 * ids -> npcId, per-request canonical resolution count (A1: accepted |
 * expired | superseded), and the superseded subset. */
interface ExternalLifecycleIndex {
  requested: Map<string, string>;
  resolutionsByRequest: Map<string, number>;
  supersededRequestIds: Set<string>;
}

function indexExternalLifecycle(ledger: LedgerFile, providerId: string): ExternalLifecycleIndex {
  const requested = new Map<string, string>();
  const resolutionsByRequest = new Map<string, number>();
  const supersededRequestIds = new Set<string>();
  const bump = (requestId: string): void => {
    if (!requested.has(requestId)) return;
    resolutionsByRequest.set(requestId, (resolutionsByRequest.get(requestId) ?? 0) + 1);
  };
  for (const event of ledger.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'DecisionRequested') {
      if (payload.providerId === providerId) {
        requested.set(String(payload.requestId), String(payload.npcId));
      }
    } else if (event.type === 'DecisionResponseAccepted') {
      bump(String(payload.requestId));
    } else if (event.type === 'DecisionRequestExpired') {
      bump(String(payload.requestId));
    } else if (event.type === 'DecisionRequestSuperseded') {
      const requestId = String(payload.requestId);
      if (requested.has(requestId)) supersededRequestIds.add(requestId);
      bump(requestId);
    }
  }
  return { requested, resolutionsByRequest, supersededRequestIds };
}

interface PipelineOutcome {
  report: RehearsalRunReport;
  bundle: RunBundle;
  finalize: FinalizeResult;
  finalManifest: FinalManifest;
  finalizedRows: FinalizedTraceEntry[];
  gatewayTraceRows: number;
  sidecarCount: number;
  externalRequestsEmitted: number;
  currentRunTraceRows: number;
  envelopeRequestIds: Set<string>;
  supersededRequestIds: Set<string>;
}

/** The shared terminal pipeline: settle -> snapshot -> real buildRunBundle
 * (+ producer validation) -> real ledger export -> full validateLedgerFile
 * import/replay -> prepareRunDirectory -> STRICT finalizeRunDirectory ->
 * artifact read-back + case-agnostic assertions. */
async function exportAndFinalize(args: {
  caseName: RehearsalCaseName;
  caseDir: string;
  runId: string;
  harness: Harness;
  port: number;
  adapterId: string;
  hooks?: RehearsalHooks;
}): Promise<PipelineOutcome> {
  const { caseName, caseDir, runId, harness, port, adapterId, hooks } = args;

  check(harness.session.host.terminal, 'run did not reach terminal state');

  // F1 settle-then-snapshot, preserved from the 1.4.0 review fixes: drain
  // queued/in-flight client work, only then snapshot the trace surfaces.
  await harness.client.settle();
  const state = harness.store.state;
  check(state.model.gateway?.busy === false, 'gateway client still busy after settle');
  check(canExportRunBundle(state), 'export gate refused a terminal, settled run');

  const clientTrace = harness.client.clientTraceEntries();
  const envelopes = harness.client.exactRequestEnvelopes();
  // exportedAtUtc producer: bundle-build time (the panel's click handler
  // equivalent) — passed INTO the real producer, never backfilled.
  const exportedAtUtc = new Date().toISOString();
  const bundle = buildRunBundle(
    state,
    clientTrace,
    harness.client.currentRunId,
    exportedAtUtc,
    envelopes,
    harness.client.archiveDiagnostics(),
  );
  const bundleProblems = validateRunBundle(bundle);
  check(
    bundleProblems.length === 0,
    `producer-side bundle validation failed: ${bundleProblems[0] ?? 'unknown'}`,
  );
  check(bundle.handoff.runCompletedAtUtc !== null, 'handoff runCompletedAtUtc is null');

  // Canonical ledger from the real builder, via the worker command surface.
  const exported = harness.command('export-ledger').find((r) => r.type === 'ledger-export');
  check(exported !== undefined && exported.type === 'ledger-export', 'no ledger-export response');

  // Import/replay through the COMPLETE validator (exact payload schemas,
  // lifecycle joins, isolated reducer replay, recomputed hashes, rebuilt
  // final summary) — brief §10.3 step 11, amended to validateLedgerFile.
  const validation = validateLedgerFile(exported.json);
  const firstError = validation.issues.find((i) => i.severity === 'error');
  check(
    validation.ok && validation.file !== null,
    `full ledger validation failed: ${firstError?.code ?? 'unknown'}`,
  );
  const ledger = validation.file;
  const replayMatch =
    bundle.handoff.worldStateHash === ledger.worldStateHash &&
    bundle.handoff.canonicalLedgerHash === ledger.canonicalLedgerHash;
  check(replayMatch, 'replayed ledger hashes do not match the run-complete handoff hashes');

  mkdirSync(caseDir, { recursive: true });
  const ledgerPath = join(caseDir, exported.fileName);
  writeFileSync(ledgerPath, exported.json, 'utf8');
  const bundlePath = join(caseDir, 'client-bundle-export.json');
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

  // Same staging logic as `model:prepare-run`, into the gateway's own run
  // directory (<caseDir>/<runId> — basename(dir) === runId for finalize).
  const { dir: runDir } = prepareRunDirectory({ runId, ledgerPath, bundlePath, destRoot: caseDir });
  hooks?.beforeFinalize?.(caseName, runDir);

  // STRICT finalization — no --allow-degraded anywhere in the rehearsal.
  const finalize = finalizeRunDirectory(runDir, runId);

  const seed = runManifestSeedSchema.parse(
    JSON.parse(readFileSync(join(runDir, 'run-manifest.json'), 'utf8')),
  );
  const finalManifest = finalManifestSchema.parse(
    JSON.parse(readFileSync(join(runDir, 'run-manifest.final.json'), 'utf8')),
  );
  const bundleManifest = bundleManifestSchema.parse(
    JSON.parse(readFileSync(join(runDir, 'bundle-manifest.json'), 'utf8')),
  );
  check(bundleManifest.producer === 'model:finalize', 'bundle manifest producer is not finalize');
  check(/^[0-9a-f]{64}$/.test(bundleManifest.aggregateSha256), 'bundle aggregate hash missing');
  const finalizedRows = readFileSync(join(runDir, 'finalized-trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => finalizedTraceEntrySchema.parse(JSON.parse(line)));
  const tracePath = join(runDir, 'model-trace.jsonl');
  const gatewayTraceRows = existsSync(tracePath)
    ? readFileSync(tracePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '').length
    : 0;
  const requestsDir = join(runDir, 'requests');
  const sidecarCount = existsSync(requestsDir)
    ? readdirSync(requestsDir).filter((f) => f.endsWith('.json')).length
    : 0;

  const lifecycle = indexExternalLifecycle(ledger, seed.externalProviderId);
  check(lifecycle.requested.size > 0, 'no external requests were emitted');
  check(seed.externalProviderId === EXTERNAL_MARA_PROVIDER_ID, 'seed provider is not pinned');

  // Every engine request has exactly ONE canonical resolution (A1:
  // accepted | expired | superseded — brief §10.3/§10.4 both require it).
  for (const requestId of lifecycle.requested.keys()) {
    check(
      (lifecycle.resolutionsByRequest.get(requestId) ?? 0) === 1,
      `request ${requestId} does not have exactly one engine resolution`,
    );
  }

  // Only Mara ever produced external traffic — checked across the ledger,
  // the finalized join, and the client trace.
  const onlyMara =
    [...lifecycle.requested.values()].every((npcId) => npcId === 'mara') &&
    finalizedRows.every((row) => row.npcId === 'mara') &&
    clientTrace.every((entry) => entry.npcId === 'mara');
  check(onlyMara, 'a non-Mara identity appeared in the external-request evidence');

  const currentRunTrace = clientTrace.filter((entry) => entry.runId === runId);
  const envelopeRequestIds = new Set(envelopes.map((envelope) => envelope.request.requestId));

  const report: RehearsalRunReport = {
    caseName,
    runId,
    scenarioId: seed.scenarioId,
    conditionId: seed.conditionId,
    providerId: seed.externalProviderId,
    promptVersion: seed.promptVersion,
    fakeAdapterId: adapterId,
    gatewayPort: port,
    startedAtUtc: seed.startedAtUtc,
    runCompletedAtUtc: bundle.handoff.runCompletedAtUtc,
    exportedAtUtc,
    finalizedAtUtc: finalManifest.finalizedAtUtc,
    externalRequestsEmitted: finalManifest.externalRequestsEmitted,
    clientTraceRows: currentRunTrace.length,
    clientExactEnvelopes: envelopeRequestIds.size,
    requestsDispatched: finalManifest.requestsDispatchedToGateway,
    requestsWithGatewayResult: finalManifest.requestsWithGatewayResult,
    upstreamCallsAttempted: finalManifest.upstreamCallsAttempted,
    acceptedResponses: finalManifest.acceptedModelResponses,
    engineRejectionsByReason: finalManifest.engineRejectionsByReason,
    externalFailuresByCode: bundle.handoff.failuresByCode,
    supersededRequests: lifecycle.supersededRequestIds.size,
    worldStateHash: finalManifest.worldStateHash,
    canonicalLedgerHash: finalManifest.canonicalLedgerHash,
    replayMatch,
    finalManifestStatus: finalManifest.status,
    failedCriteria: finalManifest.failedCriteria,
    completenessSources: finalManifest.completeness.sources,
    completenessNotes: finalManifest.completeness.notes,
    bundleAggregateSha256: bundleManifest.aggregateSha256,
    onlyMara,
  };

  return {
    report,
    bundle,
    finalize,
    finalManifest,
    finalizedRows,
    gatewayTraceRows,
    sidecarCount,
    externalRequestsEmitted: finalManifest.externalRequestsEmitted,
    currentRunTraceRows: currentRunTrace.length,
    envelopeRequestIds,
    supersededRequestIds: lifecycle.supersededRequestIds,
  };
}

/** Rehearsal A — normal fake gateway (brief §10.3). */
export async function rehearseNormalCase(
  outDir: string,
  runId: string,
  hooks?: RehearsalHooks,
): Promise<RehearsalRunReport> {
  const caseName: RehearsalCaseName = 'normal';
  const caseDir = join(outDir, caseName);
  const adapter = new FakeDecisionAdapter();
  const gateway = createGateway(
    rehearsalGatewayConfig(caseDir),
    adapter,
    new ModelTraceWriter(caseDir),
  );
  try {
    const port = await gateway.start();
    hooks?.onGatewayStarted?.(caseName, port);
    const harness = createHarness(`http://127.0.0.1:${port}`, runId);
    harness.command('load-scenario', { scenarioId: SCENARIO_ID, conditionId: MODEL_CONDITION_ID });
    harness.client.newRun();
    check((await harness.client.connect()) === 'ok', 'gateway connect did not return ok');
    await harness.driveSettled(TICK_BUDGET);

    const a = await exportAndFinalize({
      caseName,
      caseDir,
      runId,
      harness,
      port,
      adapterId: adapter.id,
      hooks,
    });

    // Brief §10.3 strict assertions.
    check(a.finalManifest.status === 'completed', 'final manifest status is not completed');
    check(a.finalize.failedCriteria.length === 0, 'strict criteria failed on the normal run');
    check(
      JSON.stringify(a.finalManifest.completeness.sources) ===
        JSON.stringify(['gateway', 'ledger', 'client']),
      `completeness sources are ${a.finalManifest.completeness.sources.join('+')}`,
    );
    check(a.finalManifest.completeness.notes.length === 0, 'completeness notes are not empty');
    const n = a.externalRequestsEmitted;
    check(a.currentRunTraceRows === n, 'client trace rows != engine-emitted requests');
    check(a.envelopeRequestIds.size === n, 'archived exact envelopes != engine-emitted requests');
    check(a.gatewayTraceRows === n, 'gateway trace rows != engine-emitted requests');
    check(a.sidecarCount === n, 'gateway envelope sidecars != engine-emitted requests');
    check(a.finalizedRows.length === n, 'finalized rows != engine-emitted requests');
    check(a.finalManifest.requestsWithGatewayResult === n, 'not every request observed a result');
    check(a.finalManifest.acceptedModelResponses === n, 'not every model response was accepted');
    check(
      a.finalizedRows.every((row) => row.engineOutcome === 'accepted'),
      'a normal-run row is not engineOutcome accepted',
    );
    return a.report;
  } finally {
    await stopWithFallback(gateway).catch(() => undefined);
  }
}

/** Rehearsal B — gateway stopped mid-run (brief §10.4, A2/A9 semantics). */
export async function rehearseGatewayStopCase(
  outDir: string,
  runId: string,
  hooks?: RehearsalHooks,
): Promise<RehearsalRunReport> {
  const caseName: RehearsalCaseName = 'gateway-stop';
  const caseDir = join(outDir, caseName);
  const adapter = new FakeDecisionAdapter();
  const gateway = createGateway(
    rehearsalGatewayConfig(caseDir),
    adapter,
    new ModelTraceWriter(caseDir),
  );
  try {
    const port = await gateway.start();
    hooks?.onGatewayStarted?.(caseName, port);
    const harness = createHarness(`http://127.0.0.1:${port}`, runId);
    harness.command('load-scenario', { scenarioId: SCENARIO_ID, conditionId: MODEL_CONDITION_ID });
    harness.client.newRun();
    check((await harness.client.connect()) === 'ok', 'gateway connect did not return ok');

    // Drive until the ENGINE has accepted >=1 gateway response.
    await harness.driveSettled(600, () => harness.store.state.model.acceptedModelResponses >= 1);
    const preStopAccepted = harness.store.state.model.acceptedModelResponses;
    check(preStopAccepted >= 1, 'no engine-accepted model response before the stop');

    // A9: stop ONLY with the client settled — a mid-flight stop measurably
    // blocks ~3.7s and can deliver one more response (nondeterministic).
    await harness.client.settle();
    const preStopRequestIds = new Set(harness.routedRequestIds);
    await stopWithFallback(gateway);

    // Drive on to terminal: post-stop requests fail typed, time never stops.
    await harness.driveSettled(TICK_BUDGET);

    const a = await exportAndFinalize({
      caseName,
      caseDir,
      runId,
      harness,
      port,
      adapterId: adapter.id,
      hooks,
    });

    // Brief §10.4 strict assertions under the A2 predicate.
    const postStopIds = harness.routedRequestIds.filter((id) => !preStopRequestIds.has(id));
    check(postStopIds.length > 0, 'no post-stop external requests were emitted');
    check(
      (a.bundle.handoff.failuresByCode['gateway-unavailable'] ?? 0) >= 1,
      'no typed gateway-unavailable failure after the stop',
    );
    const entriesById = new Map(
      a.bundle.clientTrace.filter((e) => e.runId === runId).map((e) => [e.requestId, e]),
    );
    const rowsById = new Map(a.finalizedRows.map((row) => [row.requestId, row]));
    for (const id of postStopIds) {
      // The root-defect fix: every post-stop request left exact bytes in
      // the client archive even though the gateway never saw it.
      check(a.envelopeRequestIds.has(id), `post-stop request ${id} has no archived envelope`);
      const entry = entriesById.get(id);
      check(entry !== undefined, `post-stop request ${id} has no client trace entry`);
      check(
        entry.clientOutcome === 'failure' && entry.clientFailureCode === 'gateway-unavailable',
        `post-stop request ${id} is not a typed gateway-unavailable failure`,
      );
      check(
        entry.gatewayResultObserved === false,
        `post-stop request ${id} claims a gateway-produced result`,
      );
      const row = rowsById.get(id);
      check(row !== undefined, `post-stop request ${id} has no finalized row`);
      check(
        row.strictDisposition === 'never-dispatched',
        `post-stop request ${id} classified ${String(row.strictDisposition)}, not never-dispatched`,
      );
    }
    // A2: gateway evidence exists exactly for the observed results — no
    // gateway row or sidecar is required for gatewayResultObserved=false.
    check(
      a.gatewayTraceRows === a.finalManifest.requestsWithGatewayResult,
      'gateway trace rows != requests with an observed gateway result',
    );
    check(
      a.sidecarCount === a.finalManifest.requestsWithGatewayResult,
      'gateway sidecars != requests with an observed gateway result',
    );
    check(a.sidecarCount < a.externalRequestsEmitted, 'stop produced no sidecar-less requests');
    check(a.finalManifest.status === 'completed', 'gateway-stop run did not strict-complete');
    check(a.finalize.failedCriteria.length === 0, 'strict criteria failed on the gateway-stop run');
    return a.report;
  } finally {
    await stopWithFallback(gateway).catch(() => undefined);
  }
}

/** Rehearsal C — latency / supersede regime (A9). */
export async function rehearseLatencyCase(
  outDir: string,
  runId: string,
  hooks?: RehearsalHooks,
): Promise<RehearsalRunReport> {
  const caseName: RehearsalCaseName = 'latency';
  const caseDir = join(outDir, caseName);
  const adapter = new FakeDecisionAdapter({ delayMs: LATENCY_ADAPTER_DELAY_MS });
  const gateway = createGateway(
    rehearsalGatewayConfig(caseDir),
    adapter,
    new ModelTraceWriter(caseDir),
  );
  try {
    const port = await gateway.start();
    hooks?.onGatewayStarted?.(caseName, port);
    const harness = createHarness(`http://127.0.0.1:${port}`, runId);
    harness.command('load-scenario', { scenarioId: SCENARIO_ID, conditionId: MODEL_CONDITION_ID });
    harness.client.newRun();
    check((await harness.client.connect()) === 'ok', 'gateway connect did not return ok');

    // Supersede regime: long unsettled chunks, settling only at chunk
    // boundaries, so answers land >60 logical ticks after emission.
    let driven = 0;
    while (!harness.session.host.terminal && driven < LATENCY_SETTLED_TICKS) {
      harness.stepTicks(LATENCY_CHUNK_TICKS);
      driven += LATENCY_CHUNK_TICKS;
      await harness.client.settle();
    }
    // Tail: to terminal with NO settling — the last emissions are answered
    // only post-terminal (dropped at the worker gate), so their sole engine
    // resolution is the supersede/scenario-end record.
    let guard = 0;
    while (!harness.session.host.terminal && guard < 10) {
      harness.stepTicks(LATENCY_CHUNK_TICKS);
      guard += 1;
    }
    check(harness.session.host.terminal, 'latency run did not reach terminal');

    const a = await exportAndFinalize({
      caseName,
      caseDir,
      runId,
      harness,
      port,
      adapterId: adapter.id,
      hooks,
    });

    // A9/A1 assertions: the supersede regime actually happened, is COMPLETE
    // evidence, and strict finalization accepts it.
    check(a.supersededRequestIds.size >= 1, 'no superseded resolution was recorded');
    const supersededRows = a.finalizedRows.filter((row) => row.engineOutcome === 'superseded');
    check(supersededRows.length >= 1, 'no finalized row carries engineOutcome superseded');
    for (const row of supersededRows) {
      check(
        a.supersededRequestIds.has(row.requestId),
        `row ${row.requestId} joined superseded without a ledger supersede record`,
      );
    }
    check(a.finalManifest.status === 'completed', 'latency run did not strict-complete');
    check(a.finalize.failedCriteria.length === 0, 'strict criteria failed on the latency run');
    return a.report;
  } finally {
    await stopWithFallback(gateway).catch(() => undefined);
  }
}

function readPackageVersion(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readRepositoryCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function renderMarkdown(report: RehearsalReport): string {
  const lines: string[] = [];
  lines.push('# Keyless model rehearsal report');
  lines.push('');
  lines.push(`- ok: ${report.ok}`);
  lines.push(`- packageVersion: ${report.packageVersion}`);
  lines.push(`- repositoryCommit: ${report.repositoryCommit ?? 'unavailable'}`);
  lines.push('');
  const sections: [string, RehearsalRunReport | null][] = [
    ['Rehearsal A — normal', report.normalRun],
    ['Rehearsal B — gateway-stop', report.gatewayStopRun],
    ['Rehearsal C — latency (supersede regime)', report.latencyRun],
  ];
  for (const [title, run] of sections) {
    lines.push(`## ${title}`);
    lines.push('');
    if (run === null) {
      lines.push('FAILED — see the failures section.');
      lines.push('');
      continue;
    }
    lines.push('| field | value |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(run)) {
      const rendered =
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      lines.push(`| ${key} | ${rendered} |`);
    }
    lines.push('');
  }
  lines.push('## Failures');
  lines.push('');
  if (report.failures.length === 0) {
    lines.push('- none');
  } else {
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Runs all three rehearsal cases, writes report.json/report.md (even on
 * failure, where practicable), and returns the report. The CLI maps
 * `ok: false` to a nonzero exit. */
export async function runRehearsal(options: RehearseOptions): Promise<RehearsalReport> {
  const outDir = resolve(options.outDir);
  const ci = options.ci ?? false;
  if (ci) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // Idempotence outside CI mode too: clear exactly what this run writes.
  for (const name of CASE_NAMES) rmSync(join(outDir, name), { recursive: true, force: true });
  rmSync(join(outDir, 'report.json'), { force: true });
  rmSync(join(outDir, 'report.md'), { force: true });

  const prefix = ci ? 'rehearsal-ci' : 'rehearsal';
  const failures: string[] = [];
  const runCase = async (
    caseName: RehearsalCaseName,
    run: (outDir: string, runId: string, hooks?: RehearsalHooks) => Promise<RehearsalRunReport>,
  ): Promise<RehearsalRunReport | null> => {
    try {
      return await run(outDir, `${prefix}-${caseName}-0001`, options.hooks);
    } catch (error) {
      failures.push(`${caseName}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const normalRun = await runCase('normal', rehearseNormalCase);
  const gatewayStopRun = await runCase('gateway-stop', rehearseGatewayStopCase);
  const latencyRun = await runCase('latency', rehearseLatencyCase);

  const report: RehearsalReport = {
    ok:
      failures.length === 0 && normalRun !== null && gatewayStopRun !== null && latencyRun !== null,
    packageVersion: readPackageVersion(),
    repositoryCommit: readRepositoryCommit(),
    normalRun,
    gatewayStopRun,
    latencyRun,
    failures,
  };
  try {
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(join(outDir, 'report.md'), renderMarkdown(report), 'utf8');
  } catch (error) {
    console.error(
      `model-rehearse: failed to write reports into ${outDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return report;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('rehearse.ts') ?? false;
if (invokedDirectly) {
  const ci = process.argv.includes('--ci');
  const outDir = resolve(process.cwd(), arg('--out') ?? 'artifacts/model-rehearsal');
  void runRehearsal({ outDir, ci })
    .then((report) => {
      const status = (run: RehearsalRunReport | null): string =>
        run === null
          ? 'FAILED'
          : `${run.finalManifestStatus} (${run.externalRequestsEmitted} requests, ${run.supersededRequests} superseded, replayMatch=${run.replayMatch})`;
      console.log(
        `model-rehearse: normal=${status(report.normalRun)}; gateway-stop=${status(report.gatewayStopRun)}; latency=${status(report.latencyRun)}; reports in ${outDir}`,
      );
      if (!report.ok) {
        for (const failure of report.failures) {
          console.error(`model-rehearse: FAILED — ${failure}`);
        }
        process.exit(1);
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
