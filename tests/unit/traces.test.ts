import { describe, expect, it } from 'vitest';
import { buildAnonymizedTraces } from '../../src/sim/traces';
import { getScenario } from '../../src/sim/scenarios/definitions';
import { completedRun } from '../helpers';

describe('anonymized individuality traces', () => {
  it('produces one trace per NPC with structured decision rows', () => {
    const run = completedRun('A');
    const traceExport = buildAnonymizedTraces(getScenario('A'), run.ledger.events);
    expect(traceExport.traces).toHaveLength(3);
    for (const trace of traceExport.traces) {
      expect(trace.actorLabel).toMatch(/^actor-[123]$/);
      expect(trace.rows.length).toBeGreaterThan(0);
      for (const row of trace.rows) {
        expect(row.availableCategories.length).toBeGreaterThan(0);
        expect(row.chosenCategory).toBeTruthy();
        expect(typeof row.hungerMicro).toBe('number');
        expect(['started', 'rejected', 'continued']).toContain(row.outcome);
      }
    }
  });

  it('contains no NPC names, trait labels, or biography wording anywhere', () => {
    const run = completedRun('C');
    const traceExport = buildAnonymizedTraces(getScenario('C'), run.ledger.events);
    const text = JSON.stringify(traceExport).toLowerCase();
    for (const forbidden of [
      'mara',
      'jonas',
      'rin',
      'diligence',
      'empathy',
      'suspicion',
      'pride',
    ]) {
      expect(text.includes(forbidden), `trace leaks "${forbidden}"`).toBe(false);
    }
  });

  it('keeps behavioral distinctions visible (different actors choose differently)', () => {
    const run = completedRun('A');
    const traceExport = buildAnonymizedTraces(getScenario('A'), run.ledger.events);
    const signatures = traceExport.traces.map((t) =>
      JSON.stringify(t.rows.map((r) => r.chosenCategory)),
    );
    // The three actors must not have identical decision sequences.
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });
});
