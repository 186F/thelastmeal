import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttemptFailure } from '../../../scripts/experiments/m2/failureTaxonomy';
import {
  finalizeDeterministicAttempt,
  finalizeModelAttempt,
  guardStage,
  verifyFinalManifestTreatment,
  type ModelFinalizeDeps,
} from '../../../scripts/experiments/m2/runFinalizer';
import { captureArtifact } from '../../../scripts/experiments/m2/browserDriver';

/**
 * Typed finalization-stage failure drills (re-audit §12): every
 * post-browser stage converts an injected failure into its closed-taxonomy
 * class with the stage recorded, the already-saved browser forensics are
 * left untouched, and a diagnostic-capture failure is itself recorded
 * rather than masking anything.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'm2-stages-'));
  dirs.push(dir);
  return dir;
}

/** Browser forensics that must SURVIVE every injected finalization failure. */
const BROWSER_FORENSICS = [
  'attempt-trace.zip',
  'final-screenshot.png',
  'final-dom.html',
  'console-log.json',
  'diagnostics-manifest.json',
];

function attemptDirWithForensics(root: string): string {
  const attemptDir = join(root, 'attempt-a-e1');
  mkdirSync(attemptDir, { recursive: true });
  for (const name of BROWSER_FORENSICS) {
    writeFileSync(join(attemptDir, name), `forensic:${name}`, 'utf8');
  }
  return attemptDir;
}

function expectStageFailure(fn: () => unknown, reason: string, stage: string): AttemptFailure {
  let caught: unknown = null;
  try {
    fn();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AttemptFailure);
  const failure = caught as AttemptFailure;
  expect(failure.reason).toBe(reason);
  expect(failure.stage).toBe(stage);
  return failure;
}

const boom = (): never => {
  throw new Error('injected');
};

describe('guardStage', () => {
  it('wraps plain throws into the stage class and passes AttemptFailures through', () => {
    expectStageFailure(
      () => guardStage('strict-finalize', boom),
      'strict-finalize-failed',
      'strict-finalize',
    );
    const original = new AttemptFailure(
      'treatment-mismatch',
      'kept',
      'final-treatment-verification',
    );
    try {
      guardStage('fingerprint', () => {
        throw original;
      });
      expect.unreachable();
    } catch (error: unknown) {
      expect(error).toBe(original);
    }
  });
});

describe('deterministic finalization stages', () => {
  it('a validator failure is deterministic-validation-failed and preserves forensics', () => {
    const root = scratch();
    const attemptDir = attemptDirWithForensics(root);
    const ledgerPath = join(attemptDir, 'ledger-A-v1.0.0-seed1001.json');
    writeFileSync(ledgerPath, '{"not":"a ledger"}', 'utf8');
    expectStageFailure(
      () =>
        finalizeDeterministicAttempt(attemptDir, ledgerPath, {
          validateLedgerFile: boom as never,
          buildBehaviorFingerprints: boom as never,
        }),
      'deterministic-validation-failed',
      'deterministic-validation',
    );
    for (const name of BROWSER_FORENSICS) {
      expect(existsSync(join(attemptDir, name)), name).toBe(true);
    }
  });

  it('a fingerprint failure after validation is fingerprint-failed', () => {
    const root = scratch();
    const attemptDir = attemptDirWithForensics(root);
    const ledgerPath = join(attemptDir, 'ledger-A-v1.0.0-seed1001.json');
    writeFileSync(ledgerPath, '{}', 'utf8');
    expectStageFailure(
      () =>
        finalizeDeterministicAttempt(attemptDir, ledgerPath, {
          validateLedgerFile: (() => ({ ok: true, file: {}, issues: [] })) as never,
          buildBehaviorFingerprints: boom as never,
        }),
      'fingerprint-failed',
      'fingerprint',
    );
  });

  it('a missing ledger file fails in the validation stage, not as a generic error', () => {
    const root = scratch();
    const attemptDir = attemptDirWithForensics(root);
    expectStageFailure(
      () => finalizeDeterministicAttempt(attemptDir, join(attemptDir, 'missing.json')),
      'deterministic-validation-failed',
      'deterministic-validation',
    );
  });
});

describe('model finalization stages', () => {
  function modelArgs(root: string) {
    const attemptDir = attemptDirWithForensics(root);
    const traceDir = join(attemptDir, 'gateway');
    mkdirSync(join(traceDir, 'run-1'), { recursive: true });
    return {
      attemptDir,
      traceDir,
      runId: 'run-1',
      ledgerPath: join(attemptDir, 'ledger.json'),
      bundlePath: join(attemptDir, 'bundle.json'),
    };
  }

  function depsWith(overrides: Partial<ModelFinalizeDeps>): ModelFinalizeDeps {
    return {
      prepareRunDirectory: (() => undefined) as never,
      finalizeRunDirectory: (() => ({ status: 'completed' })) as never,
      loadEvaluationEvidence: (() => ({
        kind: 'strict-finalized-run',
        file: {},
        enrichment: {},
      })) as never,
      enrichFingerprintSet: ((set: unknown) => set) as never,
      buildBehaviorFingerprints: (() => ({})) as never,
      ...overrides,
    };
  }

  const stageMatrix: Array<[keyof ModelFinalizeDeps, string, string]> = [
    ['prepareRunDirectory', 'prepare-run-failed', 'prepare-run'],
    ['finalizeRunDirectory', 'strict-finalize-failed', 'strict-finalize'],
    ['loadEvaluationEvidence', 'evidence-enrichment-failed', 'evidence-enrichment'],
    ['enrichFingerprintSet', 'fingerprint-failed', 'fingerprint'],
  ];

  for (const [dep, reason, stage] of stageMatrix) {
    it(`an injected ${String(dep)} failure is ${reason} and preserves forensics`, () => {
      const root = scratch();
      const args = modelArgs(root);
      expectStageFailure(
        () => finalizeModelAttempt(args, depsWith({ [dep]: boom as never })),
        reason,
        stage,
      );
      for (const name of BROWSER_FORENSICS) {
        expect(existsSync(join(args.attemptDir, name)), name).toBe(true);
      }
    });
  }

  it('a non-strict evidence kind fails the enrichment stage', () => {
    const root = scratch();
    const args = modelArgs(root);
    expectStageFailure(
      () =>
        finalizeModelAttempt(
          args,
          depsWith({
            loadEvaluationEvidence: (() => ({ kind: 'bare-ledger' })) as never,
          }),
        ),
      'evidence-enrichment-failed',
      'evidence-enrichment',
    );
  });

  it('a missing run directory fails prepare-run', () => {
    const root = scratch();
    const args = modelArgs(root);
    rmSync(join(args.traceDir, 'run-1'), { recursive: true, force: true });
    expectStageFailure(
      () => finalizeModelAttempt(args, depsWith({})),
      'prepare-run-failed',
      'prepare-run',
    );
  });
});

describe('final-manifest treatment verification stage', () => {
  const expected = {
    modelId: 'fake-adapter',
    servingProviderId: 'local',
    allowFallbacks: false as const,
    requireParameters: true as const,
    promptVersion: 'mara-action-selection-1.0.0',
    conditionId: 'mara-model-per-decision-v1',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.2.0',
  };

  it('a missing manifest is final-treatment-verification-failed; a mismatch is treatment-mismatch', () => {
    const root = scratch();
    expectStageFailure(
      () => verifyFinalManifestTreatment(root, expected, 'fake'),
      'final-treatment-verification-failed',
      'final-treatment-verification',
    );

    writeFileSync(
      join(root, 'run-manifest.final.json'),
      JSON.stringify({
        requestedModelId: 'some-other-model',
        conditionId: expected.conditionId,
        promptVersion: expected.promptVersion,
        externalProviderId: 'openrouter-mara-action-v1',
      }),
      'utf8',
    );
    expectStageFailure(
      () => verifyFinalManifestTreatment(root, expected, 'fake'),
      'treatment-mismatch',
      'final-treatment-verification',
    );
  });

  it('honors the frozen fake-kind seeding semantics', () => {
    const root = scratch();
    writeFileSync(
      join(root, 'run-manifest.final.json'),
      JSON.stringify({
        requestedModelId: 'fake-decision-adapter-v1',
        conditionId: expected.conditionId,
        promptVersion: expected.promptVersion,
        externalProviderId: 'openrouter-mara-action-v1',
      }),
      'utf8',
    );
    expect(() => verifyFinalManifestTreatment(root, expected, 'fake')).not.toThrow();
  });
});

describe('diagnostic capture failures are recorded, never masked (re-audit §12)', () => {
  it('captureArtifact records success and failure side by side', async () => {
    const captured: Record<string, string> = {};
    const captureFailures: Record<string, string> = {};
    await captureArtifact(captured, captureFailures, 'ok.png', async () => undefined);
    await captureArtifact(captured, captureFailures, 'broken.zip', async () => {
      throw new Error('disk full');
    });
    expect(captured['ok.png']).toBe('captured');
    expect(captureFailures['broken.zip']).toBe('disk full');
    expect(captured['broken.zip']).toBeUndefined();
  });
});
