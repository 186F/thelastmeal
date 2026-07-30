import { describe, expect, it } from 'vitest';
import {
  auditEventStream,
  auditEventStreamDetailed,
  auditStaticContracts,
} from '../../src/sim/audit/affordanceAudit';
import {
  KNOWN_GAPS,
  coverageSourceSchema,
  knownGapSchema,
  matchKnownGap,
} from '../../src/sim/audit/knownGaps';
import { INTERRUPTION_CONTRACTS, interruptionContractFor } from '../../src/sim/audit/contracts';
import { validateSustained } from '../../src/sim/actions/validation';
import {
  coverageStatus,
  loadSyntheticFixture,
  runAudit,
  type CorpusItem,
} from '../../scripts/audit/affordances';
import { exportedFile } from '../ledgerCorruption';
import { freshState } from '../helpers';
import { REQUEST_REFUSAL_COOLDOWN_TICKS } from '../../src/sim/config';
import { ACTION_MODES } from '../../src/shared/ids';
import type { EventEnvelope } from '../../src/shared/events';
import type { AuditFinding } from '../../src/sim/audit/findings';

/**
 * Affordance-space and interruption-contract auditor (M2 brief §27.6–§27.7,
 * remediated per the Phase 2 audit finding 2). Proves: the declared contracts
 * match actual engine behavior; the static findings are exactly the
 * registered VS001 gaps; every registered gap carries CI-exercisable
 * coverage that reproduces it; an unobserved registered gap fails the audit;
 * a pending own meal-transfer request satisfies the lawful-acquisition exit
 * class while the post-refusal cooldown is evaluated separately.
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

  it('holds exactly the four Milestone-1-documented entries, each with coverage', () => {
    expect(KNOWN_GAPS.map((gap) => gap.knownGapId).sort()).toEqual([
      'KG-VS001-EAT-SUSTAINED-INTERRUPTION',
      'KG-VS001-EAT-VIOLATION-SUSTAINED-INTERRUPTION',
      'KG-VS001-RENEGOTIATION-RESPONSE-WINDOW',
      'KG-VS001-TREAT-SUSTAINED-INTERRUPTION',
    ]);
    for (const gap of KNOWN_GAPS) {
      expect(() => knownGapSchema.parse(gap)).not.toThrow();
      expect(gap.coverage.length).toBeGreaterThanOrEqual(1);
      for (const source of gap.coverage) {
        expect(() => coverageSourceSchema.parse(source)).not.toThrow();
      }
    }
  });

  it('rejects an entry whose only coverage cannot be exercised in CI', () => {
    const entry = {
      ...KNOWN_GAPS[0]!,
      coverage: [
        { kind: 'retained-live-evidence-fixture' as const, description: 'outside the Git tree' },
      ],
    };
    expect(() => knownGapSchema.parse(entry)).toThrow();
  });
});

describe('coverage guarantee (audit §4.3): unobserved registered gaps fail', () => {
  const staticGap = KNOWN_GAPS.find(
    (gap) => gap.knownGapId === 'KG-VS001-TREAT-SUSTAINED-INTERRUPTION',
  )!;
  const staticFinding: AuditFinding = {
    checkId: 'non-interruptible-mode-has-world-interruption',
    scenarioId: 'static',
    key: { mode: 'treat', classes: 'patient-absent' },
    detail: 'observed',
  };

  it('a gap reproduced by its declared source is matched', () => {
    const corpus: CorpusItem[] = [
      { source: { kind: 'static-contract' }, findings: [staticFinding] },
    ];
    const status = coverageStatus([staticGap], corpus);
    expect(status.matchedKnownGapIds).toEqual([staticGap.knownGapId]);
    expect(status.unobservedKnownGapIds).toEqual([]);
  });

  it('a gap whose declared source produced nothing is unobserved — even if seen elsewhere', () => {
    const emptyDeclaredSource: CorpusItem[] = [
      { source: { kind: 'static-contract' }, findings: [] },
      // The same finding arriving from an UNDECLARED source (a supplied
      // ledger) is an extra observation, never a substitute for coverage.
      {
        source: { kind: 'supplied-ledger', path: 'somewhere.json' },
        findings: [{ ...staticFinding, scenarioId: 'C' }],
      },
    ];
    const status = coverageStatus([staticGap], emptyDeclaredSource);
    expect(status.matchedKnownGapIds).toEqual([]);
    expect(status.unobservedKnownGapIds).toEqual([staticGap.knownGapId]);
  });

  it('deleting a declared coverage fixture fails the audit', () => {
    expect(() => loadSyntheticFixture('scripts/audit/fixtures/does-not-exist.json')).toThrow(
      'audit-coverage-fixture-missing',
    );
  });

  it('the committed scenario-C fixture reproduces the exact registered finding through the real audit code', () => {
    const fixture = loadSyntheticFixture(
      'scripts/audit/fixtures/kg-vs001-renegotiation-response-window-events.json',
    );
    expect(fixture.scenarioId).toBe('C');
    const findings = auditEventStream(fixture.scenarioId, fixture.events);
    expect(findings.length).toBe(1);
    const finding = findings[0]!;
    expect(finding.checkId).toBe('renegotiation-proposal-without-response-opportunity');
    expect(finding.key.commitmentKind).toBe('relieve-at-bench');
    expect(matchKnownGap(finding)?.knownGapId).toBe('KG-VS001-RENEGOTIATION-RESPONSE-WINDOW');
  });
});

describe('event-stream audit over deterministic exports', () => {
  it('scenario A stream is clean', () => {
    const file = exportedFile('A');
    expect(auditEventStream('A', file.events)).toEqual([]);
  });

  it('stale-at-completion termination of a non-interruptible action is NOT a finding', () => {
    // Completion-time staleness is universal completion discipline, excluded
    // from the non-interruptible gap rule (contracts.ts).
    const file = exportedFile('A');
    const events = JSON.parse(JSON.stringify(file.events)) as EventEnvelope[];
    // Build a minimal synthetic pair on top of the real stream shape.
    const base = events.find((e) => e.type === 'ActionStarted')!;
    const startedCopy = JSON.parse(JSON.stringify(base)) as EventEnvelope;
    (startedCopy.payload as Record<string, unknown>).actionId = 'act-synthetic-1';
    (startedCopy.payload as Record<string, unknown>).interruptible = false;
    (startedCopy.payload as Record<string, unknown>).mode = 'request-transfer';
    (startedCopy.payload as Record<string, unknown>).category = 'request-meal-transfer';
    const interruptedCopy = JSON.parse(JSON.stringify(startedCopy)) as EventEnvelope;
    interruptedCopy.type = 'ActionInterrupted';
    interruptedCopy.payload = {
      actionId: 'act-synthetic-1',
      npcId: (startedCopy.payload as { npcId: string }).npcId,
      category: 'request-meal-transfer',
      mode: 'request-transfer',
      reasonCode: 'stale-at-completion:meal-missing',
    };
    const findings = auditEventStream('A', [...events, startedCopy, interruptedCopy]);
    expect(
      findings.filter(
        (f) =>
          f.checkId === 'non-interruptible-mode-has-world-interruption' ||
          f.checkId === 'unclassified-non-interruptible-termination',
      ),
    ).toEqual([]);
  });

  it('scenario D is clean under the refined dilemma semantics, with the sub-states reported separately', () => {
    // Probe evidence (Phase 2 remediation): scenario D offers eat-violation
    // without request-transfer six times — ticks 90/150 while Mara's own
    // transfer request is PENDING (lawful acquisition in progress), ticks
    // 210–390 during the post-refusal COOLDOWN (acquisition exercised and
    // lawfully refused; forgo modes offered every time). Neither sub-state
    // is a missing-lawful-exit gap; each is counted separately.
    const file = exportedFile('D');
    const result = auditEventStreamDetailed('D', file.events);
    expect(result.findings).toEqual([]);
    const stats = result.dilemmaStats.find((s) => s.dilemmaId === 'meal-scarcity-violation-choice');
    expect(stats).toBeDefined();
    expect(stats!.satisfiedByPendingRequest).toBe(2);
    expect(stats!.resolvedByRefusalCooldown).toBe(4);
    expect(stats!.missingExitFindings).toBe(0);
    expect(stats!.triggeringOfferSets).toBe(stats!.satisfiedByOfferedModes + 6);
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

  describe('dilemma state-satisfaction arithmetic (synthetic streams through the real auditor)', () => {
    // Minimal synthetic event streams: the auditor reads type/tick/payload
    // only, so these test the detector's transfer-lifecycle state machine
    // directly — including boundaries no frozen scenario reaches.
    let seq = 0;
    function evt(type: string, tick: number, payload: Record<string, unknown>): EventEnvelope {
      seq += 1;
      return { id: `evt-dlm-${seq}`, seq, type, tick, schemaVersion: 1, payload } as EventEnvelope;
    }
    function triggeringSet(tick: number, npcId = 'mara'): EventEnvelope {
      return evt('DecisionRequested', tick, {
        npcId,
        requestId: `req-dlm-${tick}`,
        providerId: 'deterministic-utility-v1',
        offeredAffordances: [
          { id: `aff-ev-${tick}`, mode: 'eat-violation', interruptible: false, proposalId: null },
          { id: `aff-w-${tick}`, mode: 'wait', interruptible: true, proposalId: null },
        ],
      });
    }
    const requested = (tick: number, requestId: string) =>
      evt('ReservationTransferRequested', tick, {
        requestId,
        resourceId: 'meal-1',
        requesterNpcId: 'mara',
        ownerNpcId: 'rin',
      });
    const refused = (tick: number, requestId: string) =>
      evt('ReservationTransferRefused', tick, {
        requestId,
        resourceId: 'meal-1',
        ownerNpcId: 'rin',
        requesterNpcId: 'mara',
        reasonCode: 'owner-declined',
      });
    const transferred = (tick: number, requestId: string) =>
      evt('ReservationTransferred', tick, {
        resourceId: 'meal-1',
        fromNpcId: 'rin',
        toNpcId: 'mara',
        requestId,
      });

    it('a pending own request satisfies lawful acquisition', () => {
      const result = auditEventStreamDetailed('D', [requested(50, 'tr-1'), triggeringSet(60)]);
      expect(result.findings).toEqual([]);
      expect(result.dilemmaStats[0]!.satisfiedByPendingRequest).toBe(1);
      expect(result.dilemmaStats[0]!.resolvedByRefusalCooldown).toBe(0);
    });

    it('a resolved (transferred) request clears the pending state — withholding afterwards is a finding', () => {
      const result = auditEventStreamDetailed('D', [
        requested(50, 'tr-1'),
        transferred(70, 'tr-1'),
        triggeringSet(80),
      ]);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.checkId).toBe('dilemma-missing-lawful-exits');
      expect(matchKnownGap(result.findings[0]!)).toBeNull();
    });

    it('the refusal cooldown satisfies lawful acquisition on its last active tick', () => {
      const result = auditEventStreamDetailed('D', [
        requested(50, 'tr-1'),
        refused(100, 'tr-1'),
        triggeringSet(100 + REQUEST_REFUSAL_COOLDOWN_TICKS - 1),
      ]);
      expect(result.findings).toEqual([]);
      expect(result.dilemmaStats[0]!.resolvedByRefusalCooldown).toBe(1);
      expect(result.dilemmaStats[0]!.satisfiedByPendingRequest).toBe(0);
    });

    it('an expired cooldown no longer excuses a withheld request-transfer (boundary = engine re-offer tick)', () => {
      // The engine re-offers request-transfer at exactly refusalTick +
      // REQUEST_REFUSAL_COOLDOWN_TICKS; withholding at that tick is a
      // generation-invariant violation, so a never-expiring cooldown in the
      // detector would wrongly pass this stream.
      const result = auditEventStreamDetailed('D', [
        requested(50, 'tr-1'),
        refused(100, 'tr-1'),
        triggeringSet(100 + REQUEST_REFUSAL_COOLDOWN_TICKS),
      ]);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.checkId).toBe('dilemma-missing-lawful-exits');
      expect(result.findings[0]!.key.missingClasses).toBe('lawful-acquisition');
      expect(matchKnownGap(result.findings[0]!)).toBeNull();
    });
  });

  it('MUTATION GUARD: withholding request-transfer with no pending request and no cooldown is an unregistered finding', () => {
    const file = exportedFile('D');
    const events = JSON.parse(JSON.stringify(file.events)) as EventEnvelope[];
    // Find the first offer set where BOTH eat-violation and request-transfer
    // are offered (so the actor has neither a pending request nor a cooldown)
    // and remove the lawful-acquisition offer against the engine invariant.
    let mutated = false;
    for (const event of events) {
      if (event.type !== 'DecisionRequested') continue;
      const payload = event.payload as {
        offeredAffordances: { mode: string; id: string }[];
      };
      const offered = payload.offeredAffordances;
      if (
        offered.some((o) => o.mode === 'eat-violation') &&
        offered.some((o) => o.mode === 'request-transfer')
      ) {
        payload.offeredAffordances = offered.filter((o) => o.mode !== 'request-transfer');
        mutated = true;
        break;
      }
    }
    expect(mutated).toBe(true);
    const findings = auditEventStream('D', events);
    const missing = findings.find((f) => f.checkId === 'dilemma-missing-lawful-exits');
    expect(missing).toBeDefined();
    expect(missing!.key.missingClasses).toBe('lawful-acquisition');
    // The Scenario D registry entry was removed per the audit ruling: this
    // finding must classify as UNREGISTERED and fail CI.
    expect(matchKnownGap(missing!)).toBeNull();
  });
});

describe('full audit run (CI shape)', () => {
  it('is green: all registered gaps observed by declared coverage, zero unregistered findings', () => {
    const report = runAudit([]);
    expect(report.ok).toBe(true);
    expect(report.unregisteredFindings).toEqual([]);
    expect(report.unobservedKnownGapIds).toEqual([]);
    expect(report.matchedKnownGapIds.sort()).toEqual(KNOWN_GAPS.map((g) => g.knownGapId).sort());
    expect(report.auditedFixtures).toEqual([
      'scripts/audit/fixtures/kg-vs001-renegotiation-response-window-events.json',
    ]);
    expect(report.knownLimitationCount).toBe(4);
    const dStats = report.dilemmaStats.find((s) => s.source === 'scenario-D');
    expect(dStats).toBeDefined();
    expect(dStats!.satisfiedByPendingRequest).toBe(2);
    expect(dStats!.resolvedByRefusalCooldown).toBe(4);
  });
});
