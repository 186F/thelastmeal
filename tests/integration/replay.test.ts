import { describe, expect, it } from 'vitest';
import { SCENARIO_IDS } from '../../src/shared/ids';
import { replayLedger } from '../../src/sim/replay/replay';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { hashCanonicalState } from '../../src/sim/replay/hash';
import { completedRun } from '../helpers';

describe('deterministic replay', () => {
  for (const id of SCENARIO_IDS) {
    it(`scenario ${id}: replaying the ledger reproduces the exact final state and hash`, () => {
      const run = completedRun(id);
      const replay = replayLedger(id, run.ledger.events);
      expect(replay.finalStateHash).toBe(run.finalStateHash);
      expect(replay.recordedHash).toBe(run.finalStateHash);
      // Full deep-state equality, not just the hash.
      expect(replay.state).toEqual(run.state);
      expect(hashCanonicalState(replay.state)).toBe(hashCanonicalState(run.state));
    });
  }

  it('replay consults no decision provider (ledger events only)', () => {
    // Replay applies the recorded decisions; the count of decision events in
    // the replayed state's provenance equals the recording exactly, and
    // replayLedger has no provider parameter by construction. Guard the
    // contract by replaying a doctored ledger with all decision events
    // stripped of scores — outcomes must be identical because scores are
    // debug data, not authoritative inputs.
    const run = completedRun('A');
    const stripped = run.ledger.events.map((e) =>
      e.type === 'DecisionReturned'
        ? { ...e, payload: { ...(e.payload as object), scores: [] } }
        : e,
    );
    const replay = replayLedger('A', stripped as typeof run.ledger.events);
    expect(replay.finalStateHash).toBe(run.finalStateHash);
  });

  it('an exported file round-trips through validation and replays to a matching hash', () => {
    const run = completedRun('C');
    const json = JSON.stringify(buildLedgerFile(run));
    const validated = validateLedgerFile(json);
    expect(validated.ok).toBe(true);
    const replay = replayLedger(validated.file!.scenario.id, validated.file!.events);
    expect(replay.finalStateHash).toBe(validated.file!.finalStateHash);
  });
});
