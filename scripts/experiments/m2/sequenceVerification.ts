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
import {
  buildManifestRegistration,
  sequenceManifestSchema,
  type SequenceManifest,
} from './reporting';

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

/** Reads and schema-parses the immutable final evidence manifest; a
 * missing or malformed manifest is a typed refusal. */
export function readSequenceManifestFile(sequenceRoot: string): SequenceManifest {
  const manifestPath = join(sequenceRoot, 'sequence-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('completed-resume-verification-failed: sequence-manifest.json missing');
  }
  return sequenceManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
}

/**
 * Exact reconciliation of the IMMUTABLE sequence manifest against the
 * MUTABLE control state (focused re-audit finding 4 §7.2): the manifest is
 * authoritative. Every identity field, the full execution history — count,
 * order, IDs, terminal statuses, failure classes and stages, artifact and
 * study statuses, replacement dispositions, threshold verdicts, run IDs,
 * seal aggregates, navigation counts, browser provenance, verdicts, and
 * timestamps — and planned-attempt coverage must agree exactly. The
 * control state's freeze checkpoints must extend (never rewrite) the
 * manifest's: the pre/post-package and recovery checkpoints append AFTER
 * the manifest is written. Any divergence — a removed, added, reordered,
 * or edited execution, or a changed identity — is a typed read-only
 * refusal listing every disagreement.
 */
export function reconcileManifestWithState(
  manifest: SequenceManifest,
  state: SequenceState,
  /** Null when the caller has no identity-checked plan in hand (the
   * standalone `m2:package` command): the planned-attempt-coverage check
   * is skipped there — every other comparison still runs. */
  plan: OrchestratorPlan | null,
): void {
  const mismatches: string[] = [];
  const identityKeys = [
    'sequenceId',
    'planSha256',
    'repositorySha',
    'packageVersion',
    'experimentId',
    'experimentVersion',
    'promptVersion',
    'externalProviderId',
    'upstreamPlatform',
    'expectedModelId',
    'expectedServingProviderId',
    'studyId',
    'studyVersion',
    'studyPlanSha256',
    'thresholdProfileId',
    'thresholdProfileVersion',
    'registrationId',
    'registrationProvenanceSha256',
    'stageAPrerequisiteSha256',
    'configFingerprint',
  ] as const;
  for (const key of identityKeys) {
    if (manifest[key] !== state[key]) {
      mismatches.push(`${key}: manifest '${manifest[key]}' != state '${state[key]}'`);
    }
  }
  if (!manifest.attemptSetComplete) {
    mismatches.push('attemptSetComplete: manifest does not record a complete attempt set');
  }
  // Planned-attempt coverage under the AUTHORITATIVE manifest: every
  // planned attempt must hold a completed execution in the manifest.
  for (const attempt of plan?.attempts ?? []) {
    if (
      !manifest.executions.some(
        (execution) =>
          execution.attemptId === attempt.attemptId && execution.status === 'completed',
      )
    ) {
      mismatches.push(
        `attempt-coverage: planned attempt '${attempt.attemptId}' has no completed execution in the manifest`,
      );
    }
  }
  if (manifest.executions.length !== state.executions.length) {
    mismatches.push(
      `execution-count: manifest ${manifest.executions.length} != state ${state.executions.length}`,
    );
  } else {
    for (let index = 0; index < manifest.executions.length; index += 1) {
      const recorded = manifest.executions[index]!;
      const live = state.executions[index]!;
      const scalarChecks: Array<[string, unknown, unknown]> = [
        ['executionId', recorded.executionId, live.executionId],
        ['attemptId', recorded.attemptId, live.attemptId],
        ['status', recorded.status, live.status],
        ['failureReason', recorded.failureReason, live.failureReason],
        ['failureStage', recorded.failureStage, live.failureStage],
        ['artifactStatus', recorded.artifactStatus, live.artifactStatus],
        ['studyStatus', recorded.studyStatus, live.studyStatus],
        ['replacementDisposition', recorded.replacementDisposition, live.replacementDisposition],
        ['runId', recorded.runId, live.runId],
        ['dir', recorded.dir, live.dir],
        ['sealAggregateSha256', recorded.sealAggregateSha256, live.seal?.aggregateSha256 ?? null],
        ['navigationCount', recorded.navigationCount, live.navigationCount],
        ['startedAtUtc', recorded.startedAtUtc, live.startedAtUtc],
        ['endedAtUtc', recorded.endedAtUtc, live.endedAtUtc],
      ];
      for (const [field, fromManifest, fromState] of scalarChecks) {
        if (fromManifest !== fromState) {
          mismatches.push(
            `${recorded.executionId}.${field}: manifest '${String(fromManifest)}' != state '${String(fromState)}'`,
          );
        }
      }
      const deepChecks: Array<[string, unknown, unknown]> = [
        ['thresholdVerdicts', recorded.thresholdVerdicts, live.thresholdVerdicts],
        ['browserProvenance', recorded.browserProvenance, live.browserProvenance],
        ['verdicts', recorded.verdicts, live.verdicts],
      ];
      for (const [field, fromManifest, fromState] of deepChecks) {
        if (JSON.stringify(fromManifest) !== JSON.stringify(fromState)) {
          mismatches.push(`${recorded.executionId}.${field}: manifest and state disagree`);
        }
      }
    }
  }
  const checkpointPrefix = state.freezeCheckpoints.slice(0, manifest.freezeCheckpoints.length);
  if (JSON.stringify(checkpointPrefix) !== JSON.stringify(manifest.freezeCheckpoints)) {
    mismatches.push(
      'freezeCheckpoints: the manifest checkpoints are not a prefix of the control state checkpoints',
    );
  }
  // Registration attestation consistency (final targeted remediation C
  // §5.4): a registered sequence carries the block, an unregistered one
  // carries null, and the scalar bindings agree in both directions.
  if ((state.registrationId === 'none') !== (manifest.registration === null)) {
    mismatches.push('registration: manifest block presence disagrees with state registrationId');
  }
  if (manifest.registration !== null) {
    if (manifest.registration.registrationId !== state.registrationId) {
      mismatches.push('registration.registrationId: manifest and state disagree');
    }
    if (manifest.registration.provenanceSha256 !== state.registrationProvenanceSha256) {
      mismatches.push('registration.provenanceSha256: manifest and state disagree');
    }
    const statePrerequisite =
      state.stageAPrerequisiteSha256 === 'none' ? null : state.stageAPrerequisiteSha256;
    if (manifest.registration.stageAPrerequisiteSha256 !== statePrerequisite) {
      mismatches.push('registration.stageAPrerequisiteSha256: manifest and state disagree');
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`completed-manifest-state-divergence: ${mismatches.join('; ')}`);
  }
}

/**
 * Full completed-sequence verification for the no-op resume path
 * (re-audit finding 1, §5.3): execution seals, root-vs-inventory byte
 * equality, manifest parse WITH exact manifest-vs-state reconciliation
 * (the manifest is authoritative — focused re-audit finding 4), semantic
 * revalidation, and archive + sidecar + receipt agreement with extraction
 * verification.
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

  const manifest = readSequenceManifestFile(sequenceRoot);
  reconcileManifestWithState(manifest, state, plan);

  // Re-derive the registration attestation from the ARCHIVED records in
  // the root (hash-verified against control state on the way) and require
  // exact agreement with the immutable manifest (remediation C §5.4).
  const rederivedRegistration = buildManifestRegistration(sequenceRoot, state);
  if (JSON.stringify(rederivedRegistration) !== JSON.stringify(manifest.registration)) {
    throw new Error(
      'completed-resume-verification-failed: manifest registration block does not match the ' +
        'archived registration records',
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
