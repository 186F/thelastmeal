import { describe, expect, it } from 'vitest';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { evaluateConstraints } from '../../src/sim/decisions/constraints';
import { EXTERNAL_MARA_PROVIDER_ID } from '../../src/sim/decisions/externalDeferredProvider';
import type { PendingDecisionState } from '../../src/sim/domain/state';
import { eventsOfType } from '../helpers';

/**
 * The engine-gate reconciliation gap (re-audit remediation F3, documented on
 * purpose — the engine is deliberately UNCHANGED).
 *
 * The acceptance gate validates a response against the CURRENT pending
 * request for that NPC: identity binding, provider binding, offered
 * affordances, constraints, and dependency fingerprints all refer to that
 * pending request. The gate CANNOT know which request the transport actually
 * dispatched upstream. So when request dec-A is superseded by a sibling
 * dec-B while a gateway call for dec-A is still in flight, a gateway result
 * that comes back stamped with dec-B's identity (whether by gateway bug,
 * misrouting, or forgery) passes the gate exactly like a genuine answer to
 * dec-B — the engine ACCEPTS it. This test pins that current behavior.
 *
 * That is precisely why the CLIENT must reconcile every schema-valid gateway
 * result against the request it dispatched BEFORE submission
 * (`validateGatewayResultForRequest` in src/sim/decisions/externalSchemas.ts,
 * run inside ModelGatewayClient): a result whose identity does not match the
 * dispatched request is converted to a typed 'invalid-gateway-response'
 * failure and never forwarded to the worker. Do NOT "fix" the engine to
 * track transport-level dispatch — the engine has no transport knowledge by
 * design; the client-side reconciliation is the guard.
 */

function firstExternalRequest(run: EngineRun): void {
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  expect(run.externalRequests.length).toBeGreaterThan(0);
}

/** Picks an offered affordance of the CURRENT pending request that the gate
 * will accept at drain time: constraint-allowed and compatible with Mara's
 * current action/transit state (continuation preferred, then wait). */
function gateViableAffordanceId(run: EngineRun, pending: PendingDecisionState): string {
  const npc = run.state.npcs.mara;
  const evaluation = evaluateConstraints(
    {
      npcId: npc.id,
      hungerMicro: npc.hungerMicro,
      injury: npc.injury,
      incapacitated: npc.incapacitated,
      beliefs: npc.beliefs,
    },
    pending.offeredAffordances,
  );
  const viable = pending.offeredAffordances.filter(
    (a) =>
      evaluation.allowedAffordanceIds.includes(a.id) &&
      (a.continuesActionId !== null
        ? npc.currentAction?.id === a.continuesActionId
        : npc.transit === null &&
          (!npc.currentAction ||
            (npc.currentAction.phase === 'active' && npc.currentAction.interruptible))),
  );
  expect(viable.length).toBeGreaterThan(0);
  const chosen =
    viable.find((a) => a.continuesActionId !== null) ??
    viable.find((a) => a.id.includes(':wait')) ??
    viable[0]!;
  return chosen.id;
}

describe('engine-gate sibling-request acceptance (the reconciliation gap)', () => {
  it('accepts a response naming the SUCCESSOR request while the dispatched sibling was superseded', () => {
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    firstExternalRequest(run);

    // "dec-A": what the client dispatched to the gateway.
    const dispatched = run.externalRequests[0]!;
    expect(run.state.npcs.mara.pendingDecision?.requestId).toBe(dispatched.request.requestId);

    // Supersede it: a new decision opportunity mints a sibling request while
    // the gateway call for dec-A is (conceptually) still in flight.
    run.state.npcs.mara.needsReevaluation = true;
    stepTick(run);
    const successor = run.state.npcs.mara.pendingDecision;
    expect(successor).not.toBeNull();
    expect(successor!.requestId).not.toBe(dispatched.request.requestId);
    const supersededEvents = eventsOfType(run, 'DecisionRequestSuperseded').filter(
      (e) => (e.payload as { requestId: string }).requestId === dispatched.request.requestId,
    );
    expect(supersededEvents).toHaveLength(1);

    // A gateway result stamped with the SUCCESSOR's identity: valid npc /
    // scenario / provider, and an affordance the successor actually offers.
    // A late answer to dec-A relabeled this way is indistinguishable, to the
    // gate, from a genuine answer to the successor.
    const selectedAffordanceId = gateViableAffordanceId(run, successor!);
    run.responseInbox.push({
      responseId: `gw-${successor!.requestId}`,
      requestId: successor!.requestId,
      npcId: 'mara',
      scenarioId: 'A',
      providerId: successor!.providerId,
      selectedAffordanceId,
      confidenceBp: 5_000,
      reasonCode: 'routine',
      scores: [],
    });
    // A response still naming dec-A itself IS rejected (superseded-request):
    // the gate protects against the stale id, not the sibling id.
    run.responseInbox.unshift({
      responseId: `gw-${dispatched.request.requestId}`,
      requestId: dispatched.request.requestId,
      npcId: 'mara',
      scenarioId: 'A',
      providerId: dispatched.request.providerId,
      selectedAffordanceId: dispatched.request.offeredAffordanceIds[0]!,
      confidenceBp: 5_000,
      reasonCode: 'routine',
      scores: [],
    });
    stepTick(run);

    const rejectedStale = eventsOfType(run, 'DecisionResponseRejected').filter(
      (e) => (e.payload as { requestId: string }).requestId === dispatched.request.requestId,
    );
    expect(rejectedStale).toHaveLength(1);
    expect((rejectedStale[0]!.payload as { rejectionReason: string }).rejectionReason).toBe(
      'superseded-request',
    );

    // CURRENT, UNCHANGED behavior — the gate accepts the sibling-addressed
    // response. Client-side reconciliation is what keeps a mislabeled
    // gateway result from ever reaching this point.
    const accepted = eventsOfType(run, 'DecisionResponseAccepted').filter(
      (e) => (e.payload as { requestId: string }).requestId === successor!.requestId,
    );
    expect(accepted).toHaveLength(1);
    expect((accepted[0]!.payload as { responseId: string }).responseId).toBe(
      `gw-${successor!.requestId}`,
    );
    // The successor request was consumed by the acceptance.
    expect(run.state.npcs.mara.pendingDecision?.requestId).not.toBe(successor!.requestId);
    expect(successor!.providerId).toBe(EXTERNAL_MARA_PROVIDER_ID);
  });
});
