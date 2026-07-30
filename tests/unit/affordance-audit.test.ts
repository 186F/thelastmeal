import { describe, expect, it } from 'vitest';
import { auditEventStream, auditStaticContracts } from '../../src/sim/audit/affordanceAudit';
import { KNOWN_GAPS, matchKnownGap } from '../../src/sim/audit/knownGaps';
import { INTERRUPTION_CONTRACTS, interruptionContractFor } from '../../src/sim/audit/contracts';
import { validateSustained } from '../../src/sim/actions/validation';
import { exportedFile } from '../ledgerCorruption';
import { freshState } from '../helpers';
import { ACTION_MODES } from '../../src/shared/ids';
import type { EventEnvelope } from '../../src/shared/events';
import type { AuditFinding } from '../../src/sim/audit/findings';

/**
 * Affordance-space and interruption-contract auditor (M2 brief §27.6–§27.7).
 * Proves: the declared contracts match actual engine behavior; the static
 * findings are exactly the registered VS001 gaps; classification follows the
 * four-way CI table (exact match → known limitation; changed shape, changed
 * scope, or new gap → unregistered).
 */

describe('interruption contracts match the actual engine', () => {
  it('declares every action mode exactly once', () => {
    expect(INTERRUPTION_CONTRACTS.length).toBe(ACTION_MODES.length);
    for (const mode of ACTION_MODES) expect(() => interruptionContractFor(mode)).not.toThrow();
  });

  it('treat: sustained check fails patient-absent when the patient leaves', () => {
    const state = freshState('A');
    state.npcs.rin.locationId = 'medical-cot';
    state.npcs.mara.locationId = 'medical-cot';
    const action = { actorId: 'mara', mode: 'treat', targetNpcId: 'rin' } as never;
    expect(validateSustained(state, action).ok).toBe(true);
    state.npcs.rin.locationId = 'routine-work-station';
    const failed = validateSustained(state, action);
    expect(failed.ok).toBe(false);
    expect((failed as { failed: string[] }).failed).toContain('patient-absent');
  });

  it('eat and eat-violation: sustained check fails meal-missing when the meal disappears', () => {
    const state = freshState('A');
    for (const mode of ['eat', 'eat-violation'] as const) {
      const action = { actorId: 'mara', mode, targetNpcId: null } as never;
      state.meal.exists = true;
      expect(validateSustained(state, action).ok).toBe(true);
      state.meal.exists = false;
      const failed = validateSustained(state, action);
      expect(failed.ok).toBe(false);
      expect((failed as { failed: string[] }).failed).toContain('meal-missing');
    }
  });

  it('work/relieve: sustained check fails when the bench reservation is lost', () => {
    const state = freshState('A');
    // Reservations are event-created; the fresh initial state has none, which
    // is itself the lost-reservation condition.
    state.reservations = state.reservations.filter((r) => r.resourceId !== 'workbench-slot');
    const action = { actorId: 'mara', mode: 'work', targetNpcId: null } as never;
    const lost = validateSustained(state, action);
    expect(lost.ok).toBe(false);
    expect((lost as { failed: string[] }).failed).toContain('bench-reservation-lost');
    // Holding it passes; another holder fails again.
    state.reservations.push({
      resourceId: 'workbench-slot',
      holderNpcId: 'mara',
      kind: 'exclusive-use',
    } as never);
    expect(validateSustained(state, action).ok).toBe(true);
    state.reservations[state.reservations.length - 1]!.holderNpcId = 'jonas';
    const taken = validateSustained(state, action);
    expect(taken.ok).toBe(false);
    expect((taken as { failed: string[] }).failed).toContain('bench-reservation-lost');
  });

  it('incapacitation terminates every mode (the universal class)', () => {
    const state = freshState('A');
    state.npcs.mara.incapacitated = true;
    const action = { actorId: 'mara', mode: 'wait', targetNpcId: null } as never;
    const failed = validateSustained(state, action);
    expect(failed.ok).toBe(false);
    expect((failed as { failed: string[] }).failed).toContain('actor-incapacitated');
  });
});

describe('static contract findings equal the registered VS001 gaps', () => {
  it('produces exactly the three advertised-non-interruptible gaps, all registered', () => {
    const findings = auditStaticContracts();
    expect(findings.map((f) => `${f.key.mode}:${f.key.classes}`).sort()).toEqual([
      'eat-violation:meal-missing',
      'eat:meal-missing',
      'treat:patient-absent',
    ]);
    for (const finding of findings) {
      const gap = matchKnownGap(finding);
      expect(gap, `unregistered static finding ${JSON.stringify(finding.key)}`).not.toBeNull();
    }
  });
});

describe('known-gap classification (§27.7 CI table)', () => {
  const treatFinding: AuditFinding = {
    checkId: 'non-interruptible-mode-has-world-interruption',
    scenarioId: 'C',
    key: { mode: 'treat', classes: 'patient-absent' },
    detail: 'observed',
  };

  it('exact match → known limitation', () => {
    expect(matchKnownGap(treatFinding)?.knownGapId).toBe('KG-VS001-TREAT-SUSTAINED-INTERRUPTION');
  });

  it('changed shape → no match (fails CI)', () => {
    expect(
      matchKnownGap({
        ...treatFinding,
        key: { mode: 'treat', classes: 'patient-absent+patient-incapacitated' },
      }),
    ).toBeNull();
    expect(matchKnownGap({ ...treatFinding, checkId: 'other-check' })).toBeNull();
  });

  it('changed scope → no match (scenario-scoped gaps stay scoped)', () => {
    const renegotiation: AuditFinding = {
      checkId: 'renegotiation-proposal-without-response-opportunity',
      scenarioId: 'C',
      key: { commitmentKind: 'relieve-at-bench' },
      detail: 'observed',
    };
    expect(matchKnownGap(renegotiation)?.knownGapId).toBe('KG-VS001-RENEGOTIATION-RESPONSE-WINDOW');
    expect(matchKnownGap({ ...renegotiation, scenarioId: 'A' })).toBeNull();
  });

  it('registry entries validate their own schema', () => {
    expect(KNOWN_GAPS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('event-stream audit over deterministic exports', () => {
  it('scenario A stream is clean', () => {
    const file = exportedFile('A');
    expect(auditEventStream('A', file.events)).toEqual([]);
  });

  it('scenario D surfaces only the registered meal-dilemma request-window gap', () => {
    const file = exportedFile('D');
    const findings = auditEventStream('D', file.events);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.checkId).toBe('dilemma-missing-lawful-exits');
    expect(finding.key.missingClasses).toBe('lawful-acquisition');
    expect(matchKnownGap(finding)?.knownGapId).toBe('KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW');
  });

  it('scenario C stream satisfies the renegotiation-response contract deterministically', () => {
    const file = exportedFile('C');
    const findings = auditEventStream('C', file.events);
    expect(
      findings.filter((f) => f.checkId === 'renegotiation-proposal-without-response-opportunity'),
    ).toEqual([]);
  });

  it('MUTATION GUARD: a mis-advertised offer flag is an unregistered finding', () => {
    const file = exportedFile('A');
    const events = JSON.parse(JSON.stringify(file.events)) as EventEnvelope[];
    // Find the first plain (non-continuation) rest offer — present in every
    // offer set — and flip its advertised flag against the contract.
    let mutated = false;
    for (const event of events) {
      if (event.type !== 'DecisionRequested') continue;
      const offered = (
        event.payload as {
          offeredAffordances: { mode: string; interruptible: boolean; id: string }[];
        }
      ).offeredAffordances;
      const restOffer = offered.find((o) => o.mode === 'rest' && !o.id.includes(':continue:'));
      if (restOffer) {
        restOffer.interruptible = false; // contract says rest advertises true
        mutated = true;
        break;
      }
    }
    expect(mutated).toBe(true);
    const findings = auditEventStream('A', events);
    const mismatch = findings.find((f) => f.checkId === 'contract-advertisement-mismatch');
    expect(mismatch).toBeDefined();
    expect(matchKnownGap(mismatch!)).toBeNull();
  });
});
