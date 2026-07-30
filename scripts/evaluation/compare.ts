import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { compareBehaviorFingerprintSets } from '../../src/sim/evaluation/behaviorSimilarity';
import {
  loadValidatedLedger,
  renderComparisonMarkdown,
  writeCanonicalJson,
  writeText,
} from './behaviorIo';

/**
 * `npm run eval:compare -- --left <path> --right <path> [--out <dir>] [--name <stem>]`
 *
 * Validates both inputs, builds fingerprints, and computes the versioned
 * behavioral similarity (M2 brief §10.6–10.7). Refuses non-comparable
 * pairings (same scenario+seed, or the registered B1/B2 ablation pair only).
 */

export function runCompareCli(argv: readonly string[]): number {
  const leftArg = argv.find((a) => a.startsWith('--left='))?.slice('--left='.length);
  const rightArg = argv.find((a) => a.startsWith('--right='))?.slice('--right='.length);
  const outArg = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const nameArg = argv.find((a) => a.startsWith('--name='))?.slice('--name='.length);
  if (!leftArg || !rightArg) {
    console.error(
      'usage: eval:compare -- --left=<ledger|run-dir> --right=<ledger|run-dir> [--out=<dir>] [--name=<stem>]',
    );
    return 1;
  }
  const outDir = outArg ?? join('artifacts', 'behavior-eval');
  const left = loadValidatedLedger(leftArg);
  const right = loadValidatedLedger(rightArg);
  const comparison = compareBehaviorFingerprintSets(
    buildBehaviorFingerprints(left.file),
    buildBehaviorFingerprints(right.file),
  );
  const mara = comparison.npcs.mara;
  const stem =
    nameArg ??
    `compare-${mara.left.scenarioId}-${mara.left.conditionId}-vs-${mara.right.scenarioId}-${mara.right.conditionId}-seed${mara.left.seed}`;
  const jsonPath = join(outDir, `${stem}.behavior-similarity.json`);
  const mdPath = join(outDir, `${stem}.behavior-similarity.md`);
  writeCanonicalJson(jsonPath, comparison);
  writeText(mdPath, renderComparisonMarkdown(comparison));
  console.log(
    `eval:compare — pairing ${comparison.pairing}; mara composite ${mara.compositeBp}bp; ` +
      `wrote ${jsonPath} and ${mdPath}`,
  );
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = runCompareCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(`eval:compare failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
