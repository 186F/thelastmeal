import { NPC_IDS, type NpcId } from '../../shared/ids';
import { SCHEMA_VERSION, CONFIG_VERSION } from '../../shared/versions';
import {
  BENCH_RESOURCE_ID,
  MEAL_LOCATION,
  MEAL_RESOURCE_ID,
  REPAIR_INITIAL_UNITS,
  SCENARIO_END_TICK,
} from '../config';
import { IDENTITIES, SEED_MEMORIES } from '../domain/identities';
import type {
  BeliefState,
  CanonicalState,
  MemoryState,
  NpcState,
  RelationshipState,
} from '../domain/state';
import type { ScenarioDefinition } from './definitions';

/**
 * Builds the canonical initial state for a scenario, before any event is
 * applied. Replay reconstructs this same state from the local scenario
 * definition; an imported ledger never supplies initial state directly.
 *
 * Pre-scenario memories and initial beliefs are scenario data, not events:
 * they exist before the simulation's first tick. Everything that happens
 * from tick 0 onward is event-sourced.
 */
export function buildInitialState(scenario: ScenarioDefinition): CanonicalState {
  const npcs = {} as Record<NpcId, NpcState>;
  for (const npcId of NPC_IDS) {
    npcs[npcId] = buildNpc(npcId, scenario);
  }

  const relationships: RelationshipState[] = [];
  for (const from of NPC_IDS) {
    for (const to of NPC_IDS) {
      if (from !== to) {
        // Initial relationship values are neutral (0); the brief fixes only deltas.
        relationships.push({ fromNpcId: from, toNpcId: to, valueMicro: 0 });
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    configVersion: CONFIG_VERSION,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    seed: scenario.seed,
    stateVersion: 0,
    tick: 0,
    endTick: SCENARIO_END_TICK,
    terminal: false,
    taskOutcome: 'pending',
    purifier: { progressUnits: REPAIR_INITIAL_UNITS, activeWorkerId: null },
    meal: {
      resourceId: MEAL_RESOURCE_ID,
      exists: true,
      locationId: MEAL_LOCATION,
      reservedForNpcId: null, // the tick-0 ResourceReserved event assigns Rin
      consumedByNpcId: null,
      consumedTick: null,
    },
    npcs,
    reservations: [],
    commitments: [],
    pendingTransferRequests: [],
    relationships,
    socialSignals: [],
  };
}

function buildNpc(npcId: NpcId, scenario: ScenarioDefinition): NpcState {
  const identity = IDENTITIES[npcId];
  let hunger = identity.initial.hungerMicro;
  if (npcId === 'mara' && scenario.overrides.maraInitialHungerMicro !== null) {
    hunger = scenario.overrides.maraInitialHungerMicro;
  }

  const memories: MemoryState[] = SEED_MEMORIES.filter((m) => {
    if (m.npcId !== npcId) return false;
    if (m.id === 'mem-mara-criticism' && scenario.overrides.removeMaraCriticismMemory) {
      return false;
    }
    return true;
  }).map((m) => ({
    id: m.id,
    canonicalFact: m.canonicalFact,
    factEventId: null,
    preScenario: true,
    perception: m.perception,
    interpretation: m.interpretation,
    confidenceMicro: m.confidenceMicro,
    importanceMicro: m.importanceMicro,
    createdTick: -1,
  }));

  // Small-colony common knowledge, seeded as initial beliefs with 'initial'
  // provenance: everyone knows the meal exists, that Rin holds its
  // reservation, and that Jonas promised to relieve Mara.
  const beliefs: BeliefState[] = [
    initialBelief(npcId, 'meal-exists', 'true'),
    initialBelief(npcId, 'meal-owner', 'rin'),
    initialBelief(npcId, 'commitment:cmt-jonas-relieves-mara', 'active'),
  ];

  return {
    id: npcId,
    locationId: identity.initial.locationId,
    transit: null,
    hungerMicro: hunger,
    fatigueMicro: identity.initial.fatigueMicro,
    injury: {
      severityMicro: 0,
      injuredAtTick: null,
      treatmentStartedTick: null,
      treatedByNpcId: null,
      worsened: false,
    },
    incapacitated: false,
    currentAction: null,
    pendingAction: null,
    lastDecisionTick: 0,
    needsReevaluation: false,
    requestCooldownUntilTick: 0,
    lastDecision: null,
    beliefs,
    memories,
  };
}

function initialBelief(npcId: NpcId, subject: string, value: string): BeliefState {
  return {
    id: `bel-${npcId}-${subject}`,
    subject,
    value,
    confidenceMicro: 950_000,
    provenanceKind: 'initial',
    provenanceEventId: null,
    updatedTick: 0,
  };
}

export { BENCH_RESOURCE_ID };
