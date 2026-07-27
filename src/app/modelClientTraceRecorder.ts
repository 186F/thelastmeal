import type { ClientTraceEntry } from '../shared/modelArtifacts';

/**
 * Slim client-side model trace (re-audit remediation F4, deviation D3;
 * entry schema v2 since 1.5.0 — `gatewayResultObserved`, amendment A2).
 *
 * One entry per external request the ModelGatewayClient ever sees — including
 * requests that never dispatch (queue overflow, budget exhaustion,
 * contract-mismatch fast-fails, gateway-unavailable) and results discarded by
 * the stale-runId check. Entries carry identity + timing + outcome ONLY: no
 * request payloads, no secrets, no environment. Exact envelopes are persisted
 * by the GATEWAY as `requests/<requestId>.json` sidecars and archived
 * client-side into the run bundle's `exactRequestEnvelopes` (1.5.0 C2).
 * Wall-clock timestamps are allowed here (noncanonical diagnostics); they are
 * never join keys — joins are by requestId.
 */

// Single source: the shared artifact contracts module owns the version.
export { CLIENT_TRACE_SCHEMA_VERSION } from '../shared/modelArtifacts';

export type ClientTraceOutcome = ClientTraceEntry['clientOutcome'];

/** The recorder stores EXACTLY the shared client-trace entry shape from
 * src/shared/modelArtifacts (`clientTraceEntrySchema`) — one source, no
 * per-layer copy (G1); re-audit F9 removed the hand-written widened mirror. */
export type ModelClientTraceEntry = ClientTraceEntry;

/** Owned by ModelGatewayClient; reset on newRun(). A late result from a
 * superseded run records its `discarded-stale-run` entry into the CURRENT
 * recorder (keyed by its own old runId) — the request's original entry was
 * cleared with its run, and the discard is the last thing the client ever
 * sees of it. */
export class ModelClientTraceRecorder {
  private readonly entriesByKey = new Map<string, ModelClientTraceEntry>();

  /** Appends a finalized entry; at most one per (runId, requestId). */
  record(entry: ModelClientTraceEntry): void {
    const key = `${entry.runId}:${entry.requestId}`;
    if (this.entriesByKey.has(key)) return;
    this.entriesByKey.set(key, entry);
  }

  /** Snapshot copy in insertion order. */
  entries(): ModelClientTraceEntry[] {
    return [...this.entriesByKey.values()].map((entry) => ({ ...entry }));
  }

  reset(): void {
    this.entriesByKey.clear();
  }
}
