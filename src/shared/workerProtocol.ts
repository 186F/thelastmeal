import { z } from 'zod';
import { PROTOCOL_VERSION } from './versions';
import { eventEnvelopeSchema, type EventEnvelope } from './events';
import type { PresentationSnapshot, RunStatus } from './snapshots';
import type { BatchReport, FinalSummary } from './reports';
import type { ScenarioId } from './ids';
import type { ValidationIssue } from './validation';

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
    | { type: 'load-scenario'; scenarioId: ScenarioId }
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
  );

const commandBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().min(1),
  commandSeq: z.number().int().nonnegative(),
};

export const workerCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...commandBase, type: z.literal('hello') }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('load-scenario'),
      scenarioId: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
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
  | { type: 'run-complete'; scenarioId: ScenarioId; finalStateHash: string; summary: FinalSummary }
  | { type: 'ledger-export'; fileName: string; json: string }
  | { type: 'import-result'; ok: boolean; errors: string[]; scenarioId: ScenarioId | null }
  | {
      type: 'replay-result';
      ok: boolean;
      match: boolean;
      computedHash: string | null;
      expectedHash: string | null;
      errors: string[];
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
