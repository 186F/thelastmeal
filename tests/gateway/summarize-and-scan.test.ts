import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeRunDirectory } from '../../scripts/model/summarize';
import { CANARY_TEST_KEY, scanDist } from '../../scripts/security/scanDist';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
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

/** Adversarial-review regressions: the trace↔ledger join, the §21/§26
 * derived metrics, the bundle-hash sensitivity, and the dist scanner's
 * ability to detect its own canary. */

function traceEntry(
  requestId: string,
  outcome: ModelTraceEntry['gatewayOutcome'],
): ModelTraceEntry {
  return {
    runId: 'run-sum-0001',
    requestId,
    npcId: 'mara',
    scenarioId: 'A',
    logicalRequestedTick: 60,
    providerId: EXTERNAL_MARA_PROVIDER_ID,
    promptVersion: 'mara-action-selection-1.0.0',
    modelId: 'fake-adapter',
    contextHash: '0'.repeat(16),
    truncationCounts: {},
    upstreamResponseId: null,
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
      plan: perNpcPlan('mara-model-per-decision-v1', providers, [EXTERNAL_MARA_PROVIDER_ID]),
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
      JSON.stringify({ runId: 'run-sum-0001', externalProviderId: EXTERNAL_MARA_PROVIDER_ID }),
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
      infra: { externalRequests: number; maxConcurrentCalls: number };
      derived: {
        maraDecisionOpportunities: number;
        callsPerMaraDecisionOpportunity: number;
        modelCallsPerSimulatedNpcHour: number;
      };
      engine: { acceptedModelResponses: number };
      outcomes: { requestId: string; engineOutcome: string }[];
    };
    expect(summary.infra.externalRequests).toBe(2);
    expect(summary.infra.maxConcurrentCalls).toBe(1);
    expect(summary.engine.acceptedModelResponses).toBeGreaterThan(0);
    expect(summary.derived.maraDecisionOpportunities).toBeGreaterThan(0);
    expect(summary.derived.callsPerMaraDecisionOpportunity).toBeGreaterThan(0);
    expect(summary.derived.modelCallsPerSimulatedNpcHour).toBeGreaterThan(0);
    const joined = Object.fromEntries(summary.outcomes.map((o) => [o.requestId, o.engineOutcome]));
    expect(joined[acceptedRequestId]).toBe('accepted');
    expect(joined['dec-9999']).toBe('unresolved');

    const firstBundle = JSON.parse(readFileSync(join(dir, 'bundle-manifest.json'), 'utf8')) as {
      files: { modelTrace: { sha256: string }; ledger: { sha256: string } };
    };
    appendFileSync(
      join(dir, 'model-trace.jsonl'),
      `${JSON.stringify(traceEntry('dec-0042', 'response'))}\n`,
    );
    summarizeRunDirectory(dir, 'run-sum-0001');
    const secondBundle = JSON.parse(readFileSync(join(dir, 'bundle-manifest.json'), 'utf8')) as {
      files: { modelTrace: { sha256: string }; ledger: { sha256: string } };
    };
    expect(secondBundle.files.modelTrace.sha256).not.toBe(firstBundle.files.modelTrace.sha256);
    expect(secondBundle.files.ledger.sha256).toBe(firstBundle.files.ledger.sha256);
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
