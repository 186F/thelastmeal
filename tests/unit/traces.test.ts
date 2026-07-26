import { describe, expect, it } from 'vitest';
import { buildBehaviorOnlyTraces, buildContextRichTraces } from '../../src/sim/traces';
import { getScenario } from '../../src/sim/scenarios/definitions';
import type { BlindingMap } from '../../src/shared/traces';
import { completedRun } from '../helpers';

const TEST_BLINDING: BlindingMap = {
  sessionLabel: 'session-test0001',
  labelByNpc: { mara: 'agent-B', jonas: 'agent-C', rin: 'agent-A' },
};

describe('context-rich traces (diagnostic mode)', () => {
  it('produces one trace per NPC with structured decision rows under real ids', () => {
    const run = completedRun('A');
    const traceExport = buildContextRichTraces(getScenario('A'), run.ledger.events);
    expect(traceExport.mode).toBe('context-rich');
    expect(traceExport.note).toContain('UNSUITABLE');
    expect(traceExport.traces).toHaveLength(3);
    for (const trace of traceExport.traces) {
      expect(['mara', 'jonas', 'rin']).toContain(trace.actorId);
      expect(trace.rows.length).toBeGreaterThan(0);
      for (const row of trace.rows) {
        expect(row.availableCategories.length).toBeGreaterThan(0);
        expect(row.chosenCategory).toBeTruthy();
        expect(typeof row.hungerMicro).toBe('number');
        expect(['started', 'rejected', 'continued']).toContain(row.outcome);
      }
    }
  });

  it('keeps behavioral distinctions visible (different actors choose differently)', () => {
    const run = completedRun('A');
    const traceExport = buildContextRichTraces(getScenario('A'), run.ledger.events);
    const signatures = traceExport.traces.map((t) =>
      JSON.stringify(t.rows.map((r) => r.chosenCategory)),
    );
    // The three actors must not have identical decision sequences.
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });
});

describe('behavior-only blinded traces (remediation 7)', () => {
  it('contains no NPC names, trait labels, role facts, scenario id, or seed', () => {
    const run = completedRun('C');
    const blinded = buildBehaviorOnlyTraces(getScenario('C'), run.ledger.events, TEST_BLINDING);
    const text = JSON.stringify(blinded).toLowerCase();
    for (const forbidden of [
      'mara',
      'jonas',
      'rin',
      'diligence',
      'empathy',
      'suspicion',
      'pride',
      'owns-meal-reservation',
      'debtor',
      'creditor',
      'commitmentstate',
      '"scenarioid"',
      '"seed"',
      '1003', // scenario C's public seed
    ]) {
      expect(text.includes(forbidden), `blinded trace leaks "${forbidden}"`).toBe(false);
    }
  });

  it('bands injury severity instead of exposing exact magnitudes', () => {
    const run = completedRun('C');
    const blinded = buildBehaviorOnlyTraces(getScenario('C'), run.ledger.events, TEST_BLINDING);
    const text = JSON.stringify(blinded);
    expect(text.includes('550000')).toBe(false); // the identifying scripted severity
    const allRows = blinded.traces.flatMap((t) => t.rows);
    expect(allRows.some((r) => r.injuryBand === 'serious')).toBe(true);
    for (const row of allRows) {
      expect(['none', 'minor', 'serious', 'incapacitating']).toContain(row.injuryBand);
    }
  });

  it('uses only the injected blinding labels and session label', () => {
    const run = completedRun('A');
    const blinded = buildBehaviorOnlyTraces(getScenario('A'), run.ledger.events, TEST_BLINDING);
    expect(blinded.sessionLabel).toBe('session-test0001');
    expect(blinded.traces.map((t) => t.actorLabel).sort()).toEqual([
      'agent-A',
      'agent-B',
      'agent-C',
    ]);
  });

  it('labels are NOT reconstructible from the scenario seed: the sim core contains no permutation logic', () => {
    // Two different injected maps must produce identically-shaped exports
    // with different labels — the mapping comes only from the injected
    // blinding, never from seed-derived computation inside the sim.
    const run = completedRun('A');
    const other: BlindingMap = {
      sessionLabel: 'session-test0002',
      labelByNpc: { mara: 'agent-A', jonas: 'agent-B', rin: 'agent-C' },
    };
    const first = buildBehaviorOnlyTraces(getScenario('A'), run.ledger.events, TEST_BLINDING);
    const second = buildBehaviorOnlyTraces(getScenario('A'), run.ledger.events, other);
    const rowsByLabelFirst = new Map(first.traces.map((t) => [t.actorLabel, t.rows]));
    const rowsByLabelSecond = new Map(second.traces.map((t) => [t.actorLabel, t.rows]));
    // rin's rows carry label agent-A in the first map and agent-C in the second.
    expect(JSON.stringify(rowsByLabelFirst.get('agent-A'))).toBe(
      JSON.stringify(rowsByLabelSecond.get('agent-C')),
    );
  });

  it('retains generalized context flags only', () => {
    const run = completedRun('D');
    const blinded = buildBehaviorOnlyTraces(getScenario('D'), run.ledger.events, TEST_BLINDING);
    const allFlags = new Set(blinded.traces.flatMap((t) => t.rows.flatMap((r) => r.contextFlags)));
    for (const flag of allFlags) {
      expect([
        'resource-conflict-present',
        'obligation-present',
        'other-agent-injured',
        'meal-gone',
      ]).toContain(flag);
    }
    // D's transfer-request conflict must surface through the generalized flag.
    expect(allFlags.has('resource-conflict-present')).toBe(true);
  });
});
