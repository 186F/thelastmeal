import { describe, expect, it } from 'vitest';
import type { ExternalDecisionFailure } from '../../src/shared/decisionContracts';
import type { NpcId } from '../../src/shared/ids';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { EXTERNAL_MARA_PROVIDER_ID } from '../../src/sim/decisions/externalDeferredProvider';
import {
  FixtureResponseProvider,
  fakeAdapterChoiceRule,
} from '../../src/sim/decisions/fixtureResponseProvider';
import { perNpcPlan } from '../../src/sim/decisions/providerPlan';
import type { DecisionProvider } from '../../src/sim/decisions/provider';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { createRun, runToCompletion, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { eventsOfType } from '../helpers';

/** Milestone 001, sections 15 / 22 / 23.5: the explicit external-failure
 * lifecycle and deterministic recorded-response fixtures. */

function mixedRun(): EngineRun {
  return createRun('A', { conditionId: 'mara-model-per-decision-v1' });
}

function stepTo(run: EngineRun, tick: number): void {
  while (run.state.tick < tick && !run.state.terminal) stepTick(run);
}

function failureFor(
  run: EngineRun,
  overrides: Partial<ExternalDecisionFailure> = {},
): ExternalDecisionFailure {
  const pending = run.state.npcs.mara.pendingDecision!;
  return {
    failureId: `f-${pending.requestId}`,
    requestId: pending.requestId,
    npcId: 'mara',
    scenarioId: 'A',
    providerId: pending.providerId,
    failureCode: 'gateway-unavailable',
    retryable: true,
    ...overrides,
  };
}

describe('explicit external-failure lifecycle (section 15)', () => {
  it('a reported failure records DecisionProviderFailed + external-failure expiry and resolves once', () => {
    const run = mixedRun();
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    expect(pending.providerId).toBe(EXTERNAL_MARA_PROVIDER_ID);
    run.failureInbox.push(failureFor(run, { failureCode: 'upstream-timeout' }));
    // Duplicate failure in the same batch: must resolve exactly once.
    run.failureInbox.push(failureFor(run, { failureCode: 'upstream-timeout' }));
    stepTick(run);

    const failed = eventsOfType(run, 'DecisionProviderFailed').filter(
      (e) => (e.payload as { requestId: string }).requestId === pending.requestId,
    );
    expect(failed).toHaveLength(1);
    expect((failed[0]!.payload as { errorCode: string }).errorCode).toBe('upstream-timeout');
    const expired = eventsOfType(run, 'DecisionRequestExpired').filter(
      (e) => (e.payload as { requestId: string }).requestId === pending.requestId,
    );
    expect(expired).toHaveLength(1);
    expect((expired[0]!.payload as { reasonCode: string }).reasonCode).toBe('external-failure');
    expect(run.state.npcs.mara.pendingDecision).toBeNull();
    // Ordinary cadence, not immediate re-evaluation (section 15.5).
    expect(run.state.npcs.mara.needsReevaluation).toBe(false);
  });

  it('failure provider binding: a failure naming the wrong provider is moot', () => {
    const run = mixedRun();
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    run.failureInbox.push(failureFor(run, { providerId: 'rogue-gateway' }));
    stepTick(run);
    expect(run.state.npcs.mara.pendingDecision?.requestId).toBe(pending.requestId);
    expect(eventsOfType(run, 'DecisionProviderFailed')).toHaveLength(0);
  });

  it('failures for unknown or already-superseded requests are moot', () => {
    const run = mixedRun();
    stepTo(run, 61);
    const first = run.state.npcs.mara.pendingDecision!.requestId;
    run.failureInbox.push(failureFor(run, { requestId: 'dec-9999' }));
    stepTick(run);
    expect(eventsOfType(run, 'DecisionProviderFailed')).toHaveLength(0);

    run.state.npcs.mara.needsReevaluation = true;
    stepTick(run); // supersedes `first`
    run.failureInbox.push(failureFor(run, { requestId: first }));
    stepTick(run);
    expect(eventsOfType(run, 'DecisionProviderFailed')).toHaveLength(0);
  });

  it('no response is accepted after an explicit terminal failure', () => {
    const run = mixedRun();
    stepTo(run, 61);
    const pending = run.state.npcs.mara.pendingDecision!;
    run.failureInbox.push(failureFor(run));
    stepTick(run);
    run.responseInbox.push({
      responseId: `gw-${pending.requestId}`,
      requestId: pending.requestId,
      npcId: 'mara',
      scenarioId: 'A',
      providerId: EXTERNAL_MARA_PROVIDER_ID,
      selectedAffordanceId: pending.offeredAffordances[0]!.id,
      confidenceBp: 5_000,
      reasonCode: 'late',
      scores: [],
    });
    stepTick(run);
    const rejections = eventsOfType(run, 'DecisionResponseRejected').filter(
      (e) => (e.payload as { requestId: string }).requestId === pending.requestId,
    );
    expect(rejections).toHaveLength(1);
    expect((rejections[0]!.payload as { rejectionReason: string }).rejectionReason).toBe(
      'response-expired',
    );
    expect(
      eventsOfType(run, 'DecisionResponseAccepted').map(
        (e) => (e.payload as { requestId: string }).requestId,
      ),
    ).not.toContain(pending.requestId);
  });
});

describe('recorded-response fixtures (section 22)', () => {
  function fixturePlan() {
    const deterministic = new DeterministicProvider();
    const fixture = new FixtureResponseProvider(EXTERNAL_MARA_PROVIDER_ID, () => ({
      delayTicks: 1,
      select: fakeAdapterChoiceRule,
      confidenceBp: 5_000,
      reasonCode: 'routine',
    }));
    const providers: Record<NpcId, DecisionProvider> = {
      mara: fixture,
      jonas: deterministic,
      rin: deterministic,
    };
    return perNpcPlan('mara-model-per-decision-v1', providers, [EXTERNAL_MARA_PROVIDER_ID]);
  }

  it('two fixture runs produce byte-identical canonical streams and hashes', () => {
    const first = createRun('A', { plan: fixturePlan() });
    runToCompletion(first);
    const second = createRun('A', { plan: fixturePlan() });
    runToCompletion(second);
    expect(first.state.terminal).toBe(true);
    expect(second.worldStateHash).toBe(first.worldStateHash);
    expect(second.canonicalLedgerHash).toBe(first.canonicalLedgerHash);
    expect(serializeCanonicalEventStream(second.ledger.events)).toBe(
      serializeCanonicalEventStream(first.ledger.events),
    );
    // Model-shaped responses were actually accepted through the gate.
    const accepted = eventsOfType(first, 'DecisionResponseAccepted').filter((e) =>
      (e.payload as { responseId: string }).responseId.startsWith('gw-'),
    );
    expect(accepted.length).toBeGreaterThan(0);
  });

  it('a completed fixture-run ledger exports, imports, and replays without any provider', () => {
    const run = createRun('A', { plan: fixturePlan() });
    runToCompletion(run);
    const file = buildLedgerFile(run);
    expect(file.providerId).toBe('mara-model-per-decision-v1');
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
