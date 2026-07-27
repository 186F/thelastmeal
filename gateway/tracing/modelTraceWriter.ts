import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelTraceEntry, RunManifestSeed } from '../../src/shared/modelArtifacts';

/**
 * Noncanonical model-run trace (milestone 001, section 17; trace schema v2 in
 * re-audit remediation G1). One JSONL entry per gateway request under
 * `<traceDir>/<runId>/model-trace.jsonl`, a run manifest seeded at first
 * sight of a run, and — after full validation, for every non-duplicate
 * dispatch — the exact validated envelope as
 * `<traceDir>/<runId>/requests/<requestId>.json` (G2, deviation D3).
 * Wall-clock timestamps are diagnostic only and never enter canonical state.
 *
 * Entry/seed types and their exact schemas live in
 * src/shared/modelArtifacts.ts (shared with the finalizer); this module keeps
 * only the writer classes.
 *
 * NEVER recorded: API keys, authorization headers, process environment,
 * cookies, or hidden model reasoning — entries are built exclusively from
 * the validated envelope, the validated model choice, and adapter metadata.
 */

export type { ModelTraceEntry, RunManifestSeed };

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

  /** Persists the exact validated envelope as a pretty-printed sidecar
   * (`requests/<requestId>.json`). Called by the gateway ONLY after full
   * validation and only for a non-duplicate dispatch — never on idempotent
   * replays, never on pre-validation rejects. `requestId` is schema-checked
   * (`dec-\d{4,}`) before any call, so the file name is always safe. */
  writeRequest(runId: string, requestId: string, envelope: unknown): void {
    const dir = join(this.runDir(runId), 'requests');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${requestId}.json`), JSON.stringify(envelope, null, 2), 'utf8');
  }
}

/** In-memory writer for tests: identical interface, no filesystem. */
export class MemoryTraceWriter extends ModelTraceWriter {
  readonly entries: ModelTraceEntry[] = [];
  readonly manifests: RunManifestSeed[] = [];
  /** Envelope sidecars keyed `<runId>:<requestId>`. */
  readonly requests = new Map<string, unknown>();

  constructor() {
    super('unused');
  }

  override seedManifest(seed: RunManifestSeed): void {
    if (!this.manifests.some((m) => m.runId === seed.runId)) this.manifests.push(seed);
  }

  override append(entry: ModelTraceEntry): void {
    this.entries.push(entry);
  }

  override writeRequest(runId: string, requestId: string, envelope: unknown): void {
    this.requests.set(`${runId}:${requestId}`, envelope);
  }
}
