import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Atomic sequence state (M2 brief §19.11–§19.12).
 *
 * One `sequence-state.json` per sequence, living in the sequence output
 * root (outside the tracked repository for formal evidence). Every write is
 * atomic (temp file + rename on the same volume) so a crash leaves either
 * the previous state or the new one — never a torn file.
 *
 * Identity: a sequence is bound to one plan hash, one repository SHA, one
 * package version, and one experiment identity. `--resume` requires exact
 * agreement on all of them; a mismatch is a refusal, never a warning.
 *
 * Idempotency: completed executions are immutable history. A resumed
 * sequence reads them, continues incomplete work under NEW execution ids,
 * and regenerates derived reports — it never reruns, overwrites, or
 * silently discards anything.
 */

export const SEQUENCE_STATE_VERSION = 'm2-sequence-state-1.0.0';

const nonEmpty = z.string().min(1);

export const attemptExecutionSchema = z
  .object({
    /** `<attemptId>-e<N>` — every execution gets a fresh directory. */
    executionId: nonEmpty,
    attemptId: nonEmpty,
    status: z.enum(['in-progress', 'completed', 'failed']),
    /** Failure classification when status = failed (e.g. simulation-stall,
     * run-timeout, replay-mismatch, finalize-failed, interrupted). */
    failureReason: z.string().nullable(),
    /** Browser-minted run id for model attempts; null for deterministic. */
    runId: z.string().nullable(),
    /** Attempt directory, relative to the sequence root. */
    dir: nonEmpty,
    /** Artifact paths relative to the sequence root. */
    artifacts: z.array(nonEmpty),
    /** Gate verdicts recorded for the execution (validated-ledger,
     * replay-match, strict-finalized, fingerprint, …). */
    verdicts: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
    startedAtUtc: nonEmpty,
    endedAtUtc: z.string().nullable(),
  })
  .strict();

export type AttemptExecution = z.infer<typeof attemptExecutionSchema>;

export const sequenceStateSchema = z
  .object({
    stateVersion: z.literal(SEQUENCE_STATE_VERSION),
    sequenceId: nonEmpty,
    planSha256: z.string().regex(/^[0-9a-f]{64}$/),
    repositorySha: z.string().regex(/^[0-9a-f]{40}$/),
    packageVersion: nonEmpty,
    experimentId: nonEmpty,
    experimentVersion: nonEmpty,
    /** Code-pinned prompt version and provider/platform identity (§19.11:
     * resume requires exact agreement on model, provider, and prompts). The
     * runtime model slug lives ONLY in the gateway's own configuration and
     * is bound per run by the finalized manifests' pinned-model criterion —
     * the orchestrator never reads it (§19.15). */
    promptVersion: nonEmpty,
    externalProviderId: nonEmpty,
    upstreamPlatform: nonEmpty,
    /** Nonsecret configuration fingerprint over the plan's frozen fields. */
    configFingerprint: nonEmpty,
    status: z.enum(['in-progress', 'completed', 'failed']),
    executions: z.array(attemptExecutionSchema),
    /** Last fully persisted transition, for diagnosis after a crash. */
    lastTransition: nonEmpty,
    createdAtUtc: nonEmpty,
    updatedAtUtc: nonEmpty,
  })
  .strict();

export type SequenceState = z.infer<typeof sequenceStateSchema>;

export function stateFilePath(sequenceRoot: string): string {
  return join(sequenceRoot, 'sequence-state.json');
}

/** Atomic write: serialize, write to a sibling temp file, rename over. */
export function writeSequenceState(sequenceRoot: string, state: SequenceState): void {
  sequenceStateSchema.parse(state);
  const target = stateFilePath(sequenceRoot);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}

export function readSequenceState(sequenceRoot: string): SequenceState | null {
  const target = stateFilePath(sequenceRoot);
  if (!existsSync(target)) return null;
  return sequenceStateSchema.parse(JSON.parse(readFileSync(target, 'utf8')));
}

export interface ResumeIdentity {
  planSha256: string;
  repositorySha: string;
  packageVersion: string;
  experimentId: string;
  experimentVersion: string;
  promptVersion: string;
  externalProviderId: string;
  upstreamPlatform: string;
  configFingerprint: string;
}

/** §19.11: resume requires exact identity agreement — refusal on mismatch. */
export function assertResumeIdentity(state: SequenceState, identity: ResumeIdentity): void {
  const mismatches: string[] = [];
  for (const key of [
    'planSha256',
    'repositorySha',
    'packageVersion',
    'experimentId',
    'experimentVersion',
    'promptVersion',
    'externalProviderId',
    'upstreamPlatform',
    'configFingerprint',
  ] as const) {
    if (state[key] !== identity[key]) {
      mismatches.push(`${key}: state ${state[key]} != current ${identity[key]}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`resume-identity-mismatch: ${mismatches.join('; ')}`);
  }
}

/** Next execution id for a planned attempt: attemptId-e1, -e2, … */
export function nextExecutionId(state: SequenceState, attemptId: string): string {
  const count = state.executions.filter((execution) => execution.attemptId === attemptId).length;
  return `${attemptId}-e${count + 1}`;
}

/** Completed execution for a planned attempt, if any (idempotency: such an
 * attempt is never rerun). */
export function completedExecution(
  state: SequenceState,
  attemptId: string,
): AttemptExecution | null {
  return (
    state.executions.find(
      (execution) => execution.attemptId === attemptId && execution.status === 'completed',
    ) ?? null
  );
}

/** Executions left 'in-progress' by a crash or kill are marked failed as
 * 'interrupted' on resume — preserved, never continued in place (§19.9). */
export function markInterruptedExecutions(state: SequenceState, nowUtc: string): number {
  let marked = 0;
  for (const execution of state.executions) {
    if (execution.status === 'in-progress') {
      execution.status = 'failed';
      execution.failureReason = 'interrupted';
      execution.endedAtUtc = nowUtc;
      marked += 1;
    }
  }
  return marked;
}
