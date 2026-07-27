import { z } from 'zod';
import type { ExternalFailureCode } from '../../src/shared/decisionContracts';

/**
 * Provider-agnostic model adapter interface (milestone 001, section 11). The
 * gateway's route code depends on THIS, never on a vendor SDK: the fake
 * adapter is the CI default (no network, no secret), while live vendor
 * adapters are instantiated only inside the server-side gateway.
 */

export const MODEL_REASON_CODES = [
  'survival',
  'physical-need',
  'goal',
  'commitment',
  'memory',
  'relationship',
  'social-request',
  'routine',
  'uncertainty',
] as const;
export type ModelReasonCode = (typeof MODEL_REASON_CODES)[number];

export const MODEL_RATIONALE_MAX_CHARS = 160;

export interface ModelChoice {
  selectedAffordanceId: string;
  reasonCode: ModelReasonCode;
  confidenceBp: number;
  /** Max 160-character summary for the noncanonical trace — never a
   * reasoning transcript, never forwarded into canonical events. */
  rationale: string;
}

export interface ModelChoiceMeta {
  /** Exact model identifier the upstream reported (or the adapter id). */
  modelId: string;
  upstreamResponseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Selected upstream endpoint/provider when a router reports one. This is
   * noncanonical research metadata and never affects engine acceptance. */
  upstreamProviderId?: string | null;
  /** Opaque, JSON-safe router metadata. Consumers must ignore unknown fields;
   * router schemas are additive. Never contains secrets or request content. */
  routerMetadata?: Record<string, unknown> | null;
}

export interface AdapterInput {
  /** Server-owned system instruction for the pinned prompt version. */
  systemInstruction: string;
  /** Delimited untrusted in-world data + task framing. */
  userContent: string;
  /** JSON Schema whose selectedAffordanceId enum contains ONLY offered IDs. */
  outputJsonSchema: Record<string, unknown>;
  offeredAffordanceIds: readonly string[];
}

export interface AdapterResult {
  choice: unknown;
  meta: ModelChoiceMeta;
  /** Raw model output text when the adapter has it. Persisted to the trace
   * (bounded) ONLY on invalid-model-output / upstream-refusal outcomes —
   * never on success. */
  rawOutput?: string;
}

/** Typed adapter failure: maps 1:1 onto the bounded external failure codes. */
export class AdapterFailure extends Error {
  constructor(
    readonly failureCode: ExternalFailureCode,
    message: string,
    /** Raw upstream model text (refusal text / non-JSON output) for the
     * trace's bounded rawModelOutput field. */
    readonly rawOutput?: string,
    /** Optional upstream/router metadata available on a failed request. */
    readonly meta?: ModelChoiceMeta,
  ) {
    super(message);
  }
}

export interface ModelDecisionAdapter {
  readonly id: string;
  decide(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult>;
}

/** Exact runtime schema for a model choice over one request's offered set.
 * The enum is dynamic: no unoffered ID can parse (section 13). */
export function modelChoiceSchema(offeredIds: readonly string[]) {
  if (offeredIds.length === 0) throw new Error('model-choice-schema-empty-offer');
  return z
    .object({
      selectedAffordanceId: z.enum(offeredIds as [string, ...string[]]),
      reasonCode: z.enum(MODEL_REASON_CODES),
      confidenceBp: z.number().int().min(0).max(10_000),
      rationale: z.string().max(MODEL_RATIONALE_MAX_CHARS),
    })
    .strict();
}
