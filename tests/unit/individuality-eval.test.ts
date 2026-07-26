import { describe, expect, it } from 'vitest';
import { NPC_IDS } from '../../src/shared/ids';
import {
  INDIVIDUALITY_EVAL_VERSION,
  ROLE_PERMUTATIONS,
  roleBalance,
  runRoleCounterbalancedEval,
} from '../../src/sim/evaluation/individuality';
import { createRun, createRunWithRoles, runToCompletion } from '../../src/sim/runtime/engine';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { replayLedger } from '../../src/sim/replay/replay';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { getScenario } from '../../src/sim/scenarios/definitions';
import { V1_ROLES } from '../../src/sim/scenarios/roles';

/**
 * Remediation 7 (sections 11.4/11.5): the role-counterbalancing harness is
 * balanced, separate from v1.0, and its default assignment reproduces v1.0
 * byte-exactly.
 */

describe('role permutations', () => {
  it('covers all six assignments; every identity holds every role exactly twice', () => {
    expect(ROLE_PERMUTATIONS).toHaveLength(6);
    expect(new Set(ROLE_PERMUTATIONS.map((r) => JSON.stringify(r))).size).toBe(6);
    const balance = roleBalance();
    for (const npcId of NPC_IDS) {
      expect(balance[npcId]).toEqual({ benchWorker: 2, debtor: 2, mealOwner: 2 });
    }
  });

  it('the default role assignment reproduces v1.0 byte-exactly', () => {
    const reference = createRun('A');
    runToCompletion(reference);
    const parameterized = createRunWithRoles(getScenario('A'), V1_ROLES);
    runToCompletion(parameterized);
    expect(parameterized.worldStateHash).toBe(reference.worldStateHash);
    expect(parameterized.canonicalLedgerHash).toBe(reference.canonicalLedgerHash);
    expect(serializeCanonicalEventStream(parameterized.ledger.events)).toBe(
      serializeCanonicalEventStream(reference.ledger.events),
    );
  });

  it('a rotated assignment rewires the structural roles and still terminates validly', () => {
    const rotated = createRunWithRoles(getScenario('A'), {
      benchWorker: 'rin',
      debtor: 'mara',
      mealOwner: 'jonas',
    });
    const commitment = rotated.state.commitments[0]!;
    expect(commitment.debtorId).toBe('mara');
    expect(commitment.creditorId).toBe('rin');
    expect(commitment.id).toBe('cmt-mara-relieves-rin');
    expect(rotated.state.meal.reservedForNpcId).toBe('jonas');
    runToCompletion(rotated);
    expect(rotated.state.terminal).toBe(true);
    expect(rotated.worldStateHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('eval harness separation', () => {
  it('eval runs carry the eval version label, never the v1.0 scenario version, and replay with their roles (review: roles threading)', () => {
    const results = runRoleCounterbalancedEval(['A']);
    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(result.evalVersion).toBe(INDIVIDUALITY_EVAL_VERSION);
      expect(result.scenario.version).toBe(INDIVIDUALITY_EVAL_VERSION);
      expect(result.worldStateHash).toMatch(/^[0-9a-f]{16}$/);
      expect(result.events.length).toBeGreaterThan(0);
      // Reducer-only replay with the run's role assignment reproduces the
      // semantic hash for every permutation, not just the default.
      const replay = replayLedger(result.baseScenarioId, result.events, result.roles);
      expect(replay.worldStateHash, JSON.stringify(result.roles)).toBe(result.worldStateHash);
    }
    // Rotations genuinely change outcomes (they are different worlds).
    expect(new Set(results.map((r) => r.worldStateHash)).size).toBeGreaterThan(1);
  });

  it('rotated runs refuse ledger export: the file format records no role assignment', () => {
    const rotated = createRunWithRoles(getScenario('A'), {
      benchWorker: 'jonas',
      debtor: 'rin',
      mealOwner: 'mara',
    });
    runToCompletion(rotated);
    expect(() => buildLedgerFile(rotated)).toThrow('export-requires-v1-roles');
  });
});
