import { describe, expect, it } from 'vitest';
import type { DecisionResponse } from '../../src/shared/decisionContracts';
import type { NpcId } from '../../src/shared/ids';
import { DECISION_REQUEST_TTL_TICKS } from '../../src/sim/config';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import {
  SimulatedAsyncProvider,
  type SimulatedAsyncScript,
} from '../../src/sim/decisions/simulatedAsyncProvider';
import type { DecisionContext } from '../../src/sim/decisions/provider';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { eventsOfType } from '../helpers';
import type { ScenarioId } from '../../src/shared/ids';

/**
 * Remediation 1: the asynchronous decision lifecycle. All responses —
 * scheduled by logical tick or injected through the response inbox — pass
 * the single engine acceptance gate; the simulation clock never blocks.
 */

function deferAll(): SimulatedAsyncScript {
  return () => ({ delayTicks: null });
}

function asyncRun(scenarioId: ScenarioId, script: SimulatedAsyncScript): EngineRun {
  const run = createRun(scenarioId);
  run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), script);
  return run;
}

function stepTo(run: EngineRun, tick: number): void {
  while (run.state.tick < tick && !run.state.terminal) stepTick(run);
}

function inject(
  run: EngineRun,
  npcId: NpcId,
  overrides: Partial<DecisionResponse> = {},
): DecisionResponse {
  const pending = run.state.npcs[npcId].pendingDecision;
  const fallbackAffordance = pending?.offeredAffordances.find((a) => a.mode === 'rest');
  const response: DecisionResponse = {
    responseId: overrides.responseId ?? `ext-${run.state.tick}-${npcId}`,
    requestId: overrides.requestId ?? pending?.requestId ?? 'dec-0000',
    npcId,
    scenarioId: run.state.scenarioId,
    // Provider binding (re-audit finding 1): injected responses must carry
    // the authorized provider's ID or the gate rejects them up front.
    providerId: pending?.providerId ?? 'external-test-gateway',
    selectedAffordanceId:
      overrides.selectedAffordanceId ??
      fallbackAffordance?.id ??
      pending?.offeredAffordances[0]?.id ??
      'aff:none',
    confidenceBp: 5_000,
    reasonCode: 'external-test',
    scores: [],
    ...overrides,
  };
  run.responseInbox.push(response);
  return response;
}

function rejectionsFor(run: EngineRun, responseId: string): string[] {
  return eventsOfType(run, 'DecisionResponseRejected')
    .filter((e) => (e.payload as { responseId: string }).responseId === responseId)
    .map((e) => (e.payload as { rejectionReason: string }).rejectionReason);
}

describe('deferred requests never block the world', () => {
  it('the simulation advances, the busy NPC continues, and the request is replayable state', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const pendingMara = run.state.npcs.mara.pendingDecision;
    expect(pendingMara).not.toBeNull();
    expect(pendingMara!.expiresAtTick).toBe(60 + DECISION_REQUEST_TTL_TICKS);
    // Mara keeps working the bench while her request is pending.
    const repairsWhilePending = eventsOfType(run, 'RepairProgressed').filter(
      (e) => e.tick === 61 && e.actorId === 'mara',
    );
    expect(repairsWhilePending.length).toBe(1);
    stepTo(run, 70);
    expect(run.state.tick).toBe(70);
  });

  it('an idle NPC acts on the provisional deterministic fallback immediately', () => {
    const run = asyncRun('A', deferAll());
    // Rin's non-interruptible delivery ends at tick 180; she then becomes
    // idle with a deferred provider.
    stepTo(run, 181);
    const provisional = eventsOfType(run, 'FallbackDecisionUsed').filter((e) =>
      (e.payload as { reasonCode: string }).reasonCode.startsWith('provisional:'),
    );
    expect(provisional.length).toBeGreaterThan(0);
    expect(run.state.npcs.rin.pendingDecision).not.toBeNull();
    expect(run.state.npcs.rin.currentAction).not.toBeNull();
  });
});

describe('the single acceptance gate (injected responses)', () => {
  it('accepts a delayed response whose hard dependencies are unchanged', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const oldRequestId = run.state.npcs.mara.pendingDecision!.requestId;
    const response = inject(run, 'mara');
    stepTick(run);
    const accepted = eventsOfType(run, 'DecisionResponseAccepted').filter(
      (e) => (e.payload as { responseId: string }).responseId === response.responseId,
    );
    expect(accepted).toHaveLength(1);
    // The rest action launched, preempting the interruptible work session.
    expect(run.state.npcs.mara.currentAction?.mode).toBe('rest');
    // The accepted request is resolved; the preemption itself opens a fresh
    // decision opportunity, so any pending request now is a NEW one.
    expect(run.state.npcs.mara.pendingDecision?.requestId).not.toBe(oldRequestId);
  });

  it('rejects an unoffered affordance and leaves the request pending', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const response = inject(run, 'mara', { selectedAffordanceId: 'aff:mara:60:not-offered' });
    stepTick(run);
    expect(rejectionsFor(run, response.responseId)).toEqual(['unoffered-affordance']);
    expect(run.state.npcs.mara.pendingDecision).not.toBeNull();
  });

  it('rejects a duplicate response ID without duplicating any action', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    // Two copies of a response that fails (unoffered) so the request stays
    // pending: the second copy must be refused as a duplicate.
    const first = inject(run, 'mara', {
      responseId: 'dup-1',
      selectedAffordanceId: 'aff:mara:60:not-offered',
    });
    inject(run, 'mara', { responseId: 'dup-1', selectedAffordanceId: 'aff:mara:60:not-offered' });
    stepTick(run);
    const reasons = eventsOfType(run, 'DecisionResponseRejected')
      .filter((e) => (e.payload as { responseId: string }).responseId === 'dup-1')
      .map((e) => (e.payload as { rejectionReason: string }).rejectionReason);
    expect(reasons).toEqual(['unoffered-affordance', 'duplicate-response']);
    expect(first.responseId).toBe('dup-1');
  });

  it('rejects a response that arrives after its request expired via TTL', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const requestId = run.state.npcs.mara.pendingDecision!.requestId;
    // Under normal cadence a fresh decision opportunity would SUPERSEDE the
    // request before its TTL. Suppress Mara's re-decision cadence so the
    // pure timeout path is exercised.
    run.state.npcs.mara.lastDecisionTick = 400;
    stepTo(run, 122);
    const expired = eventsOfType(run, 'DecisionRequestExpired').filter(
      (e) => (e.payload as { requestId: string }).requestId === requestId,
    );
    expect(expired).toHaveLength(1);
    expect((expired[0]!.payload as { reasonCode: string }).reasonCode).toBe('ttl-expired');
    // A late response to the dead request reports its true reason via the
    // resolved-request registry (re-audit finding 5).
    const response = inject(run, 'mara', { requestId, responseId: 'late-1' });
    stepTick(run);
    expect(response.responseId).toBe('late-1');
    expect(rejectionsFor(run, 'late-1')).toEqual(['response-expired']);
  });

  it('rejects a response to a superseded request as superseded-request', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const oldRequestId = run.state.npcs.mara.pendingDecision!.requestId;
    // A relevant world change triggers a fresh decision opportunity, which
    // supersedes the outstanding request.
    run.state.npcs.mara.needsReevaluation = true;
    stepTick(run);
    const superseded = eventsOfType(run, 'DecisionRequestSuperseded').filter(
      (e) => (e.payload as { requestId: string }).requestId === oldRequestId,
    );
    expect(superseded).toHaveLength(1);
    const staleRequestResponse = inject(run, 'mara', {
      requestId: oldRequestId,
      responseId: 'stale-req-1',
    });
    expect(staleRequestResponse.requestId).toBe(oldRequestId);
    stepTick(run);
    expect(rejectionsFor(run, 'stale-req-1')).toEqual(['superseded-request']);
  });

  it('rejects a response whose hard dependencies changed without a re-decision (bench handover)', () => {
    // Jonas's pending request fingerprints Mara's bench session. Accepting a
    // rest for Mara releases the bench WITHOUT flagging Jonas for
    // re-evaluation, so his original request survives with stale hard
    // dependencies — exactly the case the fingerprint gate must catch.
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    const jonasPending = run.state.npcs.jonas.pendingDecision;
    expect(jonasPending).not.toBeNull();
    inject(run, 'mara', { responseId: 'mara-rest-1' });
    stepTick(run); // Mara's work is preempted; the bench reservation is released.
    expect(run.state.npcs.jonas.pendingDecision?.requestId).toBe(jonasPending!.requestId);
    const response = inject(run, 'jonas', {
      requestId: jonasPending!.requestId,
      responseId: 'stale-deps-1',
      selectedAffordanceId: jonasPending!.offeredAffordances.find((a) => a.mode === 'rest')!.id,
    });
    stepTick(run);
    expect(response.responseId).toBe('stale-deps-1');
    expect(rejectionsFor(run, 'stale-deps-1')).toEqual(['stale-dependencies']);
  });

  it('a response spanning the scripted meal removal is rejected, and no phantom meal is eaten', () => {
    // Scenario E: the removal at tick 200 flags every NPC for re-evaluation,
    // so the outstanding request is superseded (first line of defense); a
    // late response to it is rejected either way and nothing is consumed.
    const run = createRun('E');
    run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), (_ordinal, ctx) =>
      ctx.npcId === 'rin' ? { delayTicks: null } : { delayTicks: 0 },
    );
    stepTo(run, 199);
    const pending = run.state.npcs.rin.pendingDecision;
    expect(pending).not.toBeNull();
    const eatAffordance = pending!.offeredAffordances.find((a) => a.mode === 'eat');
    expect(eatAffordance).toBeDefined();
    stepTo(run, 201); // meal removed at 200
    const staleResponse = inject(run, 'rin', {
      requestId: pending!.requestId,
      responseId: 'stale-meal-1',
      selectedAffordanceId: eatAffordance!.id,
    });
    expect(staleResponse.responseId).toBe('stale-meal-1');
    stepTick(run);
    const reasons = rejectionsFor(run, 'stale-meal-1');
    expect(reasons).toHaveLength(1);
    expect(['superseded-request', 'stale-dependencies']).toContain(reasons[0]);
    expect(eventsOfType(run, 'MealConsumed')).toHaveLength(0);
  });

  it('never preempts a non-interruptible action or an NPC in transit', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 61);
    run.state.npcs.mara.currentAction!.interruptible = false;
    const busy = inject(run, 'mara', { responseId: 'busy-1' });
    stepTick(run);
    expect(rejectionsFor(run, busy.responseId)).toEqual(['actor-busy-noninterruptible']);
    // Restore and instead place her in transit: same protection.
    run.state.npcs.mara.currentAction!.interruptible = true;
    run.state.npcs.mara.transit = {
      fromLocationId: 'purifier-workbench',
      toLocationId: 'food-shelf',
      startTick: run.state.tick,
      arriveTick: run.state.tick + 30,
      actionId: run.state.npcs.mara.currentAction!.id,
    };
    const moving = inject(run, 'mara', { responseId: 'busy-2' });
    stepTick(run);
    expect(rejectionsFor(run, moving.responseId)).toEqual(['actor-busy-noninterruptible']);
  });
});

describe('tick-scheduled responses (simulated asynchronous provider)', () => {
  it('a response scheduled N ticks out is accepted at its due tick through the same gate', () => {
    const run = createRun('A');
    run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
      delayTicks: 5,
    }));
    stepTo(run, 66);
    const received = eventsOfType(run, 'DecisionResponseReceived').filter((e) => e.tick === 65);
    expect(received.length).toBeGreaterThan(0);
    const accepted = eventsOfType(run, 'DecisionResponseAccepted').filter((e) => e.tick === 65);
    expect(accepted.length).toBe(received.length);
  });

  it('out-of-order responses: the first valid arrival wins; later ones are rejected', () => {
    const run = createRun('A');
    run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
      delayTicks: 10,
      extraResponse: { delayTicks: 3 }, // the SECOND response arrives FIRST
    }));
    stepTo(run, 75);
    const rejected = eventsOfType(run, 'DecisionResponseRejected');
    // The early extra response (…-2) was accepted; the base response (…-1)
    // arrived at a resolved request and was rejected.
    expect(
      rejected.some((e) => (e.payload as { responseId: string }).responseId.endsWith('-1')),
    ).toBe(true);
    const acceptedIds = eventsOfType(run, 'DecisionResponseAccepted').map(
      (e) => (e.payload as { responseId: string }).responseId,
    );
    expect(acceptedIds.some((id) => id.endsWith('-2'))).toBe(true);
  });

  it('canonical outcomes are independent of operator tick-batch sizes with scheduled responses', () => {
    const streams = [1, 7].map((batch) => {
      const run = createRun('A');
      run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), (ordinal) => ({
        delayTicks: 1 + (ordinal % 4),
      }));
      while (!run.state.terminal) {
        for (let i = 0; i < batch && !run.state.terminal; i += 1) stepTick(run);
      }
      return serializeCanonicalEventStream(run.ledger.events);
    });
    expect(streams[1]).toBe(streams[0]);
  });

  it('a never-responding provider never blocks: supersession/provisional fallback carry the run to a valid end', () => {
    const run = asyncRun('A', deferAll());
    stepTo(run, 300);
    // Unanswered requests are replaced by fresh ones at each new decision
    // opportunity (supersession is the first-line timeout under the normal
    // re-evaluation cadence).
    expect(eventsOfType(run, 'DecisionRequestSuperseded').length).toBeGreaterThan(0);
    // Provisional fallback keeps idle NPCs acting the whole time.
    expect(run.state.npcs.rin.currentAction ?? run.state.npcs.rin.pendingDecision).not.toBeNull();
    stepTo(run, 2700);
    expect(run.state.terminal).toBe(true);
    // Outstanding requests were force-expired at scenario end, in NPC order.
    const endExpiries = eventsOfType(run, 'DecisionRequestExpired').filter(
      (e) => (e.payload as { reasonCode: string }).reasonCode === 'scenario-ended',
    );
    expect(endExpiries.length).toBeGreaterThan(0);
    for (const npcId of ['mara', 'jonas', 'rin'] as const) {
      expect(run.state.npcs[npcId].pendingDecision).toBeNull();
    }
  });
});

describe('local provider parity (remediation 1.8)', () => {
  it('every synchronous decision flows through Received -> Accepted with matching request IDs', () => {
    const run = createRun('A');
    while (!run.state.terminal) stepTick(run);
    const requests = eventsOfType(run, 'DecisionRequested');
    const received = eventsOfType(run, 'DecisionResponseReceived');
    const accepted = eventsOfType(run, 'DecisionResponseAccepted');
    expect(requests.length).toBeGreaterThan(0);
    // Every request is resolved by an acceptance on the same tick (local
    // provider) — no private fast path exists.
    expect(accepted.length).toBe(requests.length);
    expect(received.length).toBe(requests.length);
    for (let i = 0; i < requests.length; i += 1) {
      const requestPayload = requests[i]!.payload as { requestId: string };
      const acceptedForRequest = accepted.find(
        (e) => (e.payload as { requestId: string }).requestId === requestPayload.requestId,
      );
      expect(acceptedForRequest).toBeDefined();
      expect(acceptedForRequest!.tick).toBe(requests[i]!.tick);
    }
  });
});

describe('malicious synchronous provider (invalid response triggers fallback)', () => {
  it('an unoffered synchronous choice is rejected through the gate and the fallback acts', () => {
    const run = createRun('A');
    run.provider = {
      id: 'malicious-unoffered',
      decide: (_ctx: DecisionContext) => ({
        affordanceId: 'aff:never:0:offered',
        confidenceBp: 10_000,
        reasonCode: 'malicious',
        scores: [],
      }),
    };
    stepTo(run, 61);
    const rejected = eventsOfType(run, 'DecisionResponseRejected');
    expect(
      rejected.some(
        (e) =>
          (e.payload as { rejectionReason: string }).rejectionReason === 'unoffered-affordance',
      ),
    ).toBe(true);
    const fallbackAccepted = eventsOfType(run, 'DecisionResponseAccepted').filter(
      (e) => (e.payload as { usedFallback: boolean }).usedFallback,
    );
    expect(fallbackAccepted.length).toBeGreaterThan(0);
    expect(eventsOfType(run, 'FallbackDecisionUsed').length).toBeGreaterThan(0);
  });
});
