import type { ModelTraceEntry } from '../tracing/modelTraceWriter';

/** Infrastructure metrics over one run's trace entries (milestone 001,
 * section 21). Engine-lifecycle and behavioral metrics are joined from the
 * exported canonical ledger by scripts/model/summarize.ts. */

export interface InfraMetrics {
  externalRequests: number;
  upstreamCallsAttempted: number;
  callsCompleted: number;
  callsFailedByCategory: Record<string, number>;
  maxConcurrentCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMsMin: number | null;
  latencyMsMedian: number | null;
  latencyMsP95: number | null;
  latencyMsMax: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function computeInfraMetrics(entries: readonly ModelTraceEntry[]): InfraMetrics {
  const latencies = entries
    .map((e) => e.latencyMs)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const failed: Record<string, number> = {};
  let completed = 0;
  let attempted = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const entry of entries) {
    // budget/queue failures never reached the upstream adapter.
    if (entry.gatewayOutcome !== 'budget-exhausted') attempted += 1;
    if (entry.gatewayOutcome === 'response') completed += 1;
    else failed[entry.gatewayOutcome] = (failed[entry.gatewayOutcome] ?? 0) + 1;
    inputTokens += entry.inputTokens ?? 0;
    outputTokens += entry.outputTokens ?? 0;
    totalTokens += entry.totalTokens ?? 0;
  }
  return {
    externalRequests: entries.length,
    upstreamCallsAttempted: attempted,
    callsCompleted: completed,
    callsFailedByCategory: failed,
    maxConcurrentCalls: entries.reduce((max, e) => Math.max(max, e.concurrentInFlight), 0),
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMsMin: latencies[0] ?? null,
    latencyMsMedian: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    latencyMsMax: latencies[latencies.length - 1] ?? null,
  };
}
