import { describe, expect, it } from 'vitest';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import type {
  DecisionContext,
  DecisionProvider,
  ProviderDecision,
} from '../../src/sim/decisions/provider';
import { createRun, runToCompletion, stepTick } from '../../src/sim/runtime/engine';
import { worldStateHash } from '../../src/sim/replay/worldHash';
import { canonicalLedgerHash } from '../../src/sim/replay/ledgerHash';
import { completedRun } from '../helpers';

/**
 * Remediation 4 (section 8.4): the semantic world-state hash covers
 * consequential state only. Provider explanations, confidences, transport
 * counters, and counter-minted identifiers never affect it; behaviorally
 * meaningful changes always do.
 */

/** Delegates every choice to the deterministic provider but reports different
 * diagnostics (confidence, reason code, no scores). */
class DifferentDiagnosticsProvider implements DecisionProvider {
  readonly id = 'different-diagnostics-v1';
  private readonly inner = new DeterministicProvider();
  decide(ctx: DecisionContext): ProviderDecision {
    const result = this.inner.decide(ctx);
    return { ...result, confidenceBp: 1, reasonCode: 'opaque-explanation', scores: [] };
  }
}

describe('provider diagnostics never reach the world-state hash', () => {
  it('same consequential world, different reason codes/confidences -> same worldStateHash, different ledger hash', () => {
    const baseline = completedRun('A');

    const wrapped = createRun('A');
    wrapped.provider = new DifferentDiagnosticsProvider();
    runToCompletion(wrapped);

    expect(wrapped.worldStateHash).toBe(baseline.worldStateHash);
    // The diagnostics ARE part of the canonical audit history.
    expect(wrapped.canonicalLedgerHash).not.toBe(baseline.canonicalLedgerHash);
  });

  it('counter-derived identifiers are excluded: shifting every ID leaves the hash unchanged', () => {
    const run = completedRun('C');
    const clone = structuredClone(run.state);
    // Simulate a decision source that emitted a different number of events:
    // every counter-minted identifier shifts, but no consequential state
    // changes.
    clone.stateVersion += 999;
    clone.worldRevision += 999;
    for (const npc of Object.values(clone.npcs)) {
      npc.lastDecision = null;
      npc.lastSupersededRequestId = 'dec-9999';
      for (const memoryState of npc.memories) {
        memoryState.id = `mem-shifted-${memoryState.id}`;
        if (memoryState.factEventId !== null) memoryState.factEventId = 'evt-999999';
      }
      for (const belief of npc.beliefs) {
        if (belief.provenanceEventId !== null) belief.provenanceEventId = 'evt-999998';
      }
      if (npc.currentAction) {
        npc.currentAction.id = 'act-9999';
        npc.currentAction.affordanceId = 'aff:shifted:9999:wait';
        npc.currentAction.stateVersionAtProposal = 123_456;
      }
    }
    for (const signal of clone.socialSignals) signal.id = `sig-9${signal.id}`;
    for (const request of clone.pendingTransferRequests)
      request.requestId = `req-9${request.requestId}`;
    expect(worldStateHash(clone)).toBe(worldStateHash(run.state));
  });

  it('behaviorally meaningful changes DO change the hash', () => {
    const run = completedRun('A');
    const base = worldStateHash(run.state);

    const relationship = structuredClone(run.state);
    relationship.relationships[0]!.valueMicro += 1;
    expect(worldStateHash(relationship)).not.toBe(base);

    const belief = structuredClone(run.state);
    belief.npcs.mara.beliefs[0]!.value = 'tampered';
    expect(worldStateHash(belief)).not.toBe(base);

    const memoryChange = structuredClone(run.state);
    memoryChange.npcs.mara.memories[0]!.importanceMicro -= 1;
    expect(worldStateHash(memoryChange)).not.toBe(base);

    const injury = structuredClone(run.state);
    injury.npcs.rin.injury.severityMicro += 1;
    expect(worldStateHash(injury)).not.toBe(base);

    const resource = structuredClone(run.state);
    resource.meal.consumedByNpcId = 'jonas';
    expect(worldStateHash(resource)).not.toBe(base);

    const commitment = structuredClone(run.state);
    commitment.commitments[0]!.status = 'broken';
    expect(worldStateHash(commitment)).not.toBe(base);

    const cadence = structuredClone(run.state);
    cadence.npcs.mara.lastDecisionTick += 1; // behaviorally load-bearing
    expect(worldStateHash(cadence)).not.toBe(base);
  });

  it('worldStateHash is terminal-only: hashing a live state throws (re-audit finding 3)', () => {
    // A live mid-run state — including one holding a pending decision — has
    // no defined semantic hash: the projection deliberately omits live
    // decision-transport data (authorized provider, responseIdsSeen, stored
    // dependency fingerprint), so the hash contract is terminal-only.
    const live = createRun('A');
    for (let i = 0; i < 61 && !live.state.terminal; i += 1) {
      stepTick(live);
    }
    expect(live.state.terminal).toBe(false);
    expect(() => worldStateHash(live.state)).toThrowError(
      'world-state-hash-requires-terminal-state',
    );

    // The terminal path (used by endScenario on its provisional clone and by
    // replay after a complete fold) still hashes.
    const done = completedRun('A');
    expect(worldStateHash(done.state)).toBe(done.worldStateHash);
  });

  it('the canonical ledger hash ignores operator markers and raw seq but covers payloads', () => {
    const run = completedRun('A');
    const events = [...run.ledger.events];
    const base = canonicalLedgerHash(events);
    // Payload change -> different hash.
    const doctored = events.map((e, i) =>
      i === 30 ? { ...e, payload: { ...(e.payload as object), doctored: true } } : e,
    );
    expect(canonicalLedgerHash(doctored as typeof events)).not.toBe(base);
    // Shifting every seq (as operator markers would) -> same hash.
    const shifted = events.map((e) => ({ ...e, seq: e.seq + 5 }));
    expect(canonicalLedgerHash(shifted as typeof events)).toBe(base);
  });
});
