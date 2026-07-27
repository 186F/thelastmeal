import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../shared/modelExperiment';
import type { ClientTraceEntry, RunBundle } from '../shared/modelArtifacts';
import type { ViewState } from './store';

/**
 * Pure run-bundle assembly (re-audit remediation F5/F9): the terminal
 * client-side handoff for the finalizer, extracted from the model panel so
 * the emitted shape is bound to `RunBundle` (src/shared/modelArtifacts) at
 * compile time and testable in node without a DOM. Hashes come from the
 * existing terminal snapshot surface (null when genuinely unavailable), the
 * slim client trace rides along, and NO worker command or protocol message
 * is involved.
 */

/** The export enable predicate (F5): only a terminal run under the model
 * condition may produce a bundle. The panel additionally requires an idle
 * gateway client before snapshotting (F1). */
export function canExportRunBundle(
  s: Pick<ViewState, 'runStatus' | 'selectedConditionId'>,
): boolean {
  return s.runStatus === 'complete' && s.selectedConditionId === MODEL_CONDITION_ID;
}

export function buildRunBundle(
  s: ViewState,
  clientTrace: ClientTraceEntry[],
  runIdFallback: string,
  exportedAtUtc: string,
): RunBundle {
  const gw = s.model.gateway;
  return {
    bundleSchemaVersion: 1,
    handoff: {
      runId: gw?.runId ?? runIdFallback,
      conditionId: s.selectedConditionId,
      scenarioId: s.snapshot?.scenarioId ?? s.selectedScenarioId,
      providerId: EXTERNAL_MARA_PROVIDER_ID,
      promptVersion: MODEL_PROMPT_VERSION,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      worldStateHash: s.finalWorldHash ?? s.snapshot?.worldStateHash ?? null,
      canonicalLedgerHash: s.finalLedgerHash ?? s.snapshot?.canonicalLedgerHash ?? null,
      callsAttempted: gw?.callsAttempted ?? 0,
      gatewayResponses: gw?.gatewayResponses ?? 0,
      acceptedModelResponses: s.model.acceptedModelResponses,
      failuresByCode: { ...(gw?.failuresByCode ?? {}) },
      exportedAtUtc,
    },
    clientTrace,
  };
}
