import type { LedgerFile } from '../../shared/ledgerFile';
import { EXPERIMENT_ID, LEDGER_FILE_FORMAT_VERSION, SCHEMA_VERSION } from '../../shared/versions';
import { buildFinalSummary } from '../reporting';
import { V1_ROLES } from '../scenarios/roles';
import type { EngineRun } from './engine';

/** Builds the exportable ledger file for a completed run. */
export function buildLedgerFile(run: EngineRun): LedgerFile {
  if (!run.state.terminal || run.worldStateHash === null || run.canonicalLedgerHash === null) {
    throw new Error('export-requires-terminal-run');
  }
  // The ledger-file contract covers v1.0 runs only: the file format records
  // no role assignment, and importing a rotated eval run would replay onto a
  // V1-roles initial state and fail as world-hash-mismatch. Refuse loudly
  // instead of emitting a file that cannot round-trip.
  if (
    run.roles.benchWorker !== V1_ROLES.benchWorker ||
    run.roles.debtor !== V1_ROLES.debtor ||
    run.roles.mealOwner !== V1_ROLES.mealOwner
  ) {
    throw new Error('export-requires-v1-roles');
  }
  return {
    formatVersion: LEDGER_FILE_FORMAT_VERSION,
    experimentId: EXPERIMENT_ID,
    scenario: {
      id: run.scenario.id,
      version: run.scenario.version,
      seed: run.scenario.seed,
      configVersion: run.state.configVersion,
      schemaVersion: SCHEMA_VERSION,
    },
    providerId: run.plan.id,
    events: run.ledger.toJSON(),
    finalSummary: buildFinalSummary(run.state, run.ledger.events),
    worldStateHash: run.worldStateHash,
    canonicalLedgerHash: run.canonicalLedgerHash,
  };
}
