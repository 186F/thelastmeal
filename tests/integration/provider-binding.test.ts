import { describe, expect, it } from 'vitest';
import type { DecisionResponse } from '../../src/shared/decisionContracts';
import type { NpcId } from '../../src/shared/ids';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { SimulatedAsyncProvider } from '../../src/sim/decisions/simulatedAsyncProvider';
import {
  createRun,
  rebuildResolvedRequests,
  stepTick,
  type EngineRun,
} from '../../src/sim/runtime/engine';
import { completedRun, eventsOfType } from '../helpers';

/**
 * Re-audit finding 1 (provider binding) and finding 5 (resolved-request
 * registry): the acceptance gate authorizes a response ONLY for the provider
 * its request named, with the engine-owned fallback as the single explicit
 * exception, and late responses to any superseded/expired request report
 * their true rejection reason.
 */

function deferAllRun(): EngineRun {
  const run = createRun('A');
  run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
    delayTicks: null,
  }));
  return run;
}

function stepTo(run: EngineRun, tick: number): void {
  while (run.state.tick < tick && !run.state.terminal) stepTick(run);
}

function inject(
  run: EngineRun,
  npcId: NpcId,
  responseId: string,
  overrides: Partial<DecisionResponse> = {},
): DecisionResponse {
  const pending = run.state.npcs[npcId].pendingDecision;
  const restAffordance = pending?.offeredAffordances.find((a) => a.mode === 'rest');
  const response: DecisionResponse = {
    responseId,
    requestId: pending?.requestId ?? 'dec-0000',
    npcId,
    scenarioId: run.state.scenarioId,
    providerId: pending?.providerId ?? 'unset',
    selectedAffordanceId: restAffordance?.id ?? pending?.offeredAffordances[0]?.id ?? 'aff:none',
    confidenceBp: 5_000,
    reasonCode: 'binding-test',
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

function acceptancesFor(run: EngineRun, responseId: string): number {
  return eventsOfType(run, 'DecisionResponseAccepted').filter(
    (e) => (e.payload as { responseId: string }).responseId === responseId,
  ).length;
}

describe('provider binding at the acceptance gate (re-audit finding 1)', () => {
  it('a wrong-provider response is rejected as provider-mismatch, proposes nothing, and leaves the request answerable', () => {
    const run = deferAllRun();
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    const wrong = inject(run, 'mara', 'wrong-provider-1', { providerId: 'rogue-gateway' });
    stepTick(run);

    expect(rejectionsFor(run, wrong.responseId)).toEqual(['provider-mismatch']);
    expect(acceptancesFor(run, wrong.responseId)).toBe(0);

    // No ActionProposed descends from any event recording this response.
    const responseEventIds = new Set(
      run.ledger.events
        .filter((e) => (e.payload as { responseId?: string }).responseId === wrong.responseId)
        .map((e) => e.id),
    );
    const proposedFromResponse = eventsOfType(run, 'ActionProposed').filter(
      (e) => e.causationId !== null && responseEventIds.has(e.causationId),
    );
    expect(proposedFromResponse).toHaveLength(0);

    // The request survives the mismatch and still accepts the authorized provider.
    expect(run.state.npcs.mara.pendingDecision?.requestId).toBe(pending.requestId);
    const right = inject(run, 'mara', 'right-provider-1');
    expect(right.providerId).toBe(pending.providerId);
    stepTick(run);
    expect(acceptancesFor(run, right.responseId)).toBe(1);
    expect(rejectionsFor(run, right.responseId)).toEqual([]);
  });

  it('an external response spoofing the fallback provider ID is not treated as an authorized fallback', () => {
    const run = deferAllRun();
    stepTo(run, 61);
    const spoof = inject(run, 'mara', 'fallback-spoof-1', { providerId: run.fallback.id });
    stepTick(run);
    expect(rejectionsFor(run, spoof.responseId)).toEqual(['provider-mismatch']);
    expect(acceptancesFor(run, spoof.responseId)).toBe(0);
    expect(run.state.npcs.mara.pendingDecision).not.toBeNull();
  });

  it('the engine-owned fallback passes the gate only through the explicit usedFallback path (scenario F)', () => {
    const run = completedRun('F');
    const receivedById = new Map(
      eventsOfType(run, 'DecisionResponseReceived').map((e) => [
        (e.payload as { responseId: string }).responseId,
        e.payload as { providerId: string; requestId: string },
      ]),
    );
    const requestProviderById = new Map(
      eventsOfType(run, 'DecisionRequested').map((e) => [
        (e.payload as { requestId: string }).requestId,
        (e.payload as { providerId: string }).providerId,
      ]),
    );
    const accepted = eventsOfType(run, 'DecisionResponseAccepted');
    expect(accepted.length).toBeGreaterThan(0);
    let fallbackAcceptances = 0;
    for (const event of accepted) {
      const payload = event.payload as {
        responseId: string;
        requestId: string;
        usedFallback: boolean;
      };
      const received = receivedById.get(payload.responseId);
      expect(received).toBeDefined();
      if (payload.usedFallback) {
        fallbackAcceptances += 1;
        expect(received!.providerId).toBe(run.fallback.id);
      } else {
        expect(received!.providerId).toBe(requestProviderById.get(payload.requestId));
      }
    }
    // Scenario F is the fallback scenario: the exception path is exercised.
    expect(fallbackAcceptances).toBeGreaterThan(0);
  });

  it('frozen scenarios never carry a provider mismatch (every acceptance is authorized)', () => {
    for (const scenarioId of ['A', 'C'] as const) {
      const run = completedRun(scenarioId);
      const requests = eventsOfType(run, 'DecisionRequested');
      const received = eventsOfType(run, 'DecisionResponseReceived');
      const requestProvider = new Map(
        requests.map((e) => [
          (e.payload as { requestId: string }).requestId,
          (e.payload as { providerId: string }).providerId,
        ]),
      );
      for (const event of received) {
        const payload = event.payload as { requestId: string; providerId: string };
        expect(payload.providerId).toBe(requestProvider.get(payload.requestId));
      }
      expect(eventsOfType(run, 'DecisionResponseRejected')).toHaveLength(0);
    }
  });
});

describe('resolved-request registry (re-audit finding 5)', () => {
  it('a response to an OLDER superseded request reports superseded-request, not unknown-request', () => {
    const run = deferAllRun();
    stepTo(run, 61);
    const first = run.state.npcs.mara.pendingDecision!.requestId;
    run.state.npcs.mara.needsReevaluation = true;
    stepTick(run);
    const second = run.state.npcs.mara.pendingDecision!.requestId;
    expect(second).not.toBe(first);
    run.state.npcs.mara.needsReevaluation = true;
    stepTick(run);
    const third = run.state.npcs.mara.pendingDecision!.requestId;
    expect(third).not.toBe(second);

    // The single-slot lastSupersededRequestId now points at `second`; the
    // registry still classifies a response to `first` correctly.
    expect(run.state.npcs.mara.lastSupersededRequestId).toBe(second);
    const stale = inject(run, 'mara', 'older-superseded-1', { requestId: first });
    stepTick(run);
    expect(rejectionsFor(run, stale.responseId)).toEqual(['superseded-request']);
  });

  it('the registry is a pure projection of the event stream (rebuildResolvedRequests)', () => {
    const run = deferAllRun();
    stepTo(run, 300);
    expect(eventsOfType(run, 'DecisionRequestSuperseded').length).toBeGreaterThan(0);
    const rebuilt = rebuildResolvedRequests(run.ledger.events);
    expect(rebuilt.size).toBe(run.resolvedRequests.size);
    for (const [requestId, record] of run.resolvedRequests) {
      expect(rebuilt.get(requestId)).toEqual(record);
    }
  });
});
