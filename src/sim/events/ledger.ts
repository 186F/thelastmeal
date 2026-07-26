import { SCHEMA_VERSION } from '../../shared/versions';
import type { EventDraft, SimEvent } from './types';

/**
 * Append-only authoritative event ledger. Events receive their sequence
 * number and ID at append time; nothing may be removed or rewritten during a
 * run.
 */
export class EventLedger {
  private readonly eventList: SimEvent[] = [];
  private sealed = false;
  private canonicalCount = 0;
  private operatorMarkerCount = 0;

  get length(): number {
    return this.eventList.length;
  }

  get events(): readonly SimEvent[] {
    return this.eventList;
  }

  at(seq: number): SimEvent | undefined {
    return this.eventList[seq];
  }

  last(): SimEvent | undefined {
    return this.eventList[this.eventList.length - 1];
  }

  append(draft: EventDraft): SimEvent {
    if (this.sealed) {
      throw new Error('ledger-sealed: cannot append to a sealed ledger');
    }
    if (draft.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`ledger-schema-mismatch: got ${draft.schemaVersion}`);
    }
    const seq = this.eventList.length;
    // Operator pause/resume markers take IDs from their own counter so that
    // canonical event IDs (which appear in beliefs, memories, and causation
    // links inside canonical state) are identical whether or not the operator
    // ever paused. Pausing must never alter authoritative outcomes.
    const isOperatorMarker =
      draft.type === 'SimulationPaused' || draft.type === 'SimulationResumed';
    const id = isOperatorMarker
      ? `evt-op-${String(this.operatorMarkerCount).padStart(4, '0')}`
      : `evt-${String(this.canonicalCount).padStart(6, '0')}`;
    if (isOperatorMarker) this.operatorMarkerCount += 1;
    else this.canonicalCount += 1;
    const event = { ...draft, seq, id } as SimEvent;
    this.eventList.push(event);
    return event;
  }

  /** Seal the ledger once the scenario reaches its terminal state. */
  seal(): void {
    this.sealed = true;
  }

  toJSON(): SimEvent[] {
    return [...this.eventList];
  }
}

export function makeDraft<E extends SimEvent>(
  fields: Omit<EventDraft<E>, 'schemaVersion'>,
): EventDraft<E> {
  return { ...fields, schemaVersion: SCHEMA_VERSION } as EventDraft<E>;
}
