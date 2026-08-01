import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManifestRegistration,
  buildSequenceManifest,
  type SequenceFinalFacts,
  type SequenceManifest,
} from '../../../scripts/experiments/m2/reporting';
import {
  SEQUENCE_STATE_VERSION,
  type AttemptExecution,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';
import { reconcileManifestWithState } from '../../../scripts/experiments/m2/sequenceVerification';
import {
  orchestratorPlanSchema,
  type OrchestratorPlan,
} from '../../../scripts/experiments/m2/planSchema';

/**
 * Manifest-vs-state reconciliation (focused re-audit finding 4 §7.2): the
 * IMMUTABLE sequence manifest is authoritative over the mutable control
 * state. A control-state edit — a removed or added execution, a changed
 * failure class, disposition, threshold verdict, seal aggregate, run ID,
 * or identity field, or a reordered history — must be a typed read-only
 * refusal. Checkpoints recorded AFTER the manifest was written (the
 * pre/post-package and recovery checkpoints) are the one permitted
 * extension: the manifest's checkpoints must be an exact PREFIX of the
 * control state's.
 */

const PLAN: OrchestratorPlan = orchestratorPlanSchema.parse({
  planSchemaVersion: 'm2-orchestrator-plan-1.1.0',
  sequenceId: 'reconcile-fixture',
  description: 'manifest reconciliation fixture',
  evidentiary: false,
  outputRoot: 'artifacts/reconcile-fixture',
  attempts: [
    {
      attemptId: 'a-rec',
      scenarioId: 'A',
      conditionId: 'deterministic-baseline-v1',
      speed: 20,
      gatewayMode: 'off',
    },
  ],
  attemptProfile: { profileId: 'm2-rehearsal-attempt-profile', profileVersion: '1.0.0' },
  replacementPolicy: { maxReplacementAttempts: 1, retryableFailureClasses: ['run-timeout'] },
  liveCallBudget: 0,
  timeouts: {
    runTimeoutMs: 60_000,
    stallTimeoutMs: 60_000,
    stallGraceMs: 5_000,
    heartbeatIntervalMs: 5_000,
  },
  postSequenceBatch: false,
});

function failedExecution(): AttemptExecution {
  return {
    executionId: 'a-rec-e1',
    attemptId: 'a-rec',
    status: 'failed',
    seal: { sealedStatus: 'failed', files: [], aggregateSha256: '1'.repeat(64) },
    failureReason: 'run-timeout',
    failureStage: 'browser',
    artifactStatus: 'artifact-invalid',
    studyStatus: 'not-evaluated',
    replacementDisposition: 'permitted',
    thresholdVerdicts: null,
    runId: null,
    dir: 'attempt-a-rec-e1',
    artifacts: [],
    verdicts: {},
    navigationCount: 1,
    browserProvenance: null,
    startedAtUtc: '2026-07-31T00:00:00.000Z',
    endedAtUtc: '2026-07-31T00:01:00.000Z',
  };
}

function completedExecution(): AttemptExecution {
  return {
    executionId: 'a-rec-e2',
    attemptId: 'a-rec',
    status: 'completed',
    seal: { sealedStatus: 'completed', files: [], aggregateSha256: '2'.repeat(64) },
    failureReason: null,
    failureStage: null,
    artifactStatus: 'artifact-valid',
    studyStatus: 'study-valid',
    replacementDisposition: null,
    thresholdVerdicts: [
      {
        metric: 'upstream-completion-ratio-bp',
        npcId: 'mara',
        value: 10000,
        min: 10000,
        pass: true,
      },
    ],
    runId: 'run-fixture-01',
    dir: 'attempt-a-rec-e2',
    artifacts: ['attempt-a-rec-e2/behavior-fingerprint.json'],
    verdicts: { 'replay-match': true, 'final-tick': 400 },
    navigationCount: 1,
    browserProvenance: {
      playwrightVersion: '1.50.0',
      browserVersion: '133.0.0.0',
      headless: true,
      contextOptions: { acceptDownloads: true },
    },
    startedAtUtc: '2026-07-31T00:02:00.000Z',
    endedAtUtc: '2026-07-31T00:03:00.000Z',
  };
}

function fixtureState(): SequenceState {
  return {
    stateVersion: SEQUENCE_STATE_VERSION,
    sequenceId: 'reconcile-fixture',
    planSha256: 'a'.repeat(64),
    repositorySha: 'b'.repeat(40),
    packageVersion: '1.8.0',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.2.0',
    promptVersion: 'mara-action-selection-1.0.0',
    externalProviderId: 'openrouter-mara-action-v1',
    upstreamPlatform: 'openrouter',
    expectedModelId: 'none',
    expectedServingProviderId: 'none',
    studyId: 'none',
    studyVersion: 'none',
    studyPlanSha256: 'none',
    thresholdProfileId: 'm2-rehearsal-attempt-profile',
    thresholdProfileVersion: '1.0.0',
    registrationId: 'none',
    registrationProvenanceSha256: 'none',
    stageAPrerequisiteSha256: 'none',
    configFingerprint: 'c'.repeat(16),
    status: 'completed',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    inventoryAggregateSha256: null,
    supersededArchives: [],
    freezeCheckpoints: [
      { checkpoint: 'pre-batch', atUtc: '2026-07-31T00:04:00.000Z' },
      { checkpoint: 'pre-evaluation', atUtc: '2026-07-31T00:05:00.000Z' },
    ],
    executions: [failedExecution(), completedExecution()],
    lastTransition: 'sequence-completed',
    createdAtUtc: '2026-07-31T00:00:00.000Z',
    updatedAtUtc: '2026-07-31T00:06:00.000Z',
  };
}

const FACTS: SequenceFinalFacts = {
  sequenceOutcome: 'evidence-finalized',
  attemptSetComplete: true,
  batchVerdict: null,
  evaluation: null,
  processLogHealth: null,
  browserVersion: 'fixture',
  launchFlags: ['headless'],
  processLog: [],
  finalizedAtUtc: '2026-07-31T00:06:00.000Z',
};

function fixtureManifest(state: SequenceState = fixtureState()): SequenceManifest {
  return buildSequenceManifest(state, FACTS, null);
}

describe('manifest-vs-state reconciliation (focused re-audit §7.2)', () => {
  it('an unedited control state reconciles exactly against its manifest', () => {
    expect(() => reconcileManifestWithState(fixtureManifest(), fixtureState(), PLAN)).not.toThrow();
  });

  it('checkpoints recorded AFTER the manifest (pre/post-package, recovery) are the permitted extension', () => {
    const state = fixtureState();
    state.freezeCheckpoints.push(
      { checkpoint: 'pre-package', atUtc: '2026-07-31T00:07:00.000Z' },
      { checkpoint: 'post-package', atUtc: '2026-07-31T00:08:00.000Z' },
    );
    expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).not.toThrow();
  });

  it('REWRITTEN earlier checkpoints violate the prefix rule', () => {
    const state = fixtureState();
    state.freezeCheckpoints[0] = { checkpoint: 'pre-batch', atUtc: '2027-01-01T00:00:00.000Z' };
    expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(
      /completed-manifest-state-divergence.*freezeCheckpoints/,
    );
  });

  it('a REMOVED failed execution in control state refuses (the §7.2 concrete failure shape)', () => {
    const state = fixtureState();
    state.executions = state.executions.filter((execution) => execution.status === 'completed');
    expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(
      /completed-manifest-state-divergence.*execution-count/,
    );
  });

  it('an EXTRA execution in control state refuses', () => {
    const state = fixtureState();
    state.executions.push({ ...completedExecution(), executionId: 'a-rec-e3' });
    expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(
      /completed-manifest-state-divergence.*execution-count/,
    );
  });

  it('a REORDERED execution history refuses (order is meaningful)', () => {
    const state = fixtureState();
    state.executions.reverse();
    expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(
      /completed-manifest-state-divergence.*executionId/,
    );
  });

  const editMatrix: Array<[string, (state: SequenceState) => void, RegExp]> = [
    [
      'changed failure class',
      (state) => {
        state.executions[0]!.failureReason = 'browser-error';
      },
      /a-rec-e1\.failureReason/,
    ],
    [
      'changed failure stage',
      (state) => {
        state.executions[0]!.failureStage = 'gateway-launch';
      },
      /a-rec-e1\.failureStage/,
    ],
    [
      'changed terminal status',
      (state) => {
        state.executions[0]!.status = 'completed';
      },
      /a-rec-e1\.status/,
    ],
    [
      'changed replacement disposition',
      (state) => {
        state.executions[0]!.replacementDisposition = 'forbidden';
      },
      /a-rec-e1\.replacementDisposition/,
    ],
    [
      'changed artifact status',
      (state) => {
        state.executions[0]!.artifactStatus = 'artifact-valid';
      },
      /a-rec-e1\.artifactStatus/,
    ],
    [
      'changed study status',
      (state) => {
        state.executions[1]!.studyStatus = 'invalid-treatment';
      },
      /a-rec-e2\.studyStatus/,
    ],
    [
      'changed threshold verdict',
      (state) => {
        state.executions[1]!.thresholdVerdicts![0]!.value = 0;
      },
      /a-rec-e2\.thresholdVerdicts/,
    ],
    [
      'changed seal aggregate',
      (state) => {
        state.executions[1]!.seal!.aggregateSha256 = 'f'.repeat(64);
      },
      /a-rec-e2\.sealAggregateSha256/,
    ],
    [
      'changed run ID',
      (state) => {
        state.executions[1]!.runId = 'run-someone-else';
      },
      /a-rec-e2\.runId/,
    ],
    [
      'changed navigation count',
      (state) => {
        state.executions[1]!.navigationCount = 3;
      },
      /a-rec-e2\.navigationCount/,
    ],
    [
      'changed browser provenance',
      (state) => {
        state.executions[1]!.browserProvenance!.browserVersion = '999.0.0.0';
      },
      /a-rec-e2\.browserProvenance/,
    ],
    [
      'changed recorded verdicts',
      (state) => {
        state.executions[1]!.verdicts['replay-match'] = false;
      },
      /a-rec-e2\.verdicts/,
    ],
    [
      'changed identity field (repository SHA)',
      (state) => {
        state.repositorySha = 'd'.repeat(40);
      },
      /repositorySha/,
    ],
    [
      'changed identity field (attempt profile version)',
      (state) => {
        state.thresholdProfileVersion = '9.9.9';
      },
      /thresholdProfileVersion/,
    ],
  ];

  for (const [name, edit, pattern] of editMatrix) {
    it(`${name} in control state refuses with the field named`, () => {
      const state = fixtureState();
      edit(state);
      expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(
        /completed-manifest-state-divergence/,
      );
      expect(() => reconcileManifestWithState(fixtureManifest(), state, PLAN)).toThrow(pattern);
    });
  }

  it('a manifest without a completed execution for a planned attempt refuses (attempt coverage)', () => {
    const state = fixtureState();
    // Both records agree the completed execution failed — coverage under
    // the AUTHORITATIVE manifest is what refuses.
    state.executions[1]!.status = 'failed';
    state.executions[1]!.failureReason = 'browser-error';
    const manifest = buildSequenceManifest(state, FACTS, null);
    expect(() => reconcileManifestWithState(manifest, state, PLAN)).toThrow(/attempt-coverage/);
  });

  it('registration attestation must be consistent between manifest, state, and archived records (remediation C §5.4)', () => {
    // Block presence disagreeing with state identity refuses in both
    // directions.
    const registered = fixtureState();
    registered.registrationId = 'calibration-variance-a';
    registered.registrationProvenanceSha256 = 'a'.repeat(64);
    expect(() => reconcileManifestWithState(fixtureManifest(), registered, PLAN)).toThrow(
      /registration: manifest block presence disagrees|registrationId/,
    );
    // buildManifestRegistration re-derives the block from the ARCHIVED
    // records, hash-verified against state on the way.
    const root = mkdtempSync(join(tmpdir(), 'm2-manifest-reg-'));
    try {
      const unregistered = fixtureState();
      expect(buildManifestRegistration(root, unregistered)).toBeNull();
      const state = fixtureState();
      const provenance = {
        registrationProvenanceSchemaVersion: 'm2-registration-provenance-1.0.0',
        registrationId: 'stage-a',
        headSha: 'b'.repeat(40),
        atUtc: '2026-07-31T00:00:00.000Z',
        studyTemplate: {
          path: 'experiments/m2/templates/m2-stage-a-acceptance-001.study.template.json',
          blobId: 'c'.repeat(40),
          sha256: 'd'.repeat(64),
        },
        planTemplate: {
          path: 'experiments/m2/templates/stage-a.plan.template.json',
          blobId: 'e'.repeat(40),
          sha256: 'f'.repeat(64),
        },
        registeredStudySha256: 'a'.repeat(64),
        stageAPrerequisiteSha256: null,
        stageADrillMode: false,
      };
      const bytes = `${JSON.stringify(provenance, null, 2)}\n`;
      writeFileSync(join(root, 'registration-provenance.archived.json'), bytes, 'utf8');
      state.registrationId = 'stage-a';
      state.registrationProvenanceSha256 = createHash('sha256').update(bytes).digest('hex');
      const block = buildManifestRegistration(root, state);
      expect(block).not.toBeNull();
      expect(block!.registrationId).toBe('stage-a');
      expect(block!.studyTemplate.blobId).toBe('c'.repeat(40));
      expect(block!.stageAPrerequisiteSha256).toBeNull();
      // A mutated archived record refuses re-derivation.
      writeFileSync(join(root, 'registration-provenance.archived.json'), `${bytes}\n`, 'utf8');
      expect(() => buildManifestRegistration(root, state)).toThrow(
        /manifest-registration-invalid: archived provenance hash differs/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('every divergence is listed in ONE refusal', () => {
    const state = fixtureState();
    state.repositorySha = 'd'.repeat(40);
    state.executions[1]!.runId = 'run-someone-else';
    try {
      reconcileManifestWithState(fixtureManifest(), state, PLAN);
      expect.unreachable('reconciliation should have refused');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('repositorySha');
      expect(message).toContain('a-rec-e2.runId');
    }
  });
});
