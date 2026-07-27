import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelTraceEntry, RunManifestSeed } from '../../src/shared/modelArtifacts';

/**
 * Noncanonical model-run trace. One JSONL entry per gateway request under
 * `<traceDir>/<runId>/model-trace.jsonl`, a run manifest seeded at first sight
 * of a run, exact request envelopes under `requests/`, and optional upstream
 * router evidence under `routing/`.
 *
 * Wall-clock timestamps and routing metadata are diagnostic only and never
 * enter canonical state. The formal bundle manifest recursively hashes these
 * sidecars together with the other run evidence.
 *
 * NEVER recorded: API keys, authorization headers, process environment,
 * cookies, or hidden model reasoning.
 */

export type { ModelTraceEntry, RunManifestSeed };

export interface RouterTraceEntry {
  routingSchemaVersion: 1;
  runId: string;
  requestId: string;
  upstreamProviderId: string | null;
  /** Opaque JSON-safe router metadata. Consumers must ignore unknown fields. */
  metadata: Record<string, unknown> | null;
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

  /** Persists the exact validated envelope as a pretty-printed sidecar
   * (`requests/<requestId>.json`). Called by the gateway ONLY after full
   * validation and only for a non-duplicate dispatch. */
  writeRequest(runId: string, requestId: string, envelope: unknown): void {
    const dir = join(this.runDir(runId), 'requests');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${requestId}.json`), JSON.stringify(envelope, null, 2), 'utf8');
  }

  /** Persists OpenRouter routing evidence separately from the vendor-neutral
   * model trace. The sidecar is written at most once per non-duplicate
   * dispatch and is recursively covered by bundle-manifest.json. */
  writeRouterMetadata(entry: RouterTraceEntry): void {
    const dir = join(this.runDir(entry.runId), 'routing');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${entry.requestId}.json`), JSON.stringify(entry, null, 2), 'utf8');
  }
}

/** In-memory writer for tests: identical interface, no filesystem. */
export class MemoryTraceWriter extends ModelTraceWriter {
  readonly entries: ModelTraceEntry[] = [];
  readonly manifests: RunManifestSeed[] = [];
  /** Envelope sidecars keyed `<runId>:<requestId>`. */
  readonly requests = new Map<string, unknown>();
  /** Routing sidecars keyed `<runId>:<requestId>`. */
  readonly routing = new Map<string, RouterTraceEntry>();

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

  override writeRouterMetadata(entry: RouterTraceEntry): void {
    this.routing.set(`${entry.runId}:${entry.requestId}`, entry);
  }
}
