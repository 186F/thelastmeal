import type { NpcId, ScenarioId } from '../../shared/ids';
import type { EventEnvelope } from '../../shared/events';
import { createRunWithRoles, runToCompletion } from '../runtime/engine';
import { getScenario, type ScenarioDefinition } from '../scenarios/definitions';
import type { RoleAssignment } from '../scenarios/roles';

/**
 * Role-counterbalancing individuality-evaluation harness (remediation 7,
 * section 11.4).
 *
 * Deliberately SEPARATE from Vertical Slice 001 v1.0: eval runs carry their
 * own version label, never enter the v1.0 batch report, and exist so that
 * identity-recognition performance cannot be explained by role assignment
 * alone. The same deterministic engine and the same ten action categories
 * are reused; only the structural role assignment rotates.
 *
 * Balanced design: all six permutations of the three identities across the
 * three coupled structural roles run per scenario, so every identity holds
 * every role exactly twice per scenario. This module is fully deterministic
 * (no randomness); blinding happens in the evaluation CLI, outside the
 * simulation core.
 */

export const INDIVIDUALITY_EVAL_VERSION = 'individuality-eval-1.0.0';

export const ROLE_PERMUTATIONS: readonly RoleAssignment[] = [
  { benchWorker: 'mara', debtor: 'jonas', mealOwner: 'rin' },
  { benchWorker: 'mara', debtor: 'rin', mealOwner: 'jonas' },
  { benchWorker: 'jonas', debtor: 'mara', mealOwner: 'rin' },
  { benchWorker: 'jonas', debtor: 'rin', mealOwner: 'mara' },
  { benchWorker: 'rin', debtor: 'mara', mealOwner: 'jonas' },
  { benchWorker: 'rin', debtor: 'jonas', mealOwner: 'mara' },
];

export interface EvalRunResult {
  evalVersion: string;
  baseScenarioId: ScenarioId;
  permutationIndex: number;
  roles: RoleAssignment;
  scenario: ScenarioDefinition;
  events: readonly EventEnvelope[];
  worldStateHash: string;
}

export function runRoleCounterbalancedEval(baseScenarioIds: ScenarioId[]): EvalRunResult[] {
  const results: EvalRunResult[] = [];
  for (const baseId of baseScenarioIds) {
    const base = getScenario(baseId);
    for (let i = 0; i < ROLE_PERMUTATIONS.length; i += 1) {
      const roles = ROLE_PERMUTATIONS[i]!;
      const evalScenario: ScenarioDefinition = { ...base, version: INDIVIDUALITY_EVAL_VERSION };
      const run = createRunWithRoles(evalScenario, roles);
      runToCompletion(run);
      results.push({
        evalVersion: INDIVIDUALITY_EVAL_VERSION,
        baseScenarioId: baseId,
        permutationIndex: i,
        roles,
        scenario: evalScenario,
        events: run.ledger.events,
        worldStateHash: run.worldStateHash!,
      });
    }
  }
  return results;
}

/** Count how often each identity holds each structural role (balance check). */
export function roleBalance(): Record<
  NpcId,
  Record<'benchWorker' | 'debtor' | 'mealOwner', number>
> {
  const counts = {
    mara: { benchWorker: 0, debtor: 0, mealOwner: 0 },
    jonas: { benchWorker: 0, debtor: 0, mealOwner: 0 },
    rin: { benchWorker: 0, debtor: 0, mealOwner: 0 },
  };
  for (const roles of ROLE_PERMUTATIONS) {
    counts[roles.benchWorker].benchWorker += 1;
    counts[roles.debtor].debtor += 1;
    counts[roles.mealOwner].mealOwner += 1;
  }
  return counts;
}
