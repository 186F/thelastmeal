import { z } from 'zod';
import { EVENT_TYPES, type EventType, type NpcId } from './ids';
import { SCHEMA_VERSION } from './versions';

/**
 * Authoritative event envelope. Every canonical event carries this shape.
 * Fields that do not apply hold explicit `null` (never `undefined`) so that
 * canonical serialization is stable.
 *
 * Payload shapes are typed precisely inside the simulation core
 * (src/sim/events/types.ts); the envelope here is the serialization contract
 * used by the worker protocol and ledger files.
 */
export interface EventEnvelope {
  /** Stable event ID, `evt-<seq>` zero-padded. */
  id: string;
  /** Position in the append-only ledger, starting at 0. */
  seq: number;
  type: EventType;
  /** Logical timestamp (integer tick, 1 tick == 1 simulated second). */
  tick: number;
  schemaVersion: number;
  /** Acting NPC when applicable. */
  actorId: NpcId | null;
  /** Target NPC / resource / commitment ID when applicable. */
  targetId: string | null;
  /** ID of the event that directly caused this one, when applicable. */
  causationId: string | null;
  /** Correlation ID grouping multi-event actions (usually the action ID). */
  correlationId: string | null;
  /** Structured, serializable payload. Never free-form log text. */
  payload: Record<string, unknown>;
}

export const eventEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    type: z.enum(EVENT_TYPES),
    tick: z.number().int().nonnegative(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    actorId: z.enum(['mara', 'jonas', 'rin']).nullable(),
    targetId: z.string().nullable(),
    causationId: z.string().nullable(),
    correlationId: z.string().nullable(),
    payload: z.record(z.unknown()),
  })
  .strict();
