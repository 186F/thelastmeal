import { z } from 'zod';
import { NPC_IDS, SCENARIO_IDS } from './ids';
import {
  DECISION_REJECTION_REASONS,
  EXTERNAL_FAILURE_CODES,
  type ExternalFailureCode,
} from './decisionContracts';

/**
 * Shared model-run artifact contracts (re-audit remediation 1.4.0, G1).
 *
 * Pure types + exact zod schemas for every noncanonical model-run artifact:
 * the gateway's raw trace rows and manifest seed, the browser's slim client
 * trace and run bundle, and the finalizer's joined trace and final manifest.
 * The gateway writer (gateway/tracing/modelTraceWriter.ts), the browser
 * recorder (src/app/modelClientTraceRecorder.ts), and the finalizer
 * (scripts/model/finalize.ts) all validate against THESE definitions — one
 * source, no per-layer copies. No node imports: this module must stay usable
 * from browser, worker, gateway, and script code alike.
 *
 * None of these artifacts is canonical state: runIds, wall-clock timestamps,
 * latencies, and token counts never enter events, ledgers, or hashes.
 */

const npcId = z.enum(NPC_IDS);
const scenarioId = z.enum(SCENARIO_IDS);
const hash16 = z.string().regex(/^[0-9a-f]{16}$/);
const nonNegInt = z.number().int().nonnegative();
const shortString = z.string().min(1);
const countsByKey = z.record(z.string(), nonNegInt);
const gatewayOutcome = z.union([z.literal('response'), z.enum(EXTERNAL_FAILURE_CODES)]);
const clientOutcome = z.enum(['response', 'failure', 'discarded-stale-run']);

/** Raw gateway trace schema version (v2: response/failure ids, offered IDs,
 * and bounded raw model output on invalid-output/refusal outcomes). The raw
 * trace KEEPS its `model-trace.jsonl` name (deviation D1); the finalized join
 * is a separate `finalized-trace.jsonl`. */
export const MODEL_TRACE_SCHEMA_VERSION = 2;

/** Ceiling on persisted raw model text (trace v2 `rawModelOutput`). */
export const RAW_MODEL_OUTPUT_MAX_CHARS = 2_048;

/** One JSONL row per gateway request (trace schema v2).
 *
 * NEVER recorded: API keys, authorization headers, process environment,
 * cookies, or hidden model reasoning — entries are built exclusively from
 * the validated envelope, the validated model choice, and adapter metadata.
 */
export interface ModelTraceEntry {
  runId: string;
  requestId: string;
  npcId: string;
  scenarioId: string;
  logicalRequestedTick: number;
  providerId: string;
  promptVersion: string;
  modelId: string | null;
  contextHash: string;
  truncationCounts: Record<string, number>;
  /** Offered-affordance IDs copied from the validated envelope (v2). */
  offeredAffordanceIds: string[];
  upstreamResponseId: string | null;
  /** `gw-<requestId>` on response outcomes; null on failures (v2). */
  responseId: string | null;
  /** `gwf-<requestId>` on failure outcomes; null on responses (v2). */
  failureId: string | null;
  selectedAffordanceId: string | null;
  reasonCode: string | null;
  confidenceBp: number | null;
  rationale: string | null;
  /** M2 revised diagnostic-output contract only (Phase 4; brief §17.5,
   * ruling R7 §9.1): true when the rationale diagnostic was normalized
   * (missing, non-string, or truncated). ALWAYS present on rows written
   * under the M2 contract, NEVER present on Milestone 1 rows — an additive
   * optional field, so every previously written v2 row validates
   * byte-identically and the trace schema version does not move. */
  rationaleNormalized?: boolean;
  /** M2 contract only (ruling R7 §9.2): the model's self-reported
   * confidence claim under its REQUIRED explicit name — optional,
   * noncanonical, excluded from every control path and from primary
   * analysis. Mirrors this row's confidenceBp on M2 rows; never present on
   * Milestone 1 rows. */
  selfReportedConfidenceBp?: number | null;
  /** First 2048 chars of the raw model text, ONLY on outcomes
   * 'invalid-model-output' and 'upstream-refusal'; null on every other
   * outcome INCLUDING success (v2). */
  rawModelOutput: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  /** In-flight upstream calls at dispatch time, INCLUDING this one (0 for
   * failures that never reached the adapter). Source for the §21 maximum
   * concurrent-calls metric. */
  concurrentInFlight: number;
  gatewayOutcome: 'response' | ExternalFailureCode;
  /** Joined later from the exported canonical ledger by the finalizer;
   * the gateway cannot know the engine verdict. */
  engineOutcome: null;
  engineRejectionReason: null;
}

export const modelTraceEntrySchema = z
  .object({
    runId: shortString,
    requestId: shortString,
    npcId,
    scenarioId,
    logicalRequestedTick: nonNegInt,
    providerId: shortString,
    promptVersion: shortString,
    modelId: z.string().nullable(),
    contextHash: hash16,
    truncationCounts: countsByKey,
    offeredAffordanceIds: z.array(shortString),
    upstreamResponseId: z.string().nullable(),
    responseId: z.string().nullable(),
    failureId: z.string().nullable(),
    selectedAffordanceId: z.string().nullable(),
    reasonCode: z.string().nullable(),
    confidenceBp: z.number().int().min(0).max(10_000).nullable(),
    rationale: z.string().nullable(),
    rationaleNormalized: z.boolean().optional(),
    selfReportedConfidenceBp: z.number().int().min(0).max(10_000).nullable().optional(),
    rawModelOutput: z.string().max(RAW_MODEL_OUTPUT_MAX_CHARS).nullable(),
    inputTokens: nonNegInt.nullable(),
    outputTokens: nonNegInt.nullable(),
    totalTokens: nonNegInt.nullable(),
    latencyMs: z.number().nonnegative(),
    concurrentInFlight: nonNegInt,
    gatewayOutcome,
    engineOutcome: z.null(),
    engineRejectionReason: z.null(),
  })
  .strict();

/** Write-once run manifest seeded by the gateway at first sight of a run.
 * Final facts land in the finalizer's `run-manifest.final.json`; the seed is
 * never mutated. */
export interface RunManifestSeed {
  traceSchemaVersion: number;
  experimentId: string;
  experimentVersion: string;
  conditionId: string;
  runId: string;
  scenarioId: string;
  providerPlanId: string;
  externalProviderId: string;
  promptVersion: string;
  modelId: string | null;
  modelSettings: Record<string, unknown>;
  startedAtUtc: string;
}

export const runManifestSeedSchema = z
  .object({
    traceSchemaVersion: z.literal(MODEL_TRACE_SCHEMA_VERSION),
    experimentId: shortString,
    experimentVersion: shortString,
    conditionId: shortString,
    runId: shortString,
    scenarioId,
    providerPlanId: shortString,
    externalProviderId: shortString,
    promptVersion: shortString,
    modelId: z.string().nullable(),
    modelSettings: z.record(z.string(), z.unknown()),
    startedAtUtc: shortString,
  })
  .strict();

/** Router evidence schema version (1.6.0). */
export const ROUTER_TRACE_SCHEMA_VERSION = 1;

/** Ceiling on persisted router metadata. Enforced on WRITE by the adapter's
 * boundedRouterMetadata and again on READ by the finalizer: a sidecar that
 * grew past the bound (hand edit, adapter regression, a router that started
 * returning far more metadata) must not be hashed into a formal bundle
 * unchallenged. */
export const ROUTER_METADATA_MAX_CHARS = 16_384;

/** One `routing/<requestId>.json` sidecar per non-duplicate dispatch on a
 * pinned-route run. These files are recursively hashed into
 * bundle-manifest.json, which makes them formal evidence — so they are
 * validated on read exactly like every other bundled artifact, and the
 * finalizer cross-checks them against the pinned provider (1.6.0).
 *
 * NEVER recorded: API keys, authorization headers, process environment,
 * cookies, or hidden model reasoning. */
export const routerTraceEntrySchema = z
  .object({
    routingSchemaVersion: z.literal(ROUTER_TRACE_SCHEMA_VERSION),
    runId: shortString,
    requestId: shortString,
    /** Provider that actually served the call, per router metadata. Null when
     * the metadata named no selected endpoint — an ABSENCE, never evidence of
     * a mismatch. */
    upstreamProviderId: z.string().nullable(),
    /** Opaque JSON-safe router metadata; consumers must ignore unknown
     * fields. Bounded by total serialized size rather than by shape, because
     * the router owns this payload's schema and we refuse to pin it.
     *
     * This refine is a SHAPE-LEVEL guard, not the authoritative bound: zod
     * rebuilds a record during parsing and drops keys it refuses to copy
     * (notably `__proto__`), so the value measured here can be smaller than
     * the bytes actually on disk. Readers that must bound the ARTIFACT — the
     * finalizer above all — measure the raw parsed JSON before schema
     * validation. See routingMetadataChars in scripts/model/finalize.ts. */
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .refine((m) => m === null || JSON.stringify(m).length <= ROUTER_METADATA_MAX_CHARS, {
        message: `router metadata exceeds ${ROUTER_METADATA_MAX_CHARS} chars`,
      }),
  })
  .strict();

export type RouterTraceEntry = z.infer<typeof routerTraceEntrySchema>;

/** Client trace entry schema version (1.5.0: v2 adds
 * `gatewayResultObserved`, amendment A2). */
export const CLIENT_TRACE_SCHEMA_VERSION = 2;

/** Slim browser-side trace entry (F4, deviation D3): identity + timing +
 * outcome ONLY — no request payloads, no secrets, no environment. Exact
 * envelopes are persisted by the GATEWAY as `requests/<requestId>.json`
 * sidecars AND (since bundle v2) archived client-side in the run bundle's
 * `exactRequestEnvelopes`. Wall-clock fields are noncanonical diagnostics,
 * never join keys. Shape mirror of src/app/modelClientTraceRecorder.ts
 * ModelClientTraceEntry (clientTraceSchemaVersion 2). */
export const clientTraceEntrySchema = z
  .object({
    runId: shortString,
    conditionId: shortString,
    requestId: shortString,
    npcId,
    scenarioId,
    providerId: shortString,
    promptVersionExpected: shortString,
    requestedAtTick: nonNegInt,
    contextHash: hash16,
    queuedAtUtc: shortString,
    dispatchedAtUtc: z.string().nullable(),
    completedAtUtc: z.string().nullable(),
    clientOutcome,
    clientFailureCode: z.enum(EXTERNAL_FAILURE_CODES).nullable(),
    responseId: z.string().nullable(),
    failureId: z.string().nullable(),
    clientLatencyMs: z.number().nonnegative().nullable(),
    /** Strict gateway-evidence predicate (A2): true ONLY when the client
     * parsed an HTTP result PRODUCED by the gateway — a response, or a
     * failure whose body the gateway minted (gwf- failureId / typed gateway
     * error body). False for client-minted cf- failures (timeout,
     * unreachable, budget, contract latch, invalid transport results) and
     * discarded-stale-run entries. Stamped explicitly at the result-parse
     * sites, never inferred from id prefixes. NOT the same as
     * `dispatchedAtUtc !== null`, which only means a POST was attempted. */
    gatewayResultObserved: z.boolean(),
  })
  .strict();

export type ClientTraceEntry = z.infer<typeof clientTraceEntrySchema>;

/** The browser's one-button run bundle (F5; v2 in 1.5.0): terminal handoff
 * facts + the slim client trace + the client-side exact-request archive.
 * `worldStateHash`/`canonicalLedgerHash` are null when the terminal surface
 * genuinely lacked them — the finalizer treats null as absent and notes it.
 *
 * v2 additions:
 * - `handoff.runCompletedAtUtc` (A4): stamped browser-side when the worker's
 *   existing `run-complete` message is received; the export gate guarantees
 *   it is non-null in any exported bundle (the schema allows null so a
 *   mid-run assembly is still representable).
 * - `exactRequestEnvelopes`: one COMPLETE prospective envelope per request
 *   the client ever saw for the current run, archived BEFORE any dispatch
 *   decision. Validated as `z.array(z.unknown())` here (A7: this module is a
 *   LEAF — per-envelope validation with externalDecisionRequestEnvelopeSchema
 *   plus pinned-contract and hash-recompute checks lives in the producer,
 *   src/app/runBundle.ts, and in the finalizer).
 * - `archiveDiagnostics`: duplicate-conflict poison messages; empty in every
 *   healthy run (a poisoned archive blocks export). */
export const runBundleSchema = z
  .object({
    bundleSchemaVersion: z.literal(2),
    handoff: z
      .object({
        runId: shortString,
        conditionId: shortString,
        scenarioId,
        providerId: shortString,
        promptVersion: shortString,
        experimentId: shortString,
        experimentVersion: shortString,
        worldStateHash: hash16.nullable(),
        canonicalLedgerHash: hash16.nullable(),
        callsAttempted: nonNegInt,
        gatewayResponses: nonNegInt,
        acceptedModelResponses: nonNegInt,
        failuresByCode: countsByKey,
        /** Run-level completion timestamp (A4): named runCompletedAtUtc so
         * it can never shadow the PER-REQUEST clientTrace `completedAtUtc`. */
        runCompletedAtUtc: z.string().nullable(),
        exportedAtUtc: shortString,
      })
      .strict(),
    clientTrace: z.array(clientTraceEntrySchema),
    exactRequestEnvelopes: z.array(z.unknown()),
    archiveDiagnostics: z.array(z.string()),
  })
  .strict();

export type RunBundle = z.infer<typeof runBundleSchema>;

/** Finalized joined trace row version (S3; v2 in 1.5.0, v3 in 1.6.1): one row
 * per requestId, joining client entry (0..1) + gateway rows + engine lifecycle
 * from the ledger. v2 added exact-request provenance WITHOUT triplicating the
 * envelope bytes (A3): rows point at the once-per-source envelopes (gateway
 * sidecar file / client bundle array index) plus a canonical sha256, and
 * carry the strict-mode disposition taxonomy (A2/V4) and the 'superseded'
 * engine resolution (A1).
 *
 * v3 splits the engine lifecycle into the three DISTINCT stages the ledger
 * actually records — submission (`engineSubmissionEventId`), response verdict
 * (`responseVerdictEventId`), and canonical request resolution
 * (`engineResolutionEventId`, whose pre-1.6.1 value was in fact the
 * submission event). Only this DERIVED artifact advances: the raw gateway
 * trace, client trace, run bundle, final manifest, and bundle manifest keep
 * their versions. A v2 row is not reinterpretable as v3 — the supported
 * upgrade is re-running model:finalize over the retained raw evidence. */
export const FINALIZED_TRACE_SCHEMA_VERSION = 3;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** Canonical ledger event id (v3): `evt-` + the zero-padded width-6
 * CANONICAL-EVENT counter of src/sim/events/ledger.ts, which may run past six
 * digits on a long run. NOT the ledger `seq`: operator markers consume a
 * separate counter, so id and seq diverge as soon as a run is paused once
 * (measured: id evt-000002 at seq 3).
 *
 * Re-declared here rather than imported because this module is a LEAF — the
 * canonical copy lives in src/sim/events/eventSchemas.ts, which is not a leaf
 * (it imports ../config) and does not export it. The envelope regex in that
 * file, /^evt-(op-)?\d{4,}$/, is deliberately NOT the one mirrored: every
 * decision-lifecycle event is a canonical event, never an operator marker, so
 * `evt-op-000001` must be REJECTED in these fields. */
const canonicalEventId = z.string().regex(/^evt-\d{6,}$/);

export const finalizedTraceEntrySchema = z
  .object({
    finalizedTraceSchemaVersion: z.literal(FINALIZED_TRACE_SCHEMA_VERSION),
    runId: shortString,
    requestId: shortString,
    npcId,
    scenarioId,
    conditionId: shortString,
    providerId: shortString,
    promptVersion: shortString,
    modelId: z.string().nullable(),
    requestedAtLogicalTick: nonNegInt,
    /** Tick of DecisionResponseReceived (responses that entered the engine)
     * or DecisionProviderFailed (explicit failures); null when the result
     * never reached the engine. Reads off the SAME indexed event as
     * `engineSubmissionEventId` and is co-null with it (refined below). */
    logicalSubmittedTick: nonNegInt.nullable(),
    /** Which once-per-source exact envelopes exist for this request (A3):
     * 'client' = bundle exactRequestEnvelopes entry, 'gateway' = sidecar. */
    exactRequestSources: z.array(z.enum(['client', 'gateway'])).max(2),
    /** sha256 of the canonical compact JSON of the reconciled envelope; null
     * when no envelope exists from any source. */
    envelopeSha256: sha256Hex.nullable(),
    /** `requests/<requestId>.json` when the gateway sidecar exists, else
     * null. */
    requestEnvelopeFile: z.string().nullable(),
    /** Index into the bundle's exactRequestEnvelopes array, else null. */
    clientEnvelopeIndex: nonNegInt.nullable(),
    /** Strict-mode disposition (A2/V4): how the finalizer explained this
     * request's gateway evidence. Null only in degraded joins that could not
     * classify the row. */
    strictDisposition: z
      .enum([
        'gateway-answered',
        'never-dispatched',
        'gateway-interrupted',
        'moot-after-resolution',
        'stale-run-discard',
      ])
      .nullable(),
    contextHash: hash16,
    truncationCounts: countsByKey,
    responseId: z.string().nullable(),
    failureId: z.string().nullable(),
    selectedAffordanceId: z.string().nullable(),
    reasonCode: z.string().nullable(),
    confidenceBp: z.number().int().min(0).max(10_000).nullable(),
    rationale: z.string().nullable(),
    tokens: z
      .object({
        inputTokens: nonNegInt.nullable(),
        outputTokens: nonNegInt.nullable(),
        totalTokens: nonNegInt.nullable(),
      })
      .strict(),
    clientLatencyMs: z.number().nonnegative().nullable(),
    gatewayLatencyMs: z.number().nonnegative().nullable(),
    clientOutcome: clientOutcome.nullable(),
    gatewayOutcome: gatewayOutcome.nullable(),
    /** Engine verdict for this request. 'superseded' is a canonical request
     * resolution (A1): a request whose only resolution is superseded is
     * COMPLETE evidence, not a failure.
     *
     * Stays nullable in v3, and null is not the same as "unresolved": when a
     * request was resolved by an acceptance of a DIFFERENT responseId than
     * this row's, the shared ladder finds no response-level verdict and no
     * expiry/supersession, so it returns null while `engineResolutionEventId`
     * carries that acceptance. That combination is legal and
     * non-contradictory — the two fields answer different questions. */
    engineOutcome: z.enum(['accepted', 'rejected', 'expired', 'superseded']).nullable(),
    engineRejectionReason: z.enum(DECISION_REJECTION_REASONS).nullable(),
    /** Event id of the engine SUBMISSION event (v3): the
     * DecisionResponseReceived carrying this row's response id, else the
     * DecisionProviderFailed for this requestId; null when nothing entered
     * the engine. Records that a result ARRIVED — never that the request
     * resolved. */
    engineSubmissionEventId: canonicalEventId.nullable(),
    /** Event id of the engine's verdict on THIS row's submitted response (v3):
     * DecisionResponseAccepted or DecisionResponseRejected, keyed by RESPONSE
     * id and never by requestId. Null whenever the row describes no verdicted
     * response — a provider failure, a pre-dispatch client failure, a request
     * that merely expired, or one superseded before any answer arrived. */
    responseVerdictEventId: canonicalEventId.nullable(),
    /** Event id of the ONE canonical request resolution, keyed by requestId
     * (v3): DecisionResponseAccepted | DecisionRequestExpired |
     * DecisionRequestSuperseded.
     *
     * NEVER DecisionResponseReceived or DecisionProviderFailed — those record
     * a submission entering the engine, and holding one here was exactly the
     * pre-1.6.1 defect this rewrite corrects. NEVER DecisionResponseRejected
     * either: a rejection is a verdict about one response, and the request
     * stays pending until it expires, is superseded, or another response is
     * accepted.
     *
     * An accepted row points verdict and resolution at the SAME event. A
     * resolution may legally PREDATE its submission (a late answer to an
     * already-superseded request), so no chronological relation between the
     * two is asserted anywhere. Nullable at schema level because degraded
     * finalization deliberately preserves unresolved rows; strict
     * completeness — non-null for every requestId in the ledger's external
     * DecisionRequested set — is the finalizer's criterion, not the
     * schema's. */
    engineResolutionEventId: canonicalEventId.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The tick and the event id are read off ONE indexed submission event, so
    // one being null while the other is not can only mean the two were
    // derived independently — precisely the drift this makes unrepresentable.
    if ((value.logicalSubmittedTick === null) !== (value.engineSubmissionEventId === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'logicalSubmittedTick and engineSubmissionEventId must be co-null: both describe the same submission event',
        path: ['engineSubmissionEventId'],
      });
    }
    // 'accepted' and 'rejected' are RESPONSE-level verdicts: the shared
    // ladder can only reach them by finding an Accepted/Rejected event for
    // this row's response id, so the id of that event must be present.
    // 'expired', 'superseded', and null carry no such obligation.
    if (
      (value.engineOutcome === 'accepted' || value.engineOutcome === 'rejected') &&
      value.responseVerdictEventId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `engineOutcome '${value.engineOutcome}' requires a non-null responseVerdictEventId`,
        path: ['responseVerdictEventId'],
      });
    }
  });

export type FinalizedTraceEntry = z.infer<typeof finalizedTraceEntrySchema>;

/** Final manifest version (S4; v2 in 1.5.0). Written as
 * `run-manifest.final.json` NEXT TO the untouched seed manifest — the seed
 * is never mutated. v2 widens `status` to completed|degraded, records the
 * run-level timestamps (A4/A5: runCompletedAtUtc <= exportedAtUtc <=
 * finalizedAtUtc, monotonic NON-decreasing, equality legal), and adds the
 * client-evidence counters (V5). */
export const FINAL_MANIFEST_SCHEMA_VERSION = 2;

export const finalManifestSchema = z
  .object({
    manifestFinalSchemaVersion: z.literal(FINAL_MANIFEST_SCHEMA_VERSION),
    /** 'completed' only when EVERY strict criterion held; 'degraded' is
     * written exclusively under --allow-degraded with failedCriteria
     * populated. */
    status: z.enum(['completed', 'degraded']),
    experimentId: shortString,
    experimentVersion: shortString,
    conditionId: shortString,
    runId: shortString,
    scenarioId,
    scenarioVersion: shortString,
    seed: z.number().int(),
    configVersion: shortString,
    providerPlanId: shortString,
    externalProviderId: shortString,
    promptVersion: shortString,
    requestedModelId: z.string().nullable(),
    /** Distinct non-null modelId values observed in trace rows — never trust
     * the seed's single modelId alone. */
    returnedModelIds: z.array(shortString),
    modelSettings: z.record(z.string(), z.unknown()),
    /** Gateway-first-sight time (seed manifest). NOT run start, and excluded
     * from the A5 monotonic ordering check. */
    startedAtUtc: shortString,
    /** Browser receipt time of the worker's run-complete message (A4), from
     * the bundle handoff; null only in degraded bundle-less joins. */
    runCompletedAtUtc: z.string().nullable(),
    /** Bundle-export click time, from the bundle handoff; null only in
     * degraded bundle-less joins. */
    exportedAtUtc: z.string().nullable(),
    finalizedAtUtc: shortString,
    worldStateHash: hash16,
    canonicalLedgerHash: hash16,
    /** ENGINE-emitted external request count: ledger DecisionRequested rows
     * carrying the external provider (V5) — no longer the client/gateway row
     * count fallback. */
    externalRequestsEmitted: nonNegInt,
    /** runId-scoped client trace entries; null in bundle-less joins (V5). */
    requestsSeenByClient: nonNegInt.nullable(),
    /** Entries with gatewayResultObserved === true (A2); null in bundle-less
     * joins. */
    requestsWithGatewayResult: nonNegInt.nullable(),
    /** Entries with dispatchedAtUtc !== null — "POST attempted", NOT gateway
     * evidence (A2); null in bundle-less joins. */
    requestsDispatchedToGateway: nonNegInt.nullable(),
    upstreamCallsAttempted: nonNegInt,
    callsCompleted: nonNegInt,
    callsFailedByCategory: countsByKey,
    acceptedModelResponses: nonNegInt,
    engineRejectionsByReason: countsByKey,
    inputTokens: nonNegInt,
    outputTokens: nonNegInt,
    totalTokens: nonNegInt,
    /** Strict criteria that did NOT hold — always empty when status is
     * 'completed'; populated under --allow-degraded. */
    failedCriteria: z.array(z.string()),
    /** Which sources the join actually had (deviation D2: a missing client
     * bundle degrades completeness with a note instead of hard-failing). */
    completeness: z
      .object({
        sources: z.array(z.enum(['gateway', 'ledger', 'client'])),
        notes: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export type FinalManifest = z.infer<typeof finalManifestSchema>;

/** Bundle-manifest schema version (1.5.0: v2 adds `status`). BOTH writers —
 * model:finalize's whole-directory evidence binding and model:summarize's
 * informal 4-file manifest — stamp this version. */
export const BUNDLE_MANIFEST_SCHEMA_VERSION = 2;

const manifestFileHash = z.object({ name: shortString, sha256: sha256Hex }).strict();
const manifestFileHashMaybe = z
  .object({ name: shortString, sha256: sha256Hex.nullable() })
  .strict();

/** `bundle-manifest.json` (v2): the producer discriminator (F4/F7/F16)
 * separates the finalizer's whole-directory binding from summarize's
 * informal manifest. `status` mirrors the final manifest's verdict and is
 * emitted ONLY by model:finalize — summarize (which runs pre-finalize and
 * asserts no final manifest exists) always writes null. */
export const bundleManifestSchema = z.discriminatedUnion('producer', [
  z
    .object({
      bundleManifestSchemaVersion: z.literal(BUNDLE_MANIFEST_SCHEMA_VERSION),
      producer: z.literal('model:finalize'),
      runId: shortString,
      files: z.array(manifestFileHash),
      aggregateSha256: sha256Hex,
      status: z.enum(['completed', 'degraded']).nullable(),
    })
    .strict(),
  z
    .object({
      bundleManifestSchemaVersion: z.literal(BUNDLE_MANIFEST_SCHEMA_VERSION),
      producer: z.literal('model:summarize'),
      runId: shortString,
      files: z
        .object({
          ledger: manifestFileHash.nullable(),
          modelTrace: manifestFileHashMaybe,
          runManifest: manifestFileHashMaybe,
          modelSummary: manifestFileHashMaybe,
        })
        .strict(),
      aggregateSha256: sha256Hex,
      status: z.null(),
    })
    .strict(),
]);

export type BundleManifest = z.infer<typeof bundleManifestSchema>;
