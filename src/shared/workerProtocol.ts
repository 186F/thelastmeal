import { z } from 'zod';
import { PROTOCOL_VERSION } from './versions';
import { eventEnvelopeSchema, type EventEnvelope } from './events';
import {
  EXTERNAL_FAILURE_CODES,
  type DecisionResponse,
  type ExternalDecisionFailure,
  type ExternalDecisionRequest,
} from './decisionContracts';
import type { PresentationSnapshot, RunStatus } from './snapshots';
import type { BatchReport, FinalSummary } from './reports';
import { ACTION_MODES, type ScenarioId } from './ids';
import type { ValidationIssue } from './validation';

/** Registered experimental condition IDs (milestone 001, section 6). The
 * authoritative registry lives in `src/sim/decisions/conditions.ts`; this
 * mirror exists so the shared protocol layer stays a leaf. A drift test pins
 * the two lists together. */
export const PROTOCOL_CONDITION_IDS = [
  'deterministic-baseline-v1',
  'mara-model-per-decision-v1',
  'mara-model-per-decision-m2-v1',
] as const;

/**
 * Typed, versioned message protocol between the browser application (main
 * thread) and the simulation Web Worker.
 *
 * Rules enforced here and in the worker host:
 * - Every message carries `protocolVersion`.
 * - Every command carries a stable `commandId` and a strictly increasing
 *   `commandSeq`. The worker rejects duplicate or out-of-order commands.
 * - All payloads are structured-clone serializable plain data.
 */

export const OPERATOR_SPEEDS = [1, 5, 20] as const;
export type OperatorSpeed = (typeof OPERATOR_SPEEDS)[number];

// ---------------------------------------------------------------------------
// Commands (main thread -> worker)
// ---------------------------------------------------------------------------

export interface CommandBase {
  protocolVersion: number;
  commandId: string;
  commandSeq: number;
}

export type WorkerCommand = CommandBase &
  (
    | { type: 'hello' }
    | {
        type: 'load-scenario';
        scenarioId: ScenarioId;
        conditionId?: (typeof PROTOCOL_CONDITION_IDS)[number];
      }
    | { type: 'start' }
    | { type: 'pause' }
    | { type: 'resume' }
    | { type: 'set-speed'; speed: OperatorSpeed }
    | { type: 'step'; ticks: number }
    | { type: 'run-to-completion' }
    | { type: 'reset' }
    | { type: 'run-batch' }
    | { type: 'export-ledger' }
    | { type: 'import-ledger'; fileText: string }
    | { type: 'replay'; source: 'imported' | 'live' }
    | { type: 'export-traces' }
    | { type: 'export-batch-report' }
    | { type: 'validate-config' }
    | { type: 'submit-decision-response'; response: DecisionResponse }
    | { type: 'submit-decision-failure'; failure: ExternalDecisionFailure }
  );

const commandBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().min(1),
  commandSeq: z.number().int().nonnegative(),
};

/** Exact runtime schema for an externally submitted decision response. */
export const decisionResponseSchema = z
  .object({
    responseId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(200),
    npcId: z.enum(['mara', 'jonas', 'rin']),
    scenarioId: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
    providerId: z.string().min(1).max(200),
    selectedAffordanceId: z.string().min(1).max(500),
    confidenceBp: z.number().int().min(0).max(10_000),
    reasonCode: z.string().min(1).max(200),
    scores: z
      .array(
        z
          .object({
            affordanceId: z.string().min(1).max(500),
            mode: z.enum(ACTION_MODES),
            totalScore: z.number().int(),
            components: z
              .array(
                z.object({ code: z.string().min(1).max(200), value: z.number().int() }).strict(),
              )
              .max(64),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

/** Exact runtime schema for an externally reported decision failure
 * (milestone 001, section 15). */
export const externalDecisionFailureSchema = z
  .object({
    failureId: z.string().min(1).max(100),
    requestId: z.string().min(1).max(200),
    npcId: z.enum(['mara', 'jonas', 'rin']),
    scenarioId: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
    providerId: z.string().min(1).max(200),
    failureCode: z.enum(EXTERNAL_FAILURE_CODES),
    retryable: z.boolean(),
  })
  .strict();

export const workerCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...commandBase, type: z.literal('hello') }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('load-scenario'),
      scenarioId: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
      conditionId: z.enum(PROTOCOL_CONDITION_IDS).optional(),
    })
    .strict(),
  z.object({ ...commandBase, type: z.literal('start') }).strict(),
  z.object({ ...commandBase, type: z.literal('pause') }).strict(),
  z.object({ ...commandBase, type: z.literal('resume') }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('set-speed'),
      speed: z.union([z.literal(1), z.literal(5), z.literal(20)]),
    })
    .strict(),
  z
    .object({ ...commandBase, type: z.literal('step'), ticks: z.number().int().min(1).max(1000) })
    .strict(),
  z.object({ ...commandBase, type: z.literal('run-to-completion') }).strict(),
  z.object({ ...commandBase, type: z.literal('reset') }).strict(),
  z.object({ ...commandBase, type: z.literal('run-batch') }).strict(),
  z.object({ ...commandBase, type: z.literal('export-ledger') }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('import-ledger'),
      fileText: z.string().max(50_000_000),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('replay'),
      source: z.enum(['imported', 'live']),
    })
    .strict(),
  z.object({ ...commandBase, type: z.literal('export-traces') }).strict(),
  z.object({ ...commandBase, type: z.literal('export-batch-report') }).strict(),
  z.object({ ...commandBase, type: z.literal('validate-config') }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('submit-decision-response'),
      response: decisionResponseSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('submit-decision-failure'),
      failure: externalDecisionFailureSchema,
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// Responses (worker -> main thread)
// ---------------------------------------------------------------------------

export interface ScenarioListing {
  id: ScenarioId;
  version: string;
  seed: number;
  title: string;
  description: string;
}

export type WorkerResponse = { protocolVersion: number } & (
  | { type: 'ready'; scenarios: ScenarioListing[]; providerId: string }
  | {
      type: 'ack';
      commandId: string;
      ok: boolean;
      errorCode: string | null;
      message: string | null;
    }
  | {
      type: 'snapshot';
      snapshotSeq: number;
      runStatus: RunStatus;
      speed: OperatorSpeed;
      snapshot: PresentationSnapshot;
    }
  | { type: 'events'; events: EventEnvelope[]; totalCount: number }
  | {
      type: 'run-complete';
      scenarioId: ScenarioId;
      worldStateHash: string;
      canonicalLedgerHash: string;
      summary: FinalSummary;
    }
  | { type: 'ledger-export'; fileName: string; json: string }
  | { type: 'import-result'; ok: boolean; errors: string[]; scenarioId: ScenarioId | null }
  | {
      type: 'replay-result';
      ok: boolean;
      match: boolean;
      computedWorldStateHash: string | null;
      expectedWorldStateHash: string | null;
      computedLedgerHash: string | null;
      expectedLedgerHash: string | null;
      errors: string[];
    }
  | {
      type: 'decision-request';
      request: ExternalDecisionRequest;
      /** Count of load-scenario/reset commands the worker has processed:
       * lets the client discard requests from a superseded run that were
       * still in the message queue when a new run started (adversarial
       * review: without it, old-run requests would be re-labelled with the
       * NEW gateway runId and bypass the stale-run discard). */
      runSeq: number;
    }
  | { type: 'batch-progress'; completed: number; total: number; currentScenarioId: ScenarioId }
  | { type: 'batch-result'; report: BatchReport; reportJson: string; reportMarkdown: string }
  | { type: 'traces-export'; fileName: string; json: string }
  | { type: 'validation-result'; ok: boolean; issues: ValidationIssue[] }
  | { type: 'fatal'; message: string }
);

/**
 * Envelope-level response schema. The `snapshot`, `report`, and `summary`
 * payloads are produced by trusted local simulation code and validated
 * structurally at their sources; here we validate the envelope discriminant,
 * protocol version, and the fields the UI dispatches on.
 */
export const workerResponseEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.enum([
      'ready',
      'ack',
      'snapshot',
      'events',
      'run-complete',
      'ledger-export',
      'import-result',
      'replay-result',
      'decision-request',
      'batch-progress',
      'batch-result',
      'traces-export',
      'validation-result',
      'fatal',
    ]),
  })
  .passthrough();

export const workerEventsResponseSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('events'),
    events: z.array(eventEnvelopeSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();
