import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { z } from 'zod';
import {
  FINALIZED_TRACE_SCHEMA_VERSION,
  FINAL_MANIFEST_SCHEMA_VERSION,
  finalManifestSchema,
  finalizedTraceEntrySchema,
  modelTraceEntrySchema,
  runBundleSchema,
  runManifestSeedSchema,
  type FinalizedTraceEntry,
  type RunBundle,
  type RunManifestSeed,
} from '../../src/shared/modelArtifacts';
import { ledgerFileSchema } from '../../src/shared/ledgerFile';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { externalDecisionRequestEnvelopeSchema } from '../../src/sim/decisions/externalSchemas';
import { externalContextHash } from '../../src/sim/decisions/externalContext';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';
import { computeInfraMetrics } from '../../gateway/metrics/runMetrics';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import {
  aggregateSha256,
  buildModelSummary,
  engineLifecycle,
  sha256OfFile,
  traceRowResponseId,
} from './summarize';

/**
 * Formal run finalizer (re-audit remediation S3).
 *
 *   npm run model:finalize -- --run-id <runId>
 *
 * Strict-loads every artifact in artifacts/model-runs/<runId>/, proves the
 * pieces describe the SAME run (any contradiction exits nonzero), joins the
 * client trace + gateway trace + engine lifecycle per requestId, and writes:
 *   finalized-trace.jsonl    — one joined row per requestId (NEW file; the
 *                              raw model-trace.jsonl is never overwritten —
 *                              deviation D1)
 *   run-manifest.final.json  — finalized manifest (the gateway's write-once
 *                              seed run-manifest.json is never mutated)
 *   model-summary.json       — the informal summarize output + client/engine
 *                              demand metrics when a client trace is present
 *   bundle-manifest.json     — sha256 of EVERY file in the directory plus an
 *                              aggregate hash over the sorted name:hash lines
 *
 * ABSENCE of an optional source (client-bundle.json — deviation D2 — or the
 * gateway trace) only degrades the recorded completeness; a CONTRADICTION
 * between present sources always fails.
 */

type ClientTraceEntry = RunBundle['clientTrace'][number];
type Envelope = z.infer<typeof externalDecisionRequestEnvelopeSchema>;

export interface FinalizeResult {
  runId: string;
  joinedRequests: number;
  completeness: { sources: string[]; notes: string[] };
}

/** v2 rows carry the gateway-minted failure id; older rows fall back to the
 * documented `gwf-<requestId>` convention. */
function traceRowFailureId(row: ModelTraceEntry): string {
  const v2 = (row as { failureId?: string | null }).failureId;
  return v2 ?? `gwf-${row.requestId}`;
}

interface LedgerIndex {
  /** DecisionRequested for the external provider only. */
  requested: Map<string, { tick: number; npcId: string; providerId: string }>;
  receivedByResponseId: Map<string, { tick: number; eventId: string }>;
  providerFailedByRequestId: Map<string, { tick: number; eventId: string; errorCode: string }>;
  acceptedResponseIds: Set<string>;
  rejectedByResponseId: Map<string, string>;
  expiredRequestIds: Set<string>;
}

function indexLedger(ledger: LedgerFile, externalProviderId: string): LedgerIndex {
  const index: LedgerIndex = {
    requested: new Map(),
    receivedByResponseId: new Map(),
    providerFailedByRequestId: new Map(),
    acceptedResponseIds: new Set(),
    rejectedByResponseId: new Map(),
    expiredRequestIds: new Set(),
  };
  for (const event of ledger.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'DecisionRequested') {
      if (payload.providerId === externalProviderId) {
        index.requested.set(String(payload.requestId), {
          tick: event.tick,
          npcId: String(payload.npcId),
          providerId: String(payload.providerId),
        });
      }
    } else if (event.type === 'DecisionResponseReceived') {
      const responseId = String(payload.responseId);
      if (!index.receivedByResponseId.has(responseId)) {
        index.receivedByResponseId.set(responseId, { tick: event.tick, eventId: event.id });
      }
    } else if (event.type === 'DecisionProviderFailed') {
      const requestId = String(payload.requestId);
      if (
        payload.providerId === externalProviderId &&
        !index.providerFailedByRequestId.has(requestId)
      ) {
        index.providerFailedByRequestId.set(requestId, {
          tick: event.tick,
          eventId: event.id,
          errorCode: String(payload.errorCode),
        });
      }
    } else if (event.type === 'DecisionResponseAccepted') {
      index.acceptedResponseIds.add(String(payload.responseId));
    } else if (event.type === 'DecisionResponseRejected') {
      index.rejectedByResponseId.set(String(payload.responseId), String(payload.rejectionReason));
    } else if (event.type === 'DecisionRequestExpired') {
      index.expiredRequestIds.add(String(payload.requestId));
    }
  }
  return index;
}

/** Ledger selection: the UNIQUE ledger-*.json in the directory — uniqueness
 * is the only rule (the strict run-bundle handoff carries no filename
 * designation). Zero or 2+ candidates is a hard error — never first-match;
 * resolve ambiguity by removing the extra ledger from the run directory. */
function selectLedgerFileName(dir: string): string {
  const candidates = readdirSync(dir).filter((f) => f.startsWith('ledger-') && f.endsWith('.json'));
  if (candidates.length === 0) {
    throw new Error(`finalize: no ledger-*.json found in ${dir}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `finalize: ${candidates.length} ledger files found (${candidates.join(', ')}) — ambiguous; remove the extra ledger-*.json from the run directory`,
    );
  }
  return candidates[0]!;
}

function walkFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(root, relPath));
    else out.push(relPath);
  }
  return out;
}

export function finalizeRunDirectory(dir: string, runId: string): FinalizeResult {
  const contradictions: string[] = [];
  const notes: string[] = [];
  const contra = (message: string): void => {
    contradictions.push(message);
  };

  // ---- 1. Load + strict-validate -----------------------------------------
  if (basename(dir) !== runId) {
    contra(`run directory name '${basename(dir)}' does not match runId '${runId}'`);
  }

  const manifestPath = join(dir, 'run-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`finalize: run-manifest.json not found in ${dir}`);
  }
  const seed: RunManifestSeed = runManifestSeedSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  );

  const tracePath = join(dir, 'model-trace.jsonl');
  const traceFileExists = existsSync(tracePath);
  const traceRows: ModelTraceEntry[] = traceFileExists
    ? readFileSync(tracePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => modelTraceEntrySchema.parse(JSON.parse(line)) as unknown as ModelTraceEntry)
    : [];
  // Content-aware, not presence-based (F6): the gateway only ever creates
  // this file by appending a complete row, so a zero-row file is truncation
  // or mis-staging and must never score MORE complete than an absent one.
  const gatewayPresent = traceFileExists && traceRows.length > 0;
  if (!traceFileExists) {
    notes.push('model-trace.jsonl absent — gateway activity unavailable');
  } else if (traceRows.length === 0) {
    notes.push('model-trace.jsonl present but contains zero rows — gateway activity unavailable');
  }

  const bundlePath = join(dir, 'client-bundle.json');
  const clientPresent = existsSync(bundlePath);
  const bundle: RunBundle | null = clientPresent
    ? runBundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf8')))
    : null;
  if (!clientPresent) {
    notes.push('client-bundle.json absent — client demand metrics unavailable (deviation D2)');
    // F11: the client handoff is the ONLY artifact that binds the copied
    // ledger to this run (ledgers carry no runId by frozen invariant).
    notes.push(
      'no client handoff: ledger-to-run binding is operator-asserted (ledgers carry no runId)',
    );
  }

  const ledgerFileName = selectLedgerFileName(dir);
  const ledger = ledgerFileSchema.parse(
    JSON.parse(readFileSync(join(dir, ledgerFileName), 'utf8')),
  ) as LedgerFile;

  const requestsDir = join(dir, 'requests');
  const sidecars = new Map<string, Envelope>();
  if (existsSync(requestsDir)) {
    for (const file of readdirSync(requestsDir).filter((f) => f.endsWith('.json'))) {
      const envelope = externalDecisionRequestEnvelopeSchema.parse(
        JSON.parse(readFileSync(join(requestsDir, file), 'utf8')),
      );
      if (file !== `${envelope.request.requestId}.json`) {
        contra(`sidecar '${file}' names request '${envelope.request.requestId}'`);
      }
      sidecars.set(envelope.request.requestId, envelope);
    }
  }

  // ---- 2. Consistency (contradiction -> nonzero) -------------------------
  const scenarioId: string = seed.scenarioId;

  if (seed.runId !== runId) contra(`run-manifest.json runId '${seed.runId}' != '${runId}'`);
  if (seed.experimentId !== MODEL_EXPERIMENT_ID) {
    contra(`run-manifest.json experimentId '${seed.experimentId}' != '${MODEL_EXPERIMENT_ID}'`);
  }
  if (seed.experimentVersion !== MODEL_EXPERIMENT_VERSION) {
    contra(`run-manifest.json experimentVersion '${seed.experimentVersion}' is not pinned`);
  }
  if (seed.conditionId !== MODEL_CONDITION_ID) {
    contra(`run-manifest.json conditionId '${seed.conditionId}' != '${MODEL_CONDITION_ID}'`);
  }
  if (seed.externalProviderId !== EXTERNAL_MARA_PROVIDER_ID) {
    contra(`run-manifest.json externalProviderId '${seed.externalProviderId}' is not pinned`);
  }
  if (seed.promptVersion !== MODEL_PROMPT_VERSION) {
    contra(`run-manifest.json promptVersion '${seed.promptVersion}' is not pinned`);
  }
  if (ledger.scenario.id !== scenarioId) {
    contra(`ledger scenario '${ledger.scenario.id}' != manifest scenario '${scenarioId}'`);
  }

  for (const row of traceRows) {
    if (row.runId !== runId)
      contra(`trace row ${row.requestId} runId '${row.runId}' != '${runId}'`);
    if (row.scenarioId !== scenarioId) {
      contra(`trace row ${row.requestId} scenarioId '${row.scenarioId}' != '${scenarioId}'`);
    }
    if (row.providerId !== seed.externalProviderId) {
      contra(`trace row ${row.requestId} providerId '${row.providerId}' is not the run's provider`);
    }
    if (row.promptVersion !== seed.promptVersion) {
      contra(`trace row ${row.requestId} promptVersion '${row.promptVersion}' != seed`);
    }
  }

  if (bundle !== null) {
    const handoff = bundle.handoff;
    if (handoff.runId !== runId) contra(`handoff runId '${handoff.runId}' != '${runId}'`);
    if (handoff.scenarioId !== scenarioId) {
      contra(`handoff scenarioId '${handoff.scenarioId}' != '${scenarioId}'`);
    }
    if (handoff.experimentId !== MODEL_EXPERIMENT_ID) {
      contra(`handoff experimentId '${handoff.experimentId}' is not pinned`);
    }
    if (handoff.experimentVersion !== MODEL_EXPERIMENT_VERSION) {
      contra(`handoff experimentVersion '${handoff.experimentVersion}' is not pinned`);
    }
    if (handoff.conditionId !== MODEL_CONDITION_ID) {
      contra(`handoff conditionId '${handoff.conditionId}' is not pinned`);
    }
    if (handoff.providerId !== EXTERNAL_MARA_PROVIDER_ID) {
      contra(`handoff providerId '${handoff.providerId}' is not pinned`);
    }
    if (handoff.promptVersion !== MODEL_PROMPT_VERSION) {
      contra(`handoff promptVersion '${handoff.promptVersion}' is not pinned`);
    }
    if (handoff.worldStateHash !== null && handoff.worldStateHash !== ledger.worldStateHash) {
      contra(
        `ledger worldStateHash '${ledger.worldStateHash}' != handoff '${handoff.worldStateHash}'`,
      );
    }
    if (
      handoff.canonicalLedgerHash !== null &&
      handoff.canonicalLedgerHash !== ledger.canonicalLedgerHash
    ) {
      contra(
        `ledger canonicalLedgerHash '${ledger.canonicalLedgerHash}' != handoff '${handoff.canonicalLedgerHash}'`,
      );
    }
  }

  const ledgerIndex = indexLedger(ledger, seed.externalProviderId);

  // F11: ledgers carry no runId, so trace<->ledger requestId overlap is the
  // only signal that the staged ledger matches this run's gateway activity.
  if (traceRows.length > 0 && !traceRows.some((row) => ledgerIndex.requested.has(row.requestId))) {
    notes.push(
      'gateway trace and ledger share zero requestIds — the ledger records no external-provider requests matching the gateway trace; verify the staged ledger belongs to this run',
    );
  }

  // Per-request context-hash chain: trace row == sidecar == recomputed.
  for (const [requestId, envelope] of sidecars) {
    if (envelope.runId !== runId) {
      contra(`sidecar ${requestId} runId '${envelope.runId}' != '${runId}'`);
    }
    if (envelope.request.scenarioId !== scenarioId) {
      contra(`sidecar ${requestId} scenarioId '${envelope.request.scenarioId}' != '${scenarioId}'`);
    }
    const recomputed = externalContextHash(envelope.context);
    if (recomputed !== envelope.contextHash) {
      contra(
        `sidecar ${requestId} contextHash '${envelope.contextHash}' does not recompute (got '${recomputed}')`,
      );
    }
  }
  const traceRowsByRequest = new Map<string, ModelTraceEntry[]>();
  for (const row of traceRows) {
    const rows = traceRowsByRequest.get(row.requestId) ?? [];
    rows.push(row);
    traceRowsByRequest.set(row.requestId, rows);
    const sidecar = sidecars.get(row.requestId);
    if (sidecar && row.contextHash !== sidecar.contextHash) {
      contra(
        `trace row ${row.requestId} contextHash '${row.contextHash}' != sidecar '${sidecar.contextHash}'`,
      );
    }
  }

  // Client entries: entries for THIS run must reference known requests and
  // agree on identity; entries keyed to another runId are the recorder's
  // stale-discard diagnostics and join nothing here.
  const clientEntries: ClientTraceEntry[] = bundle?.clientTrace ?? [];
  const clientByRequest = new Map<string, ClientTraceEntry>();
  let staleClientEntries = 0;
  for (const entry of clientEntries) {
    if (entry.runId !== runId) {
      staleClientEntries += 1;
      if (entry.clientOutcome !== 'discarded-stale-run') {
        contra(
          `client entry ${entry.requestId} carries foreign runId '${entry.runId}' with outcome '${entry.clientOutcome}'`,
        );
      }
      continue;
    }
    const known =
      ledgerIndex.requested.has(entry.requestId) ||
      traceRowsByRequest.has(entry.requestId) ||
      sidecars.has(entry.requestId);
    if (!known) {
      contra(`client entry ${entry.requestId} references a request unknown to ledger and gateway`);
      continue;
    }
    if (entry.scenarioId !== scenarioId) {
      contra(`client entry ${entry.requestId} scenarioId '${entry.scenarioId}' != '${scenarioId}'`);
    }
    const requested = ledgerIndex.requested.get(entry.requestId);
    if (
      requested &&
      (entry.npcId !== requested.npcId || entry.providerId !== requested.providerId)
    ) {
      contra(`client entry ${entry.requestId} npcId/providerId disagree with the ledger request`);
    }
    const row = traceRowsByRequest.get(entry.requestId)?.[0];
    if (row && (entry.npcId !== row.npcId || entry.providerId !== row.providerId)) {
      contra(`client entry ${entry.requestId} npcId/providerId disagree with the gateway trace`);
    }
    clientByRequest.set(entry.requestId, entry);
  }
  if (staleClientEntries > 0) {
    notes.push(`${staleClientEntries} stale-run client entr(y/ies) excluded from the join`);
  }
  // F1 defense in depth: the export button can only snapshot what the client
  // has recorded; a trace shorter than the engine's demand suggests the
  // bundle was exported while tail requests were still in flight.
  if (clientPresent && clientByRequest.size < ledgerIndex.requested.size) {
    notes.push(
      `client trace covers ${clientByRequest.size} of ${ledgerIndex.requested.size} engine-emitted requests — bundle may have been exported before the client settled`,
    );
  }

  if (contradictions.length > 0) {
    throw new Error(
      `finalize: ${contradictions.length} contradiction(s):\n- ${contradictions.join('\n- ')}`,
    );
  }

  // ---- 3. Join per requestId ---------------------------------------------
  const requestIds = [
    ...new Set([...clientByRequest.keys(), ...traceRowsByRequest.keys(), ...sidecars.keys()]),
  ].sort();

  const finalizedRows: FinalizedTraceEntry[] = [];
  const unexplained: string[] = [];
  for (const requestId of requestIds) {
    const rows = traceRowsByRequest.get(requestId) ?? [];
    if (rows.length > 1) {
      notes.push(`request ${requestId} has ${rows.length} gateway trace rows; joined the last`);
    }
    const row = rows.length > 0 ? rows[rows.length - 1]! : null;
    const sidecar = sidecars.get(requestId) ?? null;
    const client = clientByRequest.get(requestId) ?? null;

    const gwResponseId = row !== null ? traceRowResponseId(row) : `gw-${requestId}`;
    const received = ledgerIndex.receivedByResponseId.get(gwResponseId) ?? null;
    const failed = ledgerIndex.providerFailedByRequestId.get(requestId) ?? null;
    const submission = received ?? failed;
    const rejection = ledgerIndex.rejectedByResponseId.get(gwResponseId) ?? null;
    // null engineOutcome == unresolved: the result never produced an engine
    // lifecycle event.
    const engineOutcome: FinalizedTraceEntry['engineOutcome'] = ledgerIndex.acceptedResponseIds.has(
      gwResponseId,
    )
      ? 'accepted'
      : rejection !== null
        ? 'rejected'
        : ledgerIndex.expiredRequestIds.has(requestId)
          ? 'expired'
          : null;

    if (row?.gatewayOutcome === 'response' && engineOutcome === null) {
      const explained =
        client !== null &&
        (client.clientOutcome === 'discarded-stale-run' || client.clientOutcome === 'failure');
      if (!explained) unexplained.push(requestId);
    }

    finalizedRows.push(
      finalizedTraceEntrySchema.parse({
        finalizedTraceSchemaVersion: FINALIZED_TRACE_SCHEMA_VERSION,
        runId,
        requestId,
        npcId: row?.npcId ?? sidecar?.request.npcId ?? client?.npcId ?? null,
        scenarioId,
        conditionId: sidecar?.conditionId ?? client?.conditionId ?? seed.conditionId,
        providerId: row?.providerId ?? sidecar?.providerId ?? client?.providerId ?? null,
        promptVersion: row?.promptVersion ?? sidecar?.promptVersion ?? seed.promptVersion,
        modelId: row?.modelId ?? null,
        requestedAtLogicalTick:
          row?.logicalRequestedTick ??
          sidecar?.request.requestedAtTick ??
          client?.requestedAtTick ??
          ledgerIndex.requested.get(requestId)?.tick ??
          null,
        logicalSubmittedTick: submission?.tick ?? null,
        requestEnvelopeFile: sidecar !== null ? `requests/${requestId}.json` : null,
        contextHash: row?.contextHash ?? sidecar?.contextHash ?? client?.contextHash ?? null,
        truncationCounts: row?.truncationCounts ?? sidecar?.truncationCounts ?? {},
        responseId:
          row !== null
            ? row.gatewayOutcome === 'response'
              ? traceRowResponseId(row)
              : null
            : (client?.responseId ?? null),
        failureId:
          row !== null
            ? row.gatewayOutcome !== 'response'
              ? traceRowFailureId(row)
              : null
            : (client?.failureId ?? null),
        selectedAffordanceId: row?.selectedAffordanceId ?? null,
        reasonCode: row?.reasonCode ?? null,
        confidenceBp: row?.confidenceBp ?? null,
        rationale: row?.rationale ?? null,
        tokens: {
          inputTokens: row?.inputTokens ?? null,
          outputTokens: row?.outputTokens ?? null,
          totalTokens: row?.totalTokens ?? null,
        },
        clientLatencyMs: client?.clientLatencyMs ?? null,
        gatewayLatencyMs: row?.latencyMs ?? null,
        clientOutcome: client?.clientOutcome ?? null,
        gatewayOutcome: row?.gatewayOutcome ?? null,
        engineOutcome,
        engineRejectionReason: rejection,
        engineResolutionEventId: submission?.eventId ?? null,
      }),
    );
  }

  if (unexplained.length > 0) {
    if (clientPresent) {
      throw new Error(
        `finalize: unresolved gateway response row(s) with no engine event and no client explanation: ${unexplained.join(', ')}`,
      );
    }
    notes.push(
      `unresolved gateway response row(s) ${unexplained.join(', ')} — no client trace to explain them`,
    );
  }
  // F6: reconcile client/ledger evidence of gateway RESULTS against the
  // trace rows actually present. Only POSITIVE evidence counts — a
  // gateway-minted response/failure id seen by the client (the client mints
  // its own `cf-` ids for requests that never dispatched, which prove
  // nothing about the gateway), or the ledger holding engine lifecycle
  // events for the gateway's `gw-` response id. A request with such
  // evidence and no trace row means the trace file is truncated or
  // mis-staged, and the manifest must not advertise a complete gateway
  // source.
  const missingTraceRows = requestIds.filter((requestId) => {
    if (traceRowsByRequest.has(requestId)) return false;
    const client = clientByRequest.get(requestId) ?? null;
    const clientSawResult =
      client !== null &&
      (client.responseId !== null ||
        (client.failureId !== null && !client.failureId.startsWith('cf-')));
    const ledgerSawResult =
      ledgerIndex.acceptedResponseIds.has(`gw-${requestId}`) ||
      ledgerIndex.receivedByResponseId.has(`gw-${requestId}`) ||
      ledgerIndex.rejectedByResponseId.has(`gw-${requestId}`);
    return clientSawResult || ledgerSawResult;
  });
  if (missingTraceRows.length > 0) {
    notes.push(
      `${missingTraceRows.length} request(s) have engine/client evidence of a gateway result with no gateway trace row — gateway trace incomplete (e.g. ${missingTraceRows.slice(0, 3).join(', ')})`,
    );
  }
  for (const requestId of requestIds) {
    if (!sidecars.has(requestId) && traceRowsByRequest.has(requestId)) {
      notes.push(`request ${requestId} has no envelope sidecar`);
    }
  }

  // ---- 4. Write outputs ---------------------------------------------------
  // Deviation D1: the finalized join gets its OWN file. Never overwrite the
  // raw gateway trace with a derived artifact.
  writeFileSync(
    join(dir, 'finalized-trace.jsonl'),
    finalizedRows.map((row) => JSON.stringify(row)).join('\n') +
      (finalizedRows.length > 0 ? '\n' : ''),
    'utf8',
  );

  const infra = computeInfraMetrics(traceRows);
  const lifecycle = engineLifecycle(ledger);
  const completeness = {
    sources: [
      // A gateway trace with proven missing rows is not a complete source
      // (F6): the note above says why it was dropped.
      ...(gatewayPresent && missingTraceRows.length === 0 ? ['gateway'] : []),
      'ledger',
      ...(clientPresent ? ['client'] : []),
    ],
    notes,
  };
  const finalManifest = finalManifestSchema.parse({
    manifestFinalSchemaVersion: FINAL_MANIFEST_SCHEMA_VERSION,
    status: 'completed',
    experimentId: seed.experimentId,
    experimentVersion: seed.experimentVersion,
    conditionId: seed.conditionId,
    runId,
    scenarioId,
    scenarioVersion: ledger.scenario.version,
    seed: ledger.scenario.seed,
    configVersion: ledger.scenario.configVersion,
    providerPlanId: seed.providerPlanId,
    externalProviderId: seed.externalProviderId,
    promptVersion: seed.promptVersion,
    requestedModelId: seed.modelId,
    returnedModelIds: [
      ...new Set(traceRows.map((r) => r.modelId).filter((m): m is string => m !== null)),
    ].sort(),
    modelSettings: seed.modelSettings,
    startedAtUtc: seed.startedAtUtc,
    finalizedAtUtc: new Date().toISOString(),
    worldStateHash: ledger.worldStateHash,
    canonicalLedgerHash: ledger.canonicalLedgerHash,
    externalRequestsEmitted: clientPresent ? clientByRequest.size : traceRowsByRequest.size,
    upstreamCallsAttempted: infra.upstreamCallsAttempted,
    callsCompleted: infra.callsCompleted,
    callsFailedByCategory: infra.callsFailedByCategory,
    acceptedModelResponses: lifecycle.acceptedModelResponses,
    engineRejectionsByReason: lifecycle.rejectionsByReason,
    inputTokens: infra.inputTokens,
    outputTokens: infra.outputTokens,
    totalTokens: infra.totalTokens,
    completeness,
  });
  // The gateway's seed run-manifest.json is write-once and never mutated;
  // all finalized facts land in this separate file.
  writeFileSync(
    join(dir, 'run-manifest.final.json'),
    JSON.stringify(finalManifest, null, 2),
    'utf8',
  );

  const summary = buildModelSummary(dir, runId);
  if (clientPresent) {
    // §10.1 client/engine demand: distinguish what the ENGINE emitted, what
    // the CLIENT saw and dispatched, and what died before dispatch — these
    // are not derivable from gateway trace length.
    const entriesForRun = [...clientByRequest.values()];
    const beforeDispatch = entriesForRun.filter((e) => e.dispatchedAtUtc === null);
    const byCode: Record<string, number> = {};
    for (const entry of beforeDispatch) {
      const code = entry.clientFailureCode ?? 'unknown';
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
    summary.clientDemand = {
      externalRequestsEmittedByEngine: ledgerIndex.requested.size,
      requestsSeenByClient: entriesForRun.length,
      requestsDispatchedToGateway: entriesForRun.length - beforeDispatch.length,
      requestsFailedBeforeDispatch: beforeDispatch.length,
      requestsFailedBeforeDispatchByCode: byCode,
    };
  }
  writeFileSync(join(dir, 'model-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // Bundle manifest LAST: it covers every file in the directory except
  // itself, plus the aggregate hash over the sorted `<name>:<sha256>` lines.
  const files = walkFiles(dir)
    .filter((name) => name !== 'bundle-manifest.json')
    .sort()
    .map((name) => ({ name, sha256: sha256OfFile(join(dir, name))! }));
  const bundleManifest = {
    // Producer discriminator (F4/F7/F16): distinguishes this whole-directory
    // evidence binding from model:summarize's informal 4-file manifest,
    // which shares the filename. Additive top-level keys only — the manifest
    // excludes itself from `files`, so the aggregate is unaffected.
    bundleManifestSchemaVersion: 1,
    producer: 'model:finalize',
    runId,
    files,
    aggregateSha256: aggregateSha256(files),
  };
  writeFileSync(join(dir, 'bundle-manifest.json'), JSON.stringify(bundleManifest, null, 2), 'utf8');

  return { runId, joinedRequests: finalizedRows.length, completeness };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('finalize.ts') ?? false;
if (invokedDirectly) {
  const runId = arg('--run-id');
  if (!runId) {
    console.error('usage: npm run model:finalize -- --run-id <runId>');
    process.exit(1);
  }
  const traceDir = arg('--trace-dir') ?? 'artifacts/model-runs';
  const dir = join(process.cwd(), traceDir, runId);
  if (!existsSync(dir)) {
    console.error(`model-finalize: run directory not found: ${dir}`);
    process.exit(1);
  }
  try {
    const result = finalizeRunDirectory(dir, runId);
    console.log(
      `model-finalize: ${runId} — ${result.joinedRequests} request(s) joined; sources: ${result.completeness.sources.join('+')}; ${result.completeness.notes.length} note(s)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
