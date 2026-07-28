import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { z } from 'zod';
import {
  FINALIZED_TRACE_SCHEMA_VERSION,
  FINAL_MANIFEST_SCHEMA_VERSION,
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  bundleManifestSchema,
  finalManifestSchema,
  finalizedTraceEntrySchema,
  ROUTER_METADATA_MAX_CHARS,
  modelTraceEntrySchema,
  routerTraceEntrySchema,
  runBundleSchema,
  runManifestSeedSchema,
  type FinalizedTraceEntry,
  type RouterTraceEntry,
  type RunBundle,
  type RunManifestSeed,
} from '../../src/shared/modelArtifacts';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
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
  resolveEngineOutcome,
  selectLedgerName,
  sha256OfFile,
  traceRowResponseId,
} from './summarize';

/**
 * Formal run finalizer (re-audit remediation S3; strict/degraded split,
 * full ledger validation, and Windows-safe atomic commit in 1.5.0 V1-V5).
 *
 *   npm run model:finalize -- --run-id <runId> [--allow-degraded]
 *
 * Strict-loads every artifact in artifacts/model-runs/<runId>/, runs the
 * COMPLETE ledger validator (replay + hashes + lifecycle joins — V1), proves
 * the pieces describe the SAME run, joins the client trace + client
 * exact-request archive + gateway trace + engine lifecycle per requestId,
 * and writes:
 *   finalized-trace.jsonl    — one joined v2 row per requestId (NEW file;
 *                              the raw model-trace.jsonl is never
 *                              overwritten — deviation D1)
 *   run-manifest.final.json  — finalized v2 manifest (the gateway's
 *                              write-once seed run-manifest.json is never
 *                              mutated)
 *   model-summary.json       — the informal summarize output + client/engine
 *                              demand metrics when a client trace is present
 *   bundle-manifest.json     — sha256 of EVERY file in the directory plus an
 *                              aggregate hash over the sorted name:hash lines
 *
 * STRICT is the default (V3): status 'completed' is written only when every
 * strict criterion holds. A missing OPTIONAL evidence source exits nonzero
 * and writes NOTHING; `--allow-degraded` turns those absences into status
 * 'degraded' with failedCriteria populated. CONTRADICTIONS between present
 * sources (validation errors, hash or deep-equality mismatches, orphan ids,
 * a poisoned archive) are fatal in BOTH modes — degraded mode preserves
 * recoverable runs, never self-contradictory ones.
 *
 * Atomic commit (V2, Windows-measured hazards): every derived file is
 * computed first and staged in a SIBLING same-volume directory
 * (<runDir>/../.<runId>.finalize-tmp — never inside the run directory,
 * which walkFiles would sweep into the aggregate; never os.tmpdir(), where a
 * cross-volume rename silently degrades to a non-atomic copy). The commit
 * order makes interruption detectable: bundle-manifest.json is DELETED
 * first, the derived files are renamed into place (3x EPERM retry with
 * 50/100/200ms backoff — Documents trees are OneDrive/Defender territory),
 * and bundle-manifest.json is written LAST over the final bytes. A crash at
 * any point leaves no bundle manifest, the unambiguous not-finalized signal.
 */

type ClientTraceEntry = RunBundle['clientTrace'][number];
type Envelope = z.infer<typeof externalDecisionRequestEnvelopeSchema>;

export interface FinalizeOptions {
  /** Degraded archival mode (V3): absences produce status 'degraded' with
   * failedCriteria populated instead of a nonzero exit. Contradictions stay
   * fatal regardless. */
  allowDegraded?: boolean;
  /** Injectable clock for finalizedAtUtc (mirrors makeRunId injection);
   * defaults to wall clock. */
  now?: () => string;
}

export interface FinalizeResult {
  runId: string;
  status: 'completed' | 'degraded';
  joinedRequests: number;
  completeness: { sources: string[]; notes: string[] };
  failedCriteria: string[];
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
  /** Request ids resolved by a DecisionResponseAccepted (A1 resolution 1/3). */
  acceptedRequestIds: Set<string>;
  rejectedByResponseId: Map<string, string>;
  expiredRequestIds: Set<string>;
  /** A1: superseded is a first-class canonical request resolution — a
   * request whose only resolution is superseded is COMPLETE evidence. */
  supersededRequestIds: Set<string>;
}

function indexLedger(ledger: LedgerFile, externalProviderId: string): LedgerIndex {
  const index: LedgerIndex = {
    requested: new Map(),
    receivedByResponseId: new Map(),
    providerFailedByRequestId: new Map(),
    acceptedResponseIds: new Set(),
    acceptedRequestIds: new Set(),
    rejectedByResponseId: new Map(),
    expiredRequestIds: new Set(),
    supersededRequestIds: new Set(),
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
      index.acceptedRequestIds.add(String(payload.requestId));
    } else if (event.type === 'DecisionResponseRejected') {
      index.rejectedByResponseId.set(String(payload.responseId), String(payload.rejectionReason));
    } else if (event.type === 'DecisionRequestExpired') {
      index.expiredRequestIds.add(String(payload.requestId));
    } else if (event.type === 'DecisionRequestSuperseded') {
      index.supersededRequestIds.add(String(payload.requestId));
    }
  }
  return index;
}

/** A1: canonical request resolutions are accepted | expired | superseded
 * ('rejected' is a per-RESPONSE verdict, never a request resolution). */
function resolutionCount(index: LedgerIndex, requestId: string): number {
  return (
    (index.acceptedRequestIds.has(requestId) ? 1 : 0) +
    (index.expiredRequestIds.has(requestId) ? 1 : 0) +
    (index.supersededRequestIds.has(requestId) ? 1 : 0)
  );
}

/** V5: the ONE shared counters helper — the final manifest and the
 * model-summary clientDemand block both derive from this function, so the
 * two hash-bound artifacts can never disagree. `entriesForRun` must already
 * be runId-scoped (A6); null means "no client bundle". */
export interface EvidenceCounters {
  /** ENGINE-emitted external request count (ledger DecisionRequested rows
   * carrying the external provider) — never a client/gateway row count. */
  externalRequestsEmitted: number;
  requestsSeenByClient: number | null;
  /** Entries whose client parsed an HTTP result PRODUCED by the gateway
   * (A2 predicate — the explicit flag, never id-prefix sniffing). */
  requestsWithGatewayResult: number | null;
  /** dispatchedAtUtc non-null — "POST attempted", NOT gateway evidence. */
  requestsDispatchedToGateway: number | null;
}

export function computeEvidenceCounters(
  externalRequestsEmitted: number,
  entriesForRun: readonly ClientTraceEntry[] | null,
): EvidenceCounters {
  return {
    externalRequestsEmitted,
    requestsSeenByClient: entriesForRun === null ? null : entriesForRun.length,
    requestsWithGatewayResult:
      entriesForRun === null ? null : entriesForRun.filter((e) => e.gatewayResultObserved).length,
    requestsDispatchedToGateway:
      entriesForRun === null
        ? null
        : entriesForRun.filter((e) => e.dispatchedAtUtc !== null).length,
  };
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

/** Canonical compact JSON of an envelope: schema-parse (which normalizes key
 * order to the schema shape, deeply) then compact stringify. Used for the
 * client↔gateway deep-equality proof (V3) and envelopeSha256 (A3). */
function canonicalEnvelopeJson(envelope: Envelope): string {
  return JSON.stringify(externalDecisionRequestEnvelopeSchema.parse(envelope));
}

function sha256OfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ---- V2: Windows-safe commit helpers ---------------------------------------

const EPERM_BACKOFF_MS = [50, 100, 200] as const;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Runs a filesystem operation with a 3x retry on EPERM (measured Windows
 * hazard: renameSync over a destination held open by an editor, sync client,
 * or scanner fails EPERM transiently). The final failure carries an
 * actionable message instead of a raw errno stack. */
function withEpermRetry<T>(what: string, op: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return op();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM') throw error;
      if (attempt < EPERM_BACKOFF_MS.length) {
        sleepMs(EPERM_BACKOFF_MS[attempt]!);
        continue;
      }
      throw new Error(
        `finalize: ${what} kept failing with EPERM after ${EPERM_BACKOFF_MS.length} retries — ` +
          'close any program holding the file open (editor, OneDrive/antivirus scan, a running gateway) and re-run model:finalize',
      );
    }
  }
}

/** Sibling same-volume staging directory (V2): NEVER inside the run
 * directory (walkFiles would sweep it into the bundle manifest and the
 * aggregate hash) and NEVER os.tmpdir() (a cross-volume rename silently
 * degrades to a non-atomic copy under MOVEFILE_COPY_ALLOWED). */
function stagingDirFor(dir: string, runId: string): string {
  return join(dirname(dir), `.${runId}.finalize-tmp`);
}

export function finalizeRunDirectory(
  dir: string,
  runId: string,
  options: FinalizeOptions = {},
): FinalizeResult {
  const allowDegraded = options.allowDegraded ?? false;
  const now = options.now ?? (() => new Date().toISOString());
  const contradictions: string[] = [];
  const notes: string[] = [];
  /** Strict criteria that did not hold (V3): absences, never contradictions.
   * Strict mode exits nonzero listing them; --allow-degraded records them in
   * the manifest and degrades the status. */
  const failedCriteria: string[] = [];
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
  // Content-aware, not presence-based (F6, preserved from 1.4.0): the
  // gateway only ever creates this file by appending a complete row, so a
  // zero-row file is truncation or mis-staging and must never score MORE
  // complete than an absent one.
  const gatewayPresent = traceFileExists && traceRows.length > 0;
  if (!traceFileExists) {
    notes.push('model-trace.jsonl absent — gateway activity unavailable');
  } else if (traceRows.length === 0) {
    notes.push('model-trace.jsonl present but contains zero rows — gateway activity unavailable');
  }

  const bundlePath = join(dir, 'client-bundle.json');
  const clientPresent = existsSync(bundlePath);
  let bundle: RunBundle | null = null;
  if (clientPresent) {
    const rawBundle: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'));
    // A8: no legacy import path — a v1 bundle is hard-rejected, never
    // silently parsed or "degraded" into a v2 join.
    if ((rawBundle as { bundleSchemaVersion?: unknown } | null)?.bundleSchemaVersion === 1) {
      throw new Error(
        'finalize: run-bundle schema version 1 is not supported — re-export the run bundle under release 1.5.0',
      );
    }
    bundle = runBundleSchema.parse(rawBundle);
  } else {
    // Spec-mandated reversal (1.5.0 §6/V3): under STRICT mode this absence is
    // a failed criterion (recorded below), no longer a mere note; the notes
    // are kept for the --allow-degraded manifest.
    failedCriteria.push('client-bundle-present: client-bundle.json is absent');
    notes.push('client-bundle.json absent — client demand metrics unavailable (deviation D2)');
    // F11: the client handoff is the ONLY artifact that binds the copied
    // ledger to this run (ledgers carry no runId by frozen invariant).
    notes.push(
      'no client handoff: ledger-to-run binding is operator-asserted (ledgers carry no runId)',
    );
  }

  // Full ledger validation (V1): finalize re-proves the staged ledger
  // independently — never assume model:prepare-run ran or that the file was
  // untouched since. The validated LedgerFile object is threaded through
  // indexLedger / engineLifecycle / buildModelSummary below; the ledger is
  // parsed exactly once. A validation error is a CONTRADICTION-class failure:
  // fatal in both modes (degraded covers missing optional sources, never a
  // corrupt ledger).
  const ledgerFileName = selectLedgerName(dir);
  if (ledgerFileName === null) {
    throw new Error(`finalize: no ledger-*.json found in ${dir}`);
  }
  const ledgerValidation = validateLedgerFile(readFileSync(join(dir, ledgerFileName), 'utf8'));
  if (!ledgerValidation.ok || ledgerValidation.file === null) {
    const errors = ledgerValidation.issues.filter((i) => i.severity === 'error');
    const shown = errors
      .slice(0, 5)
      .map((i) => `${i.code}${i.where ? ` @ ${i.where}` : ''}`)
      .join('; ');
    throw new Error(
      `finalize: ledger '${ledgerFileName}' failed full validation with ${errors.length} error(s): ${shown}${
        errors.length > 5 ? '; …' : ''
      }`,
    );
  }
  const ledger: LedgerFile = ledgerValidation.file;

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

  // Router evidence (1.6.0). These sidecars exist only on pinned-route runs,
  // but walkFiles hashes whatever is present into bundle-manifest.json — so a
  // present sidecar IS formal evidence and gets the same strict-validate and
  // orphan treatment as the requests/ archive. Before 1.6.0 this directory was
  // write-only: recursively hashed, never read, never validated, never
  // cross-checked against the provider the experiment claims to have pinned.
  //
  // safeParse + contra rather than a throwing parse (the requests/ pattern
  // above) so a batch of bad sidecars is reported at once instead of only the
  // first; the severity is identical, since contradictions are fatal in BOTH
  // modes.
  const routingDir = join(dir, 'routing');
  const routerEntries = new Map<string, RouterTraceEntry>();
  if (existsSync(routingDir)) {
    for (const file of readdirSync(routingDir).filter((f) => f.endsWith('.json'))) {
      const rawSidecar: unknown = JSON.parse(readFileSync(join(routingDir, file), 'utf8'));
      // Bound the RAW parsed metadata, before zod sees it. The schema's own
      // refine measures zod's rebuilt record, which silently drops keys such
      // as `__proto__` — so a hand-edited sidecar can carry unbounded bytes
      // past the schema while measuring as tiny (measured: a 60,197-byte file
      // whose metadata refine saw 17 chars). This is the artifact-integrity
      // bound, so it must measure the artifact.
      const rawMetadata = (rawSidecar as { metadata?: unknown } | null)?.metadata;
      const routingMetadataChars =
        rawMetadata === null || rawMetadata === undefined ? 0 : JSON.stringify(rawMetadata).length;
      if (routingMetadataChars > ROUTER_METADATA_MAX_CHARS) {
        contra(
          `routing sidecar '${file}' metadata is ${routingMetadataChars} chars, past the ` +
            `${ROUTER_METADATA_MAX_CHARS}-char bound`,
        );
        continue;
      }
      const parsed = routerTraceEntrySchema.safeParse(rawSidecar);
      if (!parsed.success) {
        contra(
          `routing sidecar '${file}' failed validation: ${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || '<root>'} ${issue.message}`)
            .join('; ')}`,
        );
        continue;
      }
      const entry = parsed.data;
      if (file !== `${entry.requestId}.json`) {
        contra(`routing sidecar '${file}' names request '${entry.requestId}'`);
      }
      if (entry.runId !== runId) {
        contra(`routing sidecar '${file}' carries runId '${entry.runId}' != '${runId}'`);
      }
      routerEntries.set(entry.requestId, entry);
    }
  }

  // ---- 2. Consistency (contradiction -> nonzero in BOTH modes) -----------
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

  const ledgerIndex = indexLedger(ledger, seed.externalProviderId);

  /** POSITIVE proof, from the FULLY VALIDATED ledger, that the gateway
   * produced a result for this request: the engine only ever sees a
   * `gw-<requestId>` response id because the client posted a gateway-minted
   * result for it. Used for (a) the V3 "every adapter invocation has one
   * trace row" criterion, (b) keeping a demonstrably answered request out of
   * the moot carve-out, and (c) the completeness note — ONE predicate, so
   * the three can never drift apart. */
  const ledgerProvenGatewayResult = (requestId: string): boolean =>
    ledgerIndex.acceptedResponseIds.has(`gw-${requestId}`) ||
    ledgerIndex.receivedByResponseId.has(`gw-${requestId}`) ||
    ledgerIndex.rejectedByResponseId.has(`gw-${requestId}`);

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
    // Orphan fatality (V3): every gateway artifact must name a request the
    // ENGINE actually emitted — fatal in both modes.
    if (!ledgerIndex.requested.has(row.requestId)) {
      contra(
        `trace row ${row.requestId} is an orphan: no external DecisionRequested in the ledger`,
      );
    }
  }

  /** Pinned-route run (1.6.0): the seed records the RESOLVED adapter, so this
   * is read off the manifest rather than assumed from the provider id. */
  const pinnedRouteRun = seed.modelSettings.adapterKind === 'openrouter';
  const pinnedProvider =
    typeof seed.modelSettings.openRouterProvider === 'string'
      ? seed.modelSettings.openRouterProvider
      : null;

  /** The pinned provider and the reported provider live in two different
   * naming namespaces: the config pins the ROUTING SLUG the gateway puts in
   * `provider.only` ('anthropic', 'amazon-bedrock') while the router reports a
   * DISPLAY NAME ('Anthropic', 'Amazon Bedrock'). They diverge on case AND on
   * word separators, so folding case alone is not enough — 'amazon-bedrock'
   * vs 'Amazon Bedrock' would read as a substitution on a perfectly pinned
   * run. Normalizing both sides to alphanumerics compares the only part of
   * the two namespaces that is actually shared. */
  const normalizeProviderName = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Pinned-route enforcement (1.6.0). The experiment's premise is one exact
  // model, one exact provider, no fallbacks. All three were CAPTURED by the
  // OpenRouter integration and enforced nowhere: the final manifest recorded
  // requestedModelId and returnedModelIds side by side without ever comparing
  // them, and the provider that actually served each call existed only inside
  // routing sidecars this finalizer did not read. Silent substitution is
  // precisely what pinning exists to prevent, so it must not be able to reach
  // a `completed` manifest.
  const providerMismatches: string[] = [];
  for (const [requestId, entry] of routerEntries) {
    // Orphan fatality, the same rule trace rows get: router evidence naming a
    // request the engine never emitted is unexplainable, not merely extra.
    if (!ledgerIndex.requested.has(requestId)) {
      contra(
        `routing sidecar ${requestId} is an orphan: no external DecisionRequested in the ledger`,
      );
      continue;
    }
    // A null upstreamProviderId means the metadata named no selected endpoint
    // — an ABSENCE, handled as a strict criterion below, never as a mismatch.
    if (
      pinnedProvider !== null &&
      entry.upstreamProviderId !== null &&
      normalizeProviderName(entry.upstreamProviderId) !== normalizeProviderName(pinnedProvider)
    ) {
      providerMismatches.push(
        `${requestId} served by '${entry.upstreamProviderId}' (pinned '${pinnedProvider}')`,
      );
    }
  }

  const handoff = bundle?.handoff ?? null;
  if (bundle !== null && handoff !== null) {
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
    // Poisoned archive (C2/V3): a duplicate-conflict diagnostic means the
    // exact-request archive cannot attest the run — fatal in BOTH modes.
    if (bundle.archiveDiagnostics.length > 0) {
      contra(
        `client archive is poisoned: ${bundle.archiveDiagnostics.length} archiveDiagnostics message(s) — ${bundle.archiveDiagnostics[0]!}`,
      );
    }
  }

  // Client exact-request archive (A3/A7): per-envelope validation lives HERE
  // in the finalizer (and in the producer), never in the leaf schema module.
  // Every envelope must parse, carry the pinned contract literals, recompute
  // its context hash, and name an engine-emitted request — failures are
  // contradictions.
  const clientEnvelopes = new Map<string, { envelope: Envelope; index: number; json: string }>();
  if (bundle !== null) {
    bundle.exactRequestEnvelopes.forEach((raw, index) => {
      const parsed = externalDecisionRequestEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        contra(
          `client envelope[${index}] is schema-invalid: ${
            issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown'
          }`,
        );
        return;
      }
      const envelope = parsed.data;
      const requestId = envelope.request.requestId;
      if (clientEnvelopes.has(requestId)) {
        contra(`client envelope[${index}] duplicates requestId ${requestId}`);
        return;
      }
      if (envelope.runId !== runId) {
        contra(`client envelope ${requestId} runId '${envelope.runId}' != '${runId}'`);
      }
      if (envelope.conditionId !== MODEL_CONDITION_ID) {
        contra(`client envelope ${requestId} conditionId '${envelope.conditionId}' is not pinned`);
      }
      if (envelope.providerId !== EXTERNAL_MARA_PROVIDER_ID) {
        contra(`client envelope ${requestId} providerId '${envelope.providerId}' is not pinned`);
      }
      if (envelope.promptVersion !== MODEL_PROMPT_VERSION) {
        contra(
          `client envelope ${requestId} promptVersion '${envelope.promptVersion}' is not pinned`,
        );
      }
      const recomputed = externalContextHash(envelope.context);
      if (recomputed !== envelope.contextHash) {
        contra(
          `client envelope ${requestId} contextHash '${envelope.contextHash}' does not recompute (got '${recomputed}')`,
        );
      }
      if (!ledgerIndex.requested.has(requestId)) {
        contra(
          `client envelope ${requestId} is an orphan: no external DecisionRequested in the ledger`,
        );
      }
      clientEnvelopes.set(requestId, { envelope, index, json: canonicalEnvelopeJson(envelope) });
    });
  }

  // Gateway sidecars: identity + hash-recompute + orphan checks, and the V3
  // deep-equality proof against the client archive (canonical compact JSON —
  // matching hashes are NOT accepted as a substitute).
  const sidecarJson = new Map<string, string>();
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
    if (!ledgerIndex.requested.has(requestId)) {
      contra(`sidecar ${requestId} is an orphan: no external DecisionRequested in the ledger`);
    }
    const canonical = canonicalEnvelopeJson(envelope);
    sidecarJson.set(requestId, canonical);
    const clientEnv = clientEnvelopes.get(requestId);
    if (clientEnv && clientEnv.json !== canonical) {
      contra(
        `sidecar ${requestId} does not deep-equal the client archive envelope (canonical compact JSON differs)`,
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

  // Client entries: entries for THIS run must reference engine-emitted
  // requests (orphan fatality, V3) and agree on identity; entries keyed to
  // another runId are the recorder's stale-discard diagnostics and join
  // nothing here (A6 — the discarded-stale-run carve-out preserved from
  // 1.4.0).
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
    if (!ledgerIndex.requested.has(entry.requestId)) {
      contra(
        `client entry ${entry.requestId} is an orphan: no external DecisionRequested in the ledger`,
      );
      continue;
    }
    if (clientByRequest.has(entry.requestId)) {
      contra(`client entry ${entry.requestId} appears more than once for run '${runId}'`);
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

  // V3 "every adapter invocation has one trace row", enforced from the one
  // source that cannot be forged by a truncated gateway trace: a
  // `gw-<requestId>` lifecycle event in the VALIDATED ledger is positive
  // proof the gateway answered. No trace row for such a request means the
  // gateway trace is truncated or mis-staged. If a PRESENT client entry also
  // denies observing a gateway result, two present sources contradict each
  // other — fatal in BOTH modes; otherwise it is missing evidence, i.e. a
  // strict criterion (never a mere note: the ledger half of this predicate
  // used to have no consequence at all).
  const ledgerProvenNoRow: string[] = [];
  for (const requestId of ledgerIndex.requested.keys()) {
    if (traceRowsByRequest.has(requestId) || !ledgerProvenGatewayResult(requestId)) continue;
    const client = clientByRequest.get(requestId);
    if (client && !client.gatewayResultObserved) {
      contra(
        `request ${requestId}: the validated ledger holds gateway response 'gw-${requestId}' but the ` +
          `client entry reports gatewayResultObserved=false and no gateway trace row exists`,
      );
    } else {
      ledgerProvenNoRow.push(requestId);
    }
  }
  if (ledgerProvenNoRow.length > 0) {
    failedCriteria.push(
      `gateway-trace-coverage: ${ledgerProvenNoRow.length} request(s) are proven answered by the ledger ` +
        `with no gateway trace row (e.g. ${ledgerProvenNoRow.slice(0, 3).join(', ')})`,
    );
  }

  // A1: every external engine request must carry exactly one canonical
  // resolution. Zero is missing evidence (strict criterion); two or more is
  // a contradiction (the ledger validator also rejects it independently).
  const unresolvedRequests: string[] = [];
  for (const requestId of ledgerIndex.requested.keys()) {
    const count = resolutionCount(ledgerIndex, requestId);
    if (count === 0) unresolvedRequests.push(requestId);
    if (count > 1) {
      contra(
        `request ${requestId} has ${count} engine resolutions (accepted/expired/superseded must be exclusive)`,
      );
    }
  }
  if (unresolvedRequests.length > 0) {
    failedCriteria.push(
      `engine-resolution: ${unresolvedRequests.length} request(s) have no accepted/expired/superseded resolution (e.g. ${unresolvedRequests.slice(0, 3).join(', ')})`,
    );
  }

  if (contradictions.length > 0) {
    throw new Error(
      `finalize: ${contradictions.length} contradiction(s):\n- ${contradictions.join('\n- ')}`,
    );
  }

  // ---- 3. Strict evidence criteria (V3) -----------------------------------
  const finalizedAtUtc = now();

  /** Distinct non-null modelIds the upstream actually reported. Computed ONCE
   * and reused by the final manifest below — two hash-bound facts must never
   * be derived by two separate expressions. */
  const returnedModelIds = [
    ...new Set(traceRows.map((r) => r.modelId).filter((m): m is string => m !== null)),
  ].sort();

  // Pinned model (1.6.0). Deliberately a strict CRITERION rather than a
  // contradiction: an upstream reporting a legitimately variant slug must not
  // destroy an expensive live run's artifacts, but a substitution must never
  // reach a `completed` manifest either. --allow-degraded preserves the data
  // and names the reason in failedCriteria.
  if (seed.modelId !== null) {
    const substituted = returnedModelIds.filter((id) => id !== seed.modelId);
    if (substituted.length > 0) {
      failedCriteria.push(
        `pinned-model: run requested '${seed.modelId}' but the upstream reported ${substituted
          .map((id) => `'${id}'`)
          .join(', ')}`,
      );
    }
  }

  // A provider that disagrees with the pin is a strict CRITERION, not a
  // contradiction, for the same reason `pinned-model` is: the comparison
  // bridges two upstream-owned naming namespaces, so a naming divergence we
  // failed to anticipate must not destroy an expensive live run's artifacts.
  // It can still never read as `completed`.
  if (providerMismatches.length > 0) {
    failedCriteria.push(
      `pinned-provider: ${providerMismatches.length} call(s) were served by a provider the run did ` +
        `not pin with fallbacks disabled (e.g. ${providerMismatches.slice(0, 3).join('; ')})`,
    );
  }

  if (pinnedRouteRun) {
    /** Requests the gateway actually ANSWERED. Both routing criteria below are
     * scoped to these: the gateway writes a routing sidecar for FAILED calls
     * too (the OpenRouter adapter builds `meta` before it throws on an HTTP
     * error, and metaFromPayload always sets both router keys), and such a
     * sidecar legitimately carries a null provider because nothing was served.
     * Scoring those as unproven provenance would mean a single upstream 402 or
     * 5xx anywhere in a run made `completed` permanently unreachable — the
     * exact failure class this enforcement exists to prevent. */
    const answeredRequestIds = new Set(
      traceRows.filter((row) => row.gatewayOutcome === 'response').map((row) => row.requestId),
    );

    // Every answered call carries router evidence, so a missing sidecar is
    // lost evidence rather than an adapter that declined to report.
    const missingRouting = [...answeredRequestIds]
      .filter((requestId) => !routerEntries.has(requestId))
      .sort();
    if (missingRouting.length > 0) {
      failedCriteria.push(
        `routing-evidence: ${missingRouting.length} answered request(s) have no routing sidecar ` +
          `(e.g. ${missingRouting.slice(0, 3).join(', ')})`,
      );
    }
    // A sidecar naming no selected endpoint cannot prove the pinned provider
    // served the call, and the mismatch check above can only fire on a provider
    // it can actually see — so unproven provenance on an ANSWERED call is
    // recorded here rather than passing silently.
    const providerUnproven = [...routerEntries.values()]
      .filter((entry) => answeredRequestIds.has(entry.requestId))
      .filter((entry) => entry.upstreamProviderId === null)
      .map((entry) => entry.requestId)
      .sort();
    if (providerUnproven.length > 0) {
      failedCriteria.push(
        `routing-provider-evidence: ${providerUnproven.length} answered request(s) have a routing ` +
          `sidecar naming no selected provider (e.g. ${providerUnproven.slice(0, 3).join(', ')})`,
      );
    }
  }

  if (clientPresent) {
    // runId-scoped coverage (A6): every ENGINE-emitted external request needs
    // exactly one client trace entry and one archived exact envelope.
    const missingEntries = [...ledgerIndex.requested.keys()].filter(
      (id) => !clientByRequest.has(id),
    );
    if (missingEntries.length > 0) {
      failedCriteria.push(
        `client-trace-coverage: ${missingEntries.length} engine request(s) have no client trace entry (e.g. ${missingEntries.slice(0, 3).join(', ')})`,
      );
    }
    const missingEnvelopes = [...ledgerIndex.requested.keys()].filter(
      (id) => !clientEnvelopes.has(id),
    );
    if (missingEnvelopes.length > 0) {
      failedCriteria.push(
        `exact-envelope-coverage: ${missingEnvelopes.length} engine request(s) have no archived exact envelope (e.g. ${missingEnvelopes.slice(0, 3).join(', ')})`,
      );
    }

    // A2 gateway-evidence predicate: an entry whose client parsed a
    // gateway-produced HTTP result needs exactly one raw trace row AND a
    // sidecar (deep-equality was proven above); gatewayResultObserved=false
    // entries require NO gateway evidence.
    const evidenceGaps: string[] = [];
    for (const [requestId, entry] of clientByRequest) {
      if (!entry.gatewayResultObserved) continue;
      const rows = traceRowsByRequest.get(requestId) ?? [];
      if (rows.length !== 1) {
        evidenceGaps.push(
          `${requestId} (gatewayResultObserved with ${rows.length} gateway trace row(s))`,
        );
      }
      if (!sidecars.has(requestId)) {
        evidenceGaps.push(`${requestId} (gatewayResultObserved with no envelope sidecar)`);
      }
    }
    if (evidenceGaps.length > 0) {
      failedCriteria.push(`gateway-result-evidence: ${evidenceGaps.join('; ')}`);
    }

    // F11/C3: the handoff hashes are the ONLY artifact binding the copied
    // ledger to this run (ledgers carry no runId by frozen invariant), and
    // the comparisons above are `!== null`-guarded. A present bundle whose
    // hashes are null is evidentially equivalent to an absent handoff, so it
    // gets the same treatment: a strict criterion plus the note (never
    // silence under status 'completed').
    if (
      handoff !== null &&
      (handoff.worldStateHash === null || handoff.canonicalLedgerHash === null)
    ) {
      failedCriteria.push(
        'handoff-ledger-binding: handoff hashes are null — the copied ledger is not bound to this run (ledgers carry no runId)',
      );
      notes.push(
        'handoff worldStateHash/canonicalLedgerHash null — ledger-to-run binding is operator-asserted',
      );
    }

    // A5: monotonic NON-decreasing run timestamps, never asserted distinct
    // (measured 4ms margins — equality is reachable and legal). Strict
    // requires runCompletedAtUtc to be stamped.
    const runCompletedAtUtc = handoff?.runCompletedAtUtc ?? null;
    const exportedAtUtc = handoff?.exportedAtUtc ?? null;
    if (runCompletedAtUtc === null) {
      failedCriteria.push('monotonic-timestamps: handoff runCompletedAtUtc is null');
    } else if (exportedAtUtc !== null) {
      if (!(runCompletedAtUtc <= exportedAtUtc && exportedAtUtc <= finalizedAtUtc)) {
        failedCriteria.push(
          `monotonic-timestamps: expected runCompletedAtUtc <= exportedAtUtc <= finalizedAtUtc, got '${runCompletedAtUtc}' / '${exportedAtUtc}' / '${finalizedAtUtc}'`,
        );
      }
    }
  }

  // ---- 4. Join per requestId ----------------------------------------------
  const requestIds = [
    ...new Set([
      ...clientByRequest.keys(),
      ...clientEnvelopes.keys(),
      ...traceRowsByRequest.keys(),
      ...sidecars.keys(),
    ]),
  ].sort();

  /** V4 disposition taxonomy (A2): how the finalizer explained this
   * request's gateway evidence. Returns null for the unclassifiable — which
   * strict mode treats as a failed criterion. */
  const classifyDisposition = (
    requestId: string,
    client: ClientTraceEntry | null,
    hasRow: boolean,
    hasSidecar: boolean,
  ): FinalizedTraceEntry['strictDisposition'] => {
    if (client === null) return null; // degraded bundle-less join
    if (client.clientOutcome === 'discarded-stale-run') return 'stale-run-discard';
    if (client.gatewayResultObserved) {
      // The client parsed a gateway-produced result: row + sidecar required.
      return hasRow && hasSidecar ? 'gateway-answered' : null;
    }
    if (client.clientOutcome === 'failure') {
      const providerFailed = ledgerIndex.providerFailedByRequestId.has(requestId);
      const resolutions = resolutionCount(ledgerIndex, requestId);
      // A2/V4 'gateway-interrupted': the POST reached the gateway (sidecar
      // exists), the client minted a typed transport failure and never
      // parsed a gateway result, and the engine recorded exactly one
      // resolution. Whether a trace row EXISTS is deliberately not part of
      // the predicate: the gateway's own deadline is armed strictly after
      // the client's (gateway/server.ts after body read + validate + seed +
      // sidecar, vs modelGatewayClient.ts immediately before the POST) and
      // nothing wires client disconnect to the handler, so a live gateway
      // lands a row (`response` or `upstream-timeout`) for the call the
      // client abandoned, while a gateway killed mid-adapter lands none.
      // Both are the same legal shape — the row is extra evidence about what
      // happened after the client gave up, never a contradiction (V3 exempts
      // gatewayResultObserved=false entries from gateway-evidence
      // requirements). Requiring its ABSENCE made strict finalization
      // impossible for any run containing one slow model call.
      if (
        hasSidecar &&
        (client.clientFailureCode === 'request-timeout' ||
          client.clientFailureCode === 'gateway-unavailable') &&
        resolutions === 1 &&
        !ledgerProvenGatewayResult(requestId)
      ) {
        if (hasRow) {
          notes.push(
            `request ${requestId} has a gateway trace row the client never observed (client ` +
              `${client.clientFailureCode}) — the gateway produced a result after the client abandoned the call`,
          );
        }
        return 'gateway-interrupted';
      }
      // No gateway contact at all; the typed failure entered the engine.
      if (!hasSidecar && !hasRow && providerFailed) return 'never-dispatched';
      // Moot-failure carve-out (A1, engine.ts ~1109-1123): a client terminal
      // failure whose request was ALREADY resolved is dropped without an
      // event — explained evidence, never a strict failure. A request the
      // ledger proves the gateway ANSWERED is excluded: 'moot' would mean
      // the exact opposite, so it falls through to unclassifiable instead.
      if (!providerFailed && resolutions >= 1 && !ledgerProvenGatewayResult(requestId)) {
        return 'moot-after-resolution';
      }
    }
    return null;
  };

  const finalizedRows: FinalizedTraceEntry[] = [];
  const unexplained: string[] = [];
  const unclassifiable: string[] = [];
  for (const requestId of requestIds) {
    const rows = traceRowsByRequest.get(requestId) ?? [];
    if (rows.length > 1) {
      notes.push(`request ${requestId} has ${rows.length} gateway trace rows; joined the last`);
    }
    const row = rows.length > 0 ? rows[rows.length - 1]! : null;
    const sidecar = sidecars.get(requestId) ?? null;
    const client = clientByRequest.get(requestId) ?? null;
    const clientEnv = clientEnvelopes.get(requestId) ?? null;

    const gwResponseId = row !== null ? traceRowResponseId(row) : `gw-${requestId}`;
    const received = ledgerIndex.receivedByResponseId.get(gwResponseId) ?? null;
    const failed = ledgerIndex.providerFailedByRequestId.get(requestId) ?? null;
    const submission = received ?? failed;
    // Engine verdict for the request's model result, from the ladder SHARED
    // with model-summary.json's outcomes join (summarize.ts): the two
    // artifacts are hash-bound into the same bundle manifest and must never
    // disagree per requestId. 'superseded' (A1) is the canonical third
    // request resolution; the response-level verdicts keep their 1.4.0
    // precedence (a late answer to a superseded request joins as 'rejected'
    // with reason 'superseded-request').
    const { engineOutcome, engineRejectionReason: rejection } = resolveEngineOutcome(
      ledgerIndex,
      requestId,
      gwResponseId,
    );

    if (row?.gatewayOutcome === 'response' && engineOutcome === null) {
      const explained =
        client !== null &&
        (client.clientOutcome === 'discarded-stale-run' || client.clientOutcome === 'failure');
      if (!explained) unexplained.push(requestId);
    }

    const strictDisposition = classifyDisposition(
      requestId,
      client,
      row !== null,
      sidecar !== null,
    );
    if (clientPresent && strictDisposition === null) unclassifiable.push(requestId);

    // A3: rows POINT at the once-per-source envelopes instead of embedding
    // them — the sidecar file, the bundle array index, and the sha256 of the
    // canonical compact JSON of the reconciled envelope.
    const reconciledJson = clientEnv?.json ?? sidecarJson.get(requestId) ?? null;

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
          clientEnv?.envelope.request.requestedAtTick ??
          client?.requestedAtTick ??
          ledgerIndex.requested.get(requestId)?.tick ??
          null,
        logicalSubmittedTick: submission?.tick ?? null,
        exactRequestSources: [
          ...(clientEnv !== null ? (['client'] as const) : []),
          ...(sidecar !== null ? (['gateway'] as const) : []),
        ],
        envelopeSha256: reconciledJson !== null ? sha256OfText(reconciledJson) : null,
        requestEnvelopeFile: sidecar !== null ? `requests/${requestId}.json` : null,
        clientEnvelopeIndex: clientEnv?.index ?? null,
        strictDisposition,
        contextHash:
          row?.contextHash ??
          sidecar?.contextHash ??
          clientEnv?.envelope.contextHash ??
          client?.contextHash ??
          null,
        truncationCounts:
          row?.truncationCounts ??
          sidecar?.truncationCounts ??
          clientEnv?.envelope.truncationCounts ??
          {},
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

  if (unclassifiable.length > 0) {
    failedCriteria.push(
      `strict-disposition: ${unclassifiable.length} request(s) could not be classified (e.g. ${unclassifiable.slice(0, 3).join(', ')})`,
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
  // F6 (preserved, predicate upgraded per A2): reconcile client/ledger
  // evidence of gateway RESULTS against the trace rows actually present.
  // Only POSITIVE evidence counts — the client's explicit
  // gatewayResultObserved flag (never id-prefix sniffing), or the ledger
  // holding engine lifecycle events for the gateway's `gw-` response id. A
  // request with such evidence and no trace row means the trace file is
  // truncated or mis-staged, and the manifest must not advertise a complete
  // gateway source.
  const missingTraceRows = requestIds.filter((requestId) => {
    if (traceRowsByRequest.has(requestId)) return false;
    const client = clientByRequest.get(requestId) ?? null;
    const clientSawResult = client !== null && client.gatewayResultObserved;
    // Same predicate the strict `gateway-trace-coverage` criterion uses.
    return clientSawResult || ledgerProvenGatewayResult(requestId);
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

  // ---- 5. Status determination (V3) ----------------------------------------
  const status: 'completed' | 'degraded' = failedCriteria.length === 0 ? 'completed' : 'degraded';
  if (status === 'degraded' && !allowDegraded) {
    throw new Error(
      `finalize (strict): ${failedCriteria.length} criteri${
        failedCriteria.length === 1 ? 'on' : 'a'
      } failed — nothing was written:\n- ${failedCriteria.join(
        '\n- ',
      )}\nRe-run with --allow-degraded to archive this run as status 'degraded' (never citable as formally complete).`,
    );
  }

  // Re-finalize policy (V3): never silently downgrade a completed run — the
  // operator must delete the final manifest explicitly if that is truly
  // intended. degraded -> completed upgrades are allowed.
  const finalManifestPath = join(dir, 'run-manifest.final.json');
  if (status === 'degraded' && existsSync(finalManifestPath)) {
    const existing = JSON.parse(readFileSync(finalManifestPath, 'utf8')) as { status?: unknown };
    if (existing.status === 'completed') {
      throw new Error(
        "finalize: refusing to overwrite a status 'completed' run-manifest.final.json with a " +
          'degraded one — delete run-manifest.final.json from the run directory explicitly if ' +
          'you truly intend to downgrade this run',
      );
    }
  }

  // ---- 6. Compute EVERYTHING, then commit atomically (V2) ------------------
  const finalizedTraceText =
    finalizedRows.map((row) => JSON.stringify(row)).join('\n') +
    (finalizedRows.length > 0 ? '\n' : '');

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
  const entriesForRun = clientPresent ? [...clientByRequest.values()] : null;
  const counters = computeEvidenceCounters(ledgerIndex.requested.size, entriesForRun);
  const finalManifest = finalManifestSchema.parse({
    manifestFinalSchemaVersion: FINAL_MANIFEST_SCHEMA_VERSION,
    status,
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
    returnedModelIds,
    modelSettings: seed.modelSettings,
    startedAtUtc: seed.startedAtUtc,
    runCompletedAtUtc: handoff?.runCompletedAtUtc ?? null,
    exportedAtUtc: handoff?.exportedAtUtc ?? null,
    finalizedAtUtc,
    worldStateHash: ledger.worldStateHash,
    canonicalLedgerHash: ledger.canonicalLedgerHash,
    externalRequestsEmitted: counters.externalRequestsEmitted,
    requestsSeenByClient: counters.requestsSeenByClient,
    requestsWithGatewayResult: counters.requestsWithGatewayResult,
    requestsDispatchedToGateway: counters.requestsDispatchedToGateway,
    upstreamCallsAttempted: infra.upstreamCallsAttempted,
    callsCompleted: infra.callsCompleted,
    callsFailedByCategory: infra.callsFailedByCategory,
    acceptedModelResponses: lifecycle.acceptedModelResponses,
    engineRejectionsByReason: lifecycle.rejectionsByReason,
    inputTokens: infra.inputTokens,
    outputTokens: infra.outputTokens,
    totalTokens: infra.totalTokens,
    failedCriteria,
    completeness,
  });

  const summary = buildModelSummary(dir, runId, ledger);
  if (clientPresent && entriesForRun !== null) {
    // §10.1 client/engine demand, derived from the SAME counters helper as
    // the manifest (V5) — two hash-bound artifacts must never disagree.
    const beforeDispatch = entriesForRun.filter((e) => e.dispatchedAtUtc === null);
    const byCode: Record<string, number> = {};
    for (const entry of beforeDispatch) {
      const code = entry.clientFailureCode ?? 'unknown';
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
    summary.clientDemand = {
      externalRequestsEmittedByEngine: counters.externalRequestsEmitted,
      requestsSeenByClient: counters.requestsSeenByClient,
      requestsWithGatewayResult: counters.requestsWithGatewayResult,
      requestsDispatchedToGateway: counters.requestsDispatchedToGateway,
      requestsFailedBeforeDispatch: beforeDispatch.length,
      requestsFailedBeforeDispatchByCode: byCode,
    };
  }

  // Stage every derived file in the sibling same-volume directory. A stale
  // staging dir from a crashed finalization is deleted first (EPERM-tolerant
  // with retry — rmSync can hit EPERM on Windows while a file is open).
  const stagingDir = stagingDirFor(dir, runId);
  withEpermRetry(`removing stale staging directory ${stagingDir}`, () =>
    rmSync(stagingDir, { recursive: true, force: true }),
  );
  mkdirSync(stagingDir, { recursive: true });
  const stagedFiles = [
    { name: 'finalized-trace.jsonl', text: finalizedTraceText },
    { name: 'run-manifest.final.json', text: JSON.stringify(finalManifest, null, 2) },
    { name: 'model-summary.json', text: JSON.stringify(summary, null, 2) },
  ];
  for (const file of stagedFiles) {
    writeFileSync(join(stagingDir, file.name), file.text, 'utf8');
  }

  // COMMIT. Order is the detectability contract (V2): (1) delete
  // bundle-manifest.json so an interrupted commit is unambiguously
  // not-finalized; (2) rename the derived files into place (same volume, so
  // never a silent copy); (3) hash the FINAL bytes and write
  // bundle-manifest.json last.
  const bundleManifestPath = join(dir, 'bundle-manifest.json');
  if (existsSync(bundleManifestPath)) {
    withEpermRetry('deleting bundle-manifest.json', () => rmSync(bundleManifestPath));
  }
  for (const file of stagedFiles) {
    withEpermRetry(`renaming ${file.name} into ${dir}`, () =>
      renameSync(join(stagingDir, file.name), join(dir, file.name)),
    );
  }
  // Bundle manifest LAST: it covers every file in the directory except
  // itself, plus the aggregate hash over the sorted `<name>:<sha256>` lines.
  const files = walkFiles(dir)
    .filter((name) => name !== 'bundle-manifest.json')
    .sort()
    .map((name) => ({ name, sha256: sha256OfFile(join(dir, name))! }));
  const bundleManifest = bundleManifestSchema.parse({
    // Producer discriminator (F4/F7/F16): distinguishes this whole-directory
    // evidence binding from model:summarize's informal 4-file manifest,
    // which shares the filename. The v2 `status` mirrors the final
    // manifest's verdict.
    bundleManifestSchemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    producer: 'model:finalize',
    runId,
    files,
    aggregateSha256: aggregateSha256(files),
    status,
  });
  writeFileSync(bundleManifestPath, JSON.stringify(bundleManifest, null, 2), 'utf8');

  // Post-commit hygiene ONLY, and deliberately AFTER the bundle manifest.
  // The staging dir is a SIBLING of `dir` (invisible to walkFiles) and is
  // already empty here, so its removal cannot affect a single covered byte.
  // A leftover directory is harmless — the stale-staging cleanup above
  // deletes it on the next run — whereas letting it throw would report a
  // fully committed finalization as not-finalized (no bundle-manifest.json).
  // rmSync's own retries absorb the Windows EPERM/EBUSY/ENOTEMPTY that
  // withEpermRetry cannot (it rethrows every non-EPERM code immediately).
  try {
    rmSync(stagingDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // ignore: a scanner/sync client still holding the empty temp directory
  }

  return { runId, status, joinedRequests: finalizedRows.length, completeness, failedCriteria };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('finalize.ts') ?? false;
if (invokedDirectly) {
  const runId = arg('--run-id');
  if (!runId) {
    console.error('usage: npm run model:finalize -- --run-id <runId> [--allow-degraded]');
    process.exit(1);
  }
  const traceDir = arg('--trace-dir') ?? 'artifacts/model-runs';
  const dir = join(process.cwd(), traceDir, runId);
  if (!existsSync(dir)) {
    console.error(`model-finalize: run directory not found: ${dir}`);
    process.exit(1);
  }
  try {
    const result = finalizeRunDirectory(dir, runId, {
      allowDegraded: process.argv.includes('--allow-degraded'),
    });
    console.log(
      `model-finalize: ${runId} — status ${result.status}; ${result.joinedRequests} request(s) joined; sources: ${result.completeness.sources.join('+')}; ${result.completeness.notes.length} note(s); ${result.failedCriteria.length} failed criteri${result.failedCriteria.length === 1 ? 'on' : 'a'}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
