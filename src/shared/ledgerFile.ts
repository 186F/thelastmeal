import { z } from 'zod';
import { eventEnvelopeSchema, type EventEnvelope } from './events';
import type { FinalSummary } from './reports';
import type { NpcId, ScenarioId } from './ids';
import { LEDGER_FILE_FORMAT_VERSION, SCHEMA_VERSION } from './versions';

/**
 * Exported ledger file format. This is the unit of export, import, and replay.
 * Envelope-level structure is validated here with zod; event ordering, ID
 * integrity, and semantic checks are performed by the simulation core's
 * imported-ledger validator before any replay begins.
 */

export interface LedgerFileScenarioMeta {
  id: ScenarioId;
  version: string;
  seed: number;
  configVersion: string;
  schemaVersion: number;
}

export interface LedgerFile {
  formatVersion: number;
  experimentId: string;
  scenario: LedgerFileScenarioMeta;
  providerId: string;
  events: EventEnvelope[];
  finalSummary: FinalSummary;
  finalStateHash: string;
}

const finalSummarySchema = z
  .object({
    tick: z.number().int().nonnegative(),
    taskOutcome: z.enum(['completed', 'deadline-missed']),
    progressUnits: z.number().int().nonnegative(),
    mealConsumedBy: z.enum(['mara', 'jonas', 'rin']).nullable(),
    promiseOutcome: z.enum([
      'fulfilled',
      'fulfilled-after-renegotiation',
      'broken',
      'broken-after-renegotiation',
      'none',
    ]),
    ownershipViolationCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
  })
  .strict();

export const ledgerFileSchema = z
  .object({
    formatVersion: z.literal(LEDGER_FILE_FORMAT_VERSION),
    experimentId: z.string().min(1),
    scenario: z
      .object({
        id: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
        version: z.string().min(1),
        seed: z.number().int(),
        configVersion: z.string().min(1),
        schemaVersion: z.literal(SCHEMA_VERSION),
      })
      .strict(),
    providerId: z.string().min(1),
    events: z.array(eventEnvelopeSchema),
    finalSummary: finalSummarySchema,
    finalStateHash: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();

export function ledgerFileName(scenarioId: ScenarioId, version: string, seed: number): string {
  return `ledger-${scenarioId}-v${version}-seed${seed}.json`;
}

export type { NpcId };
