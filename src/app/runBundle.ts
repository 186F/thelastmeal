import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../shared/modelExperiment';
import { runBundleSchema, type ClientTraceEntry, type RunBundle } from '../shared/modelArtifacts';
import { externalDecisionRequestEnvelopeSchema } from '../sim/decisions/externalSchemas';
import { externalContextHash } from '../sim/decisions/externalContext';
import type { ViewState } from './store';

/**
 * Pure run-bundle assembly (re-audit remediation F5/F9; bundle schema v2 in
 * 1.5.0): the terminal client-side handoff for the finalizer, extracted from
 * the model panel so the emitted shape is bound to `RunBundle`
 * (src/shared/modelArtifacts) at compile time and testable in node without a
 * DOM. Hashes come from the existing terminal snapshot surface (null when
 * genuinely unavailable), the slim client trace rides along, and NO worker
 * command or protocol message is involved.
 *
 * v2 additionally carries the exact-request archive
 * (`exactRequestEnvelopes` + `archiveDiagnostics`, C2) and the run-level
 * `runCompletedAtUtc` (A4). Per-envelope validation lives HERE in the
 * producer (validateRunBundle) and in the finalizer — never in the leaf
 * schema module (A7).
 */

/** The export enable predicate (F5; extended in 1.5.0 C3/C4): only a
 * terminal model-condition run whose run-complete receipt was stamped, with
 * an unpoisoned exact-request archive, may produce a bundle. The panel
 * additionally requires an idle (not busy) gateway client before
 * snapshotting (F1), and archive COVERAGE is deliberately NOT part of this
 * predicate — it is a post-settle assertion (A6), or in-flight tails would
 * flap the button. */
export function canExportRunBundle(
  s: Pick<ViewState, 'runStatus' | 'selectedConditionId' | 'runCompletedAtUtc' | 'model'>,
): boolean {
  return (
    s.runStatus === 'complete' &&
    s.selectedConditionId === MODEL_CONDITION_ID &&
    s.runCompletedAtUtc !== null &&
    !(s.model.gateway?.archivePoisoned ?? false)
  );
}

export function buildRunBundle(
  s: ViewState,
  clientTrace: ClientTraceEntry[],
  runIdFallback: string,
  exportedAtUtc: string,
  exactRequestEnvelopes: unknown[],
  archiveDiagnostics: string[],
): RunBundle {
  const gw = s.model.gateway;
  return {
    bundleSchemaVersion: 2,
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
      runCompletedAtUtc: s.runCompletedAtUtc,
      exportedAtUtc,
    },
    // The client trace stays COMPLETE — including foreign-runId
    // discarded-stale-run entries. runId-scoped filtering happens in
    // CONSUMERS (A6), never here.
    clientTrace,
    exactRequestEnvelopes: [...exactRequestEnvelopes],
    archiveDiagnostics: [...archiveDiagnostics],
  };
}

/**
 * Producer-side bundle validation (1.5.0 C3, A6, A7), called by the model
 * panel AFTER the gateway client settled and the bundle was assembled — a
 * failing bundle is refused, never downloaded. Returns human-readable
 * problems; empty array = valid.
 *
 * Checks: whole-bundle schema; every archived envelope parses with
 * externalDecisionRequestEnvelopeSchema; pinned contract literals; the
 * context hash recomputes; requestIds are unique; and runId-SCOPED (A6)
 * trace-vs-archive coverage equality — foreign-runId discarded-stale-run
 * entries are exempt by construction.
 */
export function validateRunBundle(bundle: RunBundle): string[] {
  const errors: string[] = [];
  const parsedBundle = runBundleSchema.safeParse(bundle);
  if (!parsedBundle.success) {
    const issue = parsedBundle.error.issues[0];
    errors.push(
      `bundle-schema-invalid: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown'}`,
    );
    return errors;
  }

  const runId = bundle.handoff.runId;
  const envelopeIds = new Map<string, number>();
  bundle.exactRequestEnvelopes.forEach((raw, index) => {
    const parsed = externalDecisionRequestEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push(
        `envelope[${index}] schema-invalid: ` +
          `${issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown'}`,
      );
      return;
    }
    const envelope = parsed.data;
    const requestId = envelope.request.requestId;
    envelopeIds.set(requestId, (envelopeIds.get(requestId) ?? 0) + 1);
    if (envelope.runId !== runId) {
      errors.push(`envelope[${index}] (${requestId}): runId ${envelope.runId} != handoff ${runId}`);
    }
    if (envelope.conditionId !== MODEL_CONDITION_ID) {
      errors.push(`envelope[${index}] (${requestId}): conditionId ${envelope.conditionId}`);
    }
    if (envelope.providerId !== EXTERNAL_MARA_PROVIDER_ID) {
      errors.push(`envelope[${index}] (${requestId}): providerId ${envelope.providerId}`);
    }
    if (envelope.promptVersion !== MODEL_PROMPT_VERSION) {
      errors.push(`envelope[${index}] (${requestId}): promptVersion ${envelope.promptVersion}`);
    }
    const recomputed = externalContextHash(envelope.context);
    if (recomputed !== envelope.contextHash) {
      errors.push(
        `envelope[${index}] (${requestId}): contextHash ${envelope.contextHash} does not ` +
          `recompute (${recomputed})`,
      );
    }
  });

  for (const [requestId, count] of envelopeIds) {
    if (count > 1) errors.push(`duplicate archived envelope for requestId ${requestId} (${count})`);
  }

  // runId-scoped coverage equality (A6): current-run trace entries and
  // archived envelopes must cover exactly the same requestIds.
  const currentRunTraceIds = new Set(
    bundle.clientTrace.filter((entry) => entry.runId === runId).map((entry) => entry.requestId),
  );
  for (const requestId of currentRunTraceIds) {
    if (!envelopeIds.has(requestId)) {
      errors.push(`trace entry ${requestId} has no archived exact-request envelope`);
    }
  }
  for (const requestId of envelopeIds.keys()) {
    if (!currentRunTraceIds.has(requestId)) {
      errors.push(`archived envelope ${requestId} has no run ${runId} client trace entry`);
    }
  }

  if (bundle.archiveDiagnostics.length > 0) {
    errors.push(
      `archiveDiagnostics not empty (${bundle.archiveDiagnostics.length} poison message(s))`,
    );
  }
  return errors;
}
