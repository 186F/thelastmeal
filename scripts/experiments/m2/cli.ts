import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { hasFlag, readOption } from '../../cli/args';
import { orchestrateSequence } from './orchestrate';
import { evaluateSequence } from './evaluateSequence';
import { packageSequence } from './packageEvidence';

/**
 * Orchestrator command surface (M2 brief §19.2).
 *
 *   npm run m2:orchestrate -- --plan <path> [--resume] [--acknowledge-live-cost]
 *                              [--allow-sleep-risk] [--headed]
 *   npm run m2:evaluate    -- --sequence <sequence-root>
 *   npm run m2:package     -- --sequence <sequence-root> [--zip <path>]
 *   npm run m2:pilot        (refusal stub until Phase 6)
 *
 * `m2:orchestrate -- --resume` IS the resume command (§19.2 allows this in
 * place of a separate m2:resume, documented here and in the README):
 * identity-checked against the recorded sequence state, it marks
 * interrupted executions failed-preserved and continues from the first
 * incomplete attempt.
 */

export async function runCli(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  const repoRoot = process.cwd();

  switch (command) {
    case 'orchestrate': {
      const planPath = readOption(rest, 'plan');
      if (!planPath) {
        console.error(
          'usage: m2:orchestrate -- --plan <path> [--resume] [--acknowledge-live-cost] [--allow-sleep-risk] [--headed]',
        );
        return 1;
      }
      const result = await orchestrateSequence({
        planPath: resolve(repoRoot, planPath),
        resume: hasFlag(rest, 'resume'),
        acknowledgeLiveCost: hasFlag(rest, 'acknowledge-live-cost'),
        allowSleepRisk: hasFlag(rest, 'allow-sleep-risk'),
        headed: hasFlag(rest, 'headed'),
        repoRoot,
      });
      console.log(
        `m2:orchestrate — ${result.status.toUpperCase()}: ${result.executions} execution(s), ` +
          `${result.failedExecutions} failed; sequence root ${result.sequenceRoot}` +
          (result.zipPath ? `; evidence zip ${result.zipPath}` : ''),
      );
      return result.status === 'completed' ? 0 : 1;
    }
    case 'evaluate': {
      const sequenceRoot = readOption(rest, 'sequence');
      if (!sequenceRoot) {
        console.error('usage: m2:evaluate -- --sequence <sequence-root>');
        return 1;
      }
      const evaluation = evaluateSequence(resolve(repoRoot, sequenceRoot));
      console.log(
        `m2:evaluate — ${evaluation.sequenceId}: ${evaluation.completedExecutions.length} completed ` +
          `execution(s), ${evaluation.comparisons.length} comparison(s), ` +
          `${evaluation.skippedPairs.length} skipped pair(s); wrote sequence-evaluation.json`,
      );
      return 0;
    }
    case 'package': {
      const sequenceRoot = readOption(rest, 'sequence');
      if (!sequenceRoot) {
        console.error('usage: m2:package -- --sequence <sequence-root> [--zip <path>]');
        return 1;
      }
      const root = resolve(repoRoot, sequenceRoot);
      const zipPath = readOption(rest, 'zip') ?? resolve(root, '..', 'sequence-evidence.zip');
      const result = await packageSequence(root, resolve(repoRoot, zipPath));
      console.log(
        `m2:package — ${result.fileCount} file(s) inventoried; zip ${result.zipPath} ` +
          `(sha256 ${result.zipSha256}); secret scan clean`,
      );
      return 0;
    }
    case 'pilot': {
      console.error(
        'm2:pilot is not runnable in Phase 3: the pilot (brief §31 Phase 6) requires the M2 ' +
          'per-decision condition (Phase 4) and the policy system (Phase 5). This command exists ' +
          'so the §19.2 surface is stable; it will gain a plan when Phase 6 is authorized.',
      );
      return 1;
    }
    default:
      console.error('usage: m2 <orchestrate|evaluate|package|pilot> …');
      return 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`m2 CLI failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
