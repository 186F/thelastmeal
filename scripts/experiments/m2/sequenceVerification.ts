import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateLedgerFile } from '../../../src/sim/replay/validateLedger';
import { buildBehaviorFingerprints } from '../../../src/sim/evaluation/behaviorFingerprint';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { loadEvaluationEvidence, enrichFingerprintSet } from '../../evaluation/evidence';
import type { OrchestratorPlan } from './planSchema';
import { verifyFinalManifestTreatment } from './runFinalizer';
import {
  readInventory,
  verifyCompletedArchive,
  verifyTreeAgainstInventory,
} from './packageEvidence';
import { verifySealedExecutions, type SequenceState } from './sequenceState';
import { sequenceManifestSchema } from './reporting';

/**
 * Resume-time evidence verification (Phase 3 re-audit findings 1 and 5).
 *
 * Seals prove evidence is UNCHANGED since completion; they do not prove it
 * remains INTERPRETABLE under the installed evidence contracts. Both are
 * required before any resume skips a completed execution:
 *
 *  - semantic revalidation re-runs the actual validators — deterministic
 *    ledger validation, strict-finalized bundle integrity with the exact
 *    trace-to-ledger join, fingerprint recomputation compared byte-for-
 *    byte, and the final-manifest treatment cross-check;
 *  - completed-sequence verification additionally proves the whole root
 *    still matches its inventory (the sequence-level seal), the final
 *    evidence manifest parses, and the archive + sidecar + receipt agree
 *    and extract cleanly to the inventoried content.
 *
 * Everything here is READ-ONLY; every failure is a typed refusal.
 */

function findLedgerFile(attemptDir: string): string {
  const candidates = readdirSync(attemptDir).filter(
    (name) => name.startsWith('ledger-') && name.endsWith('.json'),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `resume-semantic-invalid: expected exactly one ledger-*.json in ${attemptDir}, ` +
        `found ${candidates.length}`,
    );
  }
  return join(attemptDir, candidates[0]!);
}

/** Re-runs the semantic validators for every COMPLETED execution
 * (re-audit finding 5, §9.2). */
export function revalidateCompletedExecutions(
  sequenceRoot: string,
  state: SequenceState,
  plan: OrchestratorPlan,
): void {
  for (const execution of state.executions) {
    if (execution.status !== 'completed') continue;
    const attempt = plan.attempts.find((entry) => entry.attemptId === execution.attemptId);
    if (!attempt) {
      throw new Error(
        `resume-semantic-invalid: ${execution.executionId} has no planned attempt ` +
          `'${execution.attemptId}' in the identity-matched plan`,
      );
    }
    const attemptDir = join(sequenceRoot, execution.dir);
    const fingerprintPath = join(attemptDir, 'behavior-fingerprint.json');
    if (!existsSync(fingerprintPath)) {
      throw new Error(`resume-semantic-invalid: ${execution.executionId} has no fingerprint`);
    }
    const storedFingerprint = readFileSync(fingerprintPath, 'utf8');

    if (attempt.conditionId === 'deterministic-baseline-v1') {
      const validation = validateLedgerFile(readFileSync(findLedgerFile(attemptDir), 'utf8'));
      if (!validation.ok || !validation.file) {
        throw new Error(
          `resume-semantic-invalid: ${execution.executionId} deterministic ledger no longer validates`,
        );
      }
      const recomputed = canonicalSerialize(buildBehaviorFingerprints(validation.file));
      if (recomputed !== storedFingerprint) {
        throw new Error(
          `resume-semantic-invalid: ${execution.executionId} fingerprint recomputation differs`,
        );
      }
    } else {
      if (execution.runId === null) {
        throw new Error(`resume-semantic-invalid: ${execution.executionId} has no run id`);
      }
      const runDir = join(attemptDir, 'gateway', execution.runId);
      const evidence = loadEvaluationEvidence(runDir);
      if (evidence.kind !== 'strict-finalized-run') {
        throw new Error(
          `resume-semantic-invalid: ${execution.executionId} run directory is no longer a ` +
            `strict-finalized run (${evidence.kind})`,
        );
      }
      const recomputed = canonicalSerialize(
        enrichFingerprintSet(buildBehaviorFingerprints(evidence.file), evidence.enrichment),
      );
      if (recomputed !== storedFingerprint) {
        throw new Error(
          `resume-semantic-invalid: ${execution.executionId} enriched fingerprint recomputation differs`,
        );
      }
      verifyFinalManifestTreatment(
        runDir,
        plan.expectedTreatment,
        attempt.gatewayMode === 'live' ? 'live' : 'fake',
      );
    }
  }
}

/**
 * Full completed-sequence verification for the no-op resume path
 * (re-audit finding 1, §5.3): execution seals, root-vs-inventory byte
 * equality, manifest parse, semantic revalidation, and archive + sidecar
 * + receipt agreement with extraction verification.
 */
export async function verifyCompletedSequence(
  sequenceRoot: string,
  state: SequenceState,
  plan: OrchestratorPlan,
): Promise<void> {
  verifySealedExecutions(sequenceRoot, state);

  const inventory = readInventory(sequenceRoot);
  if (!inventory) {
    throw new Error('completed-resume-verification-failed: sha256-inventory.json missing');
  }
  if (state.inventoryAggregateSha256 !== inventory.aggregateSha256) {
    throw new Error(
      `completed-resume-verification-failed: inventory aggregate ${inventory.aggregateSha256} ` +
        `!= recorded ${String(state.inventoryAggregateSha256)}`,
    );
  }
  verifyTreeAgainstInventory(sequenceRoot, inventory, 'completed-root');

  const manifestPath = join(sequenceRoot, 'sequence-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('completed-resume-verification-failed: sequence-manifest.json missing');
  }
  const manifest = sequenceManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!manifest.attemptSetComplete || manifest.sequenceId !== state.sequenceId) {
    throw new Error(
      'completed-resume-verification-failed: final evidence manifest does not describe a ' +
        `complete attempt set for ${state.sequenceId}`,
    );
  }

  revalidateCompletedExecutions(sequenceRoot, state, plan);

  if (state.archivePath === null || state.archiveSha256 === null) {
    throw new Error('completed-resume-verification-failed: no archive recorded in state');
  }
  await verifyCompletedArchive({
    zipPath: state.archivePath,
    expectedSha256: state.archiveSha256,
    inventory,
    receiptMeta: {
      sequenceId: state.sequenceId,
      planSha256: state.planSha256,
      repositorySha: state.repositorySha,
      studyPlanSha256: state.studyPlanSha256 === 'none' ? null : state.studyPlanSha256,
    },
  });
}
