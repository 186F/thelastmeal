import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import {
  defaultOutName,
  loadValidatedLedger,
  renderFingerprintMarkdown,
  writeCanonicalJson,
  writeText,
} from './behaviorIo';

/**
 * `npm run eval:behavior -- --ledger <path> [--out <dir>]`
 *
 * Builds versioned behavioral fingerprints (M2 brief §10.4) from one fully
 * validated ledger file or finalized run directory, writing canonical JSON
 * plus human-readable Markdown. Deterministic: identical inputs produce
 * byte-identical outputs (no timestamps).
 */

export function runBehaviorCli(argv: readonly string[]): number {
  const ledgerArg = argv.find((a) => a.startsWith('--ledger='))?.slice('--ledger='.length);
  const outArg = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  if (!ledgerArg) {
    console.error('usage: eval:behavior -- --ledger=<ledger.json|run-dir> [--out=<dir>]');
    return 1;
  }
  const outDir = outArg ?? join('artifacts', 'behavior-eval');
  const loaded = loadValidatedLedger(ledgerArg);
  const set = buildBehaviorFingerprints(loaded.file);
  const jsonPath = join(outDir, defaultOutName(loaded.ledgerPath, 'behavior-fingerprint.json'));
  const mdPath = join(outDir, defaultOutName(loaded.ledgerPath, 'behavior-fingerprint.md'));
  writeCanonicalJson(jsonPath, set);
  writeText(mdPath, renderFingerprintMarkdown(set));
  console.log(
    `eval:behavior — ${set.scenarioId} seed ${set.seed} condition ${set.conditionId}: ` +
      `wrote ${jsonPath} and ${mdPath}`,
  );
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = runBehaviorCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(
      `eval:behavior failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
