import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, SCENARIO_IDS } from '../../src/shared/ids';
import {
  EVENT_SCHEMAS_BY_TYPE,
  parseSimEvent,
  validateEventExact,
} from '../../src/sim/events/eventSchemas';
import { completedRun } from '../helpers';

/**
 * Remediation 3: exact per-event-type runtime schemas. Every genuine event
 * from every scenario parses; malformed shapes are rejected; the schema set
 * cannot silently drift from the event vocabulary.
 */

describe('schema completeness and round-trips', () => {
  it('every declared event type has exactly one exact schema', () => {
    expect(EVENT_SCHEMAS_BY_TYPE.size).toBe(EVENT_TYPES.length);
    for (const type of EVENT_TYPES) {
      expect(EVENT_SCHEMAS_BY_TYPE.has(type), `missing schema for ${type}`).toBe(true);
    }
  });

  for (const id of SCENARIO_IDS) {
    it(`every event of a live scenario ${id} run passes its exact schema`, () => {
      const run = completedRun(id);
      for (const event of run.ledger.events) {
        const problem = validateEventExact(JSON.parse(JSON.stringify(event)));
        expect(problem, `${event.id} (${event.type}): ${problem ?? ''}`).toBeNull();
      }
    });
  }

  it('parseSimEvent round-trips a genuine event unchanged', () => {
    const run = completedRun('A');
    const sample = JSON.parse(JSON.stringify(run.ledger.events[10]!));
    expect(parseSimEvent(sample)).toEqual(sample);
  });
});

describe('malformed events are rejected', () => {
  function genuine(type: string): Record<string, unknown> {
    const run = completedRun('A');
    const event = run.ledger.events.find((e) => e.type === type);
    expect(event, `no ${type} event in scenario A`).toBeDefined();
    return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
  }

  it('rejects unknown event types', () => {
    const event = genuine('TimeAdvanced');
    event.type = 'WarpTime';
    expect(validateEventExact(event)).toContain('unknown-event-type');
  });

  it('rejects unknown payload properties (.strict())', () => {
    const event = genuine('TimeAdvanced');
    (event.payload as Record<string, unknown>).extra = 1;
    expect(validateEventExact(event)).not.toBeNull();
  });

  it('rejects missing payload fields', () => {
    const event = genuine('MealConsumed');
    delete (event.payload as Record<string, unknown>).hungerAfterMicro;
    expect(validateEventExact(event)).not.toBeNull();
  });

  it('rejects mistyped and out-of-range values', () => {
    const float = genuine('RepairProgressed');
    (float.payload as Record<string, unknown>).unitsDelta = 2.5;
    expect(validateEventExact(float)).not.toBeNull();

    const range = genuine('RepairProgressed');
    (range.payload as Record<string, unknown>).progressUnits = 999_999_999;
    expect(validateEventExact(range)).not.toBeNull();

    const badNpc = genuine('MealConsumed');
    (badNpc.payload as Record<string, unknown>).npcId = 'zorp';
    expect(validateEventExact(badNpc)).not.toBeNull();
  });

  it('rejects malformed structured IDs', () => {
    const event = genuine('ActionStarted');
    (event.payload as Record<string, unknown>).actionId = 'not-an-action-id';
    expect(validateEventExact(event)).not.toBeNull();
  });

  it('rejects nullability violations', () => {
    const event = genuine('ScenarioStarted');
    (event as Record<string, unknown>).actorId = 'not-an-npc';
    expect(validateEventExact(event)).not.toBeNull();
  });
});
