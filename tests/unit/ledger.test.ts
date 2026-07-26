import { describe, expect, it } from 'vitest';
import { EventLedger, makeDraft } from '../../src/sim/events/ledger';
import { SCHEMA_VERSION } from '../../src/shared/versions';

function timeDraft(tick: number) {
  return makeDraft({
    type: 'TimeAdvanced',
    tick,
    actorId: null,
    targetId: null,
    causationId: null,
    correlationId: null,
    payload: { tick },
  });
}

describe('append-only event ledger', () => {
  it('assigns contiguous sequence numbers and stable IDs', () => {
    const ledger = new EventLedger();
    const first = ledger.append(timeDraft(1));
    const second = ledger.append(timeDraft(2));
    expect(first.seq).toBe(0);
    expect(first.id).toBe('evt-000000');
    expect(second.seq).toBe(1);
    expect(second.id).toBe('evt-000001');
    expect(ledger.length).toBe(2);
    expect(ledger.events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('preserves append order', () => {
    const ledger = new EventLedger();
    for (let i = 1; i <= 20; i += 1) ledger.append(timeDraft(i));
    const ticks = ledger.events.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('rejects appends after sealing', () => {
    const ledger = new EventLedger();
    ledger.append(timeDraft(1));
    ledger.seal();
    expect(() => ledger.append(timeDraft(2))).toThrow(/sealed/);
  });

  it('rejects drafts with a wrong schema version', () => {
    const ledger = new EventLedger();
    const bad = { ...timeDraft(1), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => ledger.append(bad)).toThrow(/schema/);
  });
});
