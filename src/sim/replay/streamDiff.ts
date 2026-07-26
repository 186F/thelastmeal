import type { EventEnvelope } from '../../shared/events';
import { canonicalSerialize } from './serialize';
import { canonicalEventStreamProjection } from './ledgerHash';

/**
 * Rich canonical event-stream mismatch reporting (remediation 5).
 *
 * On divergence, reports the scenario, seed, first differing canonical event
 * index, both event IDs and types, the logical tick, and a field-level diff
 * of the first differing event — never just "streams differ".
 */
export function diffCanonicalStreams(
  scenarioId: string,
  seed: number,
  expected: readonly EventEnvelope[],
  actual: readonly EventEnvelope[],
): string {
  const a = canonicalEventStreamProjection(expected);
  const b = canonicalEventStreamProjection(actual);
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    const leftSerialized = canonicalSerialize(left);
    const rightSerialized = canonicalSerialize(right);
    if (leftSerialized === rightSerialized) continue;
    const fieldDiffs: string[] = [];
    const keys = ['id', 'type', 'tick', 'actorId', 'targetId', 'causationId', 'correlationId'];
    for (const key of keys) {
      const lv = (left as unknown as Record<string, unknown>)[key];
      const rv = (right as unknown as Record<string, unknown>)[key];
      if (lv !== rv) fieldDiffs.push(`${key}: ${String(lv)} != ${String(rv)}`);
    }
    const leftPayload = canonicalSerialize(left.payload);
    const rightPayload = canonicalSerialize(right.payload);
    if (leftPayload !== rightPayload) {
      fieldDiffs.push(`payload: ${truncate(leftPayload, 300)} != ${truncate(rightPayload, 300)}`);
    }
    return (
      `scenario=${scenarioId} seed=${seed} first-divergence-at-canonical-index=${i} ` +
      `expected=(${left.id} ${left.type} tick=${left.tick}) ` +
      `actual=(${right.id} ${right.type} tick=${right.tick}) ` +
      `diff: ${fieldDiffs.join('; ')}`
    );
  }
  if (a.length !== b.length) {
    const longer = a.length > b.length ? a : b;
    const extra = longer[limit]!;
    return (
      `scenario=${scenarioId} seed=${seed} canonical-length-mismatch ` +
      `expected=${a.length} actual=${b.length}; ` +
      `first-extra-event=(${extra.id} ${extra.type} tick=${extra.tick}) on the ` +
      `${a.length > b.length ? 'expected' : 'actual'} side`
    );
  }
  return `scenario=${scenarioId} seed=${seed} streams-identical`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
