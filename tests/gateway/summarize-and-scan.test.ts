import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { joinEngineOutcomes, summarizeRunDirectory } from '../../scripts/model/summarize';
import { CANARY_TEST_KEY, scanDist } from '../../scripts/security/scanDist';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';
import { perNpcPlan } from '../../src/sim/decisions/providerPlan';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { EXTERNAL_MARA_PROVIDER_ID } from '../../src/sim/decisions/externalDeferredProvider';
import {
  FixtureResponseProvider,
  fakeAdapterChoiceRule,
} from '../../src/sim/decisions/fixtureResponseProvider';
import type { NpcId } from '../../src/shared/ids';
import type { DecisionProvider } from '../../src/sim/decisions/provider';
import { MODEL_CONDITION_ID, MODEL_PROMPT_VERSION } from '../../src/shared/modelExperiment';

/** Adversarial-review regressions: the trace↔ledger join, the §21/§26
 * derived metrics, the bundle-hash sensitivity, and the dist scanner's
 * ability to detect its own canary. */

/** Trace schema v2 (re-audit remediation G1): explicit response/failure ids,
 * the offered ids from the validated envelope, and the bounded raw model
 * output on invalid-output/refusal outcomes. */
type TraceEntryV2 = ModelTraceEntry & {
  responseId: string | null;
  failureId: string | null;
  offeredAffordanceIds: string[];
  rawModelOutput: string | null;
};

function traceEntry(requestId: string, outcome: ModelTraceEntry['gatewayOutcome']): TraceEntryV2 {
  return {
    runId: 'run-sum-0001',
    requestId,
    npcId: 'mara',
    scenarioId: 'A',
    logicalRequestedTick: 60,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: MODEL_PROMPT_VERSION,
    modelId: 'fake-adapter',
    contextHash: '0'.repeat(16),
    truncationCounts: {},
    upstreamResponseId: null,
    responseId: outcome === 'response' ? `gw-${requestId}` : null,
    failureId: outcome === 'response' ? null : `gwf-${requestId}`,
    offeredAffordanceIds: ['aff:mara:60:work'],
    rawModelOutput: null,
    selectedAffordanceId: outcome === 'response' ? 'aff:mara:60:work' : null,
    reasonCode: outcome === 'response' ? 'routine' : null,
    confidenceBp: outcome === 'response' ? 5_000 : null,
    rationale: null,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    latencyMs: 42,
    concurrentInFlight: outcome === 'response' ? 1 : 0,
    gatewayOutcome: outcome,
    engineOutcome: null,
    engineRejectionReason: null,
  };
}

/** Minimal ledger-shaped fixture for join unit tests. */
function ledgerWithEvents(events: Record<string, unknown>[]): LedgerFile {
  return { events } as unknown as LedgerFile;
}

/** Any request-lifecycle event with an arbitrary payload (join unit tests). */
function lifecycleEvent(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'evt-000002',
    seq: 2,
    type,
    tick: 80,
    schemaVersion: 3,
    actorId: 'mara',
    targetId: null,
    causationId: null,
    correlationId: null,
    payload,
  };
}

function acceptanceEvent(requestId: string, responseId: string): Record<string, unknown> {
  return {
    id: 'evt-000001',
    seq: 1,
    type: 'DecisionResponseAccepted',
    tick: 80,
    schemaVersion: 3,
    actorId: 'mara',
    targetId: null,
    causationId: null,
    correlationId: null,
    payload: {
      npcId: 'mara',
      requestId,
      responseId,
      selectedAffordanceId: 'aff:mara:80:work',
      confidenceBp: 5_000,
      reasonCode: 'routine',
      usedFallback: false,
    },
  };
}

describe('model-run summarizer and bundle hashing', () => {
  it('joins trace entries to engine outcomes, derives §21/§26 rates, and bundle hashes track the trace', () => {
    // A completed fixture run provides a genuine model-shaped ledger.
    const deterministic = new DeterministicProvider();
    const fixture = new FixtureResponseProvider(EXTERNAL_MARA_PROVIDER_ID, () => ({
      delayTicks: 1,
      select: fakeAdapterChoiceRule,
      confidenceBp: 5_000,
      reasonCode: 'routine',
    }));
    const providers: Record<NpcId, DecisionProvider> = {
      mara: fixture,
      jonas: deterministic,
      rin: deterministic,
    };
    const run = createRun('A', {
      plan: perNpcPlan(MODEL_CONDITION_ID, providers, [EXTERNAL_MARA_PROVIDER_ID]),
    });
    runToCompletion(run);
    const ledger = buildLedgerFile(run);
    const acceptedRequestId = (
      run.ledger.events.find(
        (e) =>
          e.type === 'DecisionResponseAccepted' &&
          (e.payload as { responseId: string }).responseId.startsWith('gw-'),
      )!.payload as { requestId: string }
    ).requestId;

    const dir = join(mkdtempSync(join(tmpdir(), 'model-run-')), 'run-sum-0001');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ledger-A-test.json'), JSON.stringify(ledger), 'utf8');
    writeFileSync(
      join(dir, 'run-manifest.json'),
      JSON.stringify({
        runId: 'run-sum-0001',
        externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
        modelId: 'gpt-fixture',
      }),
      'utf8',
    );
    const entries = [
      traceEntry(acceptedRequestId, 'response'),
      traceEntry('dec-9999', 'upstream-timeout'),
    ];
    writeFileSync(
      join(dir, 'model-trace.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );

    summarizeRunDirectory(dir, 'run-sum-0001');
    const summary = JSON.parse(readFileSync(join(dir, 'model-summary.json'), 'utf8')) as {
      requestedModelId: string | null;
      returnedModelIds: string[];
      infra: { externalRequests: number; maxConcurrentCalls: number };
      derived: {
        maraDecisionOpportunities: number;
        callsPerMaraDecisionOpportunity: number;
        modelCallsPerSimulatedNpcHour: number;
      };
      engine: { acceptedModelResponses: number };
      outcomes: { requestId: string; engineOutcome: string }[];
    };
    // S2: what was REQUESTED (seed manifest) vs what actually ANSWERED (trace).
    expect(summary.requestedModelId).toBe('gpt-fixture');
    expect(summary.returnedModelIds).toEqual(['fake-adapter']);
    expect(summary.infra.externalRequests).toBe(2);
    expect(summary.infra.maxConcurrentCalls).toBe(1);
    expect(summary.engine.acceptedModelResponses).toBeGreaterThan(0);
    expect(summary.derived.maraDecisionOpportunities).toBeGreaterThan(0);
    expect(summary.derived.callsPerMaraDecisionOpportunity).toBeGreaterThan(0);
    expect(summary.derived.modelCallsPerSimulatedNpcHour).toBeGreaterThan(0);
    const joined = Object.fromEntries(summary.outcomes.map((o) => [o.requestId, o.engineOutcome]));
    expect(joined[acceptedRequestId]).toBe('accepted');
    expect(joined['dec-9999']).toBe('unresolved');

    interface BundleManifest {
      bundleManifestSchemaVersion: number;
      producer: string;
      status: string | null;
      files: {
        modelTrace: { name: string; sha256: string };
        ledger: { name: string; sha256: string };
        runManifest: { name: string; sha256: string };
        modelSummary: { name: string; sha256: string };
      };
      aggregateSha256: string;
    }
    const firstBundle = JSON.parse(
      readFileSync(join(dir, 'bundle-manifest.json'), 'utf8'),
    ) as BundleManifest;
    // Producer discriminator (F4/F7/F16): the informal manifest names its
    // writer so it can never be mistaken for model:finalize's whole-directory
    // evidence binding, which shares the filename. The v2 `status` verdict is
    // owned by model:finalize — the informal summarizer always writes null.
    expect(firstBundle.bundleManifestSchemaVersion).toBe(2);
    expect(firstBundle.producer).toBe('model:summarize');
    expect(firstBundle.status).toBeNull();
    // S2: the aggregate is sha256 over the sorted `<fileName>:<sha256>` lines.
    const expectedAggregate = createHash('sha256')
      .update(
        Object.values(firstBundle.files)
          .map((f) => `${f.name}:${f.sha256}`)
          .sort()
          .join('\n'),
      )
      .digest('hex');
    expect(firstBundle.aggregateSha256).toBe(expectedAggregate);
    appendFileSync(
      join(dir, 'model-trace.jsonl'),
      `${JSON.stringify(traceEntry('dec-0042', 'response'))}\n`,
    );
    summarizeRunDirectory(dir, 'run-sum-0001');
    const secondBundle = JSON.parse(
      readFileSync(join(dir, 'bundle-manifest.json'), 'utf8'),
    ) as BundleManifest;
    expect(secondBundle.files.modelTrace.sha256).not.toBe(firstBundle.files.modelTrace.sha256);
    expect(secondBundle.files.ledger.sha256).toBe(firstBundle.files.ledger.sha256);
    expect(secondBundle.aggregateSha256).not.toBe(firstBundle.aggregateSha256);
  });

  it('refuses to summarize a finalized run directory (F4/F7/F16: finalizer artifacts are never clobbered)', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'model-run-finalized-')), 'run-sum-0002');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'model-trace.jsonl'),
      `${JSON.stringify(traceEntry('dec-0001', 'response'))}\n`,
      'utf8',
    );
    // run-manifest.final.json marks the directory as finalized: its
    // model-summary.json and bundle-manifest.json belong to model:finalize.
    writeFileSync(
      join(dir, 'run-manifest.final.json'),
      JSON.stringify({ status: 'completed' }),
      'utf8',
    );
    expect(() => summarizeRunDirectory(dir, 'run-sum-0002')).toThrow(/owned by model:finalize/);
    // The refusal fires before ANY write: no informal artifact appears.
    expect(existsSync(join(dir, 'model-summary.json'))).toBe(false);
    expect(existsSync(join(dir, 'bundle-manifest.json'))).toBe(false);
  });

  it('never marks a model call accepted from a non-gw acceptance for the same requestId (S2 regression)', () => {
    // The engine accepted a DETERMINISTIC response (engine-minted responseId)
    // for the same requestId the gateway later timed out on. The old join
    // keyed acceptance on the bare requestId and called the model call
    // 'accepted'; the fixed join matches the model RESPONSE id.
    const nonGw = ledgerWithEvents([acceptanceEvent('dec-0007', 'resp-mara-000123')]);
    const joined = joinEngineOutcomes(nonGw, [traceEntry('dec-0007', 'upstream-timeout')]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.engineOutcome).toBe('unresolved');

    // A genuine gateway acceptance still joins as accepted, matched on the
    // v2 responseId recorded in the trace row.
    const gw = ledgerWithEvents([acceptanceEvent('dec-0008', 'gw-dec-0008')]);
    const accepted = joinEngineOutcomes(gw, [traceEntry('dec-0008', 'response')]);
    expect(accepted[0]!.engineOutcome).toBe('accepted');

    // A v2 row whose recorded responseId differs from the reconstructed
    // gw-<requestId> convention must be matched on the RECORDED id.
    const custom = traceEntry('dec-0009', 'response');
    custom.responseId = 'gw-run7-dec-0009';
    const customJoin = joinEngineOutcomes(
      ledgerWithEvents([acceptanceEvent('dec-0009', 'gw-run7-dec-0009')]),
      [custom],
    );
    expect(customJoin[0]!.engineOutcome).toBe('accepted');
  });

  it('reports the finalizer\'s CLOSED engine vocabulary — never a raw expiry reasonCode, never "unresolved" for a superseded request', () => {
    // model-summary.json and finalized-trace.jsonl are hash-bound into the
    // same bundle manifest, so both must speak the same vocabulary
    // (accepted | rejected | expired | superseded | unresolved). The old
    // private ladder here reported the DecisionRequestExpired reasonCode as
    // the outcome and had no supersede lookup at all (A1's third canonical
    // resolution landed as 'unresolved').
    const expired = joinEngineOutcomes(
      ledgerWithEvents([
        lifecycleEvent('DecisionRequestExpired', {
          requestId: 'dec-0010',
          reasonCode: 'scenario-ended',
        }),
      ]),
      [traceEntry('dec-0010', 'upstream-timeout')],
    );
    expect(expired[0]!.engineOutcome).toBe('expired');
    // The reason survives as a diagnostic, never as the verdict.
    expect(expired[0]!.engineExpiryReason).toBe('scenario-ended');

    const superseded = joinEngineOutcomes(
      ledgerWithEvents([lifecycleEvent('DecisionRequestSuperseded', { requestId: 'dec-0011' })]),
      [traceEntry('dec-0011', 'response')],
    );
    expect(superseded[0]!.engineOutcome).toBe('superseded');
    expect(superseded[0]!.engineExpiryReason).toBeNull();
  });
});

describe('dist secret scanner self-test', () => {
  it('detects its own canary, key path, and SDK host — and passes a clean tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-scan-'));
    writeFileSync(join(dir, 'clean.js'), 'export const ok = 1;', 'utf8');
    expect(scanDist(dir)).toEqual([]);
    writeFileSync(join(dir, 'leak.js'), `const k = "${CANARY_TEST_KEY}";`, 'utf8');
    writeFileSync(join(dir, 'leak.js.map'), '{"x":"OPENAI_API_KEY"}', 'utf8');
    writeFileSync(join(dir, 'host.js'), 'fetch("https://api.openai.com/v1")', 'utf8');
    const findings = scanDist(dir);
    expect(findings.map((f) => f.code).sort()).toEqual([
      'dist-contains-canary-key',
      'dist-references-openai-host',
      'dist-references-openai-key',
    ]);
  });
});
