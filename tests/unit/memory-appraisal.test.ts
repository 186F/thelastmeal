import { describe, expect, it } from 'vitest';
import type { MemoryState } from '../../src/sim/domain/state';
import { memoryInfluence } from '../../src/sim/decisions/memoryInfluence';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import type { DecisionContext } from '../../src/sim/decisions/provider';
import type { Affordance } from '../../src/sim/actions/affordances';
import { IDENTITIES } from '../../src/sim/domain/identities';

/**
 * Remediation 6 (section 10.5): memory influence is generic — typed themes,
 * targets, confidence, and importance drive behavior; memory IDs and prose
 * never do — and the restructure is mathematically equivalent to the frozen
 * v1.0 constants at the frozen fixture appraisals.
 */

function memory(partial: Partial<MemoryState> & { themes: MemoryState['themes'] }): MemoryState {
  return {
    id: 'mem-any-001',
    canonicalFact: 'some-fact',
    factEventId: null,
    preScenario: true,
    perception: 'heard-directly',
    interpretation: 'some-interpretation',
    confidenceMicro: 900_000,
    importanceMicro: 900_000,
    createdTick: -1,
    socialTargetId: null,
    valenceMicro: -500_000,
    selfRelevanceMicro: 800_000,
    ...partial,
  };
}

describe('equivalence at the frozen fixture appraisals', () => {
  it('competence-threat at conf .90 x imp .90 reproduces the v1.0 constants exactly', () => {
    const fixture = [memory({ themes: ['competence-threat'] })];
    expect(memoryInfluence(fixture, 'work', null)).toEqual([
      { code: 'memory:competence-threat', value: 150_000 },
    ]);
    expect(memoryInfluence(fixture, 'request-break', null)).toEqual([
      { code: 'memory:competence-threat', value: -400_000 },
    ]);
    expect(memoryInfluence(fixture, 'rest', null)).toEqual([
      { code: 'memory:competence-threat', value: -100_000 },
    ]);
    expect(memoryInfluence(fixture, 'ask-help', null)).toEqual([
      { code: 'memory:competence-threat', value: -150_000 },
    ]);
  });

  it('reciprocity-debt at conf .90 x imp .70 reproduces the v1.0 relieve bonus exactly', () => {
    const fixture = [
      memory({ themes: ['reciprocity-debt'], socialTargetId: 'mara', importanceMicro: 700_000 }),
    ];
    expect(memoryInfluence(fixture, 'relieve-commitment-due', 'mara')).toEqual([
      { code: 'memory:reciprocity-debt', value: 60_000 },
    ]);
  });

  it('ownership-violation at conf .85 x imp .80 reproduces the v1.0 refuse/transfer effects exactly', () => {
    const fixture = [
      memory({
        themes: ['ownership-violation'],
        socialTargetId: 'jonas',
        confidenceMicro: 850_000,
        importanceMicro: 800_000,
      }),
    ];
    expect(memoryInfluence(fixture, 'refuse-request', 'jonas')).toEqual([
      { code: 'memory:ownership-violation', value: 100_000 },
    ]);
    expect(memoryInfluence(fixture, 'transfer', 'jonas')).toEqual([
      { code: 'memory:ownership-violation', value: -200_000 },
    ]);
  });
});

describe('ID and prose independence', () => {
  it('changing only the memory ID changes nothing', () => {
    const a = [memory({ themes: ['competence-threat'], id: 'mem-aaa' })];
    const b = [memory({ themes: ['competence-threat'], id: 'mem-completely-different' })];
    expect(memoryInfluence(a, 'work', null)).toEqual(memoryInfluence(b, 'work', null));
  });

  it('two memories with the same appraisal but different text produce equivalent influence', () => {
    const a = [
      memory({
        themes: ['ownership-violation'],
        socialTargetId: 'jonas',
        canonicalFact: 'jonas-used-rins-supply-without-asking',
        interpretation: 'jonas-disrespects-ownership',
      }),
    ];
    const b = [
      memory({
        themes: ['ownership-violation'],
        socialTargetId: 'jonas',
        canonicalFact: 'entirely-different-wording-of-the-same-kind-of-event',
        interpretation: 'other-words',
      }),
    ];
    expect(memoryInfluence(a, 'refuse-request', 'jonas')).toEqual(
      memoryInfluence(b, 'refuse-request', 'jonas'),
    );
  });

  it('removing the appraisal removes the behavioral effect even if the prose fact remains', () => {
    const proseOnly = [memory({ themes: [] })];
    expect(memoryInfluence(proseOnly, 'work', null)).toEqual([]);
    expect(memoryInfluence(proseOnly, 'request-break', null)).toEqual([]);
  });
});

describe('scaling, targeting, and bounding', () => {
  it('lower confidence or importance reduces influence monotonically', () => {
    const at = (conf: number, imp: number) =>
      memoryInfluence(
        [memory({ themes: ['competence-threat'], confidenceMicro: conf, importanceMicro: imp })],
        'work',
        null,
      )[0]?.value ?? 0;
    expect(at(900_000, 900_000)).toBeGreaterThan(at(700_000, 900_000));
    expect(at(700_000, 900_000)).toBeGreaterThan(at(500_000, 900_000));
    expect(at(900_000, 900_000)).toBeGreaterThan(at(900_000, 600_000));
    expect(at(900_000, 600_000)).toBeGreaterThan(at(900_000, 300_000));
    expect(at(0, 900_000)).toBe(0);
  });

  it('a target-specific memory about Jonas does not affect an equivalent decision involving Mara', () => {
    const grudge = [memory({ themes: ['ownership-violation'], socialTargetId: 'jonas' })];
    expect(memoryInfluence(grudge, 'transfer', 'jonas').length).toBe(1);
    expect(memoryInfluence(grudge, 'transfer', 'mara')).toEqual([]);
    expect(memoryInfluence(grudge, 'refuse-request', 'mara')).toEqual([]);
  });

  it('stacked memories combine by summation, clamped at the documented cap', () => {
    const one = memory({ themes: ['competence-threat'] });
    const five = [one, one, one, one, one];
    const combined = memoryInfluence(five, 'work', null);
    expect(combined).toHaveLength(1);
    // 5 x 150_000 = 750_000, clamped to 2 x 185_185.
    expect(combined[0]!.value).toBe(370_370);
  });
});

describe('safety and legality still override memory influence', () => {
  function aff(
    partial: Partial<Affordance> & { id: string; mode: Affordance['mode'] },
  ): Affordance {
    return {
      category: 'rest-or-wait',
      actorId: 'rin',
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

  it('an overwhelming pro-cooperation memory cannot push vulnerable Rin into surrendering food', () => {
    const provider = new DeterministicProvider();
    const context: DecisionContext = {
      npcId: 'rin',
      scenarioId: 'A',
      tick: 100,
      stateVersion: 0,
      requestId: 'dec-test',
      identity: IDENTITIES.rin,
      hungerMicro: 850_000, // vulnerable
      fatigueMicro: 300_000,
      injury: {
        severityMicro: 0,
        injuredAtTick: null,
        treatmentStartedTick: null,
        treatedByNpcId: null,
        worsened: false,
      },
      incapacitated: false,
      locationId: 'food-shelf',
      goalId: IDENTITIES.rin.goalId,
      beliefs: [],
      memories: [
        memory({
          themes: ['care-received'],
          socialTargetId: 'mara',
          confidenceMicro: 1_000_000,
          importanceMicro: 1_000_000,
        }),
      ],
      commitments: [],
      relationships: [],
      affordances: [
        aff({
          id: 'aff:rin:100:transfer:mara',
          mode: 'transfer',
          category: 'transfer-or-release-meal',
          targetNpcId: 'mara',
        }),
        aff({
          id: 'aff:rin:100:refuse-request:mara',
          mode: 'refuse-request',
          category: 'transfer-or-release-meal',
          targetNpcId: 'mara',
        }),
        aff({ id: 'aff:rin:100:wait', mode: 'wait' }),
      ],
      benchOccupantId: null,
      benchOccupantRunTicks: null,
      purifierProgressUnits: 72_000,
      recentSignals: [],
    };
    const result = provider.decide(context);
    expect(result.affordanceId).not.toBe('aff:rin:100:transfer:mara');
  });
});
