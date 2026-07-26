import type { NpcId } from '../../shared/ids';

/**
 * Structural role assignment (remediation 7, section 11.4).
 *
 * Vertical Slice 001 v1.0 couples three structural roles:
 *  - benchWorker: starts working the purifier at tick 0 and is the promise
 *    CREDITOR (owed relief at the bench).
 *  - debtor: starts on routine duty and owes the relief commitment.
 *  - mealOwner: holds the meal reservation, starts delivering materials, and
 *    is the scripted-injury target in scenarios that include the emergency.
 *
 * The v1.0 assignment is FROZEN experiment data. Role parameterization
 * exists only so the separate individuality-eval harness can rotate identity
 * profiles across roles; every v1.0 code path uses V1_ROLES, and the
 * determinism and scenario-signature suites pin that the default assignment
 * reproduces v1.0 behavior exactly.
 */
export interface RoleAssignment {
  benchWorker: NpcId;
  debtor: NpcId;
  mealOwner: NpcId;
}

export const V1_ROLES: RoleAssignment = {
  benchWorker: 'mara',
  debtor: 'jonas',
  mealOwner: 'rin',
};

export function assertValidRoles(roles: RoleAssignment): void {
  const ids = [roles.benchWorker, roles.debtor, roles.mealOwner];
  if (new Set(ids).size !== 3) {
    throw new Error(
      `invalid-role-assignment: roles must be three distinct NPCs (${ids.join(',')})`,
    );
  }
}

export function commitmentIdForRoles(roles: RoleAssignment): string {
  return `cmt-${roles.debtor}-relieves-${roles.benchWorker}`;
}

/** Structural role of one NPC under an assignment. */
export function roleOf(
  roles: RoleAssignment,
  npcId: NpcId,
): 'benchWorker' | 'debtor' | 'mealOwner' {
  if (roles.benchWorker === npcId) return 'benchWorker';
  if (roles.debtor === npcId) return 'debtor';
  return 'mealOwner';
}
