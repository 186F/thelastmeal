import type { NpcId, ScenarioId } from '../../shared/ids';
import { TICKS_PER_MINUTE } from '../../shared/units';

/**
 * The six seeded scenario variants (brief section 16). B1/B2 form one
 * memory-ablation pair sharing a seed, giving seven runnable configurations.
 *
 * Scripted world events are engine-owned: the injury (standard emergency),
 * the scenario-E meal removal, and the scenario-F provider failure mode.
 * Documented choices (the brief leaves these open):
 * - Scenario E omits the injury so stale-action handling is isolated.
 * - Scenario F keeps the standard injury so fallback behavior is exercised
 *   under pressure; the fallback policy must still keep the run valid.
 */

export interface ScriptedInjury {
  atTick: number;
  npcId: NpcId;
  severityMicro: number;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  version: string;
  seed: number;
  title: string;
  description: string;
  injury: ScriptedInjury | null;
  /** Scenario E: scripted meal removal at this tick. */
  mealRemovalAtTick: number | null;
  /** Scenario F: the active provider fails deterministically from this tick. */
  providerFailureFromTick: number | null;
  overrides: {
    maraInitialHungerMicro: number | null;
    removeMaraCriticismMemory: boolean;
  };
  /** Structured invariant codes checked by the invariant checker for this scenario. */
  expectedInvariants: string[];
}

const NO_OVERRIDES = {
  maraInitialHungerMicro: null,
  removeMaraCriticismMemory: false,
} as const;

const GLOBAL_INVARIANTS = [
  'meal-consumed-at-most-once',
  'no-duplicate-exclusive-reservation',
  'promise-outcome-unambiguous',
  'single-task-outcome',
  'terminal-state-reached',
  'rejected-actions-do-not-mutate',
];

const STANDARD_INJURY: ScriptedInjury = {
  atTick: 12 * TICKS_PER_MINUTE, // minute 12
  npcId: 'rin',
  severityMicro: 550_000,
};

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  A: {
    id: 'A',
    version: '1.0.0',
    seed: 1001,
    title: 'Routine Operation',
    description:
      'No injury occurs. Establishes ordinary work, hunger, relief, promise, and meal behavior.',
    injury: null,
    mealRemovalAtTick: null,
    providerFailureFromTick: null,
    overrides: NO_OVERRIDES,
    expectedInvariants: [...GLOBAL_INVARIANTS, 'no-injury-events'],
  },
  B1: {
    id: 'B1',
    version: '1.0.0',
    seed: 1002,
    title: 'Pride Memory Present',
    description:
      "Standard scenario without the injury; Mara has the criticism memory. Pairs with B2 to isolate one memory's effect.",
    injury: null,
    mealRemovalAtTick: null,
    providerFailureFromTick: null,
    overrides: NO_OVERRIDES,
    expectedInvariants: [...GLOBAL_INVARIANTS, 'no-injury-events'],
  },
  B2: {
    id: 'B2',
    version: '1.0.0',
    seed: 1002, // identical seed to B1 by requirement
    title: 'Pride Memory Absent',
    description: "Identical to B1 except Mara's criticism memory is removed. Same seed as B1.",
    injury: null,
    mealRemovalAtTick: null,
    providerFailureFromTick: null,
    overrides: { maraInitialHungerMicro: null, removeMaraCriticismMemory: true },
    expectedInvariants: [...GLOBAL_INVARIANTS, 'no-injury-events'],
  },
  C: {
    id: 'C',
    version: '1.0.0',
    seed: 1003,
    title: 'Promise Versus Emergency',
    description:
      'Rin is injured at minute 12 while Jonas remains obligated to relieve Mara at minute 15 (grace 17). Tests competing care and promise obligations.',
    injury: STANDARD_INJURY,
    mealRemovalAtTick: null,
    providerFailureFromTick: null,
    overrides: NO_OVERRIDES,
    expectedInvariants: [...GLOBAL_INVARIANTS, 'no-simultaneous-treat-and-bench'],
  },
  D: {
    id: 'D',
    version: '1.0.0',
    seed: 1004,
    title: 'Scarce Resource Conflict',
    description:
      'Mara starts at hunger 0.88; Rin retains the meal reservation; no injury, so the ownership conflict is isolated.',
    injury: null,
    mealRemovalAtTick: null,
    providerFailureFromTick: null,
    overrides: { maraInitialHungerMicro: 880_000, removeMaraCriticismMemory: false },
    expectedInvariants: [...GLOBAL_INVARIANTS, 'no-injury-events', 'ownership-outcome-recorded'],
  },
  E: {
    id: 'E',
    version: '1.0.0',
    seed: 1005,
    title: 'Stale Decision',
    description:
      'A scripted world event removes the meal after an eat action is selected but before consumption begins. Tests stale-action detection.',
    injury: null,
    mealRemovalAtTick: 200,
    providerFailureFromTick: null,
    overrides: NO_OVERRIDES,
    expectedInvariants: [
      ...GLOBAL_INVARIANTS,
      'no-injury-events',
      'stale-eat-rejected-or-interrupted',
      'no-phantom-meal-consumption',
    ],
  },
  F: {
    id: 'F',
    version: '1.0.0',
    seed: 1006,
    title: 'Decision Provider Failure',
    description:
      'At minute 10 the active decision provider enters a deterministic failure mode; the fallback provider must keep the simulation running to a valid terminal state.',
    injury: STANDARD_INJURY,
    mealRemovalAtTick: null,
    providerFailureFromTick: 10 * TICKS_PER_MINUTE,
    overrides: NO_OVERRIDES,
    expectedInvariants: [
      ...GLOBAL_INVARIANTS,
      'provider-failures-recorded',
      'fallback-decisions-recorded',
    ],
  },
};

export const SCENARIO_LIST: ScenarioDefinition[] = Object.values(SCENARIOS);

export function getScenario(id: ScenarioId): ScenarioDefinition {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`unknown-scenario: ${id}`);
  return s;
}
