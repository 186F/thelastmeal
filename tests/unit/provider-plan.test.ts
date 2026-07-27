import { describe, expect, it } from 'vitest';
import { createRun, runToCompletion, stepTick } from '../../src/sim/runtime/engine';
import { serializeCanonicalEventStream } from '../../src/sim/replay/ledgerHash';
import { perNpcPlan, singleProviderPlan } from '../../src/sim/decisions/providerPlan';
import { SimulatedAsyncProvider } from '../../src/sim/decisions/simulatedAsyncProvider';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { defaultScenarioProvider, planForCondition } from '../../src/sim/decisions/conditions';
import {
  ExternalDeferredProvider,
  EXTERNAL_MARA_PROVIDER_ID,
} from '../../src/sim/decisions/externalDeferredProvider';
import { getScenario } from '../../src/sim/scenarios/definitions';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { eventsOfType } from '../helpers';
import type { DecisionProvider } from '../../src/sim/decisions/provider';
import type { ExternalDecisionRequest } from '../../src/shared/decisionContracts';
import type { NpcId } from '../../src/shared/ids';

/** Milestone 001, section 23.1: provider-plan correctness. */

describe('provider plans', () => {
  it('the explicit baseline condition reproduces the default wiring byte-for-byte (incl. scenario F)', () => {
    for (const scenarioId of ['A', 'F'] as const) {
      const byDefault = createRun(scenarioId);
      runToCompletion(byDefault);
      const byCondition = createRun(scenarioId, { conditionId: 'deterministic-baseline-v1' });
      runToCompletion(byCondition);
      expect(byCondition.plan.id).toBe('deterministic-utility-v1');
      expect(byCondition.worldStateHash).toBe(byDefault.worldStateHash);
      expect(byCondition.canonicalLedgerHash).toBe(byDefault.canonicalLedgerHash);
      expect(serializeCanonicalEventStream(byCondition.ledger.events)).toBe(
        serializeCanonicalEventStream(byDefault.ledger.events),
      );
    }
  });

  it('the mixed plan routes ONLY Mara to the external provider; every request records its actual provider', () => {
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    for (let i = 0; i < 65; i += 1) stepTick(run);
    const requests = eventsOfType(run, 'DecisionRequested');
    expect(requests.length).toBeGreaterThan(0);
    for (const event of requests) {
      const payload = event.payload as { npcId: string; providerId: string };
      expect(payload.providerId).toBe(
        payload.npcId === 'mara' ? 'openai-mara-action-v1' : 'deterministic-utility-v1',
      );
    }
    // External requests are emitted only for Mara.
    expect(run.externalRequests.length).toBeGreaterThan(0);
    for (const external of run.externalRequests) {
      expect(external.request.npcId).toBe('mara');
      expect(external.request.providerId).toBe('openai-mara-action-v1');
    }
    // The run-level plan ID is recorded in ScenarioStarted.
    const started = run.ledger.events[0]!;
    expect((started.payload as { providerId: string }).providerId).toBe(
      'mara-model-per-decision-v1',
    );
  });

  it('a gateway-less model run completes on supersession/provisional fallback and its export round-trips', () => {
    const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
    runToCompletion(run);
    expect(run.state.terminal).toBe(true);
    const file = buildLedgerFile(run);
    expect(file.providerId).toBe('mara-model-per-decision-v1');
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('the model condition refuses Scenario F (frozen deterministic experiment)', () => {
    expect(() => createRun('F', { conditionId: 'mara-model-per-decision-v1' })).toThrowError(
      /condition-not-supported-for-scenario/,
    );
  });

  it('provider and condition options are mutually exclusive', () => {
    expect(() =>
      createRun('A', {
        provider: new DeterministicProvider(),
        conditionId: 'deterministic-baseline-v1',
      }),
    ).toThrowError(/create-run-provider-condition-conflict/);
  });

  it('scheduled response sources drain in deterministic provider-ID order', () => {
    const b = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({ delayTicks: 1 }));
    const a = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({ delayTicks: 1 }));
    // Same class => same id; wrap to force distinct ids in reverse order.
    const wrap = (inner: SimulatedAsyncProvider, id: string): DecisionProvider & typeof inner => {
      return new Proxy(inner, {
        get: (target, prop) => (prop === 'id' ? id : Reflect.get(target, prop)),
      }) as typeof inner;
    };
    const zProvider = wrap(b, 'z-scheduled');
    const aProvider = wrap(a, 'a-scheduled');
    const providers: Record<NpcId, DecisionProvider> = {
      mara: zProvider,
      jonas: aProvider,
      rin: aProvider,
    };
    const plan = perNpcPlan('test-plan', providers, []);
    expect(
      plan.scheduledResponseSources().map((s) => (s as unknown as DecisionProvider).id),
    ).toEqual(['a-scheduled', 'z-scheduled']);
  });
});

/** Re-audit remediation F1 (deviation D4): condition-specific request
 * validation is carried as DATA on the provider plan; the engine stays
 * experiment-agnostic and throws a single generic error code. */
describe('plan-carried external-request validator', () => {
  let cachedExternal: ExternalDecisionRequest | null = null;
  function genuineExternalRequest(): ExternalDecisionRequest {
    if (!cachedExternal) {
      const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
      while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
      cachedExternal = run.externalRequests[0]!;
    }
    return JSON.parse(JSON.stringify(cachedExternal)) as ExternalDecisionRequest;
  }

  it('the model-condition plan accepts a genuine Mara request and rejects npc/provider/scenario violations', () => {
    const scenario = getScenario('A');
    const plan = planForCondition('mara-model-per-decision-v1', scenario, () =>
      defaultScenarioProvider(scenario),
    );
    expect(plan.validateExternalRequest).toBeTypeOf('function');
    expect(plan.validateExternalRequest!(genuineExternalRequest())).toBeNull();

    const wrongNpc = genuineExternalRequest();
    wrongNpc.request.npcId = 'jonas';
    expect(plan.validateExternalRequest!(wrongNpc)).not.toBeNull();

    const wrongProvider = genuineExternalRequest();
    wrongProvider.request.providerId = 'rogue-provider-v1';
    expect(plan.validateExternalRequest!(wrongProvider)).not.toBeNull();

    const wrongScenario = genuineExternalRequest();
    wrongScenario.request.scenarioId = 'F';
    expect(plan.validateExternalRequest!(wrongScenario)).not.toBeNull();
  });

  it('the baseline condition and singleProviderPlan carry no validator', () => {
    const scenario = getScenario('A');
    const baseline = planForCondition('deterministic-baseline-v1', scenario, () =>
      defaultScenarioProvider(scenario),
    );
    expect(baseline.validateExternalRequest).toBeUndefined();
    const single = singleProviderPlan(() => new DeterministicProvider());
    expect(single.validateExternalRequest).toBeUndefined();
  });

  it('the engine throws external-request-condition-violation when the plan validator rejects a deferral', () => {
    const deterministic = new DeterministicProvider();
    const providers: Record<NpcId, DecisionProvider> = {
      mara: new ExternalDeferredProvider(EXTERNAL_MARA_PROVIDER_ID),
      jonas: deterministic,
      rin: deterministic,
    };
    const plan = perNpcPlan(
      'always-rejecting-plan',
      providers,
      [EXTERNAL_MARA_PROVIDER_ID],
      () => 'always-wrong',
    );
    const run = createRun('A', { plan });
    expect(() => {
      for (let i = 0; i < 200 && !run.state.terminal; i += 1) stepTick(run);
    }).toThrowError(/external-request-condition-violation/);
  });
});
