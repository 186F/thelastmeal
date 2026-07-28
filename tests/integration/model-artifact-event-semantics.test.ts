import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeRunDirectory } from '../../scripts/model/finalize';
import { prepareRunDirectory } from '../../scripts/model/prepareRun';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { evaluateConstraints } from '../../src/sim/decisions/constraints';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { replayLedger } from '../../src/sim/replay/replay';
import { canonicalLedgerHash } from '../../src/sim/replay/ledgerHash';
import { buildFinalSummary } from '../../src/sim/reporting';
import { EXTERNAL_REQUEST_SCHEMA_VERSION } from '../../src/sim/decisions/externalSchemas';
import type { PendingDecisionState } from '../../src/sim/domain/state';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { EventEnvelope } from '../../src/shared/events';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import type { SimEvent } from '../../src/sim/events/types';
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
 * Lifecycle event-ID semantics for finalized-trace v3 (1.6.1, spec E7 T-B).
 *
 * One REAL model-condition engine run produces every lifecycle shape the v3
 * field contract distinguishes — accepted, rejected-then-expired (cadence
 * suppressed, ground truth 11), late-after-supersession, provider failure,
 * expiry/supersession with no submission, rejected-then-resolved-by-another-
 * response (E2), and the duplicate-responseId reality (E6) — then ONE full
 * four-source strict finalization (ledger + gateway trace + sidecars + client
 * bundle) is interrogated per case. Assertions key on event TYPES and IDs
 * from the validated ledger; reason strings are secondary evidence only
 * (resolvedRequests is non-canonical, prunes at 512, degrades to
 * 'unknown-request'). Tick discipline follows ground truth 2: a submission
 * and its verdict share a tick (same drain — never assert an inequality);
 * rejection-vs-expiry ordering is proven by SEQ; the ONLY strict tick
 * inequality anywhere is the late case's resolution.tick < submission.tick.
 *
 * A second, deliberately TAMPERED ledger (E8: the terminal scenario-ended
 * expiry deleted, then renumbered/remapped/resealed so it still passes FULL
 * validation) pins the degraded-unresolved row: strict finalization refuses
 * on 'engine-resolution', --allow-degraded preserves the row with a null
 * resolution and names BOTH failed criteria. No live key, no network —
 * everything runs against tmpdirs.
 */

const RUN_ID = 'run-evtsem-0001';
const DEGRADED_RUN_ID = 'run-evtsem-0002';
const RUN_COMPLETED_AT = '2026-07-28T10:30:00.000Z';
const EXPORTED_AT = '2026-07-28T10:45:00.000Z';
/** An affordance id no request ever offers: rejected 'unoffered-affordance',
 * which VERDICTS the response while leaving the request pending — the only
 * rejection reason that lets a later resolution be observed for the same
 * request. */
const UNOFFERED_AFFORDANCE = 'aff:mara:none:unoffered';

type Role =
  /** Case 2: gateway answered, engine rejected, request then EXPIRES (the
   * re-decision cadence is suppressed so TTL beats supersession). */
  | 'rejected-expired'
  /** Case 1: gateway answered, engine accepted. */
  | 'accepted'
  /** Case 3: request superseded FIRST, the gateway's answer submitted late. */
  | 'late-superseded'
  /** Case 4: gateway failure body entered the engine; external-failure expiry. */
  | 'provider-failure'
  /** E6: ONE responseId delivered twice — two Received + two Rejected cycles. */
  | 'duplicate-response'
  /** Case 7 (E2): gw response rejected; a distinct-responseId retry, injected
   * straight into the engine inbox (not producible by gateway/worker),
   * resolves the request by acceptance. */
  | 'retry-accepted'
  /** Cases 5/6: nothing ever entered the engine — resolved by supersession on
   * the natural cadence, or by expiry (the last request, at scenario end). */
  | 'silent';

interface FixtureRequest {
  requestId: string;
  role: Role;
  requestedAtTick: number;
  contextHash: string;
  /** What the fabricated gateway row records as the model's selection (null
   * for failures and for requests the gateway never answered). */
  submittedAffordanceId: string | null;
  external: ExternalDecisionRequest;
}

type TraceEntryV2 = ModelTraceEntry & {
  responseId: string | null;
  failureId: string | null;
  offeredAffordanceIds: string[];
  rawModelOutput: string | null;
};

/** Picks an offered affordance the acceptance gate will take at drain time
 * (mirrors the helper in model-bundle.test.ts / model-reconciliation-gap). */
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

/**
 * Drives a model-condition run to completion, steering Mara's external
 * requests by ordinal through the engine's REAL inboxes:
 *
 *   1  rejected-expired  — unoffered answer next tick, then the re-decision
 *      cadence is suppressed (`lastDecisionTick = 400`, the
 *      async-lifecycle.test.ts technique per ground truth 11: cadence and TTL
 *      are both 60 ticks, so supersession beats expiry by one tick unless the
 *      cadence is pushed out). lastDecisionTick IS part of the hashed world
 *      state, but the reducer overwrites it on every DecisionRequested, so
 *      live state and replay reconverge at Mara's next request and the
 *      exported ledger still passes full validation (probe-verified).
 *   2  accepted          — gate-viable answer next tick.
 *   3  late-superseded   — left unanswered; `needsReevaluation` is set three
 *      ticks in so the next decision opportunity SUPERSEDES it (same
 *      reconvergence argument: DecisionRequested clears the flag in both live
 *      and replayed state), and only then is the gateway's answer submitted.
 *   4  provider-failure  — gateway failure body via the failure inbox:
 *      DecisionProviderFailed + external-failure expiry in the same drain.
 *   5  duplicate-response — the SAME responseId delivered twice, four ticks
 *      apart: Received is emitted unconditionally before the dedup check, so
 *      the ledger carries two Received + two Rejected cycles for one id;
 *      the request is then superseded on a forced re-decision.
 *   6  retry-accepted    — unoffered gw-<id> (rejected) plus a distinct
 *      gw-<id>-retry (accepted) in one drain, the E2 injection pattern.
 *   7+ silent            — unanswered; superseded on the natural cadence,
 *      except the final request, force-expired at scenario end.
 */
function buildLifecycleRun(): { run: EngineRun; requests: FixtureRequest[] } {
  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  const requests: FixtureRequest[] = [];
  const pushResponse = (requestId: string, responseId: string, affordanceId: string): void => {
    run.responseInbox.push({
      responseId,
      requestId,
      npcId: 'mara',
      scenarioId: 'A',
      providerId: EXTERNAL_MARA_PROVIDER_ID,
      selectedAffordanceId: affordanceId,
      confidenceBp: 5_000,
      reasonCode: 'routine',
      scores: [],
    });
  };
  const scheduled: { atTick: number; act: () => void }[] = [];
  let seen = 0;
  let cursor = 0;
  let lateRequestId: string | null = null;
  let lateAffordanceId: string | null = null;
  let lateInjected = false;
  while (!run.state.terminal) {
    const nextTick = run.state.tick + 1;
    for (const entry of scheduled) {
      if (entry.atTick === nextTick) entry.act();
    }
    stepTick(run);
    // The late case must not answer until the ledger PROVES the supersession
    // happened: scan only the events this tick appended.
    for (; cursor < run.ledger.events.length; cursor += 1) {
      const event = run.ledger.events[cursor]!;
      if (
        event.type === 'DecisionRequestSuperseded' &&
        lateRequestId !== null &&
        (event.payload as { requestId: string }).requestId === lateRequestId &&
        !lateInjected
      ) {
        lateInjected = true;
        // Drains NEXT tick, so submission lands strictly after the
        // resolution — the probe-proven Superseded -> Received -> Rejected
        // sequence of ground truth 1.
        pushResponse(lateRequestId, `gw-${lateRequestId}`, lateAffordanceId!);
      }
    }
    while (seen < run.externalRequests.length) {
      const external = run.externalRequests[seen]!;
      seen += 1;
      const ordinal = seen;
      const requestId = external.request.requestId;
      const pending = run.state.npcs.mara.pendingDecision;
      if (pending?.requestId !== requestId) {
        throw new Error(`fixture: request ${requestId} not pending at emission`);
      }
      const tick = external.request.requestedAtTick;
      let role: Role = 'silent';
      let submittedAffordanceId: string | null = null;
      if (ordinal === 1) {
        role = 'rejected-expired';
        submittedAffordanceId = UNOFFERED_AFFORDANCE;
        pushResponse(requestId, `gw-${requestId}`, UNOFFERED_AFFORDANCE);
        run.state.npcs.mara.lastDecisionTick = 400;
      } else if (ordinal === 2) {
        role = 'accepted';
        submittedAffordanceId = gateViableAffordanceId(run, pending);
        pushResponse(requestId, `gw-${requestId}`, submittedAffordanceId);
      } else if (ordinal === 3) {
        role = 'late-superseded';
        // A genuine late model answer names an affordance the ORIGINAL offer
        // held; the gate never reads it — the resolved-request registry
        // rejects on identity first.
        submittedAffordanceId = external.request.offeredAffordanceIds[0]!;
        lateRequestId = requestId;
        lateAffordanceId = submittedAffordanceId;
        scheduled.push({
          atTick: tick + 3,
          act: () => {
            run.state.npcs.mara.needsReevaluation = true;
          },
        });
      } else if (ordinal === 4) {
        role = 'provider-failure';
        run.failureInbox.push({
          failureId: `gwf-${requestId}`,
          requestId,
          npcId: 'mara',
          scenarioId: 'A',
          providerId: EXTERNAL_MARA_PROVIDER_ID,
          failureCode: 'upstream-timeout',
          retryable: false,
        });
      } else if (ordinal === 5) {
        role = 'duplicate-response';
        submittedAffordanceId = UNOFFERED_AFFORDANCE;
        pushResponse(requestId, `gw-${requestId}`, UNOFFERED_AFFORDANCE);
        // Second delivery of the SAME responseId four ticks later: a distinct
        // drain cycle, so first-wins (submission) and last-wins (verdict)
        // provably cite different events at different ticks.
        scheduled.push({
          atTick: tick + 4,
          act: () => pushResponse(requestId, `gw-${requestId}`, UNOFFERED_AFFORDANCE),
        });
        scheduled.push({
          atTick: tick + 8,
          act: () => {
            run.state.npcs.mara.needsReevaluation = true;
          },
        });
      } else if (ordinal === 6) {
        role = 'retry-accepted';
        submittedAffordanceId = UNOFFERED_AFFORDANCE;
        pushResponse(requestId, `gw-${requestId}`, UNOFFERED_AFFORDANCE);
        pushResponse(requestId, `gw-${requestId}-retry`, gateViableAffordanceId(run, pending));
      }
      requests.push({
        requestId,
        role,
        requestedAtTick: tick,
        contextHash: external.contextHash,
        submittedAffordanceId,
        external,
      });
    }
  }
  if (!lateInjected) throw new Error('fixture: the late response was never injected');
  return { run, requests };
}

function traceRowFor(request: FixtureRequest): TraceEntryV2 {
  const failure = request.role === 'provider-failure';
  return {
    runId: RUN_ID,
    requestId: request.requestId,
    npcId: 'mara',
    scenarioId: 'A',
    logicalRequestedTick: request.requestedAtTick,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: failure ? null : 'fake-adapter',
    contextHash: request.contextHash,
    truncationCounts: request.external.truncationCounts as unknown as Record<string, number>,
    upstreamResponseId: failure ? null : `up-${request.requestId}`,
    responseId: failure ? null : `gw-${request.requestId}`,
    failureId: failure ? `gwf-${request.requestId}` : null,
    offeredAffordanceIds: [...request.external.request.offeredAffordanceIds],
    rawModelOutput: null,
    selectedAffordanceId: request.submittedAffordanceId,
    reasonCode: failure ? null : 'routine',
    confidenceBp: failure ? null : 5_000,
    rationale: null,
    inputTokens: failure ? null : 100,
    outputTokens: failure ? null : 20,
    totalTokens: failure ? null : 120,
    latencyMs: failure ? 2_000 : 42,
    concurrentInFlight: 1,
    gatewayOutcome: failure ? 'upstream-timeout' : 'response',
    engineOutcome: null,
    engineRejectionReason: null,
  };
}

function clientEntryFor(runId: string, request: FixtureRequest): ModelClientTraceEntry {
  const base = {
    runId,
    conditionId: MODEL_CONDITION_ID,
    requestId: request.requestId,
    npcId: 'mara' as const,
    scenarioId: 'A' as const,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersionExpected: MODEL_PROMPT_VERSION,
    requestedAtTick: request.requestedAtTick,
    contextHash: request.contextHash,
    queuedAtUtc: '2026-07-28T10:00:00.000Z',
  };
  if (request.role === 'silent') {
    // Dispatched but never answered: the client minted a cf- transport
    // failure the engine dropped as moot (the request had already resolved) —
    // the moot-after-resolution shape of the model-bundle superseded fixture.
    return {
      ...base,
      dispatchedAtUtc: '2026-07-28T10:00:00.020Z',
      completedAtUtc: '2026-07-28T10:00:20.020Z',
      clientOutcome: 'failure',
      clientFailureCode: 'request-timeout',
      responseId: null,
      failureId: `cf-${request.requestId}`,
      clientLatencyMs: 20_000,
      gatewayResultObserved: false,
    };
  }
  if (request.role === 'provider-failure') {
    // A parsed gateway FAILURE body (gwf-) is gateway evidence (A2).
    return {
      ...base,
      dispatchedAtUtc: '2026-07-28T10:00:00.020Z',
      completedAtUtc: '2026-07-28T10:00:02.020Z',
      clientOutcome: 'failure',
      clientFailureCode: 'upstream-timeout',
      responseId: null,
      failureId: `gwf-${request.requestId}`,
      clientLatencyMs: 2_000,
      gatewayResultObserved: true,
    };
  }
  // Every other role: the gateway answered and the client dutifully posted
  // the result — the ordinary worker submits LATE responses too (ground
  // truth 3), so the late-superseded row is the SAME client shape with a
  // longer observed latency.
  return {
    ...base,
    dispatchedAtUtc: '2026-07-28T10:00:00.020Z',
    completedAtUtc:
      request.role === 'late-superseded' ? '2026-07-28T10:00:12.020Z' : '2026-07-28T10:00:00.062Z',
    clientOutcome: 'response',
    clientFailureCode: null,
    responseId: `gw-${request.requestId}`,
    failureId: null,
    clientLatencyMs: request.role === 'late-superseded' ? 12_000 : 42,
    gatewayResultObserved: true,
  };
}

function envelopeFor(runId: string, request: FixtureRequest): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    contextHash: request.contextHash,
    request: request.external.request,
    context: request.external.context,
    truncationCounts: request.external.truncationCounts,
  };
}

function gatewayStatusFor(
  runId: string,
  dispatched: number,
  responses: number,
  failures: number,
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
    gatewayFailures: failures,
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

/** Real v2 client bundle from the REAL producer, exactly as model-bundle
 * builds it: a terminal model-condition view state fed to buildRunBundle. */
function buildFixtureBundle(
  runId: string,
  ledgerFile: LedgerFile,
  entries: ModelClientTraceEntry[],
  envelopes: unknown[],
  dispatched: number,
  responses: number,
  failures: number,
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
  exportState.model.gateway = gatewayStatusFor(runId, dispatched, responses, failures);
  return buildRunBundle(exportState, entries, runId, EXPORTED_AT, envelopes, []);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function seedManifestFor(runId: string): Record<string, unknown> {
  return {
    traceSchemaVersion: 2,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId,
    scenarioId: 'A',
    providerPlanId: MODEL_CONDITION_ID,
    externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: 'fake-adapter',
    modelSettings: { temperature: 0 },
    startedAtUtc: '2026-07-28T09:59:59.000Z',
  };
}

/** The v3 row surface this suite asserts on (the full row carries more). */
interface FinalRow {
  requestId: string;
  logicalSubmittedTick: number | null;
  strictDisposition: string | null;
  responseId: string | null;
  failureId: string | null;
  clientOutcome: string | null;
  gatewayOutcome: string | null;
  engineOutcome: 'accepted' | 'rejected' | 'expired' | 'superseded' | null;
  engineRejectionReason: string | null;
  engineSubmissionEventId: string | null;
  responseVerdictEventId: string | null;
  engineResolutionEventId: string | null;
}

function readFinalRows(dir: string): Map<string, FinalRow> {
  const rows = readFileSync(join(dir, 'finalized-trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as FinalRow);
  return new Map(rows.map((row) => [row.requestId, row]));
}

function eventsWhere(
  file: LedgerFile,
  type: EventEnvelope['type'],
  key: 'requestId' | 'responseId',
  value: string,
): EventEnvelope[] {
  return file.events.filter(
    (e) => e.type === type && (e.payload as Record<string, unknown>)[key] === value,
  );
}

function onlyEvent(
  file: LedgerFile,
  type: EventEnvelope['type'],
  key: 'requestId' | 'responseId',
  value: string,
): EventEnvelope {
  const matches = eventsWhere(file, type, key, value);
  expect(matches, `${type} ${key}=${value}`).toHaveLength(1);
  return matches[0]!;
}

/**
 * E8 recipe (probe-verified): delete the TERMINAL scenario-ended
 * DecisionRequestExpired for an external request, renumber seq and the
 * canonical/operator event-ID counters, remap every event-id reference
 * (causation, perception targets, payload source-event ids), then reseal —
 * replayed worldStateHash restamped into the file AND the ScenarioEnded
 * payload, canonical ledger hash recomputed over the doctored stream, final
 * summary rebuilt from the replayed state (the reseal steps mirror
 * tests/ledgerCorruption.ts, local here because the renumbering is specific
 * to this suite). The result PASSES full validation — the request simply has
 * no resolution — which is exactly the gap the finalizer's engine-resolution
 * criterion exists to catch. (Naive tampering cannot produce this: deleting
 * a Superseded event aborts replay with reduce-decision-request-overlap.)
 */
function deleteTerminalExpiry(file: LedgerFile): { unresolvedRequestId: string } {
  const externalIds = new Set(
    file.events
      .filter(
        (e) =>
          e.type === 'DecisionRequested' &&
          (e.payload as { providerId: string }).providerId === EXTERNAL_MARA_PROVIDER_ID,
      )
      .map((e) => (e.payload as { requestId: string }).requestId),
  );
  const targets = file.events.filter(
    (e) =>
      e.type === 'DecisionRequestExpired' &&
      (e.payload as { reasonCode: string }).reasonCode === 'scenario-ended' &&
      externalIds.has((e.payload as { requestId: string }).requestId),
  );
  // Only Mara defers in this condition, so exactly one request is still
  // pending when endScenario force-expires (engine.ts endScenario).
  expect(targets).toHaveLength(1);
  const target = targets[0]!;
  const unresolvedRequestId = (target.payload as { requestId: string }).requestId;

  const kept = file.events.filter((e) => e !== target);
  // Rebuild both ID counters exactly as the validator expects them
  // (canonical events and operator markers count separately, ground truth 8).
  const idMap = new Map<string, string>();
  let canonicalCount = 0;
  let markerCount = 0;
  for (const event of kept) {
    const isMarker = event.type === 'SimulationPaused' || event.type === 'SimulationResumed';
    idMap.set(
      event.id,
      isMarker
        ? `evt-op-${String(markerCount).padStart(4, '0')}`
        : `evt-${String(canonicalCount).padStart(6, '0')}`,
    );
    if (isMarker) markerCount += 1;
    else canonicalCount += 1;
  }
  // Every event-id reference must follow its event to the new numbering:
  // causationId, PerceptionRecorded's targetId/sourceEventId, and any other
  // payload field carrying an event id (a deep walk keeps this recipe honest
  // against payloads like RelationshipChanged's source-event lists).
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return idMap.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remap(v)]),
      );
    }
    return value;
  };
  kept.forEach((event, index) => {
    event.seq = index;
    event.id = idMap.get(event.id)!;
    if (event.causationId !== null)
      event.causationId = idMap.get(event.causationId) ?? event.causationId;
    if (event.targetId !== null) event.targetId = idMap.get(event.targetId) ?? event.targetId;
    event.payload = remap(event.payload) as typeof event.payload;
  });
  file.events = kept;

  // Reseal: replay the doctored stream, restamp both hash homes, recompute
  // the canonical ledger hash, and rebuild the final summary field-by-field
  // (eventCount shrank by one).
  const replayed = replayLedger(file.scenario.id, file.events);
  file.worldStateHash = replayed.worldStateHash;
  const ended = file.events.find((e) => e.type === 'ScenarioEnded');
  if (ended) {
    (ended.payload as { worldStateHash: string }).worldStateHash = replayed.worldStateHash;
  }
  file.canonicalLedgerHash = canonicalLedgerHash(file.events as SimEvent[]);
  file.finalSummary = buildFinalSummary(replayed.state, file.events);
  return { unresolvedRequestId };
}

let ledger: LedgerFile;
let fixtureRequests: FixtureRequest[];
let rows: Map<string, FinalRow>;

function requestOf(role: Exclude<Role, 'silent'>): FixtureRequest {
  return fixtureRequests.find((r) => r.role === role)!;
}

function rowOf(role: Exclude<Role, 'silent'>): FinalRow {
  return rows.get(requestOf(role).requestId)!;
}

describe('finalized-trace v3 lifecycle event IDs (spec E7 T-B, one real run, four-source strict finalize)', () => {
  beforeAll(() => {
    const { run, requests } = buildLifecycleRun();
    fixtureRequests = requests;
    ledger = buildLedgerFile(run);
    for (const role of [
      'rejected-expired',
      'accepted',
      'late-superseded',
      'provider-failure',
      'duplicate-response',
      'retry-accepted',
    ] as const) {
      expect(
        requests.filter((r) => r.role === role),
        role,
      ).toHaveLength(1);
    }
    expect(requests.filter((r) => r.role === 'silent').length).toBeGreaterThan(1);

    // Gateway-side files first, exactly as the gateway would leave them: a
    // trace row + envelope sidecar for everything that reached it (the six
    // steered requests); the silent tail never produced gateway evidence.
    const root = mkdtempSync(join(tmpdir(), 'model-evtsem-'));
    const templateDir = join(root, RUN_ID);
    mkdirSync(join(templateDir, 'requests'), { recursive: true });
    writeJson(join(templateDir, 'run-manifest.json'), seedManifestFor(RUN_ID));
    const traced = requests.filter((r) => r.role !== 'silent');
    writeFileSync(
      join(templateDir, 'model-trace.jsonl'),
      traced.map((r) => JSON.stringify(traceRowFor(r))).join('\n') + '\n',
      'utf8',
    );
    for (const request of traced) {
      writeJson(
        join(templateDir, 'requests', `${request.requestId}.json`),
        envelopeFor(RUN_ID, request),
      );
    }

    // Client-side: an entry and an archived exact envelope for EVERY request
    // the engine emitted, in the client's requestId-sorted order.
    const sortedEnvelopes = [...requests]
      .sort((a, b) => (a.requestId < b.requestId ? -1 : 1))
      .map((r) => envelopeFor(RUN_ID, r));
    const bundle = buildFixtureBundle(
      RUN_ID,
      ledger,
      requests.map((r) => clientEntryFor(RUN_ID, r)),
      sortedEnvelopes,
      requests.length,
      traced.filter((r) => r.role !== 'provider-failure').length,
      1,
    );
    const staging = mkdtempSync(join(tmpdir(), 'model-evtsem-staging-'));
    const ledgerPath = join(staging, `ledger-A-${RUN_ID}.json`);
    writeFileSync(ledgerPath, JSON.stringify(ledger), 'utf8');
    writeJson(join(staging, 'client-bundle-export.json'), bundle);
    // Full ledger validation happens HERE (S1): the steered run — including
    // its out-of-band cadence nudges — must round-trip replay + hashes.
    const { dir } = prepareRunDirectory({
      runId: RUN_ID,
      ledgerPath,
      bundlePath: join(staging, 'client-bundle-export.json'),
      destRoot: root,
    });

    const result = finalizeRunDirectory(dir, RUN_ID);
    expect(result.status).toBe('completed');
    expect(result.failedCriteria).toEqual([]);
    expect(result.joinedRequests).toBe(requests.length);
    expect(result.completeness.sources).toEqual(['gateway', 'ledger', 'client']);
    rows = readFinalRows(dir);
    expect(rows.size).toBe(requests.length);
  }, 240_000);

  it('case 1 — accepted response: submission is the Received event; verdict and resolution are the SAME Accepted event', () => {
    const { requestId } = requestOf('accepted');
    const received = onlyEvent(ledger, 'DecisionResponseReceived', 'responseId', `gw-${requestId}`);
    const accepted = onlyEvent(ledger, 'DecisionResponseAccepted', 'responseId', `gw-${requestId}`);
    // Same drain: the verdict shares the submission's tick (ground truth 2 —
    // an inequality here would be wrong, not merely strict).
    expect(accepted.tick).toBe(received.tick);

    const row = rowOf('accepted');
    expect(row.engineOutcome).toBe('accepted');
    expect(row.engineSubmissionEventId).toBe(received.id);
    expect(row.logicalSubmittedTick).toBe(received.tick);
    expect(row.responseVerdictEventId).toBe(accepted.id);
    expect(row.engineResolutionEventId).toBe(accepted.id);
    // Acceptance is both verdict and resolution — but never the submission.
    expect(row.engineSubmissionEventId).not.toBe(row.engineResolutionEventId);
    expect(row.strictDisposition).toBe('gateway-answered');
  });

  it('case 2 — rejected then expired: verdict is the Rejected event, resolution is the Expired event, ordered by SEQ', () => {
    const { requestId } = requestOf('rejected-expired');
    const received = onlyEvent(ledger, 'DecisionResponseReceived', 'responseId', `gw-${requestId}`);
    const rejected = onlyEvent(ledger, 'DecisionResponseRejected', 'responseId', `gw-${requestId}`);
    const expired = onlyEvent(ledger, 'DecisionRequestExpired', 'requestId', requestId);
    // The cadence suppression really did force the pure-timeout path: no
    // supersession exists for this request (event TYPE, not reasonCode).
    expect(eventsWhere(ledger, 'DecisionRequestSuperseded', 'requestId', requestId)).toHaveLength(
      0,
    );
    expect(rejected.tick).toBe(received.tick);
    // Rejection precedes expiry by SEQ. Never assert tick inequality here:
    // the drain and the expiry sweep can legally share a tick (ground truth 2).
    expect(rejected.seq).toBeLessThan(expired.seq);

    const row = rowOf('rejected-expired');
    expect(row.engineOutcome).toBe('rejected');
    expect(row.engineSubmissionEventId).toBe(received.id);
    expect(row.logicalSubmittedTick).toBe(received.tick);
    expect(row.responseVerdictEventId).toBe(rejected.id);
    expect(row.engineResolutionEventId).toBe(expired.id);
    expect(row.responseVerdictEventId).not.toBe(row.engineResolutionEventId);
    // Secondary evidence only: the reason string agrees with the verdict event.
    expect(row.engineRejectionReason).toBe('unoffered-affordance');
  });

  it('case 3 — late response after supersession: the canonical resolution PREDATES the submission; the row still strict-finalizes as gateway-answered', () => {
    const { requestId } = requestOf('late-superseded');
    const superseded = onlyEvent(ledger, 'DecisionRequestSuperseded', 'requestId', requestId);
    const received = onlyEvent(ledger, 'DecisionResponseReceived', 'responseId', `gw-${requestId}`);
    const rejected = onlyEvent(ledger, 'DecisionResponseRejected', 'responseId', `gw-${requestId}`);
    // THE one legal strict tick inequality in this work: the request resolved
    // before its answer ever entered the engine. Any future chronological
    // assumption (submission <= resolution) turns this red.
    expect(superseded.tick).toBeLessThan(received.tick);
    expect(rejected.tick).toBe(received.tick);

    const row = rowOf('late-superseded');
    // Four-source join: gateway row + sidecar + observing client entry +
    // ledger — a LATE answer is ordinary evidence, not a degraded artifact.
    expect(row.gatewayOutcome).toBe('response');
    expect(row.clientOutcome).toBe('response');
    expect(row.strictDisposition).toBe('gateway-answered');
    expect(row.engineOutcome).toBe('rejected');
    expect(row.engineSubmissionEventId).toBe(received.id);
    expect(row.logicalSubmittedTick).toBe(received.tick);
    expect(row.responseVerdictEventId).toBe(rejected.id);
    // The resolution is the Superseded EVENT (primary, by type + id) …
    expect(row.engineResolutionEventId).toBe(superseded.id);
    // … and the reason string is secondary corroboration.
    expect(row.engineRejectionReason).toBe('superseded-request');
  });

  it('case 4 — provider failure then expiry: submission is the ProviderFailed event, verdict is null, resolution is the Expired event', () => {
    const { requestId } = requestOf('provider-failure');
    const failed = onlyEvent(ledger, 'DecisionProviderFailed', 'requestId', requestId);
    const expired = onlyEvent(ledger, 'DecisionRequestExpired', 'requestId', requestId);
    // No response ever entered the engine for this request.
    expect(
      eventsWhere(ledger, 'DecisionResponseReceived', 'responseId', `gw-${requestId}`),
    ).toHaveLength(0);

    const row = rowOf('provider-failure');
    expect(row.engineOutcome).toBe('expired');
    expect(row.failureId).toBe(`gwf-${requestId}`);
    expect(row.engineSubmissionEventId).toBe(failed.id);
    expect(row.logicalSubmittedTick).toBe(failed.tick);
    expect(row.responseVerdictEventId).toBeNull();
    expect(row.engineResolutionEventId).toBe(expired.id);
    expect(row.engineSubmissionEventId).not.toBe(row.engineResolutionEventId);
    expect(row.strictDisposition).toBe('gateway-answered');
  });

  it('case 5 — expiry with no submission: submission and verdict are null, resolution is the Expired event', () => {
    const silent = fixtureRequests.filter((r) => r.role === 'silent');
    const expiredSilent = silent.filter(
      (r) => eventsWhere(ledger, 'DecisionRequestExpired', 'requestId', r.requestId).length > 0,
    );
    // The final request is always still pending at scenario end (assert the
    // event TYPE only — the reasonCode is scenario-ended vs ttl-expired
    // depending on timing, and neither is the contract).
    expect(expiredSilent.length).toBeGreaterThan(0);
    const { requestId } = expiredSilent[0]!;
    const expired = onlyEvent(ledger, 'DecisionRequestExpired', 'requestId', requestId);
    expect(eventsWhere(ledger, 'DecisionResponseReceived', 'requestId', requestId)).toHaveLength(0);
    expect(eventsWhere(ledger, 'DecisionProviderFailed', 'requestId', requestId)).toHaveLength(0);

    const row = rows.get(requestId)!;
    expect(row.engineOutcome).toBe('expired');
    expect(row.engineSubmissionEventId).toBeNull();
    expect(row.logicalSubmittedTick).toBeNull();
    expect(row.responseVerdictEventId).toBeNull();
    expect(row.engineResolutionEventId).toBe(expired.id);
    expect(row.strictDisposition).toBe('moot-after-resolution');
  });

  it('case 6 — supersession with no submission: submission and verdict are null, resolution is the Superseded event', () => {
    const silent = fixtureRequests.filter((r) => r.role === 'silent');
    const supersededSilent = silent.filter(
      (r) => eventsWhere(ledger, 'DecisionRequestSuperseded', 'requestId', r.requestId).length > 0,
    );
    expect(supersededSilent.length).toBeGreaterThan(0);
    const { requestId } = supersededSilent[0]!;
    const superseded = onlyEvent(ledger, 'DecisionRequestSuperseded', 'requestId', requestId);
    expect(eventsWhere(ledger, 'DecisionResponseReceived', 'requestId', requestId)).toHaveLength(0);
    expect(eventsWhere(ledger, 'DecisionProviderFailed', 'requestId', requestId)).toHaveLength(0);

    const row = rows.get(requestId)!;
    expect(row.engineOutcome).toBe('superseded');
    expect(row.engineSubmissionEventId).toBeNull();
    expect(row.logicalSubmittedTick).toBeNull();
    expect(row.responseVerdictEventId).toBeNull();
    expect(row.engineResolutionEventId).toBe(superseded.id);
    expect(row.strictDisposition).toBe('moot-after-resolution');
  });

  it('case 7 — rejected gateway response, request resolved by a DIFFERENT responseId: verdict keyed by responseId, resolution keyed by requestId', () => {
    const { requestId } = requestOf('retry-accepted');
    const received = onlyEvent(ledger, 'DecisionResponseReceived', 'responseId', `gw-${requestId}`);
    const rejected = onlyEvent(ledger, 'DecisionResponseRejected', 'responseId', `gw-${requestId}`);
    const accepted = onlyEvent(ledger, 'DecisionResponseAccepted', 'requestId', requestId);
    // The acceptance belongs to the OTHER response — the E2 injection — so
    // the two join keys provably diverge for one and the same row.
    expect((accepted.payload as { responseId: string }).responseId).toBe(`gw-${requestId}-retry`);
    expect(
      eventsWhere(ledger, 'DecisionResponseAccepted', 'responseId', `gw-${requestId}`),
    ).toHaveLength(0);

    const row = rowOf('retry-accepted');
    // The gateway's own response is this row's identity …
    expect(row.responseId).toBe(`gw-${requestId}`);
    // … its verdict is that response's Rejected event (responseId-keyed) …
    expect(row.engineOutcome).toBe('rejected');
    expect(row.engineSubmissionEventId).toBe(received.id);
    expect(row.responseVerdictEventId).toBe(rejected.id);
    // … while the request's resolution is the retry's Accepted event
    // (requestId-keyed). E3: a legal, non-contradictory combination.
    expect(row.engineResolutionEventId).toBe(accepted.id);
    expect(row.responseVerdictEventId).not.toBe(row.engineResolutionEventId);
    expect(row.engineRejectionReason).toBe('unoffered-affordance');
  });

  it('duplicate responseId (E6): submission cites the FIRST Received cycle, the verdict the LAST Rejected cycle — pinned policy, different events', () => {
    const { requestId } = requestOf('duplicate-response');
    const receivedAll = eventsWhere(
      ledger,
      'DecisionResponseReceived',
      'responseId',
      `gw-${requestId}`,
    );
    const rejectedAll = eventsWhere(
      ledger,
      'DecisionResponseRejected',
      'responseId',
      `gw-${requestId}`,
    );
    // Received is emitted UNCONDITIONALLY before the dedup check (ground
    // truth 1), so both deliveries left a full Received + Rejected cycle.
    expect(receivedAll).toHaveLength(2);
    expect(rejectedAll).toHaveLength(2);
    // The fixture delivered the copies in distinct drains, so first-wins and
    // last-wins are distinguishable by tick, and each verdict still shares
    // its own cycle's tick.
    expect(receivedAll[0]!.tick).toBeLessThan(receivedAll[1]!.tick);
    expect(rejectedAll[1]!.tick).toBe(receivedAll[1]!.tick);
    const superseded = onlyEvent(ledger, 'DecisionRequestSuperseded', 'requestId', requestId);

    const row = rows.get(requestId)!;
    // Submission: FIRST-wins (this is what logicalSubmittedTick has always
    // reported — byte-identical preservation, E11).
    expect(row.engineSubmissionEventId).toBe(receivedAll[0]!.id);
    expect(row.logicalSubmittedTick).toBe(receivedAll[0]!.tick);
    // Verdict: LAST-wins, so the cited event is the SAME event whose reason
    // feeds engineRejectionReason — submission and verdict legitimately come
    // from different delivery cycles.
    expect(row.responseVerdictEventId).toBe(rejectedAll[1]!.id);
    expect(row.engineOutcome).toBe('rejected');
    expect(row.engineRejectionReason).toBe('duplicate-response');
    expect((rejectedAll[1]!.payload as { rejectionReason: string }).rejectionReason).toBe(
      'duplicate-response',
    );
    // Neither rejection resolves the request — the later supersession does.
    expect(row.engineResolutionEventId).toBe(superseded.id);
  });

  it('field contract: every non-null event id resolves in the validated ledger to an event of exactly the family its field claims', () => {
    const byId = new Map(ledger.events.map((e) => [e.id, e]));
    const canonicalEventId = /^evt-\d{6,}$/;
    for (const row of rows.values()) {
      // Co-null pair: tick and id are read off ONE indexed submission event.
      expect(row.logicalSubmittedTick === null, row.requestId).toBe(
        row.engineSubmissionEventId === null,
      );
      if (row.engineSubmissionEventId !== null) {
        expect(row.engineSubmissionEventId).toMatch(canonicalEventId);
        const event = byId.get(row.engineSubmissionEventId)!;
        expect(['DecisionResponseReceived', 'DecisionProviderFailed'], row.requestId).toContain(
          event.type,
        );
        expect(event.tick).toBe(row.logicalSubmittedTick);
      }
      if (row.responseVerdictEventId !== null) {
        expect(row.responseVerdictEventId).toMatch(canonicalEventId);
        expect(['DecisionResponseAccepted', 'DecisionResponseRejected'], row.requestId).toContain(
          byId.get(row.responseVerdictEventId)!.type,
        );
      }
      // The resolution family NEVER contains Received, ProviderFailed, or
      // Rejected — reintroducing any of the pre-1.6.1 aliases fails here for
      // every row at once.
      expect(row.engineResolutionEventId, row.requestId).not.toBeNull();
      expect(row.engineResolutionEventId!).toMatch(canonicalEventId);
      expect(
        ['DecisionResponseAccepted', 'DecisionRequestExpired', 'DecisionRequestSuperseded'],
        row.requestId,
      ).toContain(byId.get(row.engineResolutionEventId!)!.type);
    }
  });

  it('E1 key divergence: a bundle-less, trace-less degraded join still finds every verdict via the gw- fallback key while the row responseId FIELD is null', () => {
    // The one REACHABLE shape where the two candidate keys disagree. With
    // client-bundle.json and model-trace.jsonl both lost, rows enumerate from
    // the envelope sidecars alone: the row's `responseId` FIELD is null
    // (client?.responseId with no client, no trace row), while the verdict
    // lookup still succeeds through gwResponseId's documented `gw-<requestId>`
    // fallback — the SAME key the shared outcome ladder receives. Keyed on
    // the FIELD instead, every verdicted row here gets engineOutcome
    // 'accepted'/'rejected' beside a null responseVerdictEventId, the v3
    // superRefine refuses the row, and finalize CRASHES instead of degrading
    // — the reviewer-reproduced production scenario E1 exists to prevent.
    // Every other case in this suite pairs verdicts with 'response' trace
    // rows, where the two keys coincide; only this join can catch the
    // field-keyed regression.
    const dir = join(mkdtempSync(join(tmpdir(), 'model-evtsem-e1key-')), RUN_ID);
    mkdirSync(join(dir, 'requests'), { recursive: true });
    writeJson(join(dir, 'run-manifest.json'), seedManifestFor(RUN_ID));
    writeFileSync(join(dir, `ledger-A-${RUN_ID}.json`), JSON.stringify(ledger), 'utf8');
    for (const request of fixtureRequests.filter((r) => r.role !== 'silent')) {
      writeJson(join(dir, 'requests', `${request.requestId}.json`), envelopeFor(RUN_ID, request));
    }

    // Strict refuses the join (client bundle absent) and writes nothing.
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/client-bundle-present/);

    const result = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(result.status).toBe('degraded');

    const accepted = requestOf('accepted');
    const rejectedExpired = requestOf('rejected-expired');
    const rows = readFinalRows(dir);
    const acceptedEvent = onlyEvent(
      ledger,
      'DecisionResponseAccepted',
      'responseId',
      `gw-${accepted.requestId}`,
    );
    const rejectedEvent = onlyEvent(
      ledger,
      'DecisionResponseRejected',
      'responseId',
      `gw-${rejectedExpired.requestId}`,
    );

    const acceptedRow = rows.get(accepted.requestId)!;
    // THE divergence, both polarities: the reporting field is null, the
    // verdict is not — and outcome/verdict agree because they share one key.
    expect(acceptedRow.responseId).toBeNull();
    expect(acceptedRow.engineOutcome).toBe('accepted');
    expect(acceptedRow.responseVerdictEventId).toBe(acceptedEvent.id);
    expect(acceptedRow.engineResolutionEventId).toBe(acceptedEvent.id);

    const rejectedRow = rows.get(rejectedExpired.requestId)!;
    expect(rejectedRow.responseId).toBeNull();
    expect(rejectedRow.engineOutcome).toBe('rejected');
    expect(rejectedRow.responseVerdictEventId).toBe(rejectedEvent.id);
  });
});

describe('degraded unresolved row (spec E8)', () => {
  it('a fully-validating ledger missing one terminal resolution fails strict on engine-resolution and degrades to a null-resolution row naming BOTH criteria', () => {
    // A real never-answered run: every request superseded on the natural
    // cadence except the last, force-expired at scenario end — the event the
    // tamper removes.
    const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
    while (!run.state.terminal) stepTick(run);
    const externals = [...run.externalRequests];
    expect(externals.length).toBeGreaterThan(1);
    const file = JSON.parse(JSON.stringify(buildLedgerFile(run))) as LedgerFile;
    const { unresolvedRequestId } = deleteTerminalExpiry(file);

    // The tamper is validation-proof: only the finalizer's A1 criterion can
    // see the hole.
    const validation = validateLedgerFile(JSON.stringify(file));
    expect(validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(validation.ok).toBe(true);

    const requests: FixtureRequest[] = externals.map((external) => ({
      requestId: external.request.requestId,
      role: 'silent',
      requestedAtTick: external.request.requestedAtTick,
      contextHash: external.contextHash,
      submittedAffordanceId: null,
      external,
    }));
    const bundle = buildFixtureBundle(
      DEGRADED_RUN_ID,
      file,
      requests.map((r) => clientEntryFor(DEGRADED_RUN_ID, r)),
      [...requests]
        .sort((a, b) => (a.requestId < b.requestId ? -1 : 1))
        .map((r) => envelopeFor(DEGRADED_RUN_ID, r)),
      requests.length,
      0,
      0,
    );
    const root = mkdtempSync(join(tmpdir(), 'model-evtsem-degraded-'));
    const ledgerPath = join(root, `ledger-A-${DEGRADED_RUN_ID}.json`);
    writeFileSync(ledgerPath, JSON.stringify(file), 'utf8');
    writeJson(join(root, 'client-bundle-export.json'), bundle);
    // Staging runs the COMPLETE validation sequence again — the tampered
    // ledger must clear it or this whole scenario is unreachable.
    const { dir } = prepareRunDirectory({
      runId: DEGRADED_RUN_ID,
      ledgerPath,
      bundlePath: join(root, 'client-bundle-export.json'),
      destRoot: root,
    });
    // The gateway never produced a terminal result: seed manifest only.
    writeJson(join(dir, 'run-manifest.json'), seedManifestFor(DEGRADED_RUN_ID));

    // Strict: the missing terminal resolution is a refused criterion, not a
    // crash and not a silent null.
    expect(() => finalizeRunDirectory(dir, DEGRADED_RUN_ID)).toThrow(
      /engine-resolution: 1 request\(s\) have no accepted\/expired\/superseded resolution/,
    );

    // Degraded: the row survives with a null resolution, and the manifest
    // names BOTH failed criteria — the missing resolution and the now-
    // unclassifiable disposition (its moot carve-out needed that resolution).
    const result = finalizeRunDirectory(dir, DEGRADED_RUN_ID, { allowDegraded: true });
    expect(result.status).toBe('degraded');
    expect(result.failedCriteria.some((c) => c.startsWith('engine-resolution:'))).toBe(true);
    expect(result.failedCriteria.some((c) => c.startsWith('strict-disposition:'))).toBe(true);
    expect(result.failedCriteria.filter((c) => c.includes(unresolvedRequestId))).toHaveLength(2);
    const manifest = readJson<{ status: string; failedCriteria: string[] }>(
      join(dir, 'run-manifest.final.json'),
    );
    expect(manifest.status).toBe('degraded');
    expect(manifest.failedCriteria).toEqual(result.failedCriteria);

    const degradedRows = readFinalRows(dir);
    const row = degradedRows.get(unresolvedRequestId)!;
    expect(row.engineSubmissionEventId).toBeNull();
    expect(row.logicalSubmittedTick).toBeNull();
    expect(row.responseVerdictEventId).toBeNull();
    expect(row.engineResolutionEventId).toBeNull();
    expect(row.engineOutcome).toBeNull();
    expect(row.strictDisposition).toBeNull();
    // The null is scoped to the tampered request: a sibling superseded row
    // still cites its (renumbered) resolution event from the same ledger.
    const sibling = file.events.find((e) => e.type === 'DecisionRequestSuperseded')!;
    const siblingRow = degradedRows.get((sibling.payload as { requestId: string }).requestId)!;
    expect(siblingRow.engineOutcome).toBe('superseded');
    expect(siblingRow.engineResolutionEventId).toBe(sibling.id);
  }, 240_000);
});
