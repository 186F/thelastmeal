import { buildLedgerFile } from '../src/sim/runtime/ledgerFileBuilder';
import { canonicalLedgerHash } from '../src/sim/replay/ledgerHash';
import { replayLedger } from '../src/sim/replay/replay';
import type { LedgerFile } from '../src/shared/ledgerFile';
import type { ScenarioId } from '../src/shared/ids';
import type { SimEvent } from '../src/sim/events/types';
import { completedRun } from './helpers';

/**
 * Corrupt-ledger construction shared by tests/unit/ledger-import.test.ts and
 * tests/integration/model-corruption.test.ts (1.5.0 V6). Lives in a non-test
 * module because importing one *.test.ts file from another re-registers the
 * imported file's entire describe tree inside the importing suite.
 */

/** A deep-copied genuine export of a completed run — safe to mutate. */
export function exportedFile(scenario: ScenarioId = 'A'): LedgerFile {
  return JSON.parse(JSON.stringify(buildLedgerFile(completedRun(scenario)))) as LedgerFile;
}

/**
 * Reseals a tampered file the way a determined forger would: recomputes the
 * world-state hash from an actual replay, restamps the ScenarioEnded payload,
 * and recomputes the canonical ledger hash over the doctored stream. A tamper
 * that survives resealing can only be caught by the semantic cross-checks
 * (re-audit finding 2) — never by the hash comparisons.
 */
export function reseal(file: LedgerFile): string {
  const replayed = replayLedger(file.scenario.id, file.events);
  file.worldStateHash = replayed.worldStateHash;
  const ended = file.events.find((e) => e.type === 'ScenarioEnded');
  if (ended) {
    (ended.payload as { worldStateHash: string }).worldStateHash = replayed.worldStateHash;
  }
  file.canonicalLedgerHash = canonicalLedgerHash(file.events as SimEvent[]);
  return JSON.stringify(file);
}

/** Re-aligns ONLY the top-level hashes with each other — file.worldStateHash
 * and the ScenarioEnded payload get the same forged value, and the canonical
 * ledger hash is recomputed over the (now doctored) stream. The file is
 * internally "consistent" yet the world hash no longer replays — the §5.4
 * "hashes edited to match one another but not the event stream" class. */
export function resealTopLevelHashesOnly(file: LedgerFile, forgedWorldHash: string): string {
  file.worldStateHash = forgedWorldHash;
  const ended = file.events.find((e) => e.type === 'ScenarioEnded');
  if (ended) {
    (ended.payload as { worldStateHash: string }).worldStateHash = forgedWorldHash;
  }
  file.canonicalLedgerHash = canonicalLedgerHash(file.events as SimEvent[]);
  return JSON.stringify(file);
}
