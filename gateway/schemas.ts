import type { z } from 'zod';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
  gatewayDecisionResultSchema,
} from '../src/sim/decisions/externalSchemas';

/**
 * Gateway-side schema surface (milestone 001, section 10). Everything here
 * re-exports the SINGLE shared contract definitions from the simulation
 * side; the gateway maintains no schema copies of its own, so the contract
 * cannot drift between layers.
 */

export {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  externalDecisionRequestEnvelopeSchema,
  gatewayDecisionResultSchema,
};
export { externalContextHash } from '../src/sim/decisions/externalContext';
export {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_TARGET_NPC_ID,
} from '../src/shared/modelExperiment';
export {
  M2_ACTION_PROMPT_VERSION,
  M2_ACTION_PROVIDER_ID,
  M2_EXPERIMENT_ID,
  M2_EXPERIMENT_VERSION,
  M2_PER_DECISION_CONDITION_ID,
  M2_TARGET_NPC_ID,
} from '../src/shared/m2Experiment';
export { contractForCondition, requireContractForCondition } from '../src/shared/conditionContract';

export type ExternalDecisionRequestEnvelope = z.infer<typeof externalDecisionRequestEnvelopeSchema>;
export type GatewayDecisionResult = z.infer<typeof gatewayDecisionResultSchema>;
