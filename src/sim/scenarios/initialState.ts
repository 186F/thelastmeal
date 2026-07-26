import { NPC_IDS, type NpcId } from '../../shared/ids';
import { SCHEMA_VERSION, CONFIG_VERSION } from '../../shared/versions';
import {
  BENCH_RESOURCE_ID,
  MEAL_LOCATION,
  MEAL_RESOURCE_ID,
  REPAIR_INITIAL_UNITS,
  SCENARIO_END_TICK,
} from '../config';
import { IDENTITIES, MARA_CRITICISM_MEMORY_ID, SEED_MEMORIES } from '../domain/identities';
import type {
  BeliefState,
  CanonicalState,
  MemoryState,
  NpcState,
  RelationshipState,
} from '../domain/state';
import type { ScenarioDefinition } from './definitions';
import { V1_ROLES, commitmentIdForRoles, roleOf, type RoleAssignment } from './roles';

/**
 * Builds the canonical initial state for a scenario, before any event is
 * applied. Replay reconstructs this same state from the local scenario
 * definition; an imported ledger never supplies initial state directly.
 *
 * Pre-scenario memories and initial beliefs are scenario data, not events:
 * they exist before the simulation's first tick. Everything that happens
 * from tick 0 onward is event-sourced.
 *
 * Structural roles (remediation 7): initial locations and the common-
 * knowledge beliefs follow the role assignment; the default V1_ROLES
 * reproduces the frozen v1.0 identity-card values exactly.
 */
export function buildInitialState(
  scenario: ScenarioDefinition,
  roles: RoleAssignment = V1_ROLES,
): CanonicalState {
  const npcs = {} as Record<NpcId, NpcState>;
  for (const npcId of NPC_IDS) {
    npcs[npcId] = buildNpc(npcId, scenario, roles);
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
    worldRevision: 0,
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

const INITIAL_LOCATION_BY_ROLE = {
  benchWorker: 'purifier-workbench',
  debtor: 'routine-work-station',
  mealOwner: 'purifier-workbench',
} as const;

function buildNpc(npcId: NpcId, scenario: ScenarioDefinition, roles: RoleAssignment): NpcState {
  const identity = IDENTITIES[npcId];
  let hunger = identity.initial.hungerMicro;
  if (npcId === 'mara' && scenario.overrides.maraInitialHungerMicro !== null) {
    hunger = scenario.overrides.maraInitialHungerMicro;
  }

  const memories: MemoryState[] = SEED_MEMORIES.filter((m) => {
    if (m.npcId !== npcId) return false;
    if (m.id === MARA_CRITICISM_MEMORY_ID && scenario.overrides.removeMaraCriticismMemory) {
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
    themes: [...m.themes],
    socialTargetId: m.socialTargetId,
    valenceMicro: m.valenceMicro,
    selfRelevanceMicro: m.selfRelevanceMicro,
  }));

  // Small-colony common knowledge, seeded as initial beliefs with 'initial'
  // provenance: everyone knows the meal exists, who holds its reservation,
  // and that the relief promise is active (v1.0: Rin owns the meal, Jonas
  // promised to relieve Mara).
  const beliefs: BeliefState[] = [
    initialBelief(npcId, 'meal-exists', 'true'),
    initialBelief(npcId, 'meal-owner', roles.mealOwner),
    initialBelief(npcId, `commitment:${commitmentIdForRoles(roles)}`, 'active'),
  ];

  return {
    id: npcId,
    locationId: INITIAL_LOCATION_BY_ROLE[roleOf(roles, npcId)],
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
    pendingDecision: null,
    lastSupersededRequestId: null,
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
