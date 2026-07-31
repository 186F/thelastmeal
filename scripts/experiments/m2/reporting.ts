import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ProcessManagerHealth } from './processManager';
import type { SequenceState } from './sequenceState';
import type { SequenceEvaluation } from './evaluateSequence';

/**
 * Sequence reporting (M2 brief §19.4 final step; re-audit finding 1).
 *
 * Two documents, both written into the evidence root BEFORE packaging and
 * immutable afterwards:
 *
 *  - `sequence-manifest.json` — the archive's self-describing FINAL
 *    evidence manifest: identity, the completed attempt set with terminal
 *    verdicts (artifact/study status, dispositions, threshold verdicts,
 *    seals), gate results, and process provenance health. It carries NO
 *    mutable lifecycle field — operational state lives in the control
 *    root, and the post-archive completion attestation is the sibling
 *    receipt.
 *  - `sequence-report.json` / `.md` — the human/machine report derived
 *    from the same final facts plus the append-only process log.
 */

export const SEQUENCE_MANIFEST_VERSION = 'm2-sequence-manifest-1.0.0';

const nonEmpty = z.string().min(1);

export const sequenceManifestSchema = z
  .object({
    manifestVersion: z.literal(SEQUENCE_MANIFEST_VERSION),
    sequenceId: nonEmpty,
    planSha256: nonEmpty,
    repositorySha: nonEmpty,
    packageVersion: nonEmpty,
    experimentId: nonEmpty,
    experimentVersion: nonEmpty,
    promptVersion: nonEmpty,
    externalProviderId: nonEmpty,
    upstreamPlatform: nonEmpty,
    expectedModelId: nonEmpty,
    expectedServingProviderId: nonEmpty,
    studyId: nonEmpty,
    studyVersion: nonEmpty,
    studyPlanSha256: nonEmpty,
    thresholdProfileId: nonEmpty,
    thresholdProfileVersion: nonEmpty,
    configFingerprint: nonEmpty,
    /** Final outcome facts — never an in-flight lifecycle value. */
    sequenceOutcome: nonEmpty,
    attemptSetComplete: z.boolean(),
    executions: z.array(
      z
        .object({
          executionId: nonEmpty,
          attemptId: nonEmpty,
          status: z.enum(['completed', 'failed']),
          failureReason: z.string().nullable(),
          failureStage: z.string().nullable(),
          artifactStatus: z.string().nullable(),
          studyStatus: z.string().nullable(),
          replacementDisposition: z.string().nullable(),
          thresholdVerdicts: z.array(z.record(z.string(), z.unknown())).nullable(),
          runId: z.string().nullable(),
          dir: nonEmpty,
          sealAggregateSha256: z.string().nullable(),
          navigationCount: z.number().int().nullable(),
          browserProvenance: z.record(z.string(), z.unknown()).nullable(),
          verdicts: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
          startedAtUtc: nonEmpty,
          endedAtUtc: z.string().nullable(),
        })
        .strict(),
    ),
    batchVerdict: z.string().nullable(),
    evaluationSummary: z
      .object({
        completedExecutions: z.array(z.string()),
        comparisons: z.number().int(),
        skippedPairs: z.number().int(),
      })
      .strict()
      .nullable(),
    processLogHealth: z.record(z.string(), z.unknown()).nullable(),
    freezeCheckpoints: z.array(z.object({ checkpoint: nonEmpty, atUtc: nonEmpty }).strict()),
    finalizedAtUtc: nonEmpty,
  })
  .strict();

export type SequenceManifest = z.infer<typeof sequenceManifestSchema>;

export interface SequenceFinalFacts {
  sequenceOutcome: string;
  attemptSetComplete: boolean;
  batchVerdict: string | null;
  evaluation: SequenceEvaluation | null;
  processLogHealth: ProcessManagerHealth | null;
  browserVersion: string | null;
  launchFlags: string[];
  /** The append-only §19.5 process record (spawn/exit events across every
   * invocation of this sequence, resume included), read back from
   * process-log.jsonl — never a live in-memory table, which a regenerated
   * report would silently truncate. */
  processLog: Array<Record<string, unknown>>;
  finalizedAtUtc: string;
}

export function buildSequenceManifest(
  state: SequenceState,
  facts: SequenceFinalFacts,
): SequenceManifest {
  const inProgress = state.executions.filter((execution) => execution.status === 'in-progress');
  if (inProgress.length > 0) {
    throw new Error(
      `manifest-requires-terminal-executions: ${inProgress
        .map((execution) => execution.executionId)
        .join(', ')} still in-progress`,
    );
  }
  const manifest: SequenceManifest = {
    manifestVersion: SEQUENCE_MANIFEST_VERSION,
    sequenceId: state.sequenceId,
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
    thresholdProfileId: state.thresholdProfileId,
    thresholdProfileVersion: state.thresholdProfileVersion,
    configFingerprint: state.configFingerprint,
    sequenceOutcome: facts.sequenceOutcome,
    attemptSetComplete: facts.attemptSetComplete,
    executions: state.executions.map((execution) => ({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      status: execution.status === 'completed' ? ('completed' as const) : ('failed' as const),
      failureReason: execution.failureReason,
      failureStage: execution.failureStage,
      artifactStatus: execution.artifactStatus,
      studyStatus: execution.studyStatus,
      replacementDisposition: execution.replacementDisposition,
      thresholdVerdicts: execution.thresholdVerdicts,
      runId: execution.runId,
      dir: execution.dir,
      sealAggregateSha256: execution.seal?.aggregateSha256 ?? null,
      navigationCount: execution.navigationCount,
      browserProvenance: execution.browserProvenance,
      verdicts: execution.verdicts,
      startedAtUtc: execution.startedAtUtc,
      endedAtUtc: execution.endedAtUtc,
    })),
    batchVerdict: facts.batchVerdict,
    evaluationSummary: facts.evaluation
      ? {
          completedExecutions: facts.evaluation.completedExecutions,
          comparisons: facts.evaluation.comparisons.length,
          skippedPairs: facts.evaluation.skippedPairs.length,
        }
      : null,
    processLogHealth: facts.processLogHealth
      ? ({ ...facts.processLogHealth } as Record<string, unknown>)
      : null,
    freezeCheckpoints: state.freezeCheckpoints,
    finalizedAtUtc: facts.finalizedAtUtc,
  };
  return sequenceManifestSchema.parse(manifest);
}

export function writeSequenceManifest(
  sequenceRoot: string,
  state: SequenceState,
  facts: SequenceFinalFacts,
): string {
  const manifest = buildSequenceManifest(state, facts);
  const path = join(sequenceRoot, 'sequence-manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

export function writeSequenceReport(
  sequenceRoot: string,
  state: SequenceState,
  facts: SequenceFinalFacts,
): { jsonPath: string; markdownPath: string } {
  const manifest = buildSequenceManifest(state, facts);
  const jsonPath = join(sequenceRoot, 'sequence-report.json');
  const markdownPath = join(sequenceRoot, 'sequence-report.md');
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        ...manifest,
        browserVersion: facts.browserVersion,
        launchFlags: facts.launchFlags,
        evaluation: facts.evaluation,
        processLog: facts.processLog,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const lines: string[] = [];
  lines.push(`# Sequence report — ${state.sequenceId}`);
  lines.push('');
  lines.push(`- outcome: **${facts.sequenceOutcome}**`);
  lines.push(`- attempt set complete: ${String(facts.attemptSetComplete)}`);
  lines.push(`- repository SHA: \`${state.repositorySha}\``);
  lines.push(`- plan sha256: \`${state.planSha256}\``);
  lines.push(
    `- package: ${state.packageVersion}; experiment: ${state.experimentId} v${state.experimentVersion}`,
  );
  lines.push(`- attempt profile: ${state.thresholdProfileId} v${state.thresholdProfileVersion}`);
  lines.push(`- config fingerprint: \`${state.configFingerprint}\``);
  lines.push(`- browser: ${facts.browserVersion ?? 'not-launched'}`);
  lines.push(`- deterministic batch: ${facts.batchVerdict ?? 'not-run (plan)'}`);
  if (facts.processLogHealth) {
    lines.push(
      `- process provenance: ${facts.processLogHealth.recordWriteFailures} record-write ` +
        `failure(s), ${facts.processLogHealth.stopFailures} stop failure(s), ` +
        `${facts.processLogHealth.runningChildren.length} unreconciled child(ren)`,
    );
  }
  lines.push('');
  lines.push(
    '| execution | attempt | status | failure (stage) | artifact | study | disposition | runId | replay | finalized |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const execution of state.executions) {
    const failure = execution.failureReason
      ? `${execution.failureReason}${execution.failureStage ? ` (${execution.failureStage})` : ''}`
      : '—';
    lines.push(
      `| ${execution.executionId} | ${execution.attemptId} | ${execution.status} | ` +
        `${failure} | ${execution.artifactStatus ?? '—'} | ${execution.studyStatus ?? '—'} | ` +
        `${execution.replacementDisposition ?? '—'} | ${execution.runId ?? '—'} | ` +
        `${String(execution.verdicts['replay-match'] ?? '—')} | ` +
        `${String(execution.verdicts['strict-finalized'] ?? '—')} |`,
    );
  }
  lines.push('');
  if (facts.evaluation) {
    lines.push('## Cross-run comparisons (Mara composite, bp)');
    lines.push('');
    lines.push('| left | right | pairing | composite |');
    lines.push('| --- | --- | --- | --- |');
    for (const comparison of facts.evaluation.comparisons) {
      lines.push(
        `| ${comparison.left} | ${comparison.right} | ${comparison.pairing} | ${comparison.maraCompositeBp} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Freeze checkpoints passed');
  lines.push('');
  for (const checkpoint of state.freezeCheckpoints) {
    lines.push(`- ${checkpoint.checkpoint} (${checkpoint.atUtc})`);
  }
  lines.push('');
  lines.push('## Managed processes (append-only log, all invocations)');
  lines.push('');
  lines.push('| at | event | name | pid | exit |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of facts.processLog) {
    lines.push(
      `| ${String(row.atUtc ?? '—')} | ${String(row.event ?? '—')} | ${String(row.name ?? '—')} | ` +
        `${String(row.pid ?? '—')} | ${String(row.exit ?? '—')} |`,
    );
  }
  lines.push('');
  writeFileSync(markdownPath, `${lines.join('\n')}\n`, 'utf8');
  return { jsonPath, markdownPath };
}
