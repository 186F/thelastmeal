import { describe, expect, it } from 'vitest';
import type { Affordance } from '../../src/sim/actions/affordances';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { FallbackProvider } from '../../src/sim/decisions/fallbackProvider';
import { ScriptedFailureProvider } from '../../src/sim/decisions/failingProvider';
import { ProviderFailureError, type DecisionContext } from '../../src/sim/decisions/provider';
import { IDENTITIES } from '../../src/sim/domain/identities';

function aff(partial: Partial<Affordance> & { id: string; mode: Affordance['mode'] }): Affordance {
  return {
    category: 'rest-or-wait',
    actorId: 'jonas',
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
    ...partial,
  };
}

function ctx(partial: Partial<DecisionContext>): DecisionContext {
  return {
    npcId: 'jonas',
    scenarioId: 'A',
    tick: 100,
    stateVersion: 0,
    requestId: 'dec-test',
    identity: IDENTITIES.jonas,
    hungerMicro: 450_000,
    fatigueMicro: 300_000,
    injury: {
      severityMicro: 0,
      injuredAtTick: null,
      treatmentStartedTick: null,
      treatedByNpcId: null,
      worsened: false,
    },
    incapacitated: false,
    locationId: 'routine-work-station',
    goalId: IDENTITIES.jonas.goalId,
    beliefs: [],
    memories: [],
    commitments: [],
    relationships: [],
    affordances: [],
    benchOccupantId: null,
    benchOccupantRunTicks: null,
    purifierProgressUnits: 72_000,
    recentSignals: [],
    ...partial,
  };
}

describe('deterministic provider', () => {
  it('only ever returns an offered affordance ID with structured metadata', () => {
    const provider = new DeterministicProvider();
    const affordances = [aff({ id: 'aff:jonas:100:wait', mode: 'wait' })];
    const result = provider.decide(ctx({ affordances }));
    expect(result.affordanceId).toBe('aff:jonas:100:wait');
    expect(result.confidenceBp).toBeGreaterThan(0);
    expect(result.confidenceBp).toBeLessThanOrEqual(10_000);
    expect(typeof result.reasonCode).toBe('string');
    expect(result.scores.length).toBe(1);
    expect(result.scores[0]!.components.length).toBeGreaterThan(0);
  });

  it('breaks exact ties deterministically by ascending affordance ID', () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({ id: 'aff:jonas:100:wait:b', mode: 'wait' }),
      aff({ id: 'aff:jonas:100:wait:a', mode: 'wait' }),
    ];
    const result = provider.decide(ctx({ affordances }));
    expect(result.affordanceId).toBe('aff:jonas:100:wait:a');
    // Same inputs -> same output.
    expect(provider.decide(ctx({ affordances })).affordanceId).toBe('aff:jonas:100:wait:a');
  });

  it("enforces Jonas's hard boundary: never a violating eat, even when starving", () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({
        id: 'aff:jonas:100:eat-violation',
        mode: 'eat-violation',
        category: 'eat-meal',
        violation: true,
        targetNpcId: 'rin',
      }),
      aff({ id: 'aff:jonas:100:wait', mode: 'wait' }),
    ];
    const result = provider.decide(ctx({ affordances, hungerMicro: 990_000 }));
    expect(result.affordanceId).toBe('aff:jonas:100:wait');
  });

  it("enforces Rin's hard boundary: no voluntary surrender of food while vulnerable", () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({
        id: 'aff:rin:100:transfer:mara',
        mode: 'transfer',
        category: 'transfer-or-release-meal',
        actorId: 'rin',
        targetNpcId: 'mara',
      }),
      aff({
        id: 'aff:rin:100:refuse-request:mara',
        mode: 'refuse-request',
        category: 'transfer-or-release-meal',
        actorId: 'rin',
        targetNpcId: 'mara',
      }),
      aff({ id: 'aff:rin:100:wait', mode: 'wait', actorId: 'rin' }),
    ];
    const vulnerable = ctx({
      npcId: 'rin',
      identity: IDENTITIES.rin,
      hungerMicro: 820_000, // >= high threshold -> medically/nutritionally vulnerable
      affordances,
    });
    const result = new DeterministicProvider().decide(vulnerable);
    expect(result.affordanceId).not.toBe('aff:rin:100:transfer:mara');
    expect(provider.decide(vulnerable).affordanceId).toBe('aff:rin:100:refuse-request:mara');
  });

  it('survival override: critical hunger with a legal meal restricts choice to eating', () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({ id: 'aff:mara:100:eat', mode: 'eat', category: 'eat-meal', actorId: 'mara' }),
      aff({ id: 'aff:mara:100:work', mode: 'work', category: 'work-on-purifier', actorId: 'mara' }),
      aff({ id: 'aff:mara:100:wait', mode: 'wait', actorId: 'mara' }),
    ];
    const result = provider.decide(
      ctx({ npcId: 'mara', identity: IDENTITIES.mara, hungerMicro: 960_000, affordances }),
    );
    expect(result.affordanceId).toBe('aff:mara:100:eat');
  });

  it('survival override: an untreated serious injury restricts choice to care-seeking', () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({ id: 'aff:rin:100:eat', mode: 'eat', category: 'eat-meal', actorId: 'rin' }),
      aff({
        id: 'aff:rin:100:stay-at-cot',
        mode: 'stay-at-cot',
        category: 'rest-or-wait',
        actorId: 'rin',
      }),
      aff({
        id: 'aff:rin:100:ask-help:jonas',
        mode: 'ask-help',
        category: 'ask-for-help',
        actorId: 'rin',
        targetNpcId: 'jonas',
      }),
      aff({ id: 'aff:rin:100:wait', mode: 'wait', actorId: 'rin' }),
    ];
    const result = provider.decide(
      ctx({
        npcId: 'rin',
        identity: IDENTITIES.rin,
        hungerMicro: 990_000, // even critical hunger yields to the injury
        injury: {
          severityMicro: 550_000,
          injuredAtTick: 90,
          treatmentStartedTick: null,
          treatedByNpcId: null,
          worsened: false,
        },
        affordances,
      }),
    );
    expect(['aff:rin:100:stay-at-cot', 'aff:rin:100:ask-help:jonas']).toContain(
      result.affordanceId,
    );
  });

  it('exposes separately inspectable score components per affordance', () => {
    const provider = new DeterministicProvider();
    const affordances = [
      aff({ id: 'aff:mara:100:work', mode: 'work', category: 'work-on-purifier', actorId: 'mara' }),
      aff({ id: 'aff:mara:100:wait', mode: 'wait', actorId: 'mara' }),
    ];
    const result = provider.decide(
      ctx({
        npcId: 'mara',
        identity: IDENTITIES.mara,
        hungerMicro: 720_000,
        memories: [
          {
            id: 'mem-mara-criticism',
            canonicalFact: 'player-criticized-mara-for-giving-up-when-work-becomes-difficult',
            factEventId: null,
            preScenario: true,
            perception: 'heard-directly',
            interpretation: 'attack-on-competence',
            confidenceMicro: 900_000,
            importanceMicro: 900_000,
            createdTick: -1,
          },
        ],
        affordances,
      }),
    );
    const work = result.scores.find((s) => s.affordanceId === 'aff:mara:100:work');
    const codes = work!.components.map((c) => c.code);
    expect(codes).toContain('work-drive'); // trait effect
    expect(codes).toContain('memory:criticism'); // memory effect
    expect(codes).toContain('value:colony-survival'); // declared-value effect
  });
});

describe('fallback provider', () => {
  it('prefers continue, then wait, then first legal, deterministically', () => {
    const fallback = new FallbackProvider();
    const cont = aff({
      id: 'aff:jonas:100:continue:routine-work',
      mode: 'routine-work',
      continuesActionId: 'act-1',
    });
    const wait = aff({ id: 'aff:jonas:100:wait', mode: 'wait' });
    const rest = aff({ id: 'aff:jonas:100:rest', mode: 'rest' });
    expect(fallback.decide(ctx({ affordances: [rest, wait, cont] })).affordanceId).toBe(cont.id);
    expect(fallback.decide(ctx({ affordances: [rest, wait] })).affordanceId).toBe(wait.id);
    expect(fallback.decide(ctx({ affordances: [rest] })).affordanceId).toBe(rest.id);
  });
});

describe('scripted failure provider', () => {
  it('delegates before the failure tick and throws from it onward', () => {
    const failing = new ScriptedFailureProvider(new DeterministicProvider(), 600);
    const affordances = [aff({ id: 'aff:jonas:100:wait', mode: 'wait' })];
    expect(failing.decide(ctx({ tick: 599, affordances })).affordanceId).toBe('aff:jonas:100:wait');
    expect(() => failing.decide(ctx({ tick: 600, affordances }))).toThrow(ProviderFailureError);
  });
});
