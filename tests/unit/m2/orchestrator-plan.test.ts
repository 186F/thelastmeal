import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  orchestratorPlanSchema,
  parsePlan,
  worstCaseStudyCalls,
  type OrchestratorPlan,
} from '../../../scripts/experiments/m2/planSchema';
import { planConfigFingerprint } from '../../../scripts/experiments/m2/orchestrate';

/**
 * Orchestrator plan contract (M2 brief §19.11, §19.14, §19.17): schema
 * strictness, the cross-field gateway/condition rules, evidentiary 1×
 * pacing, the worst-case call-budget formula with replacements, and the
 * committed rehearsal plans' validity.
 */

function basePlan(): OrchestratorPlan {
  return orchestratorPlanSchema.parse(
    JSON.parse(readFileSync(join('experiments', 'm2', 'plans', 'rehearsal.json'), 'utf8')),
  );
}

describe('orchestrator plan schema', () => {
  it('accepts both committed plans', () => {
    for (const name of ['rehearsal.json', 'failure-drill.json']) {
      const bytes = readFileSync(join('experiments', 'm2', 'plans', name));
      expect(() => parsePlan(bytes), name).not.toThrow();
    }
  });

  it('rejects a baseline attempt with a gateway and a model attempt without one', () => {
    const plan = basePlan();
    expect(() =>
      orchestratorPlanSchema.parse({
        ...plan,
        attempts: [{ ...plan.attempts[0]!, gatewayMode: 'fake' }],
      }),
    ).toThrow(/baseline-attempt-must-run-gateway-off/);
    expect(() =>
      orchestratorPlanSchema.parse({
        ...plan,
        attempts: [{ ...plan.attempts[1]!, gatewayMode: 'off' }],
      }),
    ).toThrow(/model-attempt-requires-a-gateway/);
  });

  it('rejects accelerated pacing on evidentiary plans (§19.17)', () => {
    const plan = basePlan();
    expect(() => orchestratorPlanSchema.parse({ ...plan, evidentiary: true })).toThrow(
      /evidentiary-plan-requires-1x-pacing/,
    );
  });

  it('evidentiary plans require pinned SHA, study binding, and the exact formal profile', () => {
    const plan = basePlan();
    const evidentiaryBase = {
      ...plan,
      evidentiary: true,
      attempts: plan.attempts.map((attempt) => ({ ...attempt, speed: 1 })),
    };
    expect(() => orchestratorPlanSchema.parse(evidentiaryBase)).toThrow(
      /evidentiary-plan-requires-pinned-repository-sha/,
    );
    expect(() => orchestratorPlanSchema.parse(evidentiaryBase)).toThrow(
      /evidentiary-plan-requires-study-binding/,
    );
    expect(() => orchestratorPlanSchema.parse(evidentiaryBase)).toThrow(
      /evidentiary-heartbeat-exceeds-60s|evidentiary-stall-timeout-must-be-120s|evidentiary-run-timeout-must-be-75min/,
    );
    const formal = {
      ...evidentiaryBase,
      repositorySha: 'a'.repeat(40),
      study: {
        studyId: 'm2-calibration-variance-a-001',
        studyVersion: '1.0.0',
        studyPlanPath: 'experiments/m2/studies/calibration.json',
        studyPlanSha256: 'b'.repeat(64),
        studyConfigFingerprint: 'c'.repeat(16),
      },
      timeouts: {
        runTimeoutMs: 75 * 60_000,
        gatewayStopRunTimeoutMs: 90 * 60_000,
        stallTimeoutMs: 120_000,
        stallGraceMs: 30_000,
        heartbeatIntervalMs: 60_000,
      },
    };
    expect(() => orchestratorPlanSchema.parse(formal)).not.toThrow();
    // Formal profile is EXACT: a 74-minute normal timeout is refused.
    expect(() =>
      orchestratorPlanSchema.parse({
        ...formal,
        timeouts: { ...formal.timeouts, runTimeoutMs: 74 * 60_000 },
      }),
    ).toThrow(/evidentiary-run-timeout-must-be-75min/);
    expect(() =>
      orchestratorPlanSchema.parse({
        ...formal,
        timeouts: { ...formal.timeouts, heartbeatIntervalMs: 61_000 },
      }),
    ).toThrow(/evidentiary-heartbeat-exceeds-60s/);
  });

  it('model attempts require the reviewed expected treatment; stop attempts require the stop timeout', () => {
    const plan = basePlan();
    const withoutTreatment = { ...plan } as Record<string, unknown>;
    delete withoutTreatment.expectedTreatment;
    expect(() => orchestratorPlanSchema.parse(withoutTreatment)).toThrow(
      /model-attempts-require-expected-treatment/,
    );
    const withoutStopTimeout = {
      ...plan,
      timeouts: { ...plan.timeouts, gatewayStopRunTimeoutMs: undefined },
    };
    expect(() => orchestratorPlanSchema.parse(withoutStopTimeout)).toThrow(
      /gateway-stop-attempts-require-stop-timeout/,
    );
  });

  it('rejects a model attempt on a scenario outside the registered condition (statically)', () => {
    const plan = basePlan();
    expect(() =>
      orchestratorPlanSchema.parse({
        ...plan,
        attempts: [{ ...plan.attempts[1]!, scenarioId: 'F' }],
      }),
    ).toThrow(/scenario-not-in-model-condition:F/);
  });

  it('rejects duplicate attempt ids and non-operator speeds', () => {
    const plan = basePlan();
    expect(() =>
      orchestratorPlanSchema.parse({
        ...plan,
        attempts: [plan.attempts[0]!, plan.attempts[0]!],
      }),
    ).toThrow(/duplicate-attempt-id/);
    expect(() =>
      orchestratorPlanSchema.parse({
        ...plan,
        attempts: [{ ...plan.attempts[0]!, speed: 7 }],
      }),
    ).toThrow(/speed-not-an-operator-speed/);
  });

  it('computes the §19.14 worst case over live attempts AND permitted replacements', () => {
    const plan = basePlan();
    const livePlan: OrchestratorPlan = orchestratorPlanSchema.parse({
      ...plan,
      attempts: [
        plan.attempts[0]!,
        { ...plan.attempts[1]!, gatewayMode: 'live', maxCallsPerRun: 120, maxTotalCalls: 100 },
      ],
      replacementPolicy: { maxReplacementAttempts: 2, retryableFailureClasses: ['run-timeout'] },
      liveCallBudget: 300,
    });
    // min(120, 100) × (1 primary + 2 replacements) = 300.
    expect(worstCaseStudyCalls(livePlan)).toBe(300);
  });

  it('refuses a live plan whose worst case exceeds the acknowledged budget', () => {
    const plan = basePlan();
    const overBudget = {
      ...plan,
      attempts: [
        { ...plan.attempts[1]!, gatewayMode: 'live', maxCallsPerRun: 120, maxTotalCalls: 120 },
      ],
      replacementPolicy: { maxReplacementAttempts: 1, retryableFailureClasses: ['run-timeout'] },
      liveCallBudget: 200, // worst case = 240
    };
    expect(() => parsePlan(Buffer.from(JSON.stringify(overBudget)))).toThrow(
      /plan-worst-case-exceeds-live-budget/,
    );
  });

  it('config fingerprint ignores prose but moves with execution-shaping fields', () => {
    const plan = basePlan();
    const reworded = { ...plan, description: 'different prose' };
    expect(planConfigFingerprint(plan)).toBe(planConfigFingerprint(reworded as OrchestratorPlan));
    const repaced = {
      ...plan,
      timeouts: { ...plan.timeouts, runTimeoutMs: plan.timeouts.runTimeoutMs + 1 },
    };
    expect(planConfigFingerprint(plan)).not.toBe(planConfigFingerprint(repaced));
  });
});
