import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  SEQUENCE_STATE_VERSION,
  assertResumeIdentity,
  completedExecution,
  markInterruptedExecutions,
  nextExecutionId,
  readSequenceState,
  stateFilePath,
  writeSequenceState,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';

/**
 * Atomic sequence state and resume identity (M2 brief §19.11–§19.12).
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'm2-sequence-state-'));
  dirs.push(dir);
  return dir;
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
    configFingerprint: 'c'.repeat(16),
    status: 'in-progress',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    executions: [],
    lastTransition: 'created',
    createdAtUtc: '2026-07-30T00:00:00.000Z',
    updatedAtUtc: '2026-07-30T00:00:00.000Z',
  };
}

describe('sequence state', () => {
  it('round-trips atomically and leaves no temp file', () => {
    const root = freshRoot();
    const state = baseState();
    writeSequenceState(root, state);
    expect(readSequenceState(root)).toEqual(state);
    expect(() => readFileSync(`${stateFilePath(root)}.tmp`)).toThrow();
  });

  it('resume identity requires exact agreement on every bound field (§19.11)', () => {
    const state = baseState();
    const identity = {
      planSha256: state.planSha256,
      repositorySha: state.repositorySha,
      packageVersion: state.packageVersion,
      experimentId: state.experimentId,
      experimentVersion: state.experimentVersion,
      promptVersion: state.promptVersion,
      externalProviderId: state.externalProviderId,
      upstreamPlatform: state.upstreamPlatform,
      expectedModelId: state.expectedModelId,
      expectedServingProviderId: state.expectedServingProviderId,
      studyId: state.studyId,
      studyVersion: state.studyVersion,
      studyPlanSha256: state.studyPlanSha256,
      configFingerprint: state.configFingerprint,
    };
    expect(() => assertResumeIdentity(state, identity)).not.toThrow();
    for (const key of Object.keys(identity) as (keyof typeof identity)[]) {
      const mutated = { ...identity, [key]: `${identity[key]}x` };
      expect(() => assertResumeIdentity(state, mutated), key).toThrow(/resume-identity-mismatch/);
      expect(() => assertResumeIdentity(state, mutated), key).toThrow(new RegExp(key));
    }
  });

  it('execution ids grow per attempt and completed executions are found', () => {
    const state = baseState();
    expect(nextExecutionId(state, 'a-1')).toBe('a-1-e1');
    state.executions.push({
      executionId: 'a-1-e1',
      attemptId: 'a-1',
      status: 'failed',
      seal: null,
      failureReason: 'run-timeout',
      runId: null,
      dir: 'attempt-a-1-e1',
      artifacts: [],
      verdicts: {},
      startedAtUtc: '2026-07-30T00:00:00.000Z',
      endedAtUtc: '2026-07-30T00:01:00.000Z',
    });
    expect(nextExecutionId(state, 'a-1')).toBe('a-1-e2');
    expect(completedExecution(state, 'a-1')).toBeNull();
    state.executions.push({
      ...state.executions[0]!,
      executionId: 'a-1-e2',
      status: 'completed',
      failureReason: null,
    });
    expect(completedExecution(state, 'a-1')?.executionId).toBe('a-1-e2');
  });

  it('interrupted executions are marked failed-preserved, never continued (§19.9)', () => {
    const state = baseState();
    state.executions.push({
      executionId: 'a-1-e1',
      attemptId: 'a-1',
      status: 'in-progress',
      seal: null,
      failureReason: null,
      runId: null,
      dir: 'attempt-a-1-e1',
      artifacts: [],
      verdicts: {},
      startedAtUtc: '2026-07-30T00:00:00.000Z',
      endedAtUtc: null,
    });
    expect(markInterruptedExecutions(state, '2026-07-30T00:02:00.000Z')).toBe(1);
    expect(state.executions[0]!.status).toBe('failed');
    expect(state.executions[0]!.failureReason).toBe('interrupted');
    expect(state.executions[0]!.endedAtUtc).toBe('2026-07-30T00:02:00.000Z');
    // A second pass is a no-op: history is immutable.
    expect(markInterruptedExecutions(state, '2026-07-30T00:03:00.000Z')).toBe(0);
  });
});
