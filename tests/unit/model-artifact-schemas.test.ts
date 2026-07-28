import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  CLIENT_TRACE_SCHEMA_VERSION,
  FINALIZED_TRACE_SCHEMA_VERSION,
  FINAL_MANIFEST_SCHEMA_VERSION,
  MODEL_TRACE_SCHEMA_VERSION,
  ROUTER_METADATA_MAX_CHARS,
  bundleManifestSchema,
  clientTraceEntrySchema,
  finalManifestSchema,
  finalizedTraceEntrySchema,
  routerTraceEntrySchema,
  runBundleSchema,
} from '../../src/shared/modelArtifacts';

/**
 * Strict-matrix tests for the artifact schemas (spec C5): the 1.5.0 v2
 * shapes, plus the finalized trace's 1.6.1 advance to v3 (the
 * event-semantics split — engineSubmissionEventId / responseVerdictEventId /
 * corrected engineResolutionEventId, spec E5). Every schema is `.strict()`:
 * a valid fixture must parse, and a single missing, extra, mistyped,
 * fractional, or unknown-enum field must fail. The version constants are
 * pinned here so a silent downgrade cannot ship, and a v1 bundle must be
 * REJECTED by the v2 schema (A8: no legacy import path — prepareRun/finalize
 * hard-reject version 1 with a re-export message). A v2 finalized row is
 * likewise rejected by the v3 schema: its engine ids meant the SUBMISSION,
 * so reinterpretation is impossible — re-run model:finalize instead.
 */

const HASH16 = '0123456789abcdef';
const SHA256 = '0123456789abcdef'.repeat(4);
const ISO = '2026-07-27T12:00:00.000Z';

type Mutation = [label: string, mutate: (fixture: Record<string, unknown>) => void];

/** Runs a strict accept/reject matrix: the base fixture parses, each
 * mutation fails. Fixtures are deep-cloned per case. */
function strictMatrix(
  schema: z.ZodTypeAny,
  base: () => Record<string, unknown>,
  mutations: Mutation[],
): void {
  expect(schema.safeParse(base()).success).toBe(true);
  for (const [label, mutate] of mutations) {
    const fixture = base();
    mutate(fixture);
    expect(schema.safeParse(fixture).success, `should reject: ${label}`).toBe(false);
  }
}

function validClientEntry(): Record<string, unknown> {
  return {
    runId: 'run-unit-0001',
    conditionId: 'mara-model-per-decision-v1',
    requestId: 'dec-0001',
    npcId: 'mara',
    scenarioId: 'A',
    providerId: 'openai-mara-action-v1',
    promptVersionExpected: 'mara-action-selection-1.0.0',
    requestedAtTick: 12,
    contextHash: HASH16,
    queuedAtUtc: ISO,
    dispatchedAtUtc: ISO,
    completedAtUtc: ISO,
    clientOutcome: 'response',
    clientFailureCode: null,
    responseId: 'gw-dec-0001',
    failureId: null,
    clientLatencyMs: 42,
    gatewayResultObserved: true,
  };
}

function validHandoff(): Record<string, unknown> {
  return {
    runId: 'run-unit-0001',
    conditionId: 'mara-model-per-decision-v1',
    scenarioId: 'A',
    providerId: 'openai-mara-action-v1',
    promptVersion: 'mara-action-selection-1.0.0',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.0.0',
    worldStateHash: HASH16,
    canonicalLedgerHash: HASH16,
    callsAttempted: 5,
    gatewayResponses: 4,
    acceptedModelResponses: 4,
    failuresByCode: { 'budget-exhausted': 1 },
    runCompletedAtUtc: ISO,
    exportedAtUtc: ISO,
  };
}

function validBundle(): Record<string, unknown> {
  return {
    bundleSchemaVersion: 2,
    handoff: validHandoff(),
    clientTrace: [validClientEntry()],
    exactRequestEnvelopes: [{ anything: 'goes — envelopes are validated by the PRODUCER (A7)' }],
    archiveDiagnostics: [],
  };
}

function validFinalizedRow(): Record<string, unknown> {
  return {
    finalizedTraceSchemaVersion: 3,
    runId: 'run-unit-0001',
    requestId: 'dec-0001',
    npcId: 'mara',
    scenarioId: 'A',
    conditionId: 'mara-model-per-decision-v1',
    providerId: 'openai-mara-action-v1',
    promptVersion: 'mara-action-selection-1.0.0',
    modelId: 'fake-adapter',
    requestedAtLogicalTick: 40,
    logicalSubmittedTick: 42,
    exactRequestSources: ['client', 'gateway'],
    envelopeSha256: SHA256,
    requestEnvelopeFile: 'requests/dec-0001.json',
    clientEnvelopeIndex: 0,
    strictDisposition: 'gateway-answered',
    contextHash: HASH16,
    truncationCounts: { beliefs: 0 },
    responseId: 'gw-dec-0001',
    failureId: null,
    selectedAffordanceId: 'aff-eat-meal',
    reasonCode: 'routine',
    confidenceBp: 5_000,
    rationale: null,
    tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    clientLatencyMs: 12,
    gatewayLatencyMs: 11,
    clientOutcome: 'response',
    gatewayOutcome: 'response',
    engineOutcome: 'accepted',
    engineRejectionReason: null,
    // An accepted row wearing the full v3 shape: the submission (Received)
    // pairs co-non-null with logicalSubmittedTick above, and the verdict and
    // resolution both name the SAME DecisionResponseAccepted — a distinct
    // event from the submission.
    engineSubmissionEventId: 'evt-000122',
    responseVerdictEventId: 'evt-000123',
    engineResolutionEventId: 'evt-000123',
  };
}

function validFinalManifest(): Record<string, unknown> {
  return {
    manifestFinalSchemaVersion: 2,
    status: 'completed',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.0.0',
    conditionId: 'mara-model-per-decision-v1',
    runId: 'run-unit-0001',
    scenarioId: 'A',
    scenarioVersion: '1.0.0',
    seed: 1001,
    configVersion: 'vs001-1.0.0',
    providerPlanId: 'plan-model-mara-v1',
    externalProviderId: 'openai-mara-action-v1',
    promptVersion: 'mara-action-selection-1.0.0',
    requestedModelId: 'fake-adapter',
    returnedModelIds: ['fake-adapter'],
    modelSettings: { maxCallsPerRun: 80 },
    startedAtUtc: ISO,
    runCompletedAtUtc: ISO,
    exportedAtUtc: ISO,
    finalizedAtUtc: ISO,
    worldStateHash: HASH16,
    canonicalLedgerHash: HASH16,
    externalRequestsEmitted: 47,
    requestsSeenByClient: 47,
    requestsWithGatewayResult: 40,
    requestsDispatchedToGateway: 45,
    upstreamCallsAttempted: 45,
    callsCompleted: 40,
    callsFailedByCategory: { 'gateway-unavailable': 5 },
    acceptedModelResponses: 40,
    engineRejectionsByReason: {},
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    failedCriteria: [],
    completeness: { sources: ['gateway', 'ledger', 'client'], notes: [] },
  };
}

function validFinalizeBundleManifest(): Record<string, unknown> {
  return {
    bundleManifestSchemaVersion: 2,
    producer: 'model:finalize',
    runId: 'run-unit-0001',
    files: [{ name: 'ledger-A-v1.0.0-seed1001.json', sha256: SHA256 }],
    aggregateSha256: SHA256,
    status: 'completed',
  };
}

function validSummarizeBundleManifest(): Record<string, unknown> {
  return {
    bundleManifestSchemaVersion: 2,
    producer: 'model:summarize',
    runId: 'run-unit-0001',
    files: {
      ledger: { name: 'ledger-A-v1.0.0-seed1001.json', sha256: SHA256 },
      modelTrace: { name: 'model-trace.jsonl', sha256: null },
      runManifest: { name: 'run-manifest.json', sha256: SHA256 },
      modelSummary: { name: 'model-summary.json', sha256: SHA256 },
    },
    aggregateSha256: SHA256,
    status: null,
  };
}

function validRouterEntry(): Record<string, unknown> {
  return {
    routingSchemaVersion: 1,
    runId: 'run-unit-0001',
    requestId: 'dec-0001',
    upstreamProviderId: 'Anthropic',
    metadata: { requested: 'anthropic/claude-sonnet-test', strategy: 'direct', attempt: 1 },
  };
}

describe('routerTraceEntrySchema (1.6.0 strict matrix)', () => {
  it('accepts a valid sidecar and rejects every field-level defect', () => {
    strictMatrix(routerTraceEntrySchema, validRouterEntry, [
      ['wrong schema version literal', (f) => (f.routingSchemaVersion = 2)],
      ['missing schema version', (f) => delete f.routingSchemaVersion],
      ['missing runId', (f) => delete f.runId],
      ['missing requestId', (f) => delete f.requestId],
      ['empty requestId', (f) => (f.requestId = '')],
      ['missing upstreamProviderId', (f) => delete f.upstreamProviderId],
      ['mistyped upstreamProviderId', (f) => (f.upstreamProviderId = 7)],
      ['missing metadata', (f) => delete f.metadata],
      ['array metadata', (f) => (f.metadata = [])],
      ['unknown extra field', (f) => (f.extra = 1)],
      [
        'metadata past the persisted bound',
        (f) => (f.metadata = { blob: 'x'.repeat(ROUTER_METADATA_MAX_CHARS + 1) }),
      ],
    ]);
  });

  it('accepts an absent selected provider and absent metadata (absence is not corruption)', () => {
    const unproven = validRouterEntry();
    unproven.upstreamProviderId = null;
    unproven.metadata = null;
    expect(routerTraceEntrySchema.safeParse(unproven).success).toBe(true);
  });

  it('accepts opaque unknown router fields at exactly the bound (the router owns this shape)', () => {
    const opaque = validRouterEntry();
    opaque.metadata = { somethingNew: { nested: [1, 2, 3] }, futureField: 'ok' };
    expect(routerTraceEntrySchema.safeParse(opaque).success).toBe(true);

    const atBound = validRouterEntry();
    const filler = 'x'.repeat(ROUTER_METADATA_MAX_CHARS - JSON.stringify({ blob: '' }).length);
    atBound.metadata = { blob: filler };
    expect(JSON.stringify(atBound.metadata).length).toBe(ROUTER_METADATA_MAX_CHARS);
    expect(routerTraceEntrySchema.safeParse(atBound).success).toBe(true);
  });
});

describe('schema version constants', () => {
  it('pin the finalized trace at v3 (1.6.1 event-semantics split) and every sibling at its 1.5.0 value', () => {
    expect(CLIENT_TRACE_SCHEMA_VERSION).toBe(2);
    // ONLY the derived finalized trace advances; the raw gateway trace,
    // client trace, final manifest, and bundle manifest are frozen at 2.
    expect(FINALIZED_TRACE_SCHEMA_VERSION).toBe(3);
    expect(FINAL_MANIFEST_SCHEMA_VERSION).toBe(2);
    expect(BUNDLE_MANIFEST_SCHEMA_VERSION).toBe(2);
    expect(MODEL_TRACE_SCHEMA_VERSION).toBe(2);
  });
});

describe('clientTraceEntrySchema v2 (strict matrix)', () => {
  it('accepts a valid entry and rejects every field-level defect', () => {
    strictMatrix(clientTraceEntrySchema, validClientEntry, [
      ['missing gatewayResultObserved', (f) => delete f.gatewayResultObserved],
      ['mistyped gatewayResultObserved (string)', (f) => (f.gatewayResultObserved = 'true')],
      ['mistyped gatewayResultObserved (null)', (f) => (f.gatewayResultObserved = null)],
      ['unknown extra field', (f) => (f.extra = 1)],
      ['fractional requestedAtTick', (f) => (f.requestedAtTick = 1.5)],
      ['negative requestedAtTick', (f) => (f.requestedAtTick = -1)],
      ['unknown clientOutcome', (f) => (f.clientOutcome = 'pending')],
      ['unknown clientFailureCode', (f) => (f.clientFailureCode = 'other')],
      ['bad contextHash', (f) => (f.contextHash = 'nope')],
      ['missing runId', (f) => delete f.runId],
      ['unknown npcId', (f) => (f.npcId = 'someone')],
    ]);
  });

  it('accepts every legal outcome shape', () => {
    const failure = validClientEntry();
    failure.clientOutcome = 'failure';
    failure.clientFailureCode = 'gateway-unavailable';
    failure.responseId = null;
    failure.failureId = 'cf-dec-0001';
    failure.gatewayResultObserved = false;
    expect(clientTraceEntrySchema.safeParse(failure).success).toBe(true);

    const discard = validClientEntry();
    discard.clientOutcome = 'discarded-stale-run';
    discard.clientFailureCode = null;
    discard.responseId = null;
    discard.gatewayResultObserved = false;
    expect(clientTraceEntrySchema.safeParse(discard).success).toBe(true);
  });
});

describe('runBundleSchema v2 (strict matrix)', () => {
  it('accepts a valid v2 bundle and rejects every field-level defect', () => {
    strictMatrix(runBundleSchema, validBundle, [
      ['v1 version literal', (f) => (f.bundleSchemaVersion = 1)],
      ['missing exactRequestEnvelopes', (f) => delete f.exactRequestEnvelopes],
      ['missing archiveDiagnostics', (f) => delete f.archiveDiagnostics],
      ['non-string archiveDiagnostics entry', (f) => (f.archiveDiagnostics = [42])],
      ['non-array exactRequestEnvelopes', (f) => (f.exactRequestEnvelopes = {})],
      ['unknown top-level field', (f) => (f.extra = true)],
      [
        'missing handoff.runCompletedAtUtc',
        (f) => delete (f.handoff as Record<string, unknown>).runCompletedAtUtc,
      ],
      [
        'mistyped handoff.runCompletedAtUtc',
        (f) => ((f.handoff as Record<string, unknown>).runCompletedAtUtc = 7),
      ],
      [
        'unknown handoff field (the v1-colliding name completedAtUtc, A4)',
        (f) => {
          (f.handoff as Record<string, unknown>).completedAtUtc = ISO;
        },
      ],
      [
        'fractional handoff counter',
        (f) => ((f.handoff as Record<string, unknown>).callsAttempted = 1.5),
      ],
      [
        'invalid clientTrace entry',
        (f) => delete (f.clientTrace as Record<string, unknown>[])[0]!.gatewayResultObserved,
      ],
    ]);
  });

  it('REJECTS a genuine v1-shaped bundle (A8: no legacy import path)', () => {
    // Exactly the 1.4.0 producer shape: version 1, no runCompletedAtUtc, no
    // archive fields.
    const handoffV1 = validHandoff();
    delete handoffV1.runCompletedAtUtc;
    const entryV1 = validClientEntry();
    delete entryV1.gatewayResultObserved;
    const v1 = {
      bundleSchemaVersion: 1,
      handoff: handoffV1,
      clientTrace: [entryV1],
    };
    expect(runBundleSchema.safeParse(v1).success).toBe(false);
  });

  it('accepts null runCompletedAtUtc and hashes (producer guarantees non-null only when export-gated)', () => {
    const bundle = validBundle();
    const handoff = bundle.handoff as Record<string, unknown>;
    handoff.runCompletedAtUtc = null;
    handoff.worldStateHash = null;
    handoff.canonicalLedgerHash = null;
    expect(runBundleSchema.safeParse(bundle).success).toBe(true);
  });
});

describe('finalizedTraceEntrySchema v3 (strict matrix)', () => {
  it('accepts a valid row and rejects every field-level defect', () => {
    strictMatrix(finalizedTraceEntrySchema, validFinalizedRow, [
      ['v1 version literal', (f) => (f.finalizedTraceSchemaVersion = 1)],
      // A v2 row is NOT reinterpretable as v3 — its engine ids meant the
      // submission. The only upgrade path is re-running model:finalize.
      ['v2 version literal', (f) => (f.finalizedTraceSchemaVersion = 2)],
      ['missing exactRequestSources', (f) => delete f.exactRequestSources],
      [
        'exactRequestSources beyond max 2',
        (f) => (f.exactRequestSources = ['client', 'gateway', 'client']),
      ],
      ['unknown exactRequestSources member', (f) => (f.exactRequestSources = ['ledger'])],
      ['missing envelopeSha256', (f) => delete f.envelopeSha256],
      ['16-hex envelopeSha256 (must be 64)', (f) => (f.envelopeSha256 = HASH16)],
      ['missing clientEnvelopeIndex', (f) => delete f.clientEnvelopeIndex],
      ['fractional clientEnvelopeIndex', (f) => (f.clientEnvelopeIndex = 0.5)],
      ['negative clientEnvelopeIndex', (f) => (f.clientEnvelopeIndex = -1)],
      ['missing strictDisposition', (f) => delete f.strictDisposition],
      ['unknown strictDisposition', (f) => (f.strictDisposition = 'unexplained')],
      ['unknown engineOutcome', (f) => (f.engineOutcome = 'vanished')],
      ['missing requestEnvelopeFile', (f) => delete f.requestEnvelopeFile],
      ['unknown extra field', (f) => (f.extra = 1)],
      ['fractional confidenceBp', (f) => (f.confidenceBp = 0.5)],
      // Required-key proof for the two 1.6.1 fields: absent is not null.
      ['missing engineSubmissionEventId', (f) => delete f.engineSubmissionEventId],
      ['missing responseVerdictEventId', (f) => delete f.responseVerdictEventId],
      // All three event-id fields pin the CANONICAL form (`evt-` + the
      // zero-padded width-6 canonical-event counter): `evt-op-` markers
      // consume a SEPARATE counter and can never name a lifecycle event, an
      // under-width id catches a ledger-`seq` confusion, and a bare string
      // catches the field regressing to an unconstrained z.string().
      ...(
        ['engineSubmissionEventId', 'responseVerdictEventId', 'engineResolutionEventId'] as const
      ).flatMap((field): Mutation[] => [
        [`operator-marker event id in ${field}`, (f) => (f[field] = 'evt-op-000001')],
        [`under-width event id in ${field}`, (f) => (f[field] = 'evt-12')],
        [`bare-string event id in ${field}`, (f) => (f[field] = 'accepted')],
      ]),
      // Co-null refinement, violated in BOTH directions: the tick and the
      // submission id are read off ONE indexed event, so exactly one being
      // null can only mean they were derived independently.
      [
        'null logicalSubmittedTick beside a submission event id',
        (f) => (f.logicalSubmittedTick = null),
      ],
      [
        'null engineSubmissionEventId beside a submitted tick',
        (f) => (f.engineSubmissionEventId = null),
      ],
      // 'accepted'/'rejected' are RESPONSE-level verdicts, reachable only by
      // finding a verdict event — whose id must therefore be present.
      [
        "engineOutcome 'accepted' without a verdict event",
        (f) => (f.responseVerdictEventId = null),
      ],
      [
        "engineOutcome 'rejected' without a verdict event",
        (f) => {
          f.engineOutcome = 'rejected';
          f.responseVerdictEventId = null;
        },
      ],
    ]);
  });

  it("accepts engineOutcome 'superseded' (A1) and every strictDisposition (V4)", () => {
    for (const engineOutcome of ['accepted', 'rejected', 'expired', 'superseded', null]) {
      const row = validFinalizedRow();
      row.engineOutcome = engineOutcome;
      expect(
        finalizedTraceEntrySchema.safeParse(row).success,
        `engineOutcome ${String(engineOutcome)}`,
      ).toBe(true);
    }
    for (const disposition of [
      'gateway-answered',
      'never-dispatched',
      'gateway-interrupted',
      'moot-after-resolution',
      'stale-run-discard',
      null,
    ]) {
      const row = validFinalizedRow();
      row.strictDisposition = disposition;
      expect(
        finalizedTraceEntrySchema.safeParse(row).success,
        `strictDisposition ${String(disposition)}`,
      ).toBe(true);
    }
  });

  it('accepts a null verdict wherever no response was verdicted — including the E3 null-outcome row', () => {
    // Provider failures, plain expiries, and pre-answer supersessions have no
    // verdict event; only 'accepted'/'rejected' obligate one. The null case
    // is the E3 combination: a request resolved by an acceptance of a
    // DIFFERENT responseId than this row's, so the shared ladder returns a
    // null engineOutcome while engineResolutionEventId names that acceptance
    // — legal and non-contradictory, the two fields answer different
    // questions.
    for (const engineOutcome of ['expired', 'superseded', null]) {
      const row = validFinalizedRow();
      row.engineOutcome = engineOutcome;
      row.responseVerdictEventId = null;
      expect(
        finalizedTraceEntrySchema.safeParse(row).success,
        `null verdict under engineOutcome ${String(engineOutcome)}`,
      ).toBe(true);
    }
  });

  it('accepts a degraded unresolved row: null engineResolutionEventId is a finalizer criterion, not a schema bar', () => {
    // The E8 shape — a ledger missing its terminal expiry, archived under
    // --allow-degraded: nothing entered the engine and nothing resolved the
    // request, so all three ids (and the co-null tick) are null. Strict
    // completeness (non-null resolution for every ledger-requested external
    // requestId) is enforced by the finalizer, deliberately NOT here.
    const degraded = validFinalizedRow();
    degraded.engineOutcome = null;
    degraded.logicalSubmittedTick = null;
    degraded.engineSubmissionEventId = null;
    degraded.responseVerdictEventId = null;
    degraded.engineResolutionEventId = null;
    expect(finalizedTraceEntrySchema.safeParse(degraded).success).toBe(true);
  });
});

describe('finalManifestSchema v2 (strict matrix)', () => {
  it('accepts a valid completed manifest and rejects every field-level defect', () => {
    strictMatrix(finalManifestSchema, validFinalManifest, [
      ['v1 version literal', (f) => (f.manifestFinalSchemaVersion = 1)],
      ['unknown status', (f) => (f.status = 'partial')],
      ['missing status', (f) => delete f.status],
      ['missing runCompletedAtUtc', (f) => delete f.runCompletedAtUtc],
      ['missing exportedAtUtc', (f) => delete f.exportedAtUtc],
      ['missing failedCriteria', (f) => delete f.failedCriteria],
      ['non-string failedCriteria entry', (f) => (f.failedCriteria = [1])],
      ['missing requestsSeenByClient', (f) => delete f.requestsSeenByClient],
      ['fractional requestsSeenByClient', (f) => (f.requestsSeenByClient = 1.5)],
      ['negative requestsWithGatewayResult', (f) => (f.requestsWithGatewayResult = -1)],
      ['fractional requestsDispatchedToGateway', (f) => (f.requestsDispatchedToGateway = 0.5)],
      ['unknown extra field', (f) => (f.extra = 1)],
      ['unknown completeness source', (f) => (f.completeness = { sources: ['other'], notes: [] })],
      ['bad worldStateHash', (f) => (f.worldStateHash = 'zz')],
    ]);
  });

  it("accepts status 'degraded' with failedCriteria and null client counters (V3)", () => {
    const degraded = validFinalManifest();
    degraded.status = 'degraded';
    degraded.failedCriteria = ['client bundle v2 present'];
    degraded.runCompletedAtUtc = null;
    degraded.exportedAtUtc = null;
    degraded.requestsSeenByClient = null;
    degraded.requestsWithGatewayResult = null;
    degraded.requestsDispatchedToGateway = null;
    expect(finalManifestSchema.safeParse(degraded).success).toBe(true);
  });
});

describe('bundleManifestSchema v2 (strict matrix)', () => {
  it('accepts the finalize producer shape and rejects defects', () => {
    strictMatrix(bundleManifestSchema, validFinalizeBundleManifest, [
      ['v1 version literal', (f) => (f.bundleManifestSchemaVersion = 1)],
      ['unknown producer', (f) => (f.producer = 'model:other')],
      ['missing status', (f) => delete f.status],
      ['unknown status', (f) => (f.status = 'partial')],
      ['16-hex aggregateSha256', (f) => (f.aggregateSha256 = HASH16)],
      ['unknown extra field', (f) => (f.extra = 1)],
      [
        'summarize-shaped files under the finalize producer',
        (f) => (f.files = (validSummarizeBundleManifest() as { files: unknown }).files),
      ],
    ]);
    for (const status of ['completed', 'degraded', null]) {
      const manifest = validFinalizeBundleManifest();
      manifest.status = status;
      expect(bundleManifestSchema.safeParse(manifest).success, `status ${String(status)}`).toBe(
        true,
      );
    }
  });

  it('accepts the summarize producer shape, whose status STAYS null', () => {
    strictMatrix(bundleManifestSchema, validSummarizeBundleManifest, [
      ['v1 version literal', (f) => (f.bundleManifestSchemaVersion = 1)],
      ["non-null status (summarize's stays null)", (f) => (f.status = 'completed')],
      ['finalize-shaped files under the summarize producer', (f) => (f.files = [])],
      ['unknown extra field', (f) => (f.extra = 1)],
    ]);
  });
});
