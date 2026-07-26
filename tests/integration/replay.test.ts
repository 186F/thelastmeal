import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '../../src/shared/ids';
import { replayLedger } from '../../src/sim/replay/replay';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { worldStateHash } from '../../src/sim/replay/worldHash';
import { completedRun } from '../helpers';

describe('deterministic replay', () => {
  for (const id of SCENARIO_IDS) {
    it(`scenario ${id}: replaying the ledger reproduces the exact final state and hash`, () => {
      const run = completedRun(id);
      const replay = replayLedger(id, run.ledger.events);
      expect(replay.worldStateHash).toBe(run.worldStateHash);
      expect(replay.recordedWorldStateHash).toBe(run.worldStateHash);
      // Full deep-state equality, not just the hash.
      expect(replay.state).toEqual(run.state);
      expect(worldStateHash(replay.state)).toBe(worldStateHash(run.state));
    });
  }

  it('replay consults no decision provider (ledger events only)', () => {
    // Replay applies the recorded decisions; replayLedger has no provider
    // parameter by construction. Guard the contract by replaying a doctored
    // ledger with all decision-response scores stripped — outcomes must be
    // identical because scores are debug data, not authoritative inputs.
    const run = completedRun('A');
    const stripped = run.ledger.events.map((e) =>
      e.type === 'DecisionResponseReceived'
        ? { ...e, payload: { ...(e.payload as object), scores: [] } }
        : e,
    );
    const replay = replayLedger('A', stripped as typeof run.ledger.events);
    expect(replay.worldStateHash).toBe(run.worldStateHash);
  });

  it('an exported file round-trips through validation and replays to matching hashes', () => {
    const run = completedRun('C');
    const json = JSON.stringify(buildLedgerFile(run));
    const validated = validateLedgerFile(json);
    expect(
      validated.issues.filter((i) => i.severity === 'error'),
      JSON.stringify(validated.issues),
    ).toEqual([]);
    expect(validated.ok).toBe(true);
    const replay = replayLedger(validated.file!.scenario.id, validated.file!.events);
    expect(replay.worldStateHash).toBe(validated.file!.worldStateHash);
  });
});
