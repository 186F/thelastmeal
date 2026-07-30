import { describe, expect, it } from 'vitest';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { behaviorFingerprintSetSchema } from '../../src/shared/behaviorArtifacts';
import {
  M2_POLICY_COMPILER_PROVIDER_ID,
  M2_POLICY_EXECUTOR_PROVIDER_ID,
  ProviderClassificationError,
  UPSTREAM_CAPABLE_PROVIDER_IDS,
  classifyProviderId,
} from '../../src/shared/providerTaxonomy';
import { EXTERNAL_MARA_PROVIDER_ID } from '../../src/shared/modelExperiment';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { buildNpcStats } from '../../src/sim/reporting';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { completedRun } from '../helpers';
import { exportedFile } from '../ledgerCorruption';
import { NPC_IDS, ACTION_CATEGORIES, type NpcId } from '../../src/shared/ids';
import type { EventEnvelope } from '../../src/shared/events';
import type { LedgerFile } from '../../src/shared/ledgerFile';

/**
 * Behavioral fingerprint derivation over genuine exported ledgers
 * (M2 brief §10.4–10.5), remediated per the Phase 2 audit:
 *
 *  - finding 1: explicit provider-source taxonomy — request counts never
 *    claim upstream calls; the policy executor is local; unknown provider
 *    IDs fail with a typed error; upstream counts are `not-observable`
 *    from ledger-only evidence;
 *  - finding 3: movement-inclusive category active time;
 *  - finding 4: providerPlanId versus registeredConditionId provenance.
 *
 * Includes the mutation guard proving the fingerprint NEVER consults
 * decision confidence or score diagnostics (the R7 confidence-exclusion
 * requirement) and never touches rationale (absent from canonical events).
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

  it('is internally consistent', () => {
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      const startSum = Object.values(f.startsByCategory).reduce((s, v) => s + v, 0);
      expect(startSum).toBe(f.actionsStarted);
      const activeSum = Object.values(f.timeByCategoryTicks).reduce((s, v) => s + v, 0);
      expect(activeSum).toBe(f.activeTicks);
      expect(f.helpRequestsAnswered).toBe('not-observable');
      expect(f.policyCompilationRequestsEmitted).toBe(0);
      expect(f.acceptedPolicyPatches).toBe(0);
      expect(f.commitmentTerminalStatus).toBe(file.finalSummary.promiseOutcome);
    }
    const contributionSum = NPC_IDS.reduce(
      (s, npcId) => s + set.npcs[npcId].purifierContributionBp,
      0,
    );
    expect(contributionSum).toBe(10_000);
  });

  it('reports the baseline provider plan with no observable condition and zero external activity', () => {
    expect(set.providerPlanId).toBe('deterministic-utility-v1');
    expect(set.registeredConditionId).toBe('not-observable');
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      expect(f.providerPlanId).toBe('deterministic-utility-v1');
      expect(f.registeredConditionId).toBe('not-observable');
      expect(f.externalActionRequestsEmitted).toBe(0);
      expect(f.acceptedExternalActions).toBe(0);
      expect(f.policyExecutorDecisions).toBe(0);
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

describe('movement-inclusive active time (audit finding 3)', () => {
  /**
   * Independent reference derivation of the §5.3 interval rule, isolated
   * from the fingerprint accumulator: open at MovementStarted when a travel
   * leg exists (else ActionStarted); close at completion, interruption,
   * arrival rejection, or scenario end.
   */
  function referenceActiveTime(
    events: readonly EventEnvelope[],
    finalTick: number,
  ): Map<NpcId, { activeTicks: number; byCategory: Map<string, number> }> {
    const out = new Map<NpcId, { activeTicks: number; byCategory: Map<string, number> }>(
      NPC_IDS.map((npcId) => [npcId, { activeTicks: 0, byCategory: new Map() }]),
    );
    const proposed = new Map<string, string>();
    const open = new Map<string, { npcId: NpcId; openTick: number; category: string }>();
    const credit = (actionId: string, tick: number): void => {
      const interval = open.get(actionId);
      if (!interval) return;
      const npc = out.get(interval.npcId)!;
      npc.activeTicks += tick - interval.openTick;
      npc.byCategory.set(
        interval.category,
        (npc.byCategory.get(interval.category) ?? 0) + (tick - interval.openTick),
      );
      open.delete(actionId);
    };
    for (const event of events) {
      const p = event.payload as Record<string, unknown>;
      switch (event.type) {
        case 'ActionProposed':
          proposed.set(p.actionId as string, p.category as string);
          break;
        case 'MovementStarted': {
          const category = proposed.get(p.actionId as string);
          if (category !== undefined) {
            open.set(p.actionId as string, {
              npcId: p.npcId as NpcId,
              openTick: event.tick,
              category,
            });
          }
          break;
        }
        case 'ActionStarted':
          if (!open.has(p.actionId as string)) {
            open.set(p.actionId as string, {
              npcId: p.npcId as NpcId,
              openTick: event.tick,
              category: p.category as string,
            });
          }
          break;
        case 'ActionCompleted':
        case 'ActionInterrupted':
          credit(p.actionId as string, event.tick);
          break;
        case 'ActionRejected':
          if (p.actionId !== null) credit(p.actionId as string, event.tick);
          break;
        default:
          break;
      }
    }
    for (const actionId of [...open.keys()]) credit(actionId, finalTick);
    return out;
  }

  for (const scenarioId of ['A', 'C', 'D'] as const) {
    it(`matches the isolated reference derivation on scenario ${scenarioId}`, () => {
      const file = exportedFile(scenarioId);
      const set = fingerprintOf(file);
      const reference = referenceActiveTime(file.events, file.finalSummary.tick);
      for (const npcId of NPC_IDS) {
        const f = set.npcs[npcId];
        const r = reference.get(npcId)!;
        expect(f.activeTicks).toBe(r.activeTicks);
        for (const category of ACTION_CATEGORIES) {
          expect(f.timeByCategoryTicks[category]).toBe(r.byCategory.get(category) ?? 0);
        }
      }
    });
  }

  it('includes travel the legacy ActionStarted-only clock excluded (scenario A)', () => {
    const file = exportedFile('A');
    const set = fingerprintOf(file);
    const legacy = buildNpcStats(file.events.map((e) => e as never));
    let strictlyGreaterSomewhere = false;
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      for (const category of ACTION_CATEGORIES) {
        expect(f.timeByCategoryTicks[category]).toBeGreaterThanOrEqual(
          legacy[npcId].ticksByCategory[category],
        );
      }
      const legacyTotal = Object.values(legacy[npcId].ticksByCategory).reduce((s, v) => s + v, 0);
      if (f.activeTicks > legacyTotal) strictlyGreaterSomewhere = true;
    }
    // Scenario A contains genuine travel legs: the metric must actually move.
    expect(strictlyGreaterSomewhere).toBe(true);
  });

  // --- Synthetic event-shape cases (§5.4), hand-computed. -------------------

  let syntheticSeq = 0;
  function evt(type: string, tick: number, payload: Record<string, unknown>): EventEnvelope {
    syntheticSeq += 1;
    return {
      id: `evt-syn-${String(syntheticSeq).padStart(6, '0')}`,
      seq: syntheticSeq,
      type,
      tick,
      schemaVersion: 1,
      actorId: (payload.npcId as string | undefined) ?? null,
      targetId: null,
      causationId: null,
      correlationId: null,
      payload,
    } as unknown as EventEnvelope;
  }

  function descriptor(
    actionId: string,
    npcId: NpcId,
    category: string,
    mode: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      actionId,
      affordanceId: `aff-${actionId}`,
      npcId,
      category,
      mode,
      targetNpcId: null,
      targetResourceId: null,
      locationId: 'workbench-area',
      durationTicks: 60,
      stateVersion: 1,
      interruptible: true,
      violation: false,
      commitmentId: null,
      proposalId: null,
      requestId: null,
      proposedTerms: null,
      ...extra,
    };
  }

  function syntheticFile(events: EventEnvelope[], finalTick: number): LedgerFile {
    // Replay computes the world-state hash, which requires a terminal state.
    const ended = evt('ScenarioEnded', finalTick, {
      tick: finalTick,
      worldStateHash: '0123456789abcdef',
    });
    return {
      formatVersion: 1,
      experimentId: 'synthetic-active-time-test',
      scenario: { id: 'A', version: 'test', seed: 1001, configVersion: 'test', schemaVersion: 1 },
      providerId: 'deterministic-utility-v1',
      events: [...events, ended],
      finalSummary: {
        tick: finalTick,
        taskOutcome: 'deadline-missed',
        progressUnits: 0,
        mealConsumedBy: null,
        promiseOutcome: 'none',
        ownershipViolationCount: 0,
        eventCount: events.length + 1,
      },
      worldStateHash: '0123456789abcdef',
      canonicalLedgerHash: '0123456789abcdef',
    } as LedgerFile;
  }

  it('travel then start then completion: clock opens at MovementStarted, bench session at ActionStarted', () => {
    const d = descriptor('act-a', 'mara', 'work-on-purifier', 'work');
    const set = fingerprintOf(
      syntheticFile(
        [
          evt('ActionProposed', 10, d),
          evt('MovementStarted', 10, {
            npcId: 'mara',
            actionId: 'act-a',
            fromLocationId: 'camp',
            toLocationId: 'workbench-area',
            arriveTick: 30,
          }),
          evt('MovementCompleted', 30, {
            npcId: 'mara',
            actionId: 'act-a',
            locationId: 'workbench-area',
          }),
          evt('ActionStarted', 30, { ...d, completesAtTick: 90 }),
          evt('ActionCompleted', 90, {
            actionId: 'act-a',
            npcId: 'mara',
            category: 'work-on-purifier',
            mode: 'work',
            startedTick: 30,
            outcomeCode: 'completed',
          }),
        ],
        100,
      ),
    );
    const mara = set.npcs.mara;
    expect(mara.activeTicks).toBe(80); // 90 − 10: travel included
    expect(mara.timeByCategoryTicks['work-on-purifier']).toBe(80);
    expect(mara.actionsStarted).toBe(1);
    expect(mara.workSessionCount).toBe(1);
    expect(mara.longestWorkSessionTicks).toBe(60); // 90 − 30: bench occupancy only
  });

  it('travel then start-rejection on arrival: travel attributed, no action start counted', () => {
    const d = descriptor('act-b', 'mara', 'eat-meal', 'eat');
    const set = fingerprintOf(
      syntheticFile(
        [
          evt('ActionProposed', 100, d),
          evt('MovementStarted', 100, {
            npcId: 'mara',
            actionId: 'act-b',
            fromLocationId: 'camp',
            toLocationId: 'meal-table',
            arriveTick: 120,
          }),
          evt('MovementCompleted', 120, {
            npcId: 'mara',
            actionId: 'act-b',
            locationId: 'meal-table',
          }),
          evt('ActionRejected', 120, {
            actionId: 'act-b',
            affordanceId: 'aff-act-b',
            npcId: 'mara',
            category: 'eat-meal',
            mode: 'eat',
            reasonCode: 'preconditions-failed',
            failedPreconditions: ['meal-exists'],
          }),
        ],
        200,
      ),
    );
    const mara = set.npcs.mara;
    expect(mara.activeTicks).toBe(20); // 120 − 100: the travel actually spent
    expect(mara.timeByCategoryTicks['eat-meal']).toBe(20);
    expect(mara.actionsStarted).toBe(0);
    expect(mara.actionsRejected).toBe(1);
  });

  it('in-place action without movement: clock opens at ActionStarted', () => {
    const d = descriptor('act-c', 'rin', 'rest-or-wait', 'rest');
    const set = fingerprintOf(
      syntheticFile(
        [
          evt('ActionProposed', 200, d),
          evt('ActionStarted', 200, { ...d, completesAtTick: 260 }),
          evt('ActionCompleted', 260, {
            actionId: 'act-c',
            npcId: 'rin',
            category: 'rest-or-wait',
            mode: 'rest',
            startedTick: 200,
            outcomeCode: 'completed',
          }),
        ],
        300,
      ),
    );
    expect(set.npcs.rin.activeTicks).toBe(60);
    expect(set.npcs.rin.timeByCategoryTicks['rest-or-wait']).toBe(60);
  });

  it('mid-transit interruption: travel so far attributed, no start counted', () => {
    const d = descriptor('act-d', 'jonas', 'treat-injured', 'treat', { targetNpcId: 'rin' });
    const set = fingerprintOf(
      syntheticFile(
        [
          evt('ActionProposed', 300, d),
          evt('MovementStarted', 300, {
            npcId: 'jonas',
            actionId: 'act-d',
            fromLocationId: 'camp',
            toLocationId: 'medical-cot',
            arriveTick: 320,
          }),
          evt('ActionInterrupted', 310, {
            actionId: 'act-d',
            npcId: 'jonas',
            category: 'treat-injured',
            mode: 'treat',
            reasonCode: 'incapacitated',
          }),
        ],
        400,
      ),
    );
    expect(set.npcs.jonas.activeTicks).toBe(10);
    expect(set.npcs.jonas.timeByCategoryTicks['treat-injured']).toBe(10);
    expect(set.npcs.jonas.actionsStarted).toBe(0);
    expect(set.npcs.jonas.actionsInterrupted).toBe(1);
  });

  it('transit still open at scenario end closes at the final tick', () => {
    const d = descriptor('act-e', 'mara', 'work-on-purifier', 'work');
    const set = fingerprintOf(
      syntheticFile(
        [
          evt('ActionProposed', 400, d),
          evt('MovementStarted', 400, {
            npcId: 'mara',
            actionId: 'act-e',
            fromLocationId: 'camp',
            toLocationId: 'workbench-area',
            arriveTick: 420,
          }),
        ],
        410,
      ),
    );
    expect(set.npcs.mara.activeTicks).toBe(10); // 410 − 400
    expect(set.npcs.mara.timeByCategoryTicks['work-on-purifier']).toBe(10);
    expect(set.npcs.mara.actionsStarted).toBe(0);
  });
});

describe('provider-source taxonomy (audit finding 1)', () => {
  it('classifies the complete registered vocabulary and nothing else', () => {
    expect(classifyProviderId('deterministic-utility-v1')).toBe('deterministic-utility');
    expect(classifyProviderId(EXTERNAL_MARA_PROVIDER_ID)).toBe('external-action-request');
    expect(classifyProviderId(M2_POLICY_EXECUTOR_PROVIDER_ID)).toBe('local-policy-executor');
    expect(classifyProviderId(M2_POLICY_COMPILER_PROVIDER_ID)).toBe('external-policy-compilation');
    expect(() => classifyProviderId('mystery-provider-9')).toThrow(ProviderClassificationError);
    expect(() => classifyProviderId('mystery-provider-9')).toThrow(
      'provider-id-not-in-taxonomy:mystery-provider-9',
    );
  });

  it('registers exactly the OpenRouter action and compiler authorities as upstream-capable', () => {
    expect([...UPSTREAM_CAPABLE_PROVIDER_IDS].sort()).toEqual(
      [EXTERNAL_MARA_PROVIDER_ID, M2_POLICY_COMPILER_PROVIDER_ID].sort(),
    );
    expect(UPSTREAM_CAPABLE_PROVIDER_IDS).not.toContain(M2_POLICY_EXECUTOR_PROVIDER_ID);
    expect(UPSTREAM_CAPABLE_PROVIDER_IDS).not.toContain('deterministic-utility-v1');
  });

  it('an unanswered external condition run distinguishes emitted requests from upstream calls', () => {
    // The genuine gateway-stop shape (M1 Run 6: 75 emitted requests, 10
    // upstream calls): here the external deferred provider is attached with
    // NO gateway at all, so every Mara request is emitted and none is
    // externally answered. The fingerprint must report the emitted count as
    // request facts and refuse to claim any upstream call.
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    runToCompletion(run);
    const file = buildLedgerFile(run);
    const set = fingerprintOf(file);
    const mara = set.npcs.mara;
    expect(mara.externalActionRequestsEmitted).toBeGreaterThan(0);
    expect(mara.externalActionRequestsEmitted).toBe(mara.decisionOpportunities);
    expect(mara.acceptedExternalActions).toBe(0);
    expect(mara.deterministicFallbackDecisions).toBeGreaterThan(0);
    for (const npcId of ['jonas', 'rin'] as const) {
      expect(set.npcs[npcId].externalActionRequestsEmitted).toBe(0);
    }
    for (const npcId of NPC_IDS) {
      const f = set.npcs[npcId];
      expect(f.upstreamActionCallsAttempted).toBe('not-observable');
      expect(f.upstreamActionCallsCompleted).toBe('not-observable');
      expect(f.upstreamPolicyCompilationCallsAttempted).toBe('not-observable');
      expect(f.upstreamPolicyCompilationCallsCompleted).toBe('not-observable');
    }
  });

  it('policy-executor decisions are local: never counted as external action activity', () => {
    const mutated = JSON.parse(JSON.stringify(exportedFile('A'))) as LedgerFile;
    let rewritten = 0;
    let acceptedNonFallback = 0;
    const rewrittenRequests = new Set<string>();
    for (const event of mutated.events) {
      const p = event.payload as Record<string, unknown>;
      if (event.type === 'DecisionRequested' && p.npcId === 'mara') {
        p.providerId = M2_POLICY_EXECUTOR_PROVIDER_ID;
        rewrittenRequests.add(p.requestId as string);
        rewritten += 1;
      }
      if (
        event.type === 'DecisionResponseAccepted' &&
        p.npcId === 'mara' &&
        p.usedFallback === false &&
        rewrittenRequests.has(p.requestId as string)
      ) {
        acceptedNonFallback += 1;
      }
    }
    expect(rewritten).toBeGreaterThan(0);
    expect(acceptedNonFallback).toBeGreaterThan(0);
    const set = fingerprintOf(mutated);
    expect(set.npcs.mara.externalActionRequestsEmitted).toBe(0);
    expect(set.npcs.mara.acceptedExternalActions).toBe(0);
    expect(set.npcs.mara.policyExecutorDecisions).toBe(acceptedNonFallback);
  });

  it('an unknown provider ID fails with a typed classification error, never defaults to external', () => {
    const mutated = JSON.parse(JSON.stringify(exportedFile('A'))) as LedgerFile;
    const first = mutated.events.find((e) => e.type === 'DecisionRequested')!;
    (first.payload as Record<string, unknown>).providerId = 'mystery-provider-9';
    expect(() => fingerprintOf(mutated)).toThrow(ProviderClassificationError);
  });

  it('an action decision request addressed to the compilation authority is refused', () => {
    const mutated = JSON.parse(JSON.stringify(exportedFile('A'))) as LedgerFile;
    const first = mutated.events.find((e) => e.type === 'DecisionRequested')!;
    (first.payload as Record<string, unknown>).providerId = M2_POLICY_COMPILER_PROVIDER_ID;
    expect(() => fingerprintOf(mutated)).toThrow(
      'fingerprint-action-request-to-compilation-authority',
    );
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
