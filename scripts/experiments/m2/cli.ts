import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { hasFlag, readOption } from '../../cli/args';
import { orchestrateSequence } from './orchestrate';
import { evaluateFromState } from './evaluateSequence';
import {
  nextArchivePath,
  packageSequence,
  readInventory,
  verifyTreeAgainstInventory,
} from './packageEvidence';
import { readSequenceState, verifySealedExecutions, writeSequenceState } from './sequenceState';
import { readSequenceManifestFile, reconcileManifestWithState } from './sequenceVerification';

/**
 * Orchestrator command surface (M2 brief §19.2).
 *
 *   npm run m2:orchestrate -- --plan <path> [--resume] [--acknowledge-live-cost]
 *                              [--allow-sleep-risk] [--headed]
 *   npm run m2:evaluate    -- --sequence <sequence-root>
 *   npm run m2:package     -- --sequence <sequence-root> [--zip <path>]
 *   npm run m2:pilot        (refusal stub until Phase 7)
 *
 * `m2:orchestrate -- --resume` IS the resume command (§19.2 allows this in
 * place of a separate m2:resume, documented here and in the README):
 * identity-checked against the recorded sequence state, it marks
 * interrupted executions failed-preserved-and-sealed and continues from
 * the first incomplete attempt.
 *
 * A COMPLETED sequence root is immutable raw evidence (re-audit
 * finding 1): `m2:evaluate` writes its regenerated evaluation into a
 * versioned derived-output directory beside the root, and `m2:package`
 * verifies the root against its recorded inventory and produces the NEXT
 * versioned archive — it never rewrites evidence or an existing archive.
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
      const root = resolve(repoRoot, sequenceRoot);
      const state = readSequenceState(root);
      if (!state) throw new Error(`sequence-state-missing: ${root}`);
      let outputPath: string;
      if (state.status === 'completed') {
        // Completed roots are immutable: derived output goes beside them.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const derivedDir = join(`${root}.derived`, `evaluation-${stamp}`);
        mkdirSync(derivedDir, { recursive: true });
        outputPath = join(derivedDir, 'sequence-evaluation.json');
      } else {
        outputPath = join(root, 'sequence-evaluation.json');
      }
      const evaluation = evaluateFromState(root, state, outputPath);
      console.log(
        `m2:evaluate — ${evaluation.sequenceId}: ${evaluation.completedExecutions.length} completed ` +
          `execution(s), ${evaluation.comparisons.length} comparison(s), ` +
          `${evaluation.skippedPairs.length} skipped pair(s); wrote ${outputPath}`,
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
      // Standalone packaging requires a COMPLETED, seal-valid,
      // inventory-intact sequence (audit finding 7.6; re-audit finding 1):
      // arbitrary or mutated directories are refused.
      const state = readSequenceState(root);
      if (!state) throw new Error(`package-requires-sequence-state: ${root}`);
      if (state.status !== 'completed') {
        throw new Error(`package-requires-completed-sequence: status is '${state.status}'`);
      }
      verifySealedExecutions(root, state);
      const inventory = readInventory(root);
      if (!inventory) throw new Error(`package-requires-inventory: ${root}`);
      if (state.inventoryAggregateSha256 !== inventory.aggregateSha256) {
        throw new Error('package-inventory-disagrees-with-state');
      }
      verifyTreeAgainstInventory(root, inventory, 'm2:package');
      // The IMMUTABLE manifest is authoritative (focused re-audit
      // finding 4 + pre-push adversarial round): control state must
      // reconcile against it exactly, and the new receipt's identity
      // fields come from the MANIFEST — an edited control state can
      // neither pass nor author a receipt that contradicts the archived
      // manifest.
      const manifest = readSequenceManifestFile(root);
      reconcileManifestWithState(manifest, state, null);
      const zipOption = readOption(rest, 'zip');
      const zipPath = zipOption
        ? resolve(repoRoot, zipOption)
        : nextArchivePath(dirname(root), manifest.sequenceId);
      if (existsSync(zipPath)) {
        throw new Error(`archive-destination-exists: ${zipPath}`);
      }
      const result = await packageSequence(root, zipPath, {
        sequenceId: manifest.sequenceId,
        planSha256: manifest.planSha256,
        repositorySha: manifest.repositorySha,
        studyPlanSha256: manifest.studyPlanSha256 === 'none' ? null : manifest.studyPlanSha256,
      });
      // The operational state points at the NEWEST archive (re-audit §5.5);
      // prior versioned archives remain untouched beside it.
      state.archivePath = result.zipPath;
      state.archiveSha256 = result.zipSha256;
      state.lastTransition = 'repackaged';
      state.updatedAtUtc = new Date().toISOString();
      writeSequenceState(root, state);
      console.log(
        `m2:package — ${result.fileCount} file(s) verified against the recorded inventory; ` +
          `zip ${result.zipPath} (sha256 ${result.zipSha256}); receipt ${result.receiptPath}; secret scan clean`,
      );
      return 0;
    }
    case 'register': {
      const studyTemplate = readOption(rest, 'study-template');
      const planTemplate = readOption(rest, 'plan-template');
      const outDir = readOption(rest, 'out');
      if (!studyTemplate || !planTemplate || !outDir) {
        console.error(
          'usage: m2:register -- --study-template <path> --plan-template <path> --out <dir-outside-repo>',
        );
        return 1;
      }
      const { registerTemplates } = await import('./register');
      const result = registerTemplates(
        repoRoot,
        resolve(repoRoot, studyTemplate),
        resolve(repoRoot, planTemplate),
        outDir,
      );
      console.log(
        `m2:register — registered at HEAD ${result.headSha}\n` +
          `  study: ${result.registeredStudyPath}\n` +
          `    sha256 ${result.studySha256}\n` +
          `    configFingerprint ${result.studyConfigFingerprint}\n` +
          `  plan:  ${result.registeredPlanPath}\n` +
          `    sha256 ${result.planSha256}\n` +
          `Launch with m2:orchestrate -- --plan <registered plan path>. No run was started.`,
      );
      return 0;
    }
    case 'pilot': {
      console.error(
        'm2:pilot is not runnable in Phase 4: the pilot (brief §31 Phase 7, after the Phase 6 adversarial audit) requires ' +
          'the policy system (Phase 5). This command exists ' +
          'so the §19.2 surface is stable; it will gain a plan when Phase 7 is authorized.',
      );
      return 1;
    }
    default:
      console.error('usage: m2 <orchestrate|evaluate|package|register|pilot> …');
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
