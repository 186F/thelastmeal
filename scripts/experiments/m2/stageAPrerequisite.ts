import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { M2_PER_DECISION_CONDITION_ID } from '../../../src/shared/m2Experiment';
import { BASELINE_CONDITION_ID } from '../../../src/shared/modelExperiment';
import { parsePlan, type OrchestratorPlan } from './planSchema';
import { readSequenceState, completedExecution, type SequenceState } from './sequenceState';
import { verifyCompletedSequence } from './sequenceVerification';

/**
 * The authenticated Stage A prerequisite (Phase 4 audit finding 2).
 *
 * The governing ruling (§3.5/§19.16) makes Stage A an acceptance GATE for
 * the R2 calibration study: both Stage A runs must pass, on the same
 * repository SHA the calibration will run at, before any calibration
 * observation is collected. This module converts that requirement from
 * prose into a typed, hash-bound record:
 *
 *  - `buildStageAPrerequisite` VERIFIES a completed Stage A sequence root
 *    end to end (identity-checked archived plan; every seal; strict
 *    inventory + tree bytes; immutable manifest reconciled against control
 *    state; semantic revalidation of every execution; archive, digest
 *    sidecar, and receipt) and then extracts the audit-specified facts
 *    into a canonical record — it never trusts a caller-supplied summary;
 *  - the record's SHA-256 is stamped into the registered calibration study
 *    and plan by `m2:register`, entering the study freeze projection and
 *    the plan configuration fingerprint — and through them the sequence
 *    resume identity and every freeze checkpoint;
 *  - any source, prompt, condition, treatment, profile, analyzer, or
 *    tracing change after Stage A moves HEAD, the prerequisite's
 *    `repositorySha` no longer matches, and calibration registration
 *    refuses until Stage A runs again.
 */

export const STAGE_A_PREREQUISITE_SCHEMA_VERSION = 'm2-stage-a-prerequisite-1.0.0';

const sha64 = z.string().regex(/^[0-9a-f]{64}$/);

export const stageAPrerequisiteSchema = z
  .object({
    prerequisiteSchemaVersion: z.literal(STAGE_A_PREREQUISITE_SCHEMA_VERSION),
    stageAStudyId: z.string().min(1),
    stageAStudyVersion: z.string().min(1),
    stageASequenceId: z.string().min(1),
    repositorySha: z.string().regex(/^[0-9a-f]{40}$/),
    packageVersion: z.string().min(1),
    experimentId: z.string().min(1),
    experimentVersion: z.string().min(1),
    attemptProfileId: z.string().min(1),
    attemptProfileVersion: z.string().min(1),
    baselineExecutionId: z.string().min(1),
    modelExecutionId: z.string().min(1),
    baselineConditionId: z.string().min(1),
    baselineGatewayMode: z.literal('off'),
    modelConditionId: z.string().min(1),
    modelGatewayMode: z.enum(['fake', 'live']),
    promptVersion: z.string().min(1),
    modelId: z.string().min(1),
    servingProviderId: z.string().min(1),
    sequenceManifestPath: z.string().min(1),
    sequenceManifestSha256: sha64,
    evidenceArchivePath: z.string().min(1),
    evidenceArchiveSha256: sha64,
    receiptPath: z.string().min(1),
    receiptSha256: sha64,
    artifactValidVerdicts: z.record(z.string(), z.literal('artifact-valid')),
    studyValidVerdicts: z.record(z.string(), z.literal('study-valid')),
    strictFinalizationVerdict: z.literal('completed'),
    replayVerdicts: z.record(z.string(), z.literal(true)),
    treatmentThresholdVerdicts: z.array(
      z
        .object({
          metric: z.string().min(1),
          npcId: z.string().min(1),
          value: z.number().int().nullable(),
          min: z.number().int(),
          pass: z.literal(true),
        })
        .strict(),
    ),
    /** The packaging transaction hard-fails on any secret finding before a
     * receipt can exist; a receipted archive is therefore the scan's
     * mechanical pass witness. */
    secretScanVerdict: z.literal('enforced-by-receipted-packaging'),
    inventoryAggregateSha256: sha64,
  })
  .strict();

export type StageAPrerequisite = z.infer<typeof stageAPrerequisiteSchema>;

export interface BuiltStageAPrerequisite {
  record: StageAPrerequisite;
  recordBytes: string;
  recordSha256: string;
}

/** The registered Stage A identity a calibration registration must consume
 * (Phase 4 re-audit): SHA equality alone would accept ANY completed
 * two-attempt sequence at the right HEAD; this pins the evidence to the
 * study, version, sequence, and attempt profile of the closed-registry
 * `stage-a` registration. */
export interface StageAExpectedIdentity {
  stageARegistrationId: string;
  studyId: string;
  studyVersion: string;
  sequenceId: string;
  attemptProfileId: string;
  attemptProfileVersion: string;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function refuse(detail: string): never {
  throw new Error(`stage-a-prerequisite-refused: ${detail}`);
}

/**
 * Verifies a completed Stage A root and builds its prerequisite record.
 *
 * `options.expectedHeadSha` is the repository SHA the CALIBRATION
 * registration is happening at: the Stage A evidence must have been
 * produced at exactly that SHA. `options.requireLiveModel` is true for the
 * real calibration registration (the ruling's Stage A run 2 is a LIVE
 * run); keyless drills pass false to exercise every verification path
 * against fake-gateway evidence and separately assert the live-mode
 * refusal. `options.expectedIdentity` is the registered Stage A identity
 * this evidence must carry (null only for keyless drills, whose roots are
 * non-evidentiary by construction and whose drill mode is recorded in the
 * registration provenance).
 */
export async function buildStageAPrerequisite(options: {
  stageARoot: string;
  expectedHeadSha: string;
  requireLiveModel: boolean;
  expectedIdentity: StageAExpectedIdentity | null;
}): Promise<BuiltStageAPrerequisite> {
  const { stageARoot, expectedHeadSha, requireLiveModel, expectedIdentity } = options;

  const archivedPlanPath = join(stageARoot, 'plan.archived.json');
  if (!existsSync(archivedPlanPath)) refuse(`no archived plan at ${archivedPlanPath}`);
  const loaded = parsePlan(readFileSync(archivedPlanPath));
  const plan: OrchestratorPlan = loaded.plan;

  const state: SequenceState | null = readSequenceState(stageARoot);
  if (state === null) refuse('no sequence state (control root missing or unreadable)');
  if (state.status !== 'completed') refuse(`sequence status is '${state.status}', not completed`);
  if (state.planSha256 !== loaded.planSha256) {
    refuse('archived plan bytes do not match the recorded plan hash');
  }

  // Structural shape: exactly the two Stage A attempts.
  if (plan.attempts.length !== 2)
    refuse(`expected exactly 2 attempts, plan has ${plan.attempts.length}`);
  const baselineAttempt = plan.attempts.find(
    (attempt) => attempt.conditionId === BASELINE_CONDITION_ID,
  );
  const modelAttempt = plan.attempts.find(
    (attempt) => attempt.conditionId === M2_PER_DECISION_CONDITION_ID,
  );
  if (!baselineAttempt) refuse('no deterministic-baseline attempt in the archived plan');
  if (!modelAttempt) refuse('no M2 per-decision attempt in the archived plan');
  if (baselineAttempt.gatewayMode !== 'off') {
    refuse(`baseline attempt gateway mode is '${baselineAttempt.gatewayMode}', not off`);
  }
  if (modelAttempt.gatewayMode === 'off') refuse('model attempt ran without a gateway');
  if (requireLiveModel && modelAttempt.gatewayMode !== 'live') {
    refuse(
      `the ruling's Stage A run 2 is a LIVE run; this evidence used gateway mode '${modelAttempt.gatewayMode}'`,
    );
  }

  // The complete cryptographic verification pipeline: seals, inventory
  // (strictly validated, aggregate recomputed), tree bytes, immutable
  // manifest reconciliation, semantic revalidation of every execution,
  // archive + sidecar + receipt + extraction. Everything below only READS
  // facts this call has already proven.
  await verifyCompletedSequence(stageARoot, state, plan);

  if (state.repositorySha !== expectedHeadSha) {
    refuse(
      `Stage A ran at ${state.repositorySha}; calibration registration is at ${expectedHeadSha} — ` +
        'any change after Stage A requires Stage A to run again',
    );
  }

  // Identity binding (checked only AFTER verification proved the state
  // trustworthy): the evidence must BE the registered Stage A sequence,
  // not merely a completed two-attempt sequence at the right SHA.
  if (expectedIdentity !== null) {
    const identityChecks: readonly [field: string, actual: string, required: string][] = [
      ['studyId', state.studyId, expectedIdentity.studyId],
      ['studyVersion', state.studyVersion, expectedIdentity.studyVersion],
      ['sequenceId', state.sequenceId, expectedIdentity.sequenceId],
      ['attemptProfileId', state.thresholdProfileId, expectedIdentity.attemptProfileId],
      [
        'attemptProfileVersion',
        state.thresholdProfileVersion,
        expectedIdentity.attemptProfileVersion,
      ],
    ];
    for (const [field, actual, required] of identityChecks) {
      if (actual !== required) {
        refuse(
          `Stage A identity mismatch: ${field} is '${actual}', the registered ` +
            `'${expectedIdentity.stageARegistrationId}' registration requires '${required}'`,
        );
      }
    }
  }

  const baselineExecution = completedExecution(state, baselineAttempt.attemptId);
  const modelExecution = completedExecution(state, modelAttempt.attemptId);
  if (!baselineExecution) refuse('baseline attempt has no completed execution');
  if (!modelExecution) refuse('model attempt has no completed execution');

  const artifactValidVerdicts: Record<string, 'artifact-valid'> = {};
  const studyValidVerdicts: Record<string, 'study-valid'> = {};
  const replayVerdicts: Record<string, true> = {};
  for (const execution of [baselineExecution, modelExecution]) {
    if (execution.artifactStatus !== 'artifact-valid') {
      refuse(`${execution.executionId} artifactStatus is ${String(execution.artifactStatus)}`);
    }
    if (execution.studyStatus !== 'study-valid') {
      refuse(`${execution.executionId} studyStatus is ${String(execution.studyStatus)}`);
    }
    if (execution.verdicts['replay-match'] !== true) {
      refuse(`${execution.executionId} has no replay-match verdict`);
    }
    artifactValidVerdicts[execution.executionId] = 'artifact-valid';
    studyValidVerdicts[execution.executionId] = 'study-valid';
    replayVerdicts[execution.executionId] = true;
  }
  if (modelExecution.verdicts['strict-finalized'] !== 'completed') {
    refuse(
      `model execution strict finalization is ${String(modelExecution.verdicts['strict-finalized'])}`,
    );
  }
  const thresholdVerdicts = modelExecution.thresholdVerdicts ?? [];
  if (thresholdVerdicts.length === 0) refuse('model execution has no treatment-threshold verdicts');
  for (const verdict of thresholdVerdicts) {
    if (!verdict.pass) {
      refuse(`treatment threshold ${verdict.metric} failed (${String(verdict.value)})`);
    }
  }

  if (state.archivePath === null || state.archiveSha256 === null) {
    refuse('completed state records no archive');
  }
  if (state.inventoryAggregateSha256 === null)
    refuse('completed state records no inventory aggregate');
  const manifestPath = join(stageARoot, 'sequence-manifest.json');
  const receiptPath = `${state.archivePath}.receipt.json`;
  if (!existsSync(receiptPath)) refuse(`no receipt at ${receiptPath}`);

  const record: StageAPrerequisite = {
    prerequisiteSchemaVersion: STAGE_A_PREREQUISITE_SCHEMA_VERSION,
    stageAStudyId: state.studyId,
    stageAStudyVersion: state.studyVersion,
    stageASequenceId: state.sequenceId,
    repositorySha: state.repositorySha,
    packageVersion: state.packageVersion,
    experimentId: state.experimentId,
    experimentVersion: state.experimentVersion,
    attemptProfileId: state.thresholdProfileId,
    attemptProfileVersion: state.thresholdProfileVersion,
    baselineExecutionId: baselineExecution.executionId,
    modelExecutionId: modelExecution.executionId,
    baselineConditionId: baselineAttempt.conditionId,
    baselineGatewayMode: 'off',
    modelConditionId: modelAttempt.conditionId,
    modelGatewayMode: modelAttempt.gatewayMode,
    promptVersion: state.promptVersion,
    modelId: state.expectedModelId,
    servingProviderId: state.expectedServingProviderId,
    sequenceManifestPath: manifestPath,
    sequenceManifestSha256: sha256(readFileSync(manifestPath)),
    evidenceArchivePath: state.archivePath,
    evidenceArchiveSha256: state.archiveSha256,
    receiptPath,
    receiptSha256: sha256(readFileSync(receiptPath)),
    artifactValidVerdicts,
    studyValidVerdicts,
    strictFinalizationVerdict: 'completed',
    replayVerdicts,
    treatmentThresholdVerdicts: thresholdVerdicts.map((verdict) => ({
      metric: verdict.metric,
      npcId: verdict.npcId,
      value: verdict.value,
      min: verdict.min,
      pass: true as const,
    })),
    secretScanVerdict: 'enforced-by-receipted-packaging',
    inventoryAggregateSha256: state.inventoryAggregateSha256,
  };

  const parsed = stageAPrerequisiteSchema.parse(record);
  const recordBytes = canonicalSerialize(parsed);
  return { record: parsed, recordBytes, recordSha256: sha256(recordBytes) };
}
