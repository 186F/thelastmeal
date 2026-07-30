import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SequenceState } from './sequenceState';
import type { SequenceEvaluation } from './evaluateSequence';

/**
 * Sequence reporting (M2 brief §19.4 final step): a machine-readable JSON
 * report plus a human-readable Markdown summary, both DERIVED from the
 * sequence state and immutable attempt artifacts — regenerable at any time.
 */

export interface SequenceReportExtras {
  browserVersion: string | null;
  launchFlags: string[];
  processTable: { name: string; pid: number; exitCode: number | null }[];
  batchVerdict: string | null;
  evaluation: SequenceEvaluation | null;
}

export function writeSequenceReport(
  sequenceRoot: string,
  state: SequenceState,
  extras: SequenceReportExtras,
): { jsonPath: string; markdownPath: string } {
  const jsonPath = join(sequenceRoot, 'sequence-report.json');
  const markdownPath = join(sequenceRoot, 'sequence-report.md');
  writeFileSync(jsonPath, `${JSON.stringify({ state, ...extras }, null, 2)}\n`, 'utf8');

  const lines: string[] = [];
  lines.push(`# Sequence report — ${state.sequenceId}`);
  lines.push('');
  lines.push(`- status: **${state.status}**`);
  lines.push(`- repository SHA: \`${state.repositorySha}\``);
  lines.push(`- plan sha256: \`${state.planSha256}\``);
  lines.push(
    `- package: ${state.packageVersion}; experiment: ${state.experimentId} v${state.experimentVersion}`,
  );
  lines.push(`- config fingerprint: \`${state.configFingerprint}\``);
  lines.push(`- browser: ${extras.browserVersion ?? 'not-launched'}`);
  lines.push(`- deterministic batch: ${extras.batchVerdict ?? 'not-run (plan)'}`);
  lines.push('');
  lines.push('| execution | attempt | status | failure | runId | replay | finalized |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const execution of state.executions) {
    lines.push(
      `| ${execution.executionId} | ${execution.attemptId} | ${execution.status} | ` +
        `${execution.failureReason ?? '—'} | ${execution.runId ?? '—'} | ` +
        `${String(execution.verdicts['replay-match'] ?? '—')} | ` +
        `${String(execution.verdicts['strict-finalized'] ?? '—')} |`,
    );
  }
  lines.push('');
  if (extras.evaluation) {
    lines.push('## Cross-run comparisons (Mara composite, bp)');
    lines.push('');
    lines.push('| left | right | pairing | composite |');
    lines.push('| --- | --- | --- | --- |');
    for (const comparison of extras.evaluation.comparisons) {
      lines.push(
        `| ${comparison.left} | ${comparison.right} | ${comparison.pairing} | ${comparison.maraCompositeBp} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Managed processes');
  lines.push('');
  lines.push('| name | pid | exit code |');
  lines.push('| --- | --- | --- |');
  for (const row of extras.processTable) {
    lines.push(`| ${row.name} | ${row.pid} | ${row.exitCode ?? 'running'} |`);
  }
  lines.push('');
  writeFileSync(markdownPath, `${lines.join('\n')}\n`, 'utf8');
  return { jsonPath, markdownPath };
}
