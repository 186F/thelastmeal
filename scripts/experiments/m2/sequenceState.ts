import { z } from 'zod';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';

/**
 * Atomic sequence state (M2 brief §19.11–§19.12; Phase 3 re-audit
 * findings 1, 3, and 5).
 *
 * The state file is MUTABLE OPERATIONAL CONTROL STATE and therefore lives
 * in a CONTROL ROOT beside the evidence root (`<root>.control/`), never
 * inside the packaged evidence tree — once the sequence archive is
 * created, no inventoried evidence file changes again (re-audit finding 1).
 * The archive's self-describing counterpart is the immutable
 * `sequence-manifest.json` written INTO the evidence root before
 * packaging.
 *
 * Every write is atomic (temp file + rename on the same volume) so a crash
 * leaves either the previous state or the new one — never a torn file.
 *
 * Identity: a sequence is bound to one plan hash, one repository SHA, one
 * package version, one experiment identity, and one registered attempt
 * profile. `--resume` requires exact agreement on all of them; a mismatch
 * is a refusal, never a warning.
 *
 * Terminal evidence: EVERY terminal execution — completed, failed, and
 * interrupted — carries an immutable seal over its attempt directory
 * (re-audit finding 5), revalidated on resume before any write.
 */

export const SEQUENCE_STATE_VERSION = 'm2-sequence-state-2.0.0';

const nonEmpty = z.string().min(1);

/** The control root holding mutable operational state, the writer lock,
 * and packaging-helper provenance — OUTSIDE the packaged evidence tree. */
export function controlRoot(sequenceRoot: string): string {
  return `${sequenceRoot}.control`;
}

/** Immutable per-execution evidence seal (audit finding 4; re-audit
 * finding 5): the sha256 of every file in the attempt directory, written
 * WITH the terminal status and revalidated before any resume proceeds.
 * `files` may be empty when a crash interrupted the execution before its
 * directory gained content. */
export const executionSealSchema = z
  .object({
    sealedStatus: z.enum(['completed', 'failed']),
    files: z.array(
      z.object({ path: nonEmpty, sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    ),
    aggregateSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type ExecutionSeal = z.infer<typeof executionSealSchema>;

/** Per-execution browser provenance (re-audit §13.2), recorded before the
 * execution seals. */
export const browserProvenanceSchema = z
  .object({
    playwrightVersion: nonEmpty,
    browserVersion: nonEmpty,
    headless: z.boolean(),
    contextOptions: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
  })
  .strict();
export type BrowserProvenance = z.infer<typeof browserProvenanceSchema>;

export const thresholdVerdictSchema = z
  .object({
    metric: nonEmpty,
    npcId: nonEmpty,
    value: z.number().int().nullable(),
    min: z.number().int(),
    pass: z.boolean(),
  })
  .strict();

export const attemptExecutionSchema = z
  .object({
    /** `<attemptId>-e<N>` — every execution gets a fresh directory. */
    executionId: nonEmpty,
    attemptId: nonEmpty,
    status: z.enum(['in-progress', 'completed', 'failed']),
    /** Non-null for EVERY terminal execution (completed and failed). */
    seal: executionSealSchema.nullable(),
    /** Closed-taxonomy failure class when status = failed. */
    failureReason: z.string().nullable(),
    /** Pipeline stage that threw, for typed post-browser failures
     * (re-audit §12). */
    failureStage: z.string().nullable(),
    /** Artifact-pipeline verdict (re-audit finding 3): did the evidence
     * pipeline itself succeed end to end? */
    artifactStatus: z.enum(['artifact-valid', 'artifact-invalid']).nullable(),
    /** Study-validity verdict: does the artifact ALSO clear the registered
     * treatment thresholds? `invalid-treatment` preserves an artifact-valid
     * run that missed them. */
    studyStatus: z.enum(['study-valid', 'invalid-treatment', 'not-evaluated']).nullable(),
    /** Persisted replacement disposition (re-audit finding 3 §7.3): resume
     * inspects THIS, never re-derives capacity. `forbidden` permanently
     * halts the attempt under this plan. */
    replacementDisposition: z.enum(['permitted', 'forbidden', 'exhausted']).nullable(),
    /** Threshold verdicts under the bound attempt profile. */
    thresholdVerdicts: z.array(thresholdVerdictSchema).nullable(),
    /** Browser-minted run id for model attempts; null for deterministic. */
    runId: z.string().nullable(),
    /** Attempt directory, relative to the sequence root. */
    dir: nonEmpty,
    /** Artifact paths relative to the sequence root. */
    artifacts: z.array(nonEmpty),
    /** Gate verdicts recorded for the execution (validated-ledger,
     * replay-match, strict-finalized, fingerprint, …). */
    verdicts: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
    /** Main-frame navigation count observed by the driver (re-audit
     * §13.3): exactly 1 for an uninterrupted attempt. */
    navigationCount: z.number().int().nullable(),
    browserProvenance: browserProvenanceSchema.nullable(),
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
    /** Reviewed treatment identity (audit finding 2): the plan's expected
     * model and serving route, gateway-verified before Start. `none` for
     * plans with no model-backed attempts. */
    expectedModelId: nonEmpty,
    expectedServingProviderId: nonEmpty,
    /** Pre-registered study binding for evidentiary sequences; `none`
     * markers otherwise. */
    studyId: nonEmpty,
    studyVersion: nonEmpty,
    studyPlanSha256: nonEmpty,
    /** Registered attempt execution/threshold profile (re-audit finding 3):
     * part of resume identity. */
    thresholdProfileId: nonEmpty,
    thresholdProfileVersion: nonEmpty,
    /** Nonsecret configuration fingerprint over the plan's frozen fields. */
    configFingerprint: nonEmpty,
    /** Sequence finalization lifecycle (audit finding 5): `completed` is
     * written ONLY after every gate, the archive, and its receipt succeed. */
    status: z.enum([
      'in-progress',
      'attempts-complete',
      'validating',
      'packaging',
      'completed',
      'failed',
    ]),
    /** Typed reason + failed stage when status is 'failed'. */
    sequenceFailureReason: z.string().nullable(),
    /** Durable archive receipt data once packaging succeeds. */
    archivePath: z.string().nullable(),
    archiveSha256: z.string().nullable(),
    /** Aggregate of the sequence root's sha256 inventory at packaging time
     * (re-audit findings 1 and 5): with the inventory file itself this is
     * the sequence-level evidence seal — the whole root, attempt and
     * non-attempt files alike, verified byte-for-byte on completed resume. */
    inventoryAggregateSha256: z.string().nullable(),
    /** Freeze checkpoints passed so far (re-audit finding 4). Violations
     * never appear here — they fail the sequence. */
    freezeCheckpoints: z.array(z.object({ checkpoint: nonEmpty, atUtc: nonEmpty }).strict()),
    executions: z.array(attemptExecutionSchema),
    /** Last fully persisted transition, for diagnosis after a crash. */
    lastTransition: nonEmpty,
    createdAtUtc: nonEmpty,
    updatedAtUtc: nonEmpty,
  })
  .strict();

export type SequenceState = z.infer<typeof sequenceStateSchema>;

export function stateFilePath(sequenceRoot: string): string {
  return join(controlRoot(sequenceRoot), 'sequence-state.json');
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
  expectedModelId: string;
  expectedServingProviderId: string;
  studyId: string;
  studyVersion: string;
  studyPlanSha256: string;
  thresholdProfileId: string;
  thresholdProfileVersion: string;
  configFingerprint: string;
}

export const RESUME_IDENTITY_FIELDS = [
  'planSha256',
  'repositorySha',
  'packageVersion',
  'experimentId',
  'experimentVersion',
  'promptVersion',
  'externalProviderId',
  'upstreamPlatform',
  'expectedModelId',
  'expectedServingProviderId',
  'studyId',
  'studyVersion',
  'studyPlanSha256',
  'thresholdProfileId',
  'thresholdProfileVersion',
  'configFingerprint',
] as const;

/** §19.11: resume requires exact identity agreement — refusal on mismatch. */
export function assertResumeIdentity(state: SequenceState, identity: ResumeIdentity): void {
  const mismatches: string[] = [];
  for (const key of RESUME_IDENTITY_FIELDS) {
    if (state[key] !== identity[key]) {
      mismatches.push(`${key}: state ${state[key]} != current ${identity[key]}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`resume-identity-mismatch: ${mismatches.join('; ')}`);
  }
}

/**
 * Resume replacement governance (re-audit finding 3, §7.3): before any
 * write or replacement spend, the RECORDED terminal dispositions decide
 * whether the sequence may continue — resume never re-derives capacity. A
 * `forbidden` disposition (non-retryable failure class) permanently halts
 * the attempt under this plan; `exhausted` means the registered capacity
 * is spent. Sequence-level failures outside the attempt loop resume into
 * the same identity- and freeze-guarded pipeline, which re-refuses on any
 * unresolved cause.
 */
export function assertResumable(state: SequenceState): void {
  for (const execution of state.executions) {
    if (execution.replacementDisposition === 'forbidden') {
      throw new Error(
        `resume-blocked-forbidden-failure: ${execution.executionId} failed as ` +
          `'${execution.failureReason ?? 'unknown'}' (non-retryable) — this plan may not ` +
          'receive another execution for the attempt',
      );
    }
    if (execution.replacementDisposition === 'exhausted') {
      throw new Error(
        `resume-blocked-replacement-exhausted: ${execution.executionId} failed as ` +
          `'${execution.failureReason ?? 'unknown'}' with no replacement capacity left`,
      );
    }
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

/** Walks an execution directory and seals every file with the terminal
 * status (audit finding 4; re-audit finding 5). A directory a crash never
 * created seals as an explicit empty file set. */
export function sealExecution(
  sequenceRoot: string,
  executionDir: string,
  sealedStatus: 'completed' | 'failed',
): ExecutionSeal {
  const root = join(sequenceRoot, executionDir);
  const files: { path: string; sha256: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        files.push({
          path: relative(root, full).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
        });
      }
    }
  };
  if (existsSync(root)) walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const aggregateSha256 = createHash('sha256')
    .update(files.map((file) => `${file.path}:${file.sha256}`).join('\n'))
    .digest('hex');
  return { sealedStatus, files, aggregateSha256 };
}

/** Revalidates every TERMINAL execution's seal — completed, failed, and
 * interrupted alike (re-audit finding 5): missing or altered evidence is a
 * typed refusal, never a silent skip or rerun. */
export function verifySealedExecutions(sequenceRoot: string, state: SequenceState): void {
  for (const execution of state.executions) {
    if (execution.status === 'in-progress') continue;
    if (execution.seal === null) {
      throw new Error(`resume-evidence-invalid: ${execution.executionId} has no terminal seal`);
    }
    if (execution.seal.sealedStatus !== execution.status) {
      throw new Error(
        `resume-evidence-invalid: ${execution.executionId} seal status ` +
          `'${execution.seal.sealedStatus}' != execution status '${execution.status}'`,
      );
    }
    const recomputed = sealExecution(sequenceRoot, execution.dir, execution.seal.sealedStatus);
    if (recomputed.aggregateSha256 !== execution.seal.aggregateSha256) {
      const recorded = new Map(execution.seal.files.map((file) => [file.path, file.sha256]));
      const current = new Map(recomputed.files.map((file) => [file.path, file.sha256]));
      const problems: string[] = [];
      for (const [path, hash] of recorded) {
        if (!current.has(path)) problems.push(`missing:${path}`);
        else if (current.get(path) !== hash) problems.push(`altered:${path}`);
      }
      for (const path of current.keys()) {
        if (!recorded.has(path)) problems.push(`added:${path}`);
      }
      throw new Error(
        `resume-evidence-invalid: ${execution.executionId} seal mismatch (${problems
          .slice(0, 5)
          .join('; ')})`,
      );
    }
  }
}

/** Executions left 'in-progress' by a crash or kill are marked failed as
 * 'interrupted' on resume — preserved and SEALED as they survived, never
 * continued in place (§19.9; re-audit finding 5). The caller assigns each
 * marked execution's replacement disposition from the plan. */
export function markInterruptedExecutions(
  sequenceRoot: string,
  state: SequenceState,
  nowUtc: string,
): AttemptExecution[] {
  const marked: AttemptExecution[] = [];
  for (const execution of state.executions) {
    if (execution.status === 'in-progress') {
      execution.status = 'failed';
      execution.failureReason = 'interrupted';
      execution.failureStage = 'interrupted';
      execution.artifactStatus = 'artifact-invalid';
      execution.studyStatus = 'not-evaluated';
      execution.endedAtUtc = nowUtc;
      execution.seal = sealExecution(sequenceRoot, execution.dir, 'failed');
      marked.push(execution);
    }
  }
  return marked;
}
