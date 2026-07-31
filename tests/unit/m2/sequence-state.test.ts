import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  RESUME_IDENTITY_FIELDS,
  SEQUENCE_STATE_VERSION,
  assertResumable,
  assertResumeIdentity,
  completedExecution,
  controlRoot,
  markInterruptedExecutions,
  nextExecutionId,
  readSequenceState,
  stateFilePath,
  writeSequenceState,
  type AttemptExecution,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';

/**
 * Atomic sequence state and resume identity (M2 brief §19.11–§19.12;
 * re-audit findings 1, 3, and 5): the control-root location, the 16-field
 * identity, terminal seals for interrupted executions, and the recorded
 * replacement dispositions that gate resume.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'm2-sequence-state-'));
  dirs.push(dir);
  return join(dir, 'sequence');
}

function baseExecution(overrides: Partial<AttemptExecution> = {}): AttemptExecution {
  return {
    executionId: 'a-1-e1',
    attemptId: 'a-1',
    status: 'in-progress',
    seal: null,
    failureReason: null,
    failureStage: null,
    artifactStatus: null,
    studyStatus: null,
    replacementDisposition: null,
    thresholdVerdicts: null,
    runId: null,
    dir: 'attempt-a-1-e1',
    artifacts: [],
    verdicts: {},
    navigationCount: null,
    browserProvenance: null,
    startedAtUtc: '2026-07-30T00:00:00.000Z',
    endedAtUtc: null,
    ...overrides,
  };
}

function baseState(): SequenceState {
  return {
    stateVersion: SEQUENCE_STATE_VERSION,
    sequenceId: 'test-sequence',
    planSha256: 'a'.repeat(64),
    repositorySha: 'b'.repeat(40),
    packageVersion: '1.8.0',
    experimentId: 'model-backed-npc-001',
    experimentVersion: '1.2.0',
    promptVersion: 'mara-action-selection-1.0.0',
    externalProviderId: 'openrouter-mara-action-v1',
    upstreamPlatform: 'openrouter',
    expectedModelId: 'fake-adapter',
    expectedServingProviderId: 'local',
    studyId: 'none',
    studyVersion: 'none',
    studyPlanSha256: 'none',
    thresholdProfileId: 'm2-rehearsal-attempt-profile',
    thresholdProfileVersion: '1.0.0',
    configFingerprint: 'c'.repeat(16),
    status: 'in-progress',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    inventoryAggregateSha256: null,
    freezeCheckpoints: [],
    executions: [],
    lastTransition: 'created',
    createdAtUtc: '2026-07-30T00:00:00.000Z',
    updatedAtUtc: '2026-07-30T00:00:00.000Z',
  };
}

describe('sequence state', () => {
  it('lives in the control root beside the evidence root and round-trips atomically', () => {
    const root = freshRoot();
    const state = baseState();
    writeSequenceState(root, state);
    // Re-audit finding 1: mutable operational state is NEVER inside the
    // packaged evidence tree.
    expect(stateFilePath(root).startsWith(controlRoot(root))).toBe(true);
    expect(controlRoot(root)).toBe(`${root}.control`);
    expect(readSequenceState(root)).toEqual(state);
    expect(() => readFileSync(`${stateFilePath(root)}.tmp`)).toThrow();
  });

  it('resume identity requires exact agreement on every bound field incl. the attempt profile (§19.11)', () => {
    const state = baseState();
    const identity = Object.fromEntries(
      RESUME_IDENTITY_FIELDS.map((key) => [key, state[key]]),
    ) as unknown as Parameters<typeof assertResumeIdentity>[1];
    expect(RESUME_IDENTITY_FIELDS).toHaveLength(16);
    expect(RESUME_IDENTITY_FIELDS).toContain('thresholdProfileId');
    expect(RESUME_IDENTITY_FIELDS).toContain('thresholdProfileVersion');
    expect(() => assertResumeIdentity(state, identity)).not.toThrow();
    for (const key of RESUME_IDENTITY_FIELDS) {
      const mutated = { ...identity, [key]: `${identity[key]}x` };
      expect(() => assertResumeIdentity(state, mutated), key).toThrow(/resume-identity-mismatch/);
      expect(() => assertResumeIdentity(state, mutated), key).toThrow(new RegExp(key));
    }
  });

  it('execution ids grow per attempt and completed executions are found', () => {
    const state = baseState();
    expect(nextExecutionId(state, 'a-1')).toBe('a-1-e1');
    state.executions.push(baseExecution({ status: 'failed', failureReason: 'run-timeout' }));
    expect(nextExecutionId(state, 'a-1')).toBe('a-1-e2');
    expect(completedExecution(state, 'a-1')).toBeNull();
    state.executions.push(baseExecution({ executionId: 'a-1-e2', status: 'completed' }));
    expect(completedExecution(state, 'a-1')?.executionId).toBe('a-1-e2');
  });

  it('interrupted executions are marked failed-preserved AND sealed as they survived (§19.9; re-audit finding 5)', () => {
    const root = freshRoot();
    mkdirSync(join(root, 'attempt-a-1-e1'), { recursive: true });
    writeFileSync(join(root, 'attempt-a-1-e1', 'heartbeat.jsonl'), '{"tick":1}\n', 'utf8');
    const state = baseState();
    state.executions.push(baseExecution());
    const marked = markInterruptedExecutions(root, state, '2026-07-30T00:02:00.000Z');
    expect(marked).toHaveLength(1);
    const execution = state.executions[0]!;
    expect(execution.status).toBe('failed');
    expect(execution.failureReason).toBe('interrupted');
    expect(execution.endedAtUtc).toBe('2026-07-30T00:02:00.000Z');
    expect(execution.seal).not.toBeNull();
    expect(execution.seal!.sealedStatus).toBe('failed');
    expect(execution.seal!.files.map((file) => file.path)).toContain('heartbeat.jsonl');
    // A second pass is a no-op: history is immutable.
    expect(markInterruptedExecutions(root, state, '2026-07-30T00:03:00.000Z')).toHaveLength(0);
  });

  it('an interrupted execution whose directory never existed seals as an explicit empty set', () => {
    const root = freshRoot();
    const state = baseState();
    state.executions.push(baseExecution({ dir: 'attempt-never-created' }));
    const marked = markInterruptedExecutions(root, state, '2026-07-30T00:02:00.000Z');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.seal).not.toBeNull();
    expect(marked[0]!.seal!.files).toHaveLength(0);
  });

  it('recorded dispositions gate resume: forbidden and exhausted refuse, permitted continues (re-audit §7.3)', () => {
    const state = baseState();
    state.executions.push(
      baseExecution({
        status: 'failed',
        failureReason: 'run-timeout',
        replacementDisposition: 'permitted',
      }),
    );
    expect(() => assertResumable(state)).not.toThrow();

    state.executions[0]!.replacementDisposition = 'exhausted';
    expect(() => assertResumable(state)).toThrow(/resume-blocked-replacement-exhausted/);

    state.executions[0]!.replacementDisposition = 'forbidden';
    state.executions[0]!.failureReason = 'treatment-mismatch';
    expect(() => assertResumable(state)).toThrow(/resume-blocked-forbidden-failure/);
    expect(() => assertResumable(state)).toThrow(/treatment-mismatch/);
  });
});
