import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFullBatch } from '../../src/sim/batch';
import { renderMarkdownReport } from '../../src/sim/reporting';
import { ledgerFileName } from '../../src/shared/ledgerFile';

/**
 * `npm run batch` — the deterministic headless batch (brief section 18).
 *
 * Runs every scenario, replays every ledger, repeats each scenario 100 times
 * to confirm hash stability, and writes ledgers, anonymized traces, and the
 * machine-readable + Markdown reports to the git-ignored `artifacts/`
 * directory. Exits nonzero when any invariant fails, any replay differs, or
 * any scenario fails to reach a terminal state.
 */

const runsArg = process.argv.find((a) => a.startsWith('--runs='));
const runsPerScenario = runsArg ? Math.max(1, Number(runsArg.split('=')[1])) : 100;

const artifactsDir = join(process.cwd(), 'artifacts');
mkdirSync(artifactsDir, { recursive: true });
mkdirSync(join(artifactsDir, 'ledgers'), { recursive: true });
mkdirSync(join(artifactsDir, 'traces'), { recursive: true });

console.log(`Running deterministic batch: ${runsPerScenario} run(s) per scenario...`);
const started = Date.now();

let output;
try {
  output = runFullBatch({
    runsPerScenario,
    onProgress: (completed, total, scenarioId) => {
      console.log(`  [${completed}/${total}] scenario ${scenarioId} done`);
    },
  });
} catch (error) {
  console.error('Batch crashed before completion:', error);
  process.exit(1);
}

const { report, ledgers, traces } = output;

for (const { file } of ledgers) {
  const name = ledgerFileName(file.scenario.id, file.scenario.version, file.scenario.seed);
  writeFileSync(join(artifactsDir, 'ledgers', name), JSON.stringify(file, null, 2), 'utf8');
}
for (const trace of traces) {
  const name = `traces-context-rich-${trace.scenarioId}-seed${trace.seed}.json`;
  writeFileSync(join(artifactsDir, 'traces', name), JSON.stringify(trace, null, 2), 'utf8');
}
writeFileSync(join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(join(artifactsDir, 'report.md'), renderMarkdownReport(report), 'utf8');

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log('');
for (const row of report.scenarios) {
  console.log(
    `  ${row.scenarioId}: ${(row.finalProgressPctTimes100 / 100).toFixed(2)}% ${row.taskOutcome}, ` +
      `meal=${row.mealConsumedBy ?? 'none'}, promise=${row.promiseOutcome}, ` +
      `events=${row.eventCount}, world=${row.worldStateHash}, ledger=${row.canonicalLedgerHash}, replay=${row.replayHashMatch ? 'match' : 'MISMATCH'}`,
  );
}
console.log('');
console.log(
  `B1/B2 memory comparison: workTicks ${report.memoryComparison.b1.workTicks} vs ${report.memoryComparison.b2.workTicks}, ` +
    `breakRequests ${report.memoryComparison.b1.breakRequestCount} vs ${report.memoryComparison.b2.breakRequestCount}, ` +
    `distinct=${report.memoryComparison.distinctBehaviorObserved}`,
);
if (report.determinism.invariantViolations.length > 0) {
  console.error('\nInvariant violations:');
  for (const v of report.determinism.invariantViolations) console.error(`  - ${v}`);
}
console.log(`\nBatch ${report.ok ? 'PASSED' : 'FAILED'} in ${elapsed}s. Artifacts in ./artifacts`);
process.exit(report.ok ? 0 : 1);
