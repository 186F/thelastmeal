import type { EventEnvelope } from '../../shared/events';
import { fnv1a64Hex } from './hash';
import { canonicalSerialize } from './serialize';

/**
 * Canonical ledger hash (remediation 4) and the shared canonical event-stream
 * projection used by the determinism suite (remediation 5).
 *
 * The projection:
 *  - EXCLUDES operator pause/resume markers entirely (they are audit
 *    bookkeeping, never authoritative history), and
 *  - OMITS the raw `seq` field: markers shift every later seq, while
 *    canonical event IDs come from a marker-independent counter, so IDs are
 *    the pause-invariant ordering witness. (Renumbering seq instead would
 *    conflict with the exported file's `seq === index` integrity check.)
 *  - OMITS the constant per-event `schemaVersion` (validated separately).
 *  - INCLUDES everything else verbatim: id, type, tick, actor, target,
 *    causation, correlation, and the exact payload.
 *
 * Provider diagnostics recorded as canonical audit events DO affect this
 * hash — that is intended. They never affect `worldStateHash` unless they
 * change persistent state.
 */

export interface CanonicalEventProjection {
  id: string;
  type: string;
  tick: number;
  actorId: string | null;
  targetId: string | null;
  causationId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
}

export function canonicalEventStreamProjection(
  events: readonly EventEnvelope[],
): CanonicalEventProjection[] {
  return events
    .filter((e) => e.type !== 'SimulationPaused' && e.type !== 'SimulationResumed')
    .map((e) => ({
      id: e.id,
      type: e.type,
      tick: e.tick,
      actorId: e.actorId,
      targetId: e.targetId,
      causationId: e.causationId,
      correlationId: e.correlationId,
      payload: e.payload,
    }));
}

export function serializeCanonicalEventStream(events: readonly EventEnvelope[]): string {
  return canonicalSerialize(canonicalEventStreamProjection(events));
}

export function canonicalLedgerHash(events: readonly EventEnvelope[]): string {
  return fnv1a64Hex(serializeCanonicalEventStream(events));
}
