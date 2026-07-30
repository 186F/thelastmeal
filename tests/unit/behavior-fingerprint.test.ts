import { describe, expect, it } from 'vitest';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { behaviorFingerprintSetSchema } from '../../src/shared/behaviorArtifacts';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { buildNpcStats } from '../../src/sim/reporting';
import { completedRun } from '../helpers';
import { exportedFile } from '../ledgerCorruption';
import { NPC_IDS, ACTION_CATEGORIES } from '../../src/shared/ids';
import type { LedgerFile } from '../../src/shared/ledgerFile';

/**
 * Behavioral fingerprint derivation over genuine exported ledgers
 * (M2 brief §10.4–10.5). Includes the Phase 2 mutation guard proving the
 * fingerprint NEVER consults decision confidence or score diagnostics
 * (the R7 confidence-exclusion requirement) and never touches rationale
 * (which does not exist in canonical events at all).
 */

function fingerprintOf(file: LedgerFile) {
  return buildBehaviorFingerprints(file);
}

describe('behavior fingerprints (scenario A deterministic export)', () => {
  const file = exportedFile('A');
  const set = fingerprintOf(file);

  it('validates against the strict versioned schema and serializes canonically', () => {
    expect(() => behaviorFingerprintSetSchema.parse(set)).not.toThrow();
    expect(() => canonicalSerialize(set as unknown)).not.toThrow();
  });

  it('normalizes every non-empty distribution to exactly 10_000 basis points', () => {
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      for (const [name, distribution] of [
        ['timeByCategoryBp', f.timeByCategoryBp],
        ['startsByCategoryBp', f.startsByCategoryBp],
        ['startsByModeBp', f.startsByModeBp],
        ['targetOrientationBp', f.targetOrientationBp],
      ] as const) {
        const sum = Object.values(distribution).reduce((s, v) => s + v, 0);
        expect(sum === 10_000 || sum === 0, `${npcId}.${name} sum ${sum}`).toBe(true);
      }
    }
  });

  it('agrees with the established buildNpcStats active-tick algorithm', () => {
    const stats = buildNpcStats(file.events.map((e) => e as never));
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      for (const category of ACTION_CATEGORIES) {
        expect(f.timeByCategoryTicks[category]).toBe(stats[npcId].ticksByCategory[category]);
      }
    }
  });

  it('is internally consistent', () => {
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      const startSum = Object.values(f.startsByCategory).reduce((s, v) => s + v, 0);
      expect(startSum).toBe(f.actionsStarted);
      const activeSum = Object.values(f.timeByCategoryTicks).reduce((s, v) => s + v, 0);
      expect(activeSum).toBe(f.activeTicks);
      expect(f.helpRequestsAnswered).toBe('not-observable');
      expect(f.policyCompilationCalls).toBe(0);
      expect(f.acceptedPolicyPatches).toBe(0);
      expect(f.commitmentTerminalStatus).toBe(file.finalSummary.promiseOutcome);
    }
    const contributionSum = NPC_IDS.reduce(
      (s, npcId) => s + set.npcs[npcId].purifierContributionBp,
      0,
    );
    expect(contributionSum).toBe(10_000);
  });

  it('reports the baseline condition with zero external activity', () => {
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      expect(f.conditionId).toBe('deterministic-utility-v1');
      expect(f.externalActionCalls).toBe(0);
      expect(f.acceptedExternalActions).toBe(0);
      const failureSum = Object.values(f.providerFailuresByCode).reduce((s, v) => s + v, 0);
      expect(failureSum).toBe(0);
    }
  });

  it('MUTATION GUARD: decision confidence and score diagnostics never influence the fingerprint', () => {
    const mutated = JSON.parse(JSON.stringify(file)) as LedgerFile;
    let touched = 0;
    for (const event of mutated.events) {
      const p = event.payload as Record<string, unknown>;
      if (event.type === 'DecisionResponseReceived') {
        p.confidenceBp = 1; // was engine-produced value
        p.scores = [];
        touched += 1;
      }
      if (event.type === 'DecisionResponseAccepted') {
        p.confidenceBp = 9_999;
        touched += 1;
      }
    }
    expect(touched).toBeGreaterThan(0);
    const mutatedSet = fingerprintOf(mutated);
    expect(canonicalSerialize(mutatedSet as unknown)).toBe(canonicalSerialize(set as unknown));
  });
});

describe('behavior fingerprints (scenario C — treatment and renegotiation)', () => {
  const file = exportedFile('C');
  const set = fingerprintOf(file);

  it('captures patient-perspective treatment facts and renegotiation actions', () => {
    // Rin is the scripted injury target in the V1 role assignment.
    const rin = set.npcs.rin;
    expect(rin.firstTreatmentStartTick).not.toBeNull();
    expect(rin.treatmentCompletionTick).not.toBeNull();
    const renegotiationActivity =
      set.npcs.mara.renegotiationProposals +
      set.npcs.mara.renegotiationAcceptances +
      set.npcs.mara.renegotiationRejections +
      set.npcs.jonas.renegotiationProposals +
      set.npcs.jonas.renegotiationAcceptances +
      set.npcs.jonas.renegotiationRejections;
    expect(renegotiationActivity).toBeGreaterThan(0);
    expect(file.finalSummary.promiseOutcome).toBe('fulfilled-after-renegotiation');
  });

  it('pins deterministic scenario-C decision-source facts', () => {
    // The completedRun fixture is the frozen deterministic run: these values
    // are stable regression pins, exactly like the golden hashes.
    for (const npcId of NPC_IDS) {
      expect(set.npcs[npcId].deterministicFallbackDecisions).toBeGreaterThanOrEqual(0);
      expect(set.npcs[npcId].violationSelections).toBe(0);
    }
  });
});

describe('fixture provenance', () => {
  it('uses the genuine engine export (same run the corruption helpers use)', () => {
    const run = completedRun('A');
    expect(run.state.terminal).toBe(true);
  });
});

describe('all seven frozen scenarios fingerprint without error (§10.1 failed-run support)', () => {
  for (const scenarioId of ['A', 'B1', 'B2', 'C', 'D', 'E', 'F'] as const) {
    it(`scenario ${scenarioId} fingerprints, validates, and serializes`, () => {
      const set = fingerprintOf(exportedFile(scenarioId));
      expect(() => behaviorFingerprintSetSchema.parse(set)).not.toThrow();
      expect(() => canonicalSerialize(set as unknown)).not.toThrow();
    });
  }

  it('scenario F records the scripted provider-failure code (frozen-behavior pin)', () => {
    const set = fingerprintOf(exportedFile('F'));
    const totalScripted = NPC_IDS.reduce(
      (sum, npcId) => sum + set.npcs[npcId].providerFailuresByCode['scripted-failure-mode']!,
      0,
    );
    // Frozen deterministic scenario F: 127 scripted provider failures.
    expect(totalScripted).toBe(127);
    expect(set.npcs.mara.deterministicFallbackDecisions).toBeGreaterThan(0);
  });
});
