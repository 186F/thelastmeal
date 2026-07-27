import { describe, expect, it } from 'vitest';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
  externalDecisionRequestSchema,
} from '../../src/sim/decisions/externalSchemas';
import { externalContextHash } from '../../src/sim/decisions/externalContext';
import { MODEL_EXPERIMENT_ID, MODEL_EXPERIMENT_VERSION } from '../../src/sim/decisions/conditions';
import { PROTOCOL_CONDITION_IDS } from '../../src/shared/workerProtocol';
import { CONDITION_IDS } from '../../src/sim/decisions/conditions';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';

/** Milestone 001, section 23.2: exact outbound request contract. */

let cached: ExternalDecisionRequest | null = null;
function genuineExternalRequest(): ExternalDecisionRequest {
  if (!cached) {
    const run: EngineRun = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
    cached = run.externalRequests[0]!;
  }
  return JSON.parse(JSON.stringify(cached)) as ExternalDecisionRequest;
}

function envelopeFor(external: ExternalDecisionRequest): Record<string, unknown> {
  return {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: 'mara-model-per-decision-v1',
    runId: 'run-test-00000001',
    providerId: external.request.providerId,
    promptVersion: 'mara-action-selection-1.0.0',
    contextHash: external.contextHash,
    request: external.request,
    context: external.context,
    truncationCounts: external.truncationCounts,
  };
}

describe('exact external decision-request schema', () => {
  it('a genuine Mara request parses, and its context hash is reproducible', () => {
    const external = genuineExternalRequest();
    expect(externalDecisionRequestSchema.safeParse(external).success).toBe(true);
    expect(externalContextHash(external.context)).toBe(external.contextHash);
    expect(externalDecisionRequestEnvelopeSchema.safeParse(envelopeFor(external)).success).toBe(
      true,
    );
  });

  it('rejects extra, missing, mistyped, fractional, and oversized fields', () => {
    const extra = genuineExternalRequest() as unknown as Record<string, unknown>;
    (extra.request as Record<string, unknown>).injected = 1;
    expect(externalDecisionRequestSchema.safeParse(extra).success).toBe(false);

    const missing = genuineExternalRequest() as unknown as {
      request: Record<string, unknown>;
    };
    delete missing.request.hardDependencyFingerprint;
    expect(externalDecisionRequestSchema.safeParse(missing).success).toBe(false);

    const fractional = genuineExternalRequest();
    (fractional.request as unknown as { requestedAtTick: number }).requestedAtTick = 60.5;
    expect(externalDecisionRequestSchema.safeParse(fractional).success).toBe(false);

    const mistyped = genuineExternalRequest();
    (mistyped.context.state as unknown as { hungerMicro: unknown }).hungerMicro = '720000';
    expect(externalDecisionRequestSchema.safeParse(mistyped).success).toBe(false);

    const oversized = genuineExternalRequest();
    const first = oversized.request.offeredAffordances[0]!;
    while (oversized.request.offeredAffordances.length <= 24) {
      oversized.request.offeredAffordances.push({ ...first });
      oversized.request.offeredAffordanceIds.push(first.id);
    }
    expect(externalDecisionRequestSchema.safeParse(oversized).success).toBe(false);
  });

  it('rejects offered ID / descriptor divergence', () => {
    const diverged = genuineExternalRequest();
    diverged.request.offeredAffordanceIds.reverse();
    if (diverged.request.offeredAffordanceIds.length > 1) {
      expect(externalDecisionRequestSchema.safeParse(diverged).success).toBe(false);
    }
  });

  it('rejects wrong experiment, condition, or schema version at the envelope', () => {
    const external = genuineExternalRequest();
    const wrongExperiment = { ...envelopeFor(external), experimentId: 'some-other-experiment' };
    expect(externalDecisionRequestEnvelopeSchema.safeParse(wrongExperiment).success).toBe(false);

    const wrongCondition = { ...envelopeFor(external), conditionId: 'unregistered-condition' };
    expect(externalDecisionRequestEnvelopeSchema.safeParse(wrongCondition).success).toBe(false);

    const wrongSchema = { ...envelopeFor(external), schemaVersion: 999 };
    expect(externalDecisionRequestEnvelopeSchema.safeParse(wrongSchema).success).toBe(false);

    const providerMismatch = { ...envelopeFor(external), providerId: 'someone-else-v1' };
    expect(externalDecisionRequestEnvelopeSchema.safeParse(providerMismatch).success).toBe(false);
  });

  it('the protocol-layer condition mirror stays pinned to the engine registry', () => {
    expect([...PROTOCOL_CONDITION_IDS]).toEqual([...CONDITION_IDS]);
  });
});
