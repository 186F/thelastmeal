import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { readOption } from '../cli/args';
import { enrichFingerprintSet, loadEvaluationEvidence } from './evidence';
import {
  defaultOutName,
  renderFingerprintMarkdown,
  writeCanonicalJson,
  writeText,
} from './behaviorIo';

/**
 * `npm run eval:behavior -- --ledger <path> [--out <dir>]`
 * (both `--name value` and `--name=value` spellings are accepted)
 *
 * Builds versioned behavioral fingerprints (M2 brief §10.4). A ledger FILE
 * yields ledger-only evidence (`registeredConditionId` and upstream calls
 * `not-observable`); a strict-finalized run DIRECTORY additionally proves
 * the registered condition and upstream action-call counts, which enrich the
 * fingerprint after full artifact validation (re-audit blocker 2).
 * Deterministic: identical inputs produce byte-identical outputs.
 */

export function runBehaviorCli(argv: readonly string[]): number {
  const ledgerArg = readOption(argv, 'ledger');
  const outArg = readOption(argv, 'out');
  if (!ledgerArg) {
    console.error('usage: eval:behavior -- --ledger <ledger.json|finalized-run-dir> [--out <dir>]');
    return 1;
  }
  const outDir = outArg ?? join('artifacts', 'behavior-eval');
  const evidence = loadEvaluationEvidence(ledgerArg);
  let set = buildBehaviorFingerprints(evidence.file);
  if (evidence.kind === 'strict-finalized-run') {
    set = enrichFingerprintSet(set, evidence.enrichment);
  }
  const jsonPath = join(outDir, defaultOutName(evidence.ledgerPath, 'behavior-fingerprint.json'));
  const mdPath = join(outDir, defaultOutName(evidence.ledgerPath, 'behavior-fingerprint.md'));
  writeCanonicalJson(jsonPath, set);
  writeText(mdPath, renderFingerprintMarkdown(set));
  console.log(
    `eval:behavior — ${set.scenarioId} seed ${set.seed} provider plan ${set.providerPlanId} ` +
      `(evidence: ${evidence.kind}; registered condition: ${set.registeredConditionId}): ` +
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
