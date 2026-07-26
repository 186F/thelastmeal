import type { LedgerFile } from '../../shared/ledgerFile';
import { EXPERIMENT_ID, LEDGER_FILE_FORMAT_VERSION, SCHEMA_VERSION } from '../../shared/versions';
import { buildFinalSummary } from '../reporting';
import type { EngineRun } from './engine';

/** Builds the exportable ledger file for a completed run. */
export function buildLedgerFile(run: EngineRun): LedgerFile {
  if (!run.state.terminal || run.finalStateHash === null) {
    throw new Error('export-requires-terminal-run');
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
    providerId: run.provider.id,
    events: run.ledger.toJSON(),
    finalSummary: buildFinalSummary(run.state, run.ledger.events),
    finalStateHash: run.finalStateHash,
  };
}
