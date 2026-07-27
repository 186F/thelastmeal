import { describe, expect, it } from 'vitest';
import type { DecisionResponse } from '../../src/shared/decisionContracts';
import type { NpcId } from '../../src/shared/ids';
import { evaluateConstraints, CONSTRAINT_CODES } from '../../src/sim/decisions/constraints';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { SimulatedAsyncProvider } from '../../src/sim/decisions/simulatedAsyncProvider';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { eventsOfType } from '../helpers';

/**
 * Remediation 2 (section 6.5): hard survival and identity constraints are
 * enforced by the ENGINE's response-acceptance gate, independent of any
 * provider's cooperation. Every case below drives the real acceptance path
 * with a hostile/incorrect selection over genuinely offered affordances.
 */

function deferredRun(scenarioId: 'A' | 'C' = 'A'): EngineRun {
  const run = createRun(scenarioId);
  run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
    delayTicks: null,
  }));
  return run;
}

function stepTo(run: EngineRun, tick: number): void {
  while (run.state.tick < tick && !run.state.terminal) stepTick(run);
}

function inject(run: EngineRun, npcId: NpcId, selectedAffordanceId: string, id: string): void {
  const pending = run.state.npcs[npcId].pendingDecision!;
  const response: DecisionResponse = {
    responseId: id,
    requestId: pending.requestId,
    npcId,
    scenarioId: run.state.scenarioId,
    // The hostile SELECTION is what these tests exercise; the provider label
    // must be the authorized one or provider binding rejects it first
    // (re-audit finding 1 — that path has its own tests).
    providerId: pending.providerId,
    selectedAffordanceId,
    confidenceBp: 10_000,
    reasonCode: 'hostile',
    scores: [],
  };
  run.responseInbox.push(response);
}

function rejectionOf(run: EngineRun, responseId: string) {
  const event = eventsOfType(run, 'DecisionResponseRejected').find(
    (e) => (e.payload as { responseId: string }).responseId === responseId,
  );
  return event ? (event.payload as { rejectionReason: string; constraintCodes: string[] }) : null;
}

describe('engine acceptance gate enforces hard constraints (section 6.5)', () => {
  it("a hostile provider cannot make Jonas take Rin's reserved meal", () => {
    const run = deferredRun('A');
    stepTo(run, 61);
    const pending = run.state.npcs.jonas.pendingDecision!;
    const violation = pending.offeredAffordances.find((a) => a.mode === 'eat-violation');
    expect(violation, 'eat-violation must be physically offered to Jonas').toBeDefined();
    inject(run, 'jonas', violation!.id, 'hostile-jonas-1');
    stepTick(run);
    const rejection = rejectionOf(run, 'hostile-jonas-1');
    expect(rejection?.rejectionReason).toBe('constraint-violation');
    expect(rejection?.constraintCodes).toContain(CONSTRAINT_CODES.jonasNoReservedFood);
    expect(eventsOfType(run, 'OwnershipViolated')).toHaveLength(0);
    // No ActionProposed was created for the forbidden choice.
    const proposals = eventsOfType(run, 'ActionProposed').filter(
      (e) => (e.payload as { affordanceId: string }).affordanceId === violation!.id,
    );
    expect(proposals).toHaveLength(0);
    // The simulation continues normally.
    stepTo(run, 70);
    expect(run.state.tick).toBe(70);
  });

  it('a hostile provider cannot make vulnerable Rin surrender her meal', () => {
    const run = deferredRun('A');
    // Rin idles at 180 and receives a deferred request; she starts hungry
    // (0.80 == the vulnerability threshold), so transfer/release are
    // constraint-forbidden even though they may be physically offered.
    stepTo(run, 181);
    const pending = run.state.npcs.rin.pendingDecision!;
    const release = pending.offeredAffordances.find((a) => a.mode === 'release');
    expect(release, 'release must be physically offered to the meal owner').toBeDefined();
    inject(run, 'rin', release!.id, 'hostile-rin-1');
    stepTick(run);
    const rejection = rejectionOf(run, 'hostile-rin-1');
    expect(rejection?.rejectionReason).toBe('constraint-violation');
    expect(rejection?.constraintCodes).toContain(CONSTRAINT_CODES.rinKeepsFoodWhileVulnerable);
    expect(run.state.meal.reservedForNpcId).toBe('rin');
  });

  it('a critically hungry NPC with a legal meal cannot be steered into routine work', () => {
    const run = deferredRun('A');
    stepTo(run, 59);
    // Construct the survival condition on Mara, whose in-flight bench work
    // keeps her hard dependencies stable while the request is pending: make
    // her the legal meal owner and critically hungry.
    run.state.meal.reservedForNpcId = 'mara';
    run.state.reservations.find((r) => r.resourceId === 'meal-1')!.holderNpcId = 'mara';
    run.state.npcs.mara.hungerMicro = 980_000;
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    const legalEat = pending.offeredAffordances.find((a) => a.mode === 'eat');
    const routine = pending.offeredAffordances.find((a) => a.mode === 'routine-work');
    expect(legalEat).toBeDefined();
    expect(routine).toBeDefined();
    inject(run, 'mara', routine!.id, 'hostile-mara-2');
    stepTick(run);
    const rejection = rejectionOf(run, 'hostile-mara-2');
    expect(rejection?.rejectionReason).toBe('constraint-violation');
    expect(rejection?.constraintCodes).toContain(CONSTRAINT_CODES.survivalCriticalHungerEat);
  });

  it('a seriously injured NPC cannot be steered away from care-seeking', () => {
    const run = deferredRun('A');
    stepTo(run, 59);
    // Jonas is injured and untreated; his interruptible routine block keeps
    // running (stable dependencies) while his request is pending.
    run.state.npcs.jonas.injury = {
      severityMicro: 550_000,
      injuredAtTick: 50,
      treatmentStartedTick: null,
      treatedByNpcId: null,
      worsened: false,
    };
    stepTo(run, 61);
    const pending = run.state.npcs.jonas.pendingDecision!;
    const care = pending.offeredAffordances.filter(
      (a) => a.mode === 'stay-at-cot' || a.mode === 'ask-help',
    );
    expect(care.length).toBeGreaterThan(0);
    const rest = pending.offeredAffordances.find((a) => a.mode === 'rest');
    expect(rest).toBeDefined();
    inject(run, 'jonas', rest!.id, 'hostile-jonas-2');
    stepTick(run);
    const rejection = rejectionOf(run, 'hostile-jonas-2');
    expect(rejection?.rejectionReason).toBe('constraint-violation');
    expect(rejection?.constraintCodes).toContain(CONSTRAINT_CODES.survivalInjuryCare);
  });

  it('Mara cannot ignore the sole-helper emergency boundary', () => {
    const run = deferredRun('A');
    stepTo(run, 59);
    // Construct the emergency: Rin incapacitated and untreated, Jonas also
    // believed incapacitated, so Mara is the sole capable helper according
    // to her beliefs (the rule is deliberately belief-scoped).
    run.state.npcs.rin.injury = {
      severityMicro: 850_000,
      injuredAtTick: 50,
      treatmentStartedTick: null,
      treatedByNpcId: null,
      worsened: true,
    };
    run.state.npcs.rin.incapacitated = true;
    run.state.npcs.mara.beliefs.push(
      {
        id: 'bel-mara-injury:rin',
        subject: 'injury:rin',
        value: 'incapacitating',
        confidenceMicro: 900_000,
        provenanceKind: 'perception',
        provenanceEventId: null,
        updatedTick: 50,
      },
      {
        id: 'bel-mara-injury:jonas',
        subject: 'injury:jonas',
        value: 'incapacitating',
        confidenceMicro: 900_000,
        provenanceKind: 'perception',
        provenanceEventId: null,
        updatedTick: 50,
      },
    );
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    const treat = pending.offeredAffordances.find(
      (a) => a.mode === 'treat' && a.targetNpcId === 'rin',
    );
    const wait = pending.offeredAffordances.find((a) => a.mode === 'wait');
    expect(treat).toBeDefined();
    expect(wait).toBeDefined();
    inject(run, 'mara', wait!.id, 'hostile-mara-1');
    stepTick(run);
    const rejection = rejectionOf(run, 'hostile-mara-1');
    expect(rejection?.rejectionReason).toBe('constraint-violation');
    expect(rejection?.constraintCodes).toContain(CONSTRAINT_CODES.maraSoleHelper);
  });

  it('eat-violation stays LEGAL for NPCs whose constraints permit it (Mara)', () => {
    const run = deferredRun('A');
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    const violation = pending.offeredAffordances.find((a) => a.mode === 'eat-violation');
    expect(violation).toBeDefined();
    inject(run, 'mara', violation!.id, 'permitted-mara-1');
    stepTick(run);
    // Accepted: Mara's constraints do not forbid the violation; the engine
    // records the norm violation with its relationship consequence when the
    // taking occurs.
    const accepted = eventsOfType(run, 'DecisionResponseAccepted').filter(
      (e) => (e.payload as { responseId: string }).responseId === 'permitted-mara-1',
    );
    expect(accepted).toHaveLength(1);
    // She must travel to the shelf; the violation is recorded on arrival.
    stepTo(run, run.state.tick + 40);
    expect(eventsOfType(run, 'OwnershipViolated').length).toBe(1);
  });
});

describe('shared constraint module semantics', () => {
  it('preserves the v1.0 layer order: injury care before critical hunger before boundaries', () => {
    const care = { id: 'a1', mode: 'stay-at-cot' };
    const eat = { id: 'a2', mode: 'eat' };
    const wait = { id: 'a3', mode: 'wait' };
    const mk = (partial: { id: string; mode: string }) => ({
      id: partial.id,
      category: 'rest-or-wait' as const,
      mode: partial.mode as 'wait',
      actorId: 'rin' as const,
      targetNpcId: null,
      targetResourceId: null,
      requiredLocationId: null,
      durationTicks: 30,
      expectedTravelTicks: 0,
      preconditions: [],
      reservations: [],
      violation: false,
      interruptible: true,
      commitmentId: null,
      proposalId: null,
      requestId: null,
      proposedTerms: null,
      continuesActionId: null,
      stateVersion: 0,
    });
    const injuredAndStarving = {
      npcId: 'rin' as const,
      hungerMicro: 990_000,
      injury: { severityMicro: 550_000, treatmentStartedTick: null },
      incapacitated: false,
      beliefs: [],
    };
    const evaluation = evaluateConstraints(injuredAndStarving, [mk(care), mk(eat), mk(wait)]);
    // Injury care outranks even critical hunger.
    expect(evaluation.allowedAffordanceIds).toEqual(['a1']);
    expect(evaluation.mandatoryModes).toEqual(['ask-help', 'stay-at-cot']);
    expect(evaluation.activeConstraintCodes).toContain(CONSTRAINT_CODES.survivalInjuryCare);
  });

  it('keeps the safety fall-through: no care affordance offered means no restriction', () => {
    const wait = {
      id: 'w1',
      category: 'rest-or-wait' as const,
      mode: 'wait' as const,
      actorId: 'rin' as const,
      targetNpcId: null,
      targetResourceId: null,
      requiredLocationId: null,
      durationTicks: 30,
      expectedTravelTicks: 0,
      preconditions: [],
      reservations: [],
      violation: false,
      interruptible: true,
      commitmentId: null,
      proposalId: null,
      requestId: null,
      proposedTerms: null,
      continuesActionId: null,
      stateVersion: 0,
    };
    const injured = {
      npcId: 'rin' as const,
      hungerMicro: 0,
      injury: { severityMicro: 550_000, treatmentStartedTick: null },
      incapacitated: false,
      beliefs: [],
    };
    const evaluation = evaluateConstraints(injured, [wait]);
    expect(evaluation.allowedAffordanceIds).toEqual(['w1']);
    expect(evaluation.mandatoryModes).toBeNull();
  });
});
