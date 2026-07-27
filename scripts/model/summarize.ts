import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeInfraMetrics } from '../../gateway/metrics/runMetrics';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import { EXTERNAL_MARA_PROVIDER_ID } from '../../src/shared/modelExperiment';
import {
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  bundleManifestSchema,
} from '../../src/shared/modelArtifacts';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import {
  buildMaraPersistenceStats,
  buildNpcStats,
  buildTreatmentOutcome,
} from '../../src/sim/reporting';

/**
 * Model-run summarizer (milestone 001, sections 17 and 21).
 *
 *   npm run model:summarize -- --run-id <runId>
 *
 * Reads artifacts/model-runs/<runId>/ (the gateway's model-trace.jsonl and
 * run-manifest.json, plus the exported canonical ledger file the operator
 * placed there) and writes:
 *   model-summary.json    — infrastructure + engine lifecycle + behavior
 *   bundle-manifest.json  — sha256 hashes binding ledger + trace + manifest
 *
 * The bundle hash is research metadata, never canonical world state.
 */

export interface EngineLifecycle {
  acceptedResponses: number;
  acceptedModelResponses: number;
  rejectionsByReason: Record<string, number>;
  expiredRequests: number;
  externalFailureExpiries: number;
  supersededRequests: number;
  providerFailuresByCode: Record<string, number>;
  provisionalFallbacks: number;
  ordinaryFallbacks: number;
}

export function engineLifecycle(file: LedgerFile): EngineLifecycle {
  const lifecycle: EngineLifecycle = {
    acceptedResponses: 0,
    acceptedModelResponses: 0,
    rejectionsByReason: {},
    expiredRequests: 0,
    externalFailureExpiries: 0,
    supersededRequests: 0,
    providerFailuresByCode: {},
    provisionalFallbacks: 0,
    ordinaryFallbacks: 0,
  };
  for (const event of file.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'DecisionResponseAccepted') {
      lifecycle.acceptedResponses += 1;
      if (String(payload.responseId).startsWith('gw-')) lifecycle.acceptedModelResponses += 1;
    } else if (event.type === 'DecisionResponseRejected') {
      const reason = String(payload.rejectionReason);
      lifecycle.rejectionsByReason[reason] = (lifecycle.rejectionsByReason[reason] ?? 0) + 1;
    } else if (event.type === 'DecisionRequestExpired') {
      lifecycle.expiredRequests += 1;
      if (payload.reasonCode === 'external-failure') lifecycle.externalFailureExpiries += 1;
    } else if (event.type === 'DecisionRequestSuperseded') {
      lifecycle.supersededRequests += 1;
    } else if (event.type === 'DecisionProviderFailed') {
      const code = String(payload.errorCode);
      lifecycle.providerFailuresByCode[code] = (lifecycle.providerFailuresByCode[code] ?? 0) + 1;
    } else if (event.type === 'FallbackDecisionUsed') {
      if (String(payload.reasonCode).startsWith('provisional:')) {
        lifecycle.provisionalFallbacks += 1;
      } else {
        lifecycle.ordinaryFallbacks += 1;
      }
    }
  }
  return lifecycle;
}

/** The CLOSED engine-resolution vocabulary shared by the two hash-bound
 * artifacts of a finalized run — finalized-trace.jsonl and model-summary.json.
 * 'superseded' is a canonical request resolution (A1); 'rejected' is a
 * per-RESPONSE verdict. A raw ledger reasonCode ('scenario-ended',
 * 'external-failure') is NEVER a member: it is the reason an expiry happened,
 * not the engine's verdict. */
export type EngineOutcome = 'accepted' | 'rejected' | 'expired' | 'superseded';

/** The minimal ledger view the resolution ladder needs. scripts/model/
 * finalize.ts's richer LedgerIndex satisfies it structurally, so BOTH
 * producers run the identical ladder over their own single ledger parse. */
export interface EngineResolutionIndex {
  acceptedResponseIds: ReadonlySet<string>;
  rejectedByResponseId: ReadonlyMap<string, string>;
  expiredRequestIds: ReadonlySet<string>;
  supersededRequestIds: ReadonlySet<string>;
}

export interface LedgerResolutionIndex extends EngineResolutionIndex {
  acceptedResponseIds: Set<string>;
  rejectedByResponseId: Map<string, string>;
  expiredRequestIds: Set<string>;
  supersededRequestIds: Set<string>;
  /** DecisionRequestExpired reasonCode per request — diagnostics only, kept
   * strictly OUT of engineOutcome. */
  expiryReasonByRequest: Map<string, string>;
}

export function indexEngineResolutions(file: LedgerFile): LedgerResolutionIndex {
  const index: LedgerResolutionIndex = {
    acceptedResponseIds: new Set(),
    rejectedByResponseId: new Map(),
    expiredRequestIds: new Set(),
    supersededRequestIds: new Set(),
    expiryReasonByRequest: new Map(),
  };
  for (const event of file.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'DecisionResponseAccepted') {
      index.acceptedResponseIds.add(String(payload.responseId));
    } else if (event.type === 'DecisionResponseRejected') {
      index.rejectedByResponseId.set(String(payload.responseId), String(payload.rejectionReason));
    } else if (event.type === 'DecisionRequestExpired') {
      index.expiredRequestIds.add(String(payload.requestId));
      index.expiryReasonByRequest.set(String(payload.requestId), String(payload.reasonCode));
    } else if (event.type === 'DecisionRequestSuperseded') {
      index.supersededRequestIds.add(String(payload.requestId));
    }
  }
  return index;
}

/** The ONE resolution ladder (V5's "one shared helper" rule applied to
 * outcomes): response-level verdicts first (a late answer to a superseded
 * request joins as 'rejected' with reason 'superseded-request'), then the
 * canonical request resolutions. null means the ledger holds no resolution
 * for this request at all. */
export function resolveEngineOutcome(
  index: EngineResolutionIndex,
  requestId: string,
  responseId: string,
): { engineOutcome: EngineOutcome | null; engineRejectionReason: string | null } {
  const engineRejectionReason = index.rejectedByResponseId.get(responseId) ?? null;
  const engineOutcome: EngineOutcome | null = index.acceptedResponseIds.has(responseId)
    ? 'accepted'
    : engineRejectionReason !== null
      ? 'rejected'
      : index.expiredRequestIds.has(requestId)
        ? 'expired'
        : index.supersededRequestIds.has(requestId)
          ? 'superseded'
          : null;
  return { engineOutcome, engineRejectionReason };
}

export interface JoinedOutcome {
  requestId: string;
  gatewayOutcome: string;
  /** Closed vocabulary + 'unresolved' for "no ledger resolution at all" —
   * the summary's spelling of the finalized row's null. */
  engineOutcome: EngineOutcome | 'unresolved';
  engineRejectionReason: string | null;
  /** Expiry reasonCode when the request expired, else null (diagnostic). */
  engineExpiryReason: string | null;
}

/** The gateway-minted response ID for a trace row: v2 rows carry it
 * explicitly; older rows fall back to the documented `gw-<requestId>`
 * convention (re-audit remediation S2 — prefer the recorded id). */
export function traceRowResponseId(entry: ModelTraceEntry): string {
  const v2 = (entry as { responseId?: string | null }).responseId;
  return v2 ?? `gw-${entry.requestId}`;
}

/** Joins each trace entry to the engine verdict recorded in the ledger.
 * Acceptance is matched on the model RESPONSE id (the same gw- filter
 * engineLifecycle uses), never on the bare requestId, so a non-model
 * acceptance for the same requestId can never mark a model call accepted
 * (re-audit remediation S2).
 *
 * The verdict comes from the SHARED ladder (resolveEngineOutcome), which
 * model:finalize also uses for finalized-trace.jsonl: model-summary.json and
 * finalized-trace.jsonl are hash-bound into the same bundle manifest and must
 * never disagree per requestId. Before 1.5.0 this join had its own ladder,
 * which knew nothing of A1's 'superseded' (reported as 'unresolved') and put
 * the raw expiry reasonCode in engineOutcome. */
export function joinEngineOutcomes(
  file: LedgerFile | null,
  trace: readonly ModelTraceEntry[],
): JoinedOutcome[] {
  if (!file) return [];
  const index = indexEngineResolutions(file);
  return trace.map((entry) => {
    const { engineOutcome, engineRejectionReason } = resolveEngineOutcome(
      index,
      entry.requestId,
      traceRowResponseId(entry),
    );
    return {
      requestId: entry.requestId,
      gatewayOutcome: entry.gatewayOutcome,
      engineOutcome: engineOutcome ?? 'unresolved',
      engineRejectionReason,
      engineExpiryReason: index.expiryReasonByRequest.get(entry.requestId) ?? null,
    };
  });
}

/** Distinct non-null model IDs actually reported by the trace rows — the
 * seed manifest's single modelId is what was REQUESTED, not proof of what
 * answered (re-audit remediation S2). */
export function returnedModelIds(trace: readonly ModelTraceEntry[]): string[] {
  return [...new Set(trace.map((e) => e.modelId).filter((m): m is string => m !== null))].sort();
}

/** Aggregate bundle hash: sha256 over the sorted `<fileName>:<sha256>`
 * lines, one per covered file (re-audit remediation S2). */
export function aggregateSha256(files: ReadonlyArray<{ name: string; sha256: string }>): string {
  const lines = files.map((f) => `${f.name}:${f.sha256}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function sha256OfFile(path: string): string | null {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

export function loadTraceEntries(dir: string): ModelTraceEntry[] {
  const tracePath = join(dir, 'model-trace.jsonl');
  return existsSync(tracePath)
    ? readFileSync(tracePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as ModelTraceEntry)
    : [];
}

/** Ledger selection shared by BOTH CLIs (1.5.0 V1): the UNIQUE ledger-*.json
 * in the directory, or null when none exists. Two or more candidates is a
 * hard error — NEVER first-match (the old `readdirSync(...).find(...)` could
 * silently bind to a different ledger than the one that was validated). */
export function selectLedgerName(dir: string): string | null {
  const candidates = readdirSync(dir).filter((f) => f.startsWith('ledger-') && f.endsWith('.json'));
  if (candidates.length > 1) {
    throw new Error(
      `${candidates.length} ledger files found (${candidates.join(', ')}) — ambiguous; remove the extra ledger-*.json from the run directory`,
    );
  }
  return candidates[0] ?? null;
}

/** Builds the model-summary object without writing it (shared with the
 * formal finalizer, which augments it before writing).
 *
 * 1.5.0 V1: callers that already hold a parsed (and, for the finalizer,
 * fully VALIDATED) ledger pass it as `ledgerFile` — the summary must never
 * re-read the ledger from disk behind a validated caller's back. When the
 * parameter is omitted (standalone use) the ledger is selected with the same
 * unique-match rule, never first-match. */
export function buildModelSummary(
  dir: string,
  runId: string,
  ledgerFile?: LedgerFile | null,
): Record<string, unknown> {
  const entries = loadTraceEntries(dir);

  let ledger: LedgerFile | null;
  if (ledgerFile !== undefined) {
    ledger = ledgerFile;
  } else {
    const ledgerFileName = selectLedgerName(dir);
    ledger = ledgerFileName
      ? (JSON.parse(readFileSync(join(dir, ledgerFileName), 'utf8')) as LedgerFile)
      : null;
  }

  // §21/§26 derived rates: model calls per genuine Mara decision opportunity
  // and per simulated NPC-hour (one model-backed NPC; 1 tick == 1 second).
  const infra = computeInfraMetrics(entries);
  const manifestPath = join(dir, 'run-manifest.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        externalProviderId?: string;
        modelId?: string | null;
      })
    : null;
  const externalProviderId = manifest?.externalProviderId ?? EXTERNAL_MARA_PROVIDER_ID;
  const maraOpportunities = ledger
    ? ledger.events.filter(
        (e) =>
          e.type === 'DecisionRequested' &&
          (e.payload as { providerId: string }).providerId === externalProviderId,
      ).length
    : null;
  const finalTick = ledger?.finalSummary.tick ?? null;
  const derived = {
    maraDecisionOpportunities: maraOpportunities,
    callsPerMaraDecisionOpportunity:
      maraOpportunities !== null && maraOpportunities > 0
        ? infra.upstreamCallsAttempted / maraOpportunities
        : null,
    modelCallsPerSimulatedNpcHour:
      finalTick !== null && finalTick > 0
        ? infra.upstreamCallsAttempted / (finalTick / 3_600)
        : null,
  };

  const summary: Record<string, unknown> = {
    runId,
    requestedModelId: manifest?.modelId ?? null,
    returnedModelIds: returnedModelIds(entries),
    infra,
    derived,
    engine: ledger ? engineLifecycle(ledger) : null,
    behavior: ledger
      ? {
          finalSummary: ledger.finalSummary,
          worldStateHash: ledger.worldStateHash,
          canonicalLedgerHash: ledger.canonicalLedgerHash,
          treatmentOutcome: buildTreatmentOutcome(ledger.events),
          maraPersistence: buildMaraPersistenceStats(ledger.events),
          npcStats: buildNpcStats(ledger.events),
        }
      : null,
    outcomes: joinEngineOutcomes(ledger, entries),
  };
  return summary;
}

export function summarizeRunDirectory(dir: string, runId: string): { traceEntries: number } {
  // Re-audit F4/F7/F16: after model:finalize, model-summary.json and
  // bundle-manifest.json are the formal, hash-bound evidence binding for the
  // whole directory — the informal summarizer must never clobber them (same
  // rule as deviation D1: never overwrite delivered evidence with a
  // narrower derived file).
  if (existsSync(join(dir, 'run-manifest.final.json'))) {
    throw new Error(
      `model-summarize: ${dir} is already finalized (run-manifest.final.json present); ` +
        'model-summary.json and bundle-manifest.json are owned by model:finalize — ' +
        're-run `npm run model:finalize` instead',
    );
  }
  const entries = loadTraceEntries(dir);
  // One selection, one parse (1.5.0 V1): the summary and the file-hash block
  // below must describe the SAME ledger file — never two independent reads.
  const ledgerFileName = selectLedgerName(dir);
  const ledger: LedgerFile | null = ledgerFileName
    ? (JSON.parse(readFileSync(join(dir, ledgerFileName), 'utf8')) as LedgerFile)
    : null;
  const summary = buildModelSummary(dir, runId, ledger);
  writeFileSync(join(dir, 'model-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const files = {
    ledger: ledgerFileName
      ? { name: ledgerFileName, sha256: sha256OfFile(join(dir, ledgerFileName))! }
      : null,
    modelTrace: { name: 'model-trace.jsonl', sha256: sha256OfFile(join(dir, 'model-trace.jsonl')) },
    runManifest: {
      name: 'run-manifest.json',
      sha256: sha256OfFile(join(dir, 'run-manifest.json')),
    },
    modelSummary: {
      name: 'model-summary.json',
      sha256: sha256OfFile(join(dir, 'model-summary.json')),
    },
  };
  const bundle = bundleManifestSchema.parse({
    // Producer discriminator (F4/F7/F16): the informal 4-file manifest and
    // the finalizer's whole-directory manifest share a filename; the
    // discriminator makes the coverage universe self-describing.
    bundleManifestSchemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    producer: 'model:summarize',
    runId,
    files,
    aggregateSha256: aggregateSha256(
      Object.values(files).filter(
        (f): f is { name: string; sha256: string } => f !== null && f.sha256 !== null,
      ),
    ),
    // v2 `status` mirrors the FINAL manifest's verdict and is owned by
    // model:finalize; the informal summarizer (which refuses to run on a
    // finalized directory) always writes null.
    status: null,
  });
  writeFileSync(join(dir, 'bundle-manifest.json'), JSON.stringify(bundle, null, 2), 'utf8');
  return { traceEntries: entries.length };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('summarize.ts') ?? false;
if (invokedDirectly) {
  const runId = arg('--run-id');
  if (!runId) {
    console.error('usage: npm run model:summarize -- --run-id <runId>');
    process.exit(1);
  }
  const traceDir = arg('--trace-dir') ?? 'artifacts/model-runs';
  const dir = join(process.cwd(), traceDir, runId);
  if (!existsSync(dir)) {
    console.error(`model-summarize: run directory not found: ${dir}`);
    process.exit(1);
  }
  try {
    const { traceEntries } = summarizeRunDirectory(dir, runId);
    console.log(
      `model-summarize: wrote model-summary.json and bundle-manifest.json for ${runId} (${traceEntries} trace entries)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
