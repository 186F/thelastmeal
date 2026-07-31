import { describe, expect, it } from 'vitest';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
} from '../../src/sim/decisions/externalSchemas';
import { CONDITION_IDS } from '../../src/sim/decisions/conditions';
import {
  MODEL_BACKED_CONDITION_CONTRACTS,
  contractForCondition,
  isModelBackedConditionId,
  requireContractForCondition,
} from '../../src/shared/conditionContract';
import {
  M2_ACTION_PROMPT_VERSION,
  M2_ACTION_PROVIDER_ID,
  M2_EXPERIMENT_ID,
  M2_EXPERIMENT_VERSION,
  M2_PER_DECISION_CONDITION_ID,
} from '../../src/shared/m2Experiment';
import {
  BASELINE_CONDITION_ID,
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';

/**
 * The Phase 4 M2 per-decision condition (brief §9.2/§9.4) and the
 * condition-contract registry: the M2 condition is registered alongside the
 * frozen Milestone 1 pairings, resolves to the M2 provider identity in the
 * engine, and the transport envelope enforces the EXACT condition-to-
 * experiment pairing — no mixture parses.
 */

let cachedM2: ExternalDecisionRequest | null = null;
function genuineM2Request(): ExternalDecisionRequest {
  if (!cachedM2) {
    const run: EngineRun = createRun('A', { conditionId: M2_PER_DECISION_CONDITION_ID });
    while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
    cachedM2 = run.externalRequests[0]!;
  }
  return JSON.parse(JSON.stringify(cachedM2)) as ExternalDecisionRequest;
}

function m2EnvelopeFor(external: ExternalDecisionRequest): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: M2_EXPERIMENT_ID,
    experimentVersion: M2_EXPERIMENT_VERSION,
    conditionId: M2_PER_DECISION_CONDITION_ID,
    runId: 'run-test-m2-00000001',
    providerId: external.request.providerId,
    promptVersion: M2_ACTION_PROMPT_VERSION,
    contextHash: external.contextHash,
    request: external.request,
    context: external.context,
    truncationCounts: external.truncationCounts,
  };
}

describe('condition-contract registry (Phase 4)', () => {
  it('registers exactly the two model-backed pairings with their frozen identities', () => {
    expect(MODEL_BACKED_CONDITION_CONTRACTS).toHaveLength(2);
    const m1 = requireContractForCondition(MODEL_CONDITION_ID);
    expect(m1).toMatchObject({
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      providerId: EXTERNAL_MARA_PROVIDER_ID,
      promptVersion: MODEL_PROMPT_VERSION,
      targetNpcId: 'mara',
      diagnosticContract: 'm1-strict',
    });
    const m2 = requireContractForCondition(M2_PER_DECISION_CONDITION_ID);
    expect(m2).toMatchObject({
      experimentId: M2_EXPERIMENT_ID,
      experimentVersion: M2_EXPERIMENT_VERSION,
      providerId: M2_ACTION_PROVIDER_ID,
      promptVersion: M2_ACTION_PROMPT_VERSION,
      targetNpcId: 'mara',
      upstreamPlatform: 'openrouter',
      diagnosticContract: 'm2-normalized',
    });
    // Scenario coverage is identical to Milestone 1 (§9.2: behaviorally
    // equivalent in authority); Scenario F stays deterministic-only.
    expect([...m2.scenarios]).toEqual(['A', 'B1', 'B2', 'C', 'D', 'E']);
  });

  it('the baseline is never model-backed; unknown ids refuse loudly', () => {
    expect(contractForCondition(BASELINE_CONDITION_ID)).toBeNull();
    expect(isModelBackedConditionId(BASELINE_CONDITION_ID)).toBe(false);
    expect(isModelBackedConditionId(M2_PER_DECISION_CONDITION_ID)).toBe(true);
    expect(() => requireContractForCondition('made-up')).toThrow(/condition-not-model-backed/);
  });

  it('the engine condition registry includes the M2 condition', () => {
    expect([...CONDITION_IDS]).toContain(M2_PER_DECISION_CONDITION_ID);
  });
});

describe('M2 per-decision condition in the engine (§9.2/§9.4)', () => {
  it('routes ONLY Mara to the M2 action provider; Jonas and Rin stay deterministic', () => {
    const external = genuineM2Request();
    expect(external.request.npcId).toBe('mara');
    expect(external.request.providerId).toBe(M2_ACTION_PROVIDER_ID);
    // A full run under the M2 condition emits Mara-only external requests.
    const run = createRun('A', { conditionId: M2_PER_DECISION_CONDITION_ID });
    while (run.state.tick < 400) stepTick(run);
    expect(run.externalRequests.length).toBeGreaterThan(0);
    expect(
      run.externalRequests.every(
        (request) =>
          request.request.npcId === 'mara' && request.request.providerId === M2_ACTION_PROVIDER_ID,
      ),
    ).toBe(true);
  });

  it('refuses Scenario F (frozen deterministic-only), like Milestone 1', () => {
    expect(() => createRun('F', { conditionId: M2_PER_DECISION_CONDITION_ID })).toThrow(
      /condition-not-supported-for-scenario/,
    );
  });
});

describe('envelope condition-to-experiment pairing (Phase 4)', () => {
  it('an M2 envelope with the M2 identity parses', () => {
    const parsed = externalDecisionRequestEnvelopeSchema.safeParse(
      m2EnvelopeFor(genuineM2Request()),
    );
    expect(parsed.success).toBe(true);
  });

  it('every cross-pairing is refused: no mixture of condition and experiment parses', () => {
    const base = m2EnvelopeFor(genuineM2Request());
    // M2 condition under the M1 experiment identity.
    expect(
      externalDecisionRequestEnvelopeSchema.safeParse({
        ...base,
        experimentId: MODEL_EXPERIMENT_ID,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
      }).success,
    ).toBe(false);
    // M2 condition with only the version wrong.
    expect(
      externalDecisionRequestEnvelopeSchema.safeParse({
        ...base,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
      }).success,
    ).toBe(false);
    // M1 condition claiming the M2 experiment.
    expect(
      externalDecisionRequestEnvelopeSchema.safeParse({
        ...base,
        conditionId: MODEL_CONDITION_ID,
      }).success,
    ).toBe(false);
    // Baseline claiming the M2 experiment.
    expect(
      externalDecisionRequestEnvelopeSchema.safeParse({
        ...base,
        conditionId: BASELINE_CONDITION_ID,
      }).success,
    ).toBe(false);
  });
});
