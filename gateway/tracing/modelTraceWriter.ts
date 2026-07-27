import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExternalFailureCode } from '../../src/shared/decisionContracts';

/**
 * Noncanonical model-run trace (milestone 001, section 17). One JSONL entry
 * per gateway request under `<traceDir>/<runId>/model-trace.jsonl`, plus a
 * run manifest seeded at first sight of a run. Wall-clock timestamps are
 * diagnostic only and never enter canonical state.
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
  upstreamResponseId: string | null;
  selectedAffordanceId: string | null;
  reasonCode: string | null;
  confidenceBp: number | null;
  rationale: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  /** In-flight upstream calls at dispatch time, INCLUDING this one (0 for
   * failures that never reached the adapter). Source for the §21 maximum
   * concurrent-calls metric. */
  concurrentInFlight: number;
  gatewayOutcome: 'response' | ExternalFailureCode;
  /** Joined later from the exported canonical ledger by the summarizer;
   * the gateway cannot know the engine verdict. */
  engineOutcome: null;
  engineRejectionReason: null;
}

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

export class ModelTraceWriter {
  private readonly seededRuns = new Set<string>();

  constructor(private readonly traceDir: string) {}

  runDir(runId: string): string {
    return join(this.traceDir, runId);
  }

  seedManifest(seed: RunManifestSeed): void {
    if (this.seededRuns.has(seed.runId)) return;
    const dir = this.runDir(seed.runId);
    mkdirSync(dir, { recursive: true });
    const manifestPath = join(dir, 'run-manifest.json');
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, JSON.stringify(seed, null, 2), 'utf8');
    }
    this.seededRuns.add(seed.runId);
  }

  append(entry: ModelTraceEntry): void {
    const dir = this.runDir(entry.runId);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'model-trace.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

/** In-memory writer for tests: identical interface, no filesystem. */
export class MemoryTraceWriter extends ModelTraceWriter {
  readonly entries: ModelTraceEntry[] = [];
  readonly manifests: RunManifestSeed[] = [];

  constructor() {
    super('unused');
  }

  override seedManifest(seed: RunManifestSeed): void {
    if (!this.manifests.some((m) => m.runId === seed.runId)) this.manifests.push(seed);
  }

  override append(entry: ModelTraceEntry): void {
    this.entries.push(entry);
  }
}
