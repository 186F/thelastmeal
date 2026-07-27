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

/** Slim browser-side trace entry (F4, deviation D3): identity + timing +
 * outcome ONLY — no request payloads, no secrets, no environment. Exact
 * envelopes are persisted by the GATEWAY as `requests/<requestId>.json`
 * sidecars. Wall-clock fields are noncanonical diagnostics, never join keys.
 * Shape mirror of src/app/modelClientTraceRecorder.ts ModelClientTraceEntry
 * (clientTraceSchemaVersion 1). */
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
  })
  .strict();

export type ClientTraceEntry = z.infer<typeof clientTraceEntrySchema>;

/** The browser's one-button run bundle (F5): terminal handoff facts + the
 * slim client trace. `worldStateHash`/`canonicalLedgerHash` are null when the
 * terminal surface genuinely lacked them — the finalizer treats null as
 * absent and notes it. */
export const runBundleSchema = z
  .object({
    bundleSchemaVersion: z.literal(1),
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
        exportedAtUtc: shortString,
      })
      .strict(),
    clientTrace: z.array(clientTraceEntrySchema),
  })
  .strict();

export type RunBundle = z.infer<typeof runBundleSchema>;

/** Finalized joined trace row version (S3): one row per requestId, joining
 * client entry (0..1) + gateway rows + engine lifecycle from the ledger. */
export const FINALIZED_TRACE_SCHEMA_VERSION = 1;

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
     * never reached the engine. */
    logicalSubmittedTick: nonNegInt.nullable(),
    /** `requests/<requestId>.json` when the sidecar exists, else null. */
    requestEnvelopeFile: z.string().nullable(),
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
    engineOutcome: z.enum(['accepted', 'rejected', 'expired']).nullable(),
    engineRejectionReason: z.enum(DECISION_REJECTION_REASONS).nullable(),
    /** Event id of the engine's resolving lifecycle event, when one exists. */
    engineResolutionEventId: z.string().nullable(),
  })
  .strict();

export type FinalizedTraceEntry = z.infer<typeof finalizedTraceEntrySchema>;

/** Final manifest version (S4). Written as `run-manifest.final.json` NEXT TO
 * the untouched seed manifest — the seed is never mutated. */
export const FINAL_MANIFEST_SCHEMA_VERSION = 1;

export const finalManifestSchema = z
  .object({
    manifestFinalSchemaVersion: z.literal(FINAL_MANIFEST_SCHEMA_VERSION),
    status: z.literal('completed'),
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
    startedAtUtc: shortString,
    finalizedAtUtc: shortString,
    worldStateHash: hash16,
    canonicalLedgerHash: hash16,
    /** Client count when a client trace is present, else gateway row count. */
    externalRequestsEmitted: nonNegInt,
    upstreamCallsAttempted: nonNegInt,
    callsCompleted: nonNegInt,
    callsFailedByCategory: countsByKey,
    acceptedModelResponses: nonNegInt,
    engineRejectionsByReason: countsByKey,
    inputTokens: nonNegInt,
    outputTokens: nonNegInt,
    totalTokens: nonNegInt,
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
