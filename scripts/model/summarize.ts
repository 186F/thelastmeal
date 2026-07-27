import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeInfraMetrics } from '../../gateway/metrics/runMetrics';
import type { ModelTraceEntry } from '../../gateway/tracing/modelTraceWriter';
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

export interface JoinedOutcome {
  requestId: string;
  gatewayOutcome: string;
  engineOutcome: string;
  engineRejectionReason: string | null;
}

/** Joins each trace entry to the engine verdict recorded in the ledger. */
export function joinEngineOutcomes(
  file: LedgerFile | null,
  trace: readonly ModelTraceEntry[],
): JoinedOutcome[] {
  if (!file) return [];
  const acceptedByRequest = new Set<string>();
  const rejectedByResponse = new Map<string, string>();
  const expiredByRequest = new Map<string, string>();
  for (const event of file.events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'DecisionResponseAccepted') {
      acceptedByRequest.add(String(payload.requestId));
    } else if (event.type === 'DecisionResponseRejected') {
      rejectedByResponse.set(String(payload.responseId), String(payload.rejectionReason));
    } else if (event.type === 'DecisionRequestExpired') {
      expiredByRequest.set(String(payload.requestId), String(payload.reasonCode));
    }
  }
  return trace.map((entry) => {
    const responseId = `gw-${entry.requestId}`;
    const rejection = rejectedByResponse.get(responseId) ?? null;
    const engineOutcome = acceptedByRequest.has(entry.requestId)
      ? 'accepted'
      : rejection !== null
        ? 'rejected'
        : (expiredByRequest.get(entry.requestId) ?? 'unresolved');
    return {
      requestId: entry.requestId,
      gatewayOutcome: entry.gatewayOutcome,
      engineOutcome,
      engineRejectionReason: rejection,
    };
  });
}

export function summarizeRunDirectory(dir: string, runId: string): { traceEntries: number } {
  const tracePath = join(dir, 'model-trace.jsonl');
  const entries: ModelTraceEntry[] = existsSync(tracePath)
    ? readFileSync(tracePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as ModelTraceEntry)
    : [];

  const ledgerFileName = readdirSync(dir).find(
    (f) => f.startsWith('ledger-') && f.endsWith('.json'),
  );
  const ledger: LedgerFile | null = ledgerFileName
    ? (JSON.parse(readFileSync(join(dir, ledgerFileName), 'utf8')) as LedgerFile)
    : null;

  // §21/§26 derived rates: model calls per genuine Mara decision opportunity
  // and per simulated NPC-hour (one model-backed NPC; 1 tick == 1 second).
  const infra = computeInfraMetrics(entries);
  const manifestPath = join(dir, 'run-manifest.json');
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { externalProviderId?: string })
    : null;
  const externalProviderId = manifest?.externalProviderId ?? 'openai-mara-action-v1';
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
  writeFileSync(join(dir, 'model-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const sha256 = (path: string): string | null =>
    existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
  const bundle = {
    runId,
    files: {
      ledger: ledgerFileName
        ? { name: ledgerFileName, sha256: sha256(join(dir, ledgerFileName)) }
        : null,
      modelTrace: { name: 'model-trace.jsonl', sha256: sha256(tracePath) },
      runManifest: { name: 'run-manifest.json', sha256: sha256(join(dir, 'run-manifest.json')) },
      modelSummary: { name: 'model-summary.json', sha256: sha256(join(dir, 'model-summary.json')) },
    },
  };
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
  const { traceEntries } = summarizeRunDirectory(dir, runId);
  console.log(
    `model-summarize: wrote model-summary.json and bundle-manifest.json for ${runId} (${traceEntries} trace entries)`,
  );
}
