import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { z } from 'zod';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { runBundleSchema } from '../../src/shared/modelArtifacts';

/**
 * Formal run-directory helper (re-audit remediation S1; full ledger
 * validation in 1.5.0 V1).
 *
 *   npm run model:prepare-run -- --run-id <id> --ledger <path> [--bundle <path>]
 *
 * Copies the operator-exported canonical ledger (keeping its original
 * filename) and the browser-exported run bundle (as `client-bundle.json`)
 * into `artifacts/model-runs/<runId>/`, next to the gateway's own
 * model-trace.jsonl / run-manifest.json / requests/ sidecars.
 *
 * EVERYTHING is validated before ANY copy — a mismatch exits nonzero and
 * leaves the run directory untouched (no partial copy):
 *   - the ledger passes the COMPLETE validateLedgerFile sequence (exact
 *     per-event payload schemas, ordering/causation integrity, decision and
 *     action lifecycle joins, isolated reducer replay, structural
 *     invariants, recomputed worldStateHash + canonicalLedgerHash, rebuilt
 *     final summary) — schema parsing alone is NOT sufficient evidence.
 *     Warnings are permitted; ANY validation error rejects the staging.
 *     Ledger integrity is non-negotiable at staging time: the finalizer's
 *     degraded mode covers missing OPTIONAL sources (a lost client bundle),
 *     never a corrupt or truncated ledger (resolves brief §5.2 vs §6.4);
 *   - the ledger filename matches `ledger-*.json` (the only pattern the
 *     finalizer's ledger selection can find);
 *   - the bundle (when given) parses against the strict run-bundle v2
 *     schema; a v1 bundle is hard-rejected with a migration message (A8 —
 *     zero v1 bundles exist, so there is no legacy import path);
 *   - bundle.handoff.runId equals --run-id;
 *   - the ledger scenario equals the handoff scenario;
 *   - the ledger hashes equal the handoff hashes (when the handoff recorded
 *     them; null handoff hashes mean "unavailable at export time" and are
 *     resolved by the finalizer, not here).
 */

export interface PrepareRunArgs {
  runId: string;
  ledgerPath: string;
  /** Optional client bundle (deviation D2: its absence only degrades the
   * finalized completeness, so preparing without one is legal). */
  bundlePath: string | null;
  /** Run-directory root; the CLI uses artifacts/model-runs. */
  destRoot: string;
}

type RunBundle = z.infer<typeof runBundleSchema>;

export function prepareRunDirectory(args: PrepareRunArgs): { dir: string; copied: string[] } {
  if (!existsSync(args.ledgerPath)) {
    throw new Error(`prepare-run: ledger file not found: ${args.ledgerPath}`);
  }
  // Full ledger validation (V1): replay + hashes + lifecycle joins, not just
  // the envelope schema. ok === true with a non-null file is required;
  // warnings are tolerated, every error is fatal and precedes ANY write.
  const validation = validateLedgerFile(readFileSync(args.ledgerPath, 'utf8'));
  if (!validation.ok || validation.file === null) {
    const errors = validation.issues.filter((i) => i.severity === 'error');
    const shown = errors
      .slice(0, 5)
      .map((i) => `${i.code}${i.where ? ` @ ${i.where}` : ''}`)
      .join('; ');
    throw new Error(
      `prepare-run: ledger failed full validation with ${errors.length} error(s): ${shown}${
        errors.length > 5 ? '; …' : ''
      } — a corrupt or truncated ledger can never be staged (degraded mode covers missing optional sources only)`,
    );
  }
  const ledger = validation.file;

  let bundle: RunBundle | null = null;
  if (args.bundlePath !== null) {
    if (!existsSync(args.bundlePath)) {
      throw new Error(`prepare-run: bundle file not found: ${args.bundlePath}`);
    }
    const rawBundle: unknown = JSON.parse(readFileSync(args.bundlePath, 'utf8'));
    // A8: no legacy import path — v1 bundles do not exist anywhere, so the
    // only correct handling is an explicit hard reject, never a silent parse.
    if ((rawBundle as { bundleSchemaVersion?: unknown } | null)?.bundleSchemaVersion === 1) {
      throw new Error(
        'prepare-run: run-bundle schema version 1 is not supported — re-export the run bundle under release 1.5.0',
      );
    }
    bundle = runBundleSchema.parse(rawBundle);
    const handoff = bundle.handoff;
    if (handoff.runId !== args.runId) {
      throw new Error(
        `prepare-run: bundle handoff runId '${handoff.runId}' does not match --run-id '${args.runId}'`,
      );
    }
    if (ledger.scenario.id !== handoff.scenarioId) {
      throw new Error(
        `prepare-run: ledger scenario '${ledger.scenario.id}' does not match handoff scenario '${handoff.scenarioId}'`,
      );
    }
    if (handoff.worldStateHash !== null && handoff.worldStateHash !== ledger.worldStateHash) {
      throw new Error('prepare-run: ledger worldStateHash does not match handoff worldStateHash');
    }
    if (
      handoff.canonicalLedgerHash !== null &&
      handoff.canonicalLedgerHash !== ledger.canonicalLedgerHash
    ) {
      throw new Error(
        'prepare-run: ledger canonicalLedgerHash does not match handoff canonicalLedgerHash',
      );
    }
  }

  const ledgerName = basename(args.ledgerPath);
  // F8: finalize selects the run's ledger by the `ledger-*.json` glob (the
  // handoff carries no designated filename), so a differently-named export
  // would be copied here and then be invisible to the finalizer.
  if (!ledgerName.startsWith('ledger-') || !ledgerName.endsWith('.json')) {
    throw new Error(
      `prepare-run: ledger filename '${ledgerName}' must match ledger-*.json — model:finalize selects the run's ledger by that pattern; rename it (keeping the ledger- prefix) or re-export and retry`,
    );
  }

  // Validation is complete — only now touch the filesystem.
  const dir = join(args.destRoot, args.runId);
  mkdirSync(dir, { recursive: true });
  copyFileSync(args.ledgerPath, join(dir, ledgerName));
  const copied = [ledgerName];
  if (args.bundlePath !== null) {
    copyFileSync(args.bundlePath, join(dir, 'client-bundle.json'));
    copied.push('client-bundle.json');
  }
  return { dir, copied };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('prepareRun.ts') ?? false;
if (invokedDirectly) {
  const runId = arg('--run-id');
  const ledgerPath = arg('--ledger');
  if (!runId || !ledgerPath) {
    console.error(
      'usage: npm run model:prepare-run -- --run-id <id> --ledger <path> [--bundle <path>]',
    );
    process.exit(1);
  }
  const destRoot = join(process.cwd(), arg('--trace-dir') ?? 'artifacts/model-runs');
  try {
    const { dir, copied } = prepareRunDirectory({
      runId,
      ledgerPath,
      bundlePath: arg('--bundle'),
      destRoot,
    });
    console.log(`model-prepare-run: copied ${copied.join(', ')} into ${dir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
