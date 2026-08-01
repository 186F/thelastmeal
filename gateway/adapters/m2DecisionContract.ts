import { z } from 'zod';
import { M2_RATIONALE_TRACE_MAX_CHARS } from '../../src/shared/m2Experiment';
import { MODEL_REASON_CODES, type ModelReasonCode } from './modelDecisionAdapter';

/**
 * The Milestone 2 revised diagnostic-output contract (brief §17.5; scope
 * ruling R7 §9.1/§9.2), applied to adapter output for the M2
 * per-decision condition. The frozen Milestone 1 contract
 * (`modelChoiceSchema`) is not modified.
 *
 * Structural fields — the selected affordance ID (from the offered set
 * only) and the bounded reason code — are validated independently and
 * strictly. Rationale and self-reported confidence are OPTIONAL
 * DIAGNOSTICS: missing, non-string, or overlong rationale is normalized
 * (null or truncated to the fixed trace limit) with a noncanonical
 * `rationaleNormalized` flag; a missing or non-conforming confidence
 * normalizes to null in the trace. Neither can ever convert a structurally
 * valid choice into `invalid-model-output` (Milestone 1's seven
 * rationale-length live failures are the motivating defect), and neither
 * ever influences action legality or world state.
 */

export interface M2NormalizedChoice {
  selectedAffordanceId: string;
  reasonCode: ModelReasonCode;
  /** Normalized diagnostic rationale: null when absent or non-string,
   * truncated to M2_RATIONALE_TRACE_MAX_CHARS when overlong. */
  rationale: string | null;
  /** The model's self-reported confidence claim, or null when absent or
   * non-conforming. Diagnostic only (ruling R7 §9.2): excluded from control
   * semantics and from primary analysis. */
  selfReportedConfidenceBp: number | null;
  /** True when the rationale diagnostic was altered in ANY way (missing,
   * non-string, or truncated) — the R7 §9.1 normalization flag. */
  rationaleNormalized: boolean;
}

export type M2ChoiceParseResult =
  { ok: true; choice: M2NormalizedChoice } | { ok: false; detail: string };

/** Strict schema for the STRUCTURAL fields only. Unknown extra keys are
 * tolerated (they are upstream noise, not structure) and never stored. */
function m2StructuralSchema(offeredIds: readonly string[]) {
  if (offeredIds.length === 0) throw new Error('m2-choice-schema-empty-offer');
  return z
    .object({
      selectedAffordanceId: z.enum(offeredIds as [string, ...string[]]),
      reasonCode: z.enum(MODEL_REASON_CODES),
    })
    .passthrough();
}

/**
 * Parses adapter output under the M2 contract. Returns a structural
 * failure ONLY when the output is not an object, names an unoffered
 * affordance, or carries an invalid reason code — never because of
 * rationale or confidence.
 */
export function parseM2Choice(raw: unknown, offeredIds: readonly string[]): M2ChoiceParseResult {
  const structural = m2StructuralSchema(offeredIds).safeParse(raw);
  if (!structural.success) {
    const detail = structural.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return { ok: false, detail };
  }
  const source = raw as Record<string, unknown>;

  // §17.5 names three normalization cases — missing, non-string, overlong —
  // and the flag records ALL of them (the R2 calibration study's
  // rationale-normalization frequency counts exactly these).
  let rationale: string | null = null;
  let rationaleNormalized = false;
  const rawRationale = source.rationale;
  if (typeof rawRationale === 'string') {
    if (rawRationale.length > M2_RATIONALE_TRACE_MAX_CHARS) {
      rationale = rawRationale.slice(0, M2_RATIONALE_TRACE_MAX_CHARS);
      rationaleNormalized = true;
    } else {
      rationale = rawRationale;
    }
  } else {
    rationale = null;
    rationaleNormalized = true;
  }

  const rawConfidence = source.confidenceBp;
  const selfReportedConfidenceBp =
    typeof rawConfidence === 'number' &&
    Number.isInteger(rawConfidence) &&
    rawConfidence >= 0 &&
    rawConfidence <= 10_000
      ? rawConfidence
      : null;

  return {
    ok: true,
    choice: {
      selectedAffordanceId: structural.data.selectedAffordanceId,
      reasonCode: structural.data.reasonCode,
      rationale,
      selfReportedConfidenceBp,
      rationaleNormalized,
    },
  };
}

/**
 * The compatibility value carried in the engine response's required
 * `confidenceBp` field when the model reported none (ruling §9.2: "the
 * existing action-response interface may retain a compatibility field, but
 * its value remains diagnostic only"). A fixed constant keeps the response
 * deterministic in the model output; the raw claim (or null) lives in the
 * trace as `selfReportedConfidenceBp`.
 */
export const M2_CONFIDENCE_COMPATIBILITY_VALUE = 0;
