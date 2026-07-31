import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
// The sequence identity records the experiment of the plan's model-backed
// condition (Phase 4): Milestone 1 plans record model-backed-npc-001, M2
// per-decision plans record sparse-cognition-policy-001. Deterministic-only
// plans keep recording the M1 experiment, preserving Phase 3 behavior.
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
  MODEL_UPSTREAM_PLATFORM,
} from '../../../src/shared/modelExperiment';
import {
  isModelBackedConditionId,
  requireContractForCondition,
} from '../../../src/shared/conditionContract';
import {
  BEHAVIOR_FINGERPRINT_VERSION,
  BEHAVIOR_SIMILARITY_VERSION,
} from '../../../src/shared/behaviorArtifacts';
import {
  INSTALLED_ANALYSIS_VERSIONS,
  M2_CALIBRATION_ANALYSIS_VERSION,
  M2_STAGE_A_ACCEPTANCE_GATES_VERSION,
} from '../../../src/shared/calibrationAnalysis';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { fnv1a64Hex } from '../../../src/sim/replay/hash';
import { validateStudyFile } from './studyRegistry';
import {
  parsePlan,
  type LoadedPlan,
  type OrchestratorPlan,
  type PlannedAttempt,
} from './planSchema';
import {
  assertResumable,
  assertResumeIdentity,
  completedExecution,
  markInterruptedExecutions,
  nextExecutionId,
  readSequenceState,
  sealExecution,
  verifySealedExecutions,
  writeSequenceState,
  controlRoot,
  SEQUENCE_STATE_VERSION,
  type AttemptExecution,
  type BrowserProvenance,
  type ResumeIdentity,
} from './sequenceState';
import { ProcessManager, classifyChildTerminalState, type ManagedProcess } from './processManager';
import { startGateway, portIsFree, tsxCliPath } from './gatewayDriver';
import {
  AUTOMATION_GATEWAY_PORT,
  AUTOMATION_GATEWAY_URL,
  AUTOMATION_ORIGIN,
  AUTOMATION_VITE_PORT,
  startVite,
} from './viteDriver';
import { DEFAULT_TRACE_CHUNK_INTERVAL_MS, runBrowserAttempt } from './browserDriver';
import {
  AttemptFailure,
  FAILURE_TAXONOMY_VERSION,
  assessReplacementDisposition,
} from './failureTaxonomy';
import { evaluateTreatmentThresholds, type AttemptProfile } from './attemptProfile';
import { reconcileStudyWithPlan } from './studyReconciliation';
import {
  finalizeDeterministicAttempt,
  finalizeModelAttempt,
  guardStage,
  readBudgetExhaustedCalls,
  verifyFinalManifestTreatment,
} from './runFinalizer';
import { evaluateFromState, type SequenceEvaluation } from './evaluateSequence';
import {
  findUnreceiptedArchives,
  nextArchivePath,
  packageSequence,
  readInventory,
  removeStaleStagedArchives,
  verifyTreeAgainstInventory,
  type PackagingStage,
} from './packageEvidence';
import { writeSequenceManifest, writeSequenceReport, type SequenceFinalFacts } from './reporting';
import {
  readSequenceManifestFile,
  reconcileManifestWithState,
  revalidateCompletedExecutions,
  verifyCompletedSequence,
} from './sequenceVerification';
import { acquireKeepAwake, type KeepAwakeLease } from './keepAwake';
import {
  batchChildEnv,
  browserChildEnv,
  fakeGatewayEnv,
  helperEnv,
  liveGatewayEnv,
} from './childEnv';

/**
 * The unattended sequence orchestrator (M2 brief §19), remediated per the
 * Phase 3 audit and re-audit:
 *
 *  - refused invocations are observationally read-only; resume inspects
 *    recorded replacement DISPOSITIONS, so a non-retryable failure can
 *    never be revived by a process restart (re-audit finding 3);
 *  - the registered study declaration is semantically RECONCILED with the
 *    plan and effective attempts, its exact bytes and freeze record are
 *    archived into the evidence root, and both join every freeze check
 *    (re-audit finding 2);
 *  - attempts are judged under a versioned attempt profile separating
 *    artifact-valid from study-valid: an artifact below the registered
 *    treatment thresholds is preserved as `invalid-treatment` (finding 3);
 *  - the freeze check runs before/after every execution AND through the
 *    complete post-sequence pipeline — batch, evaluation, reporting,
 *    packaging, receipt (finding 4);
 *  - every TERMINAL execution is sealed; completed evidence is
 *    semantically revalidated on resume; a completed sequence root is
 *    immutable and its archive, receipt, and inventory are verified before
 *    a no-op resume returns success (findings 1 and 5);
 *  - mutable operational state lives in the control root BESIDE the
 *    evidence root, so nothing inventoried changes after packaging;
 *    archives are versioned, staged on the destination volume, and
 *    committed by atomic rename with the receipt written last (findings 1
 *    and 7);
 *  - every non-live-gateway child — Vite, batch, fake gateway, keep-awake,
 *    archive helpers, git, taskkill — runs under the nonsecret helper
 *    environment; keep-awake is live-only and exception-safe (finding 6).
 */

export interface OrchestrateOptions {
  planPath: string;
  resume: boolean;
  acknowledgeLiveCost: boolean;
  allowSleepRisk: boolean;
  headed: boolean;
  repoRoot: string;
  /** Packaging-stage hook threaded into the packaging transaction
   * (focused re-audit finding 3 §6.4): a throw drills that stage's
   * failure. Used by the rehearsal's recovery drill and the failure-
   * injection tests; absent in normal operation. */
  onPackagingStage?: (stage: PackagingStage) => void;
  /** Determinism seam for the recovery lock-ordering race drills (final
   * audit blocker 3 §5.4): fires after the recovery dispatch decides this
   * invocation is packaging-ready, immediately BEFORE the writer lock is
   * acquired — a drill can run a competing invocation or mutate state here
   * and the post-lock re-read must observe it. Absent in normal operation. */
  onBeforeRecoveryLock?: () => void | Promise<void>;
}

export interface OrchestrateResult {
  sequenceRoot: string;
  status: 'completed' | 'failed';
  executions: number;
  failedExecutions: number;
  zipPath: string | null;
  noOpResume: boolean;
  /** True when the invocation took the packaging-only recovery path
   * (focused re-audit finding 3): no Vite, Chromium, or gateway process
   * was launched and no inventoried evidence byte was written. */
  packagingRecovery: boolean;
}

/** Default per-sequence evidence budget (re-audit §13.4). */
export const DEFAULT_EVIDENCE_BUDGET_BYTES = 8 * 1024 * 1024 * 1024;

function nowUtc(): string {
  return new Date().toISOString();
}

/** Git helpers run under the nonsecret helper environment (re-audit
 * finding 6): an exported key never reaches the git child processes. */
function headSha(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: helperEnv(process.env),
  }).trim();
}

function worktreeDirty(repoRoot: string): boolean {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: helperEnv(process.env),
  });
  return status.trim() !== '';
}

function packageVersion(repoRoot: string): string {
  return (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string })
    .version;
}

function lockfileVersions(repoRoot: string): { version: string; rootPackageVersion: string } {
  const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as {
    version: string;
    packages?: Record<string, { version?: string }>;
  };
  return {
    version: lock.version,
    rootPackageVersion: lock.packages?.['']?.version ?? '(missing)',
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Nonsecret configuration fingerprint over the plan's frozen fields
 * (identity §19.11): everything that shapes execution, excluding prose and
 * the output location. */
export function planConfigFingerprint(plan: OrchestratorPlan): string {
  return fnv1a64Hex(
    canonicalSerialize({
      planSchemaVersion: plan.planSchemaVersion,
      sequenceId: plan.sequenceId,
      evidentiary: plan.evidentiary,
      attempts: plan.attempts,
      attemptProfile: plan.attemptProfile,
      expectedTreatment: plan.expectedTreatment ?? null,
      study: plan.study ?? null,
      replacementPolicy: plan.replacementPolicy,
      liveCallBudget: plan.liveCallBudget,
      timeouts: plan.timeouts,
      postSequenceBatch: plan.postSequenceBatch,
      evidenceSizeBudgetBytes: plan.evidenceSizeBudgetBytes ?? null,
      tracing: plan.tracing ?? null,
      registration: plan.registration ?? null,
    }),
  );
}

function hasLiveAttempt(plan: OrchestratorPlan): boolean {
  return plan.attempts.some((attempt) => attempt.gatewayMode === 'live');
}

/** §19.14 acknowledgement gate (no writes, no spawns). */
function checkLiveAcknowledgement(plan: OrchestratorPlan, options: OrchestrateOptions): void {
  if (!hasLiveAttempt(plan)) return;
  if (process.env.M2_LIVE_RUNS !== '1' || !options.acknowledgeLiveCost) {
    throw new Error(
      'live-plan-not-acknowledged: a live plan requires BOTH M2_LIVE_RUNS=1 and --acknowledge-live-cost',
    );
  }
}

/**
 * Live-only keep-awake acquisition (re-audit finding 6, §10.4): the
 * acknowledgement gate runs FIRST, so a refused live launch never spawns
 * the helper; non-live plans never acquire one at all. The caller places
 * the returned lease in a `try/finally` that begins immediately after this
 * call.
 */
export async function acquireKeepAwakeForPlan(
  plan: OrchestratorPlan,
  options: OrchestrateOptions,
  acquire: typeof acquireKeepAwake = acquireKeepAwake,
): Promise<KeepAwakeLease | null> {
  if (!hasLiveAttempt(plan)) return null;
  checkLiveAcknowledgement(plan, options);
  const lease = await acquire();
  if (lease === null && !options.allowSleepRisk) {
    throw new Error(
      'keep-awake-unavailable: no sleep-inhibition lease could be established — ' +
        'rerun with --allow-sleep-risk to accept the risk for a live plan',
    );
  }
  if (lease === null) {
    console.warn('WARNING: no keep-awake lease could be established — the machine may sleep.');
  }
  return lease;
}

/** §19.14 record: create-once and immutable. On resume the existing file is
 * verified byte-for-byte, never rewritten (audit finding 4). */
function recordLiveAcknowledgement(plan: OrchestratorPlan, sequenceRoot: string): void {
  if (!hasLiveAttempt(plan) && plan.expectedTreatment === undefined) return;
  const liveAttempts = plan.attempts.filter((attempt) => attempt.gatewayMode === 'live');
  const acknowledgement = `${JSON.stringify(
    {
      plannedLiveAttempts: liveAttempts.length,
      maxReplacementAttempts: plan.replacementPolicy.maxReplacementAttempts,
      perAttemptCaps: liveAttempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        maxCallsPerRun: attempt.maxCallsPerRun ?? null,
        maxTotalCalls: attempt.maxTotalCalls ?? null,
      })),
      acknowledgedLiveCallBudget: plan.liveCallBudget,
      expectedModelId: plan.expectedTreatment?.modelId ?? null,
      expectedServingProviderId: plan.expectedTreatment?.servingProviderId ?? null,
      expectedPromptVersion: plan.expectedTreatment?.promptVersion ?? null,
      note: 'expected values are gateway-verified before Start; the orchestrator never reads gateway credentials',
    },
    null,
    2,
  )}\n`;
  const path = join(sequenceRoot, 'cost-acknowledgement.json');
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== acknowledgement) {
      throw new Error('cost-acknowledgement-immutable: existing acknowledgement differs');
    }
    return;
  }
  console.log(`live interlocks: ${acknowledgement.trim()}`);
  writeFileSync(path, acknowledgement, 'utf8');
}

/** Exclusive single-writer lock in the CONTROL root (re-audit finding 1):
 * never part of the packaged evidence tree. */
function acquireSequenceLock(sequenceRoot: string): () => void {
  const lockPath = join(controlRoot(sequenceRoot), 'sequence.lock');
  mkdirSync(controlRoot(sequenceRoot), { recursive: true });
  const token = `${process.pid}:${Math.floor(Math.random() * 1e9)}`;
  try {
    writeFileSync(lockPath, token, { flag: 'wx' });
  } catch {
    const holder = readFileSync(lockPath, 'utf8').trim();
    const holderPid = Number(holder.split(':')[0]);
    let holderAlive = false;
    try {
      process.kill(holderPid, 0);
      holderAlive = true;
    } catch {
      holderAlive = false;
    }
    if (holderAlive) {
      throw new Error(
        `sequence-locked: ${lockPath} held by live pid ${holderPid} — a sequence has exactly one writer`,
      );
    }
    rmSync(lockPath, { force: true });
    writeFileSync(lockPath, token, { flag: 'wx' });
  }
  return () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === token) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // lock release must never throw.
    }
  };
}

/** The exact bytes of the archived study freeze record (focused re-audit
 * finding 4 §7.1): one shared constructor for the writer and every freeze
 * check, so the record's frozen form is defined once. */
export function studyFreezeRecordContent(study: {
  studyId: string;
  studyVersion: string;
  studyPlanSha256: string;
  studyConfigFingerprint: string;
}): string {
  return `${JSON.stringify(
    {
      studyId: study.studyId,
      studyVersion: study.studyVersion,
      planSha256: study.studyPlanSha256,
      configFingerprint: study.studyConfigFingerprint,
    },
    null,
    2,
  )}\n`;
}

/** Freeze identity (audit finding 3; re-audit findings 2 and 4; focused
 * re-audit finding 4): re-verified before AND after every execution and
 * through the COMPLETE post-sequence pipeline. Any drift invalidates the
 * work as `freeze-violation`. */
export interface FreezeIdentity {
  repositorySha: string;
  packageVersion: string;
  planSha256: string;
  requireCleanWorktree: boolean;
  configFingerprint: string;
  thresholdProfileId: string;
  thresholdProfileVersion: string;
  /** Study freeze (re-audit finding 2; focused re-audit finding 4 §7.1):
   * archived bytes, the freeze RECORD (exact bytes AND parsed fields), and
   * the external registered file are all rechecked at every checkpoint. */
  studyPlanSha256: string | null;
  studyPlanPathAbsolute: string | null;
  studyId: string | null;
  studyVersion: string | null;
  studyConfigFingerprint: string | null;
  studyFreezeRecordSha256: string | null;
}

export function checkFreeze(repoRoot: string, sequenceRoot: string, freeze: FreezeIdentity): void {
  const head = headSha(repoRoot);
  if (head !== freeze.repositorySha) {
    throw new Error(`freeze-violation: HEAD moved ${freeze.repositorySha} → ${head}`);
  }
  if (freeze.requireCleanWorktree && worktreeDirty(repoRoot)) {
    throw new Error('freeze-violation: tracked worktree is dirty');
  }
  const version = packageVersion(repoRoot);
  if (version !== freeze.packageVersion) {
    throw new Error(`freeze-violation: package version moved to ${version}`);
  }
  const lock = lockfileVersions(repoRoot);
  if (lock.version !== freeze.packageVersion || lock.rootPackageVersion !== freeze.packageVersion) {
    throw new Error(
      `freeze-violation: package-lock.json versions (${lock.version}/${lock.rootPackageVersion}) ` +
        `disagree with release ${freeze.packageVersion}`,
    );
  }
  const archivedPlan = join(sequenceRoot, 'plan.archived.json');
  if (!existsSync(archivedPlan) || sha256(readFileSync(archivedPlan)) !== freeze.planSha256) {
    throw new Error('freeze-violation: archived plan bytes missing or altered');
  }
  const reparsed = parsePlan(readFileSync(archivedPlan));
  if (planConfigFingerprint(reparsed.plan) !== freeze.configFingerprint) {
    throw new Error('freeze-violation: nonsecret configuration fingerprint moved');
  }
  if (
    reparsed.profile.profileId !== freeze.thresholdProfileId ||
    reparsed.profile.profileVersion !== freeze.thresholdProfileVersion
  ) {
    throw new Error(
      `freeze-violation: registered attempt profile moved to ` +
        `${reparsed.profile.profileId}@${reparsed.profile.profileVersion}`,
    );
  }
  if (freeze.studyPlanSha256 !== null) {
    const archivedStudy = join(sequenceRoot, 'study.archived.json');
    if (
      !existsSync(archivedStudy) ||
      sha256(readFileSync(archivedStudy)) !== freeze.studyPlanSha256
    ) {
      throw new Error('freeze-violation: archived study bytes missing or altered');
    }
    // The freeze RECORD is verified like every other frozen artifact
    // (focused re-audit finding 4 §7.1): parsed with each identity field
    // compared, AND its exact bytes hashed — a byte-level change that
    // preserves valid JSON and field values still violates.
    const freezeRecordPath = join(sequenceRoot, 'study.freeze.archived.json');
    if (!existsSync(freezeRecordPath)) {
      throw new Error('freeze-violation: archived study freeze record missing');
    }
    const recordBytes = readFileSync(freezeRecordPath);
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(recordBytes.toString('utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not-an-object');
      }
      record = parsed as Record<string, unknown>;
    } catch {
      throw new Error(
        'freeze-violation: archived study freeze record is not a parseable JSON object',
      );
    }
    const recordChecks: Array<[string, unknown, unknown]> = [
      ['studyId', record.studyId, freeze.studyId],
      ['studyVersion', record.studyVersion, freeze.studyVersion],
      ['planSha256', record.planSha256, freeze.studyPlanSha256],
      ['configFingerprint', record.configFingerprint, freeze.studyConfigFingerprint],
    ];
    for (const [field, actual, wanted] of recordChecks) {
      if (actual !== wanted) {
        throw new Error(
          `freeze-violation: archived study freeze record ${field} is '${String(actual)}', ` +
            `the frozen identity requires '${String(wanted)}'`,
        );
      }
    }
    if (
      freeze.studyFreezeRecordSha256 !== null &&
      sha256(recordBytes) !== freeze.studyFreezeRecordSha256
    ) {
      throw new Error('freeze-violation: archived study freeze record bytes altered');
    }
    if (
      freeze.studyPlanPathAbsolute !== null &&
      (!existsSync(freeze.studyPlanPathAbsolute) ||
        sha256(readFileSync(freeze.studyPlanPathAbsolute)) !== freeze.studyPlanSha256)
    ) {
      throw new Error(
        `freeze-violation: registered study file changed or vanished (${freeze.studyPlanPathAbsolute})`,
      );
    }
  }
}

/** Pre-Start treatment verification (audit finding 2): the gateway's public
 * nonsecret configuration must match the reviewed plan exactly. */
/**
 * The registered contract of the plan's single model-backed condition, or
 * null for deterministic-only plans. parsePlan already refuses plans mixing
 * model conditions, so the first model attempt determines the treatment.
 */
export function planModelContract(plan: OrchestratorPlan) {
  const modelAttempt = plan.attempts.find((attempt) =>
    isModelBackedConditionId(attempt.conditionId),
  );
  return modelAttempt === undefined ? null : requireContractForCondition(modelAttempt.conditionId);
}

/**
 * The experiment identity a sequence binds into its resume identity and
 * study reconciliation (Phase 4): the identity of the plan's model-backed
 * condition. Deterministic-only plans keep recording the Milestone 1
 * experiment — the frozen baseline is a regression fixture of that family,
 * and this preserves Phase 3 sequence identities byte-for-byte.
 */
export function planExperimentIdentity(plan: OrchestratorPlan): {
  experimentId: string;
  experimentVersion: string;
  promptVersion: string;
  externalProviderId: string;
  upstreamPlatform: string;
} {
  const contract = planModelContract(plan);
  if (contract === null) {
    return {
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      promptVersion: MODEL_PROMPT_VERSION,
      externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
      upstreamPlatform: MODEL_UPSTREAM_PLATFORM,
    };
  }
  return {
    experimentId: contract.experimentId,
    experimentVersion: contract.experimentVersion,
    promptVersion: contract.promptVersion,
    externalProviderId: contract.providerId,
    upstreamPlatform: contract.upstreamPlatform,
  };
}

async function verifyGatewayTreatment(plan: OrchestratorPlan): Promise<Record<string, string>> {
  const expected = plan.expectedTreatment;
  if (!expected) {
    throw new AttemptFailure(
      'treatment-verification-failed',
      'treatment verification requested without an expected treatment',
      'treatment-verification',
    );
  }
  let config: Record<string, unknown>;
  try {
    const response = await fetch(`${AUTOMATION_GATEWAY_URL}/v1/provider-config`);
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    config = (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new AttemptFailure(
      'treatment-verification-failed',
      `gateway provider-config unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'treatment-verification',
    );
  }
  // The provider id is not a plan field: it comes from the model-backed
  // condition's registered contract (Phase 4) — M1 plans verify the M1
  // provider, M2 plans the M2 provider.
  const expectedProviderId = planModelContract(plan)?.providerId ?? EXTERNAL_MARA_PROVIDER_ID;
  const checks: Array<[string, unknown, unknown]> = [
    ['modelId', config.modelId, expected.modelId],
    ['servingProviderId', config.servingProviderId, expected.servingProviderId],
    ['promptVersion', config.promptVersion, expected.promptVersion],
    ['conditionId', config.conditionId, expected.conditionId],
    ['experimentId', config.experimentId, expected.experimentId],
    ['experimentVersion', config.experimentVersion, expected.experimentVersion],
    ['providerId', config.providerId, expectedProviderId],
  ];
  for (const [field, actual, wanted] of checks) {
    if (actual !== wanted) {
      throw new AttemptFailure(
        'treatment-mismatch',
        `gateway ${field} is '${String(actual)}', reviewed plan requires '${String(wanted)}'`,
        'treatment-verification',
      );
    }
  }
  return {
    'verified-model': String(config.modelId),
    'verified-serving-provider': String(config.servingProviderId),
  };
}

/** Bounded tail of a text file, for failed-attempt context (finding 6). */
function tailOf(path: string, lines: number): string {
  try {
    const all = readFileSync(path, 'utf8').split('\n');
    return all.slice(Math.max(0, all.length - lines)).join('\n');
  } catch {
    return '(unavailable)';
  }
}

function directorySizeBytes(root: string): number {
  let total = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else total += stats.size;
    }
  };
  if (existsSync(root)) walk(root);
  return total;
}

/** Free bytes on the volume holding `path`, or null when the platform
 * cannot report it. */
function freeDiskBytes(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

interface AttemptOutcome {
  execution: AttemptExecution;
  failure: AttemptFailure | Error | null;
}

/**
 * Issues the PLANNED mid-run gateway stop (focused re-audit finding 1 +
 * pre-push adversarial round): a gateway that ALREADY exited before the
 * planned stop tick died unexpectedly — the trigger refuses instead of
 * absorbing the earlier death as a planned stop, so the stop evidence can
 * never attribute an external kill to the plan. `markIssued` runs only
 * when the gateway was alive at trigger time.
 */
export async function issuePlannedGatewayStop(
  processManager: ProcessManager,
  gateway: ManagedProcess,
  markIssued: () => void,
  graceMs = 5_000,
): Promise<string> {
  if (gateway.hasExited()) {
    throw new AttemptFailure(
      'gateway-died-unexpectedly',
      `gateway child already exited (${gateway.terminalOutcome() ?? 'unknown'}) before the ` +
        'planned stop tick — an external death is never a planned stop',
    );
  }
  markIssued();
  return processManager.stop(gateway, graceMs);
}

async function executeAttempt(
  browser: Browser,
  processManager: ProcessManager,
  plan: OrchestratorPlan,
  profile: AttemptProfile,
  attempt: PlannedAttempt,
  sequenceRoot: string,
  repoRoot: string,
  execution: AttemptExecution,
  evidenceForecast: { budgetBytes: number; rootBytesAtStart: number },
): Promise<AttemptOutcome> {
  const attemptDir = join(sequenceRoot, execution.dir);
  let gateway: ManagedProcess | null = null;
  let plannedStopIssued = false;
  const traceDir = join(attemptDir, 'gateway');
  try {
    try {
      mkdirSync(attemptDir, { recursive: true });
    } catch (setupError: unknown) {
      throw new AttemptFailure(
        'attempt-setup-failed',
        setupError instanceof Error ? setupError.message : String(setupError),
        'attempt-setup',
      );
    }

    if (attempt.gatewayMode !== 'off') {
      try {
        gateway = await startGateway(processManager, {
          mode: attempt.gatewayMode,
          port: AUTOMATION_GATEWAY_PORT,
          allowedBrowserOrigin: AUTOMATION_ORIGIN,
          // The fresh gateway child serves exactly the attempt's condition
          // pairing (Phase 4) — nonsecret identity, never a credential.
          servedConditionId: attempt.conditionId,
          traceDir,
          maxCallsPerRun: attempt.maxCallsPerRun,
          maxTotalCalls: attempt.maxTotalCalls,
          requestTimeoutMs: attempt.requestTimeoutMs,
          maxConcurrency: attempt.maxConcurrency,
          repoRoot,
          logPath: join(attemptDir, 'gateway.log'),
          env:
            attempt.gatewayMode === 'fake'
              ? fakeGatewayEnv(process.env)
              : liveGatewayEnv(process.env),
        });
      } catch (launchError: unknown) {
        throw new AttemptFailure(
          'gateway-launch-failed',
          launchError instanceof Error ? launchError.message : String(launchError),
          'gateway-launch',
        );
      }
      // Reviewed-treatment verification BEFORE any run starts (finding 2).
      const verified = await verifyGatewayTreatment(plan);
      for (const [key, value] of Object.entries(verified)) {
        execution.verdicts[key] = value;
      }
    }

    const runTimeoutMs =
      attempt.gatewayStopAtTick !== undefined
        ? (plan.timeouts.gatewayStopRunTimeoutMs ?? plan.timeouts.runTimeoutMs)
        : plan.timeouts.runTimeoutMs;
    const browserResult = await runBrowserAttempt(browser, {
      origin: AUTOMATION_ORIGIN,
      attempt,
      attemptDir,
      timeouts: { ...plan.timeouts, runTimeoutMs },
      tracing: plan.tracing,
      evidenceForecast,
      onGatewayStopTick:
        attempt.gatewayStopAtTick !== undefined && gateway !== null
          ? () =>
              issuePlannedGatewayStop(processManager, gateway!, () => {
                plannedStopIssued = true;
              })
          : undefined,
    });
    execution.navigationCount = browserResult.navigationCount;
    execution.verdicts['navigation-count'] = browserResult.navigationCount;

    // Planned-stop evidence (finding 8): a stop-planned attempt whose
    // trigger never fired is an invalid treatment observation.
    if (attempt.gatewayStopAtTick !== undefined) {
      execution.verdicts['gateway-stop'] = JSON.stringify(browserResult.gatewayStop);
      if (!browserResult.gatewayStop?.fired) {
        throw new AttemptFailure(
          'gateway-stop-not-fired',
          `planned stop at tick ${attempt.gatewayStopAtTick} never fired (final tick ${browserResult.finalTick})`,
        );
      }
    }
    // Unplanned gateway death (finding 8; focused re-audit finding 1): a
    // normal model attempt whose gateway child ended on its own — by
    // numeric exit OR by signal — is not a valid treatment observation,
    // however cleanly the fallbacks carried the run. Classification uses
    // terminal STATE, so a SIGTERM/SIGKILL-killed gateway cannot evade
    // detection behind a null numeric exit code.
    if (
      gateway &&
      classifyChildTerminalState(gateway, plannedStopIssued) === 'unexpected-terminal-exit'
    ) {
      throw new AttemptFailure(
        'gateway-died-unexpectedly',
        `gateway child exited (${gateway.terminalOutcome() ?? 'unknown'}) during a normal attempt`,
      );
    }

    // Stop the gateway BEFORE finalization (§19.4 order); harmless when the
    // planned stop already ended it.
    if (gateway) await processManager.stop(gateway, 5_000);

    execution.runId = browserResult.runId;
    execution.verdicts['replay-match'] = true;
    execution.verdicts['replay-verdict'] = browserResult.replayVerdict;
    execution.verdicts['final-tick'] = browserResult.finalTick;
    execution.verdicts['heartbeats'] = browserResult.heartbeatCount;
    execution.verdicts['console-errors'] = browserResult.consoleErrors.length;
    execution.artifacts.push(`${execution.dir}/heartbeat.jsonl`);

    if (attempt.conditionId === 'deterministic-baseline-v1') {
      finalizeDeterministicAttempt(attemptDir, browserResult.ledgerPath);
      execution.verdicts['ledger-validated'] = true;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(`${execution.dir}/behavior-fingerprint.json`);
      execution.artifactStatus = 'artifact-valid';
      // Deterministic attempts have no upstream treatment; the artifact
      // gates ARE the applicable profile gates.
      execution.thresholdVerdicts = [];
      execution.studyStatus = 'study-valid';
    } else {
      if (browserResult.runId === null || browserResult.bundlePath === null) {
        throw new AttemptFailure(
          'model-evidence-incomplete',
          `runId=${String(browserResult.runId)}, bundle=${String(browserResult.bundlePath)}`,
        );
      }
      const evidence = finalizeModelAttempt({
        attemptDir,
        traceDir,
        runId: browserResult.runId,
        ledgerPath: browserResult.ledgerPath,
        bundlePath: browserResult.bundlePath,
      });
      verifyFinalManifestTreatment(
        evidence.runDir,
        plan.expectedTreatment,
        attempt.gatewayMode === 'live' ? 'live' : 'fake',
      );
      execution.verdicts['strict-finalized'] = evidence.finalize.status;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(
        `${execution.dir}/gateway/${browserResult.runId}/bundle-manifest.json`,
        `${execution.dir}/behavior-fingerprint.json`,
      );
      execution.artifactStatus = 'artifact-valid';
      // Study-validity thresholds under the bound profile (re-audit
      // finding 3): an artifact-valid run below them is preserved as
      // invalid-treatment, never completed primary evidence.
      const thresholds = evaluateTreatmentThresholds(profile, evidence.fingerprints);
      execution.thresholdVerdicts = thresholds.verdicts;
      if (!thresholds.pass) {
        execution.studyStatus = 'invalid-treatment';
        const failing = thresholds.verdicts
          .filter((verdict) => !verdict.pass)
          .map((verdict) => `${verdict.metric}=${String(verdict.value)}<${verdict.min}`)
          .join('; ');
        throw new AttemptFailure(
          'invalid-treatment',
          `artifact-valid but below registered thresholds (${failing})`,
          'treatment-thresholds',
        );
      }
      // §23.1 per-run integrity gate (registered on the FORMAL profile):
      // a primary run with any budget-exhausted upstream call is preserved
      // as invalid-treatment, never completed primary evidence. The planned
      // gateway-stop run is exempt (§23.8) — its post-stop failures are the
      // drill's intended shape, not treatment evidence.
      if (
        profile.artifactGates.includes('no-budget-exhausted-failure') &&
        attempt.gatewayStopAtTick === undefined
      ) {
        const budgetExhausted = readBudgetExhaustedCalls(evidence.runDir);
        if (budgetExhausted > 0) {
          execution.studyStatus = 'invalid-treatment';
          throw new AttemptFailure(
            'invalid-treatment',
            `artifact-valid but ${budgetExhausted} upstream call(s) failed budget-exhausted ` +
              '(§23.1 no-budget-exhausted-failure gate)',
            'treatment-thresholds',
          );
        }
      }
      execution.studyStatus = 'study-valid';
    }

    execution.status = 'completed';
    execution.endedAtUtc = nowUtc();
    execution.seal = guardStage('execution-seal', () =>
      sealExecution(sequenceRoot, execution.dir, 'completed'),
    );
    return { execution, failure: null };
  } catch (error: unknown) {
    if (gateway) await processManager.stop(gateway, 5_000);
    const failure =
      error instanceof AttemptFailure
        ? error
        : new AttemptFailure(
            'attempt-setup-failed',
            error instanceof Error ? error.message : String(error),
            'attempt-setup',
          );
    execution.status = 'failed';
    execution.failureReason = failure.reason;
    execution.failureStage = failure.stage ?? 'browser';
    execution.artifactStatus ??= 'artifact-invalid';
    execution.studyStatus ??= 'not-evaluated';
    execution.endedAtUtc = nowUtc();
    // Preserve the thrown message, a structured failure manifest, and
    // bounded process context (finding 6; re-audit §12): the always-saved
    // browser artifacts (trace, DOM, screenshot, console log) already live
    // in the attempt directory for post-browser failures. The directory is
    // (re)created so even an attempt-setup failure leaves its record.
    mkdirSync(attemptDir, { recursive: true });
    writeFileSync(
      join(attemptDir, 'failure-message.txt'),
      `${failure.reason}: ${failure.message}\n`,
      'utf8',
    );
    writeFileSync(
      join(attemptDir, 'failure-manifest.json'),
      `${JSON.stringify(
        {
          taxonomyVersion: FAILURE_TAXONOMY_VERSION,
          failureClass: failure.reason,
          stage: execution.failureStage,
          message: failure.message,
          artifacts: existsSync(attemptDir) ? readdirSync(attemptDir).sort() : [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(
      join(attemptDir, 'context-logs.txt'),
      `--- vite.log (tail) ---\n${tailOf(join(sequenceRoot, 'vite.log'), 200)}\n` +
        `--- process-log.jsonl (tail) ---\n${tailOf(join(sequenceRoot, 'process-log.jsonl'), 100)}\n`,
      'utf8',
    );
    // Terminal seal for the FAILED execution (re-audit finding 5). A seal
    // failure here is an evidence-integrity failure: escalate to the
    // sequence level rather than leave unverifiable evidence skippable.
    execution.seal = guardStage('execution-seal', () =>
      sealExecution(sequenceRoot, execution.dir, 'failed'),
    );
    return { execution, failure };
  }
}

/**
 * Post-sequence evidence pipeline (re-audit findings 1 and 4), extracted
 * so drift at every checkpoint is drillable: batch → evaluation → final
 * report + manifest → packaging → receipt, each guarded by the full freeze
 * check. Drift anywhere fails the sequence as a preserved
 * `freeze-violation` — it is never packaged under the old SHA.
 */
export interface PostSequenceDeps {
  /** Runs the full freeze check and records the checkpoint; throws on
   * drift. */
  checkpoint: (name: string) => void;
  /** Deterministic batch runner (null when the plan skips it). Resolves
   * with the exit outcome string. */
  runBatch: (() => Promise<string>) | null;
  evaluate: () => SequenceEvaluation;
  /** Evidentiary process-provenance gate (re-audit §13.1); throws when
   * provenance is incomplete for an evidentiary sequence. */
  assertProcessProvenance: () => void;
  writeFinalEvidence: (batchVerdict: string | null, evaluation: SequenceEvaluation) => void;
  markValidating: () => void;
  markPackaging: () => void;
  packageArchive: (beforeReceipt: () => void) => Promise<{
    zipPath: string;
    zipSha256: string;
    inventoryAggregateSha256: string;
  }>;
  markCompleted: (packaged: {
    zipPath: string;
    zipSha256: string;
    inventoryAggregateSha256: string;
  }) => void;
  fail: (stage: string, error: unknown) => void;
}

export async function runPostSequencePipeline(
  deps: PostSequenceDeps,
): Promise<{ zipPath: string | null; failed: boolean }> {
  let batchVerdict: string | null = null;
  try {
    deps.checkpoint('pre-batch');
  } catch (error: unknown) {
    deps.fail('freeze-violation:pre-batch', error);
    return { zipPath: null, failed: true };
  }
  if (deps.runBatch) {
    let exit: string;
    try {
      exit = await deps.runBatch();
    } catch (error: unknown) {
      deps.fail('post-sequence-batch', error);
      return { zipPath: null, failed: true };
    }
    batchVerdict = exit === '0' ? 'PASSED' : `FAILED (exit ${exit})`;
    if (exit !== '0') {
      deps.fail('post-sequence-batch', new Error(`exit ${exit}`));
      return { zipPath: null, failed: true };
    }
    try {
      deps.checkpoint('post-batch');
    } catch (error: unknown) {
      deps.fail('freeze-violation:post-batch', error);
      return { zipPath: null, failed: true };
    }
  }
  try {
    deps.assertProcessProvenance();
  } catch (error: unknown) {
    deps.fail('process-evidence-incomplete', error);
    return { zipPath: null, failed: true };
  }
  deps.markValidating();
  let evaluation: SequenceEvaluation;
  try {
    deps.checkpoint('pre-evaluation');
    evaluation = deps.evaluate();
    deps.writeFinalEvidence(batchVerdict, evaluation);
    deps.checkpoint('post-evaluation');
  } catch (error: unknown) {
    deps.fail(
      error instanceof Error && error.message.startsWith('freeze-violation')
        ? 'freeze-violation:evaluation'
        : 'evaluation',
      error,
    );
    return { zipPath: null, failed: true };
  }
  deps.markPackaging();
  try {
    deps.checkpoint('pre-package');
    const packaged = await deps.packageArchive(() => deps.checkpoint('post-package'));
    deps.markCompleted(packaged);
    return { zipPath: packaged.zipPath, failed: false };
  } catch (error: unknown) {
    deps.fail(
      error instanceof Error && error.message.startsWith('freeze-violation')
        ? 'freeze-violation:packaging'
        : 'packaging',
      error,
    );
    return { zipPath: null, failed: true };
  }
}

/**
 * Packaging-ready recovery (focused re-audit finding 3): once a valid
 * inventory exists, the evidence root is FINAL — a failure in any later
 * packaging stage (zip, size, extraction, commit, post-package freeze,
 * sidecar, receipt) resumes HERE, never through the ordinary path.
 *
 * The recovery path:
 *  - verifies the root READ-ONLY before any write: terminal seals,
 *    semantic revalidation, exact root-vs-inventory byte equality, and
 *    the authoritative manifest reconciled against control state;
 *  - launches NO Vite, Chromium, or gateway process and never appends to
 *    the evidence-root process log;
 *  - never reruns or rewrites evaluation, report, or manifest;
 *  - handles prior packaging material explicitly: crash-leftover staged
 *    `.tmp` siblings are removed, committed-but-unreceipted archives are
 *    preserved and recorded as superseded;
 *  - re-runs only the freeze verification and the packaging transaction,
 *    producing the NEXT versioned archive with its sidecar and receipt;
 *  - writes only control-root operational state, marking `completed` only
 *    after the archive verifies and the receipt exists.
 */
async function resumePackagingReady(context: {
  options: OrchestrateOptions;
  sequenceRoot: string;
  plan: OrchestratorPlan;
  planSha256: string;
  repositorySha: string;
  freeze: FreezeIdentity;
  identity: ResumeIdentity;
}): Promise<OrchestrateResult> {
  const { options, sequenceRoot, plan } = context;
  // ---- Lock BEFORE authoritative verification (final audit blocker 3):
  // only immutable identity/path prechecks ran before dispatch. The
  // single-writer lock is acquired FIRST; the control state and inventory
  // are then RE-READ and every authoritative check runs on those fresh
  // objects, so a competing invocation's writes can never be verified
  // against stale data. The seam below exists solely for the §5.4 race
  // drills. ---------------------------------------------------------------
  await options.onBeforeRecoveryLock?.();
  const releaseLock = acquireSequenceLock(sequenceRoot);
  let zipPath: string | null = null;
  let recoveryFailed = false;
  let executionCount = 0;
  let failedExecutionCount = 0;
  try {
    const state = readSequenceState(sequenceRoot);
    if (!state) {
      throw new Error('packaging-recovery-blocked: sequence state vanished before recovery');
    }
    assertResumeIdentity(state, context.identity);
    assertResumable(state);
    const inventory = readInventory(sequenceRoot);
    if (!inventory) {
      throw new Error('packaging-recovery-blocked: inventory vanished before recovery');
    }

    // Completed while this invocation waited for the lock (§5.3.8): the
    // winning invocation already packaged and receipted — verify the
    // completed sequence whole and return a no-op, creating no additional
    // archive and writing nothing from stale state.
    if (
      state.status === 'completed' &&
      plan.attempts.every((attempt) => completedExecution(state, attempt.attemptId) !== null)
    ) {
      await verifyCompletedSequence(sequenceRoot, state, plan);
      console.log(
        'packaging recovery: sequence completed while waiting for the lock; verified whole as ' +
          'a no-op; no additional archive created',
      );
      return {
        sequenceRoot,
        status: 'completed',
        executions: state.executions.length,
        failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
          .length,
        zipPath: state.archivePath,
        noOpResume: true,
        packagingRecovery: false,
      };
    }

    if (state.status !== 'packaging' && state.status !== 'failed') {
      throw new Error(
        `packaging-recovery-unexpected-status: an inventory exists but the sequence state is ` +
          `'${state.status}' — an inventoried root is final and only reaches this path from a ` +
          'packaging-stage failure',
      );
    }
    for (const attempt of plan.attempts) {
      if (completedExecution(state, attempt.attemptId) === null) {
        throw new Error(
          `packaging-recovery-blocked: an inventory exists but planned attempt ` +
            `'${attempt.attemptId}' has no completed execution — refusing to package an ` +
            'incomplete attempt set',
        );
      }
    }

    // ---- Read-only verification under the lock: nothing below writes
    // until every check passes on the freshly read state. -----------------
    verifySealedExecutions(sequenceRoot, state);
    revalidateCompletedExecutions(sequenceRoot, state, plan);
    // The on-disk inventory must be AUTHENTICATED, never self-certifying
    // (adversarial round; final audit blocker 2): `readInventory` already
    // recomputed the aggregate from the validated entries, and the value
    // recorded in control state before the inventory file was written must
    // agree exactly — a rewritten inventory cannot pass, and a planted
    // inventory with no recorded aggregate is refused outright.
    if (state.inventoryAggregateSha256 === null) {
      throw new Error(
        'packaging-recovery-blocked: no inventory aggregate is recorded in the control state — ' +
          'the evidence-root inventory cannot be authenticated',
      );
    }
    if (state.inventoryAggregateSha256 !== inventory.aggregateSha256) {
      throw new Error(
        'packaging-recovery-blocked: the recorded inventory aggregate disagrees with the ' +
          'inventory file',
      );
    }
    verifyTreeAgainstInventory(sequenceRoot, inventory, 'packaging-recovery');
    reconcileManifestWithState(readSequenceManifestFile(sequenceRoot), state, plan);
    const persist = (transition: string): void => {
      state.lastTransition = transition;
      state.updatedAtUtc = nowUtc();
      writeSequenceState(sequenceRoot, state);
    };
    const checkpoint = (name: string): void => {
      checkFreeze(options.repoRoot, sequenceRoot, context.freeze);
      state.freezeCheckpoints.push({ checkpoint: name, atUtc: nowUtc() });
      persist(`freeze-checkpoint:${name}`);
    };
    try {
      // Prior packaging material (§6.4): staged .tmp leftovers are deleted
      // (they were never committed evidence); committed-but-unreceipted
      // archives are preserved and recorded as superseded.
      const destinationDir = resolve(sequenceRoot, '..');
      const removedStaged = removeStaleStagedArchives(destinationDir, plan.sequenceId);
      for (const staged of removedStaged) {
        console.warn(`packaging recovery: removed crash-leftover staged archive ${staged}`);
      }
      for (const orphan of findUnreceiptedArchives(destinationDir, plan.sequenceId)) {
        if (!state.supersededArchives.some((entry) => entry.archive === orphan)) {
          state.supersededArchives.push({
            archive: orphan,
            reason: 'unreceipted-before-recovery',
            atUtc: nowUtc(),
          });
        }
      }
      checkpoint('pre-package:recovery');
      state.status = 'packaging';
      persist('packaging-recovery');
      const archivePath = nextArchivePath(destinationDir, plan.sequenceId);
      const packagingLog = join(controlRoot(sequenceRoot), 'packaging-log.jsonl');
      const packaged = await packageSequence(
        sequenceRoot,
        archivePath,
        {
          sequenceId: plan.sequenceId,
          planSha256: context.planSha256,
          repositorySha: context.repositorySha,
          studyPlanSha256: plan.study?.studyPlanSha256 ?? null,
        },
        {
          beforeReceipt: () => checkpoint('post-package:recovery'),
          maxArchiveBytes: plan.evidenceSizeBudgetBytes ?? DEFAULT_EVIDENCE_BUDGET_BYTES,
          onStage: options.onPackagingStage,
          onInventory: (aggregateSha256) => {
            state.inventoryAggregateSha256 = aggregateSha256;
            persist('inventory-recorded:recovery');
          },
          onHelper: (command, args) => {
            try {
              writeFileSync(
                packagingLog,
                `${JSON.stringify({ atUtc: nowUtc(), command, args })}\n`,
                {
                  flag: 'a',
                },
              );
            } catch {
              // Control-side provenance must not break packaging.
            }
          },
        },
      );
      state.archivePath = packaged.zipPath;
      state.archiveSha256 = packaged.zipSha256;
      state.inventoryAggregateSha256 = packaged.inventoryAggregateSha256;
      state.status = 'completed';
      persist('sequence-completed:packaging-recovery');
      zipPath = packaged.zipPath;
      console.log(
        'packaging-ready recovery: root verified against the inventory read-only; nothing ' +
          `launched; versioned archive ${packaged.zipPath} written with sidecar and receipt`,
      );
    } catch (error: unknown) {
      recoveryFailed = true;
      state.status = 'failed';
      state.sequenceFailureReason = `packaging-recovery: ${
        error instanceof Error ? error.message : String(error)
      }`;
      persist('sequence-failed:packaging-recovery');
    }
    executionCount = state.executions.length;
    failedExecutionCount = state.executions.filter(
      (execution) => execution.status === 'failed',
    ).length;
  } finally {
    releaseLock();
  }
  return {
    sequenceRoot,
    status: recoveryFailed ? 'failed' : 'completed',
    executions: executionCount,
    failedExecutions: failedExecutionCount,
    zipPath,
    noOpResume: false,
    packagingRecovery: true,
  };
}

export async function orchestrateSequence(options: OrchestrateOptions): Promise<OrchestrateResult> {
  const planBytes = readFileSync(options.planPath);
  const loaded: LoadedPlan = parsePlan(planBytes);
  const { plan, profile } = loaded;
  const sequenceRoot = isAbsolute(plan.outputRoot)
    ? plan.outputRoot
    : resolve(options.repoRoot, plan.outputRoot);

  // ---- Read-only gates (audit finding 4): nothing below writes. ----------
  if (plan.evidentiary) {
    const rel = relative(resolve(options.repoRoot), sequenceRoot);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      throw new Error(
        `evidentiary-output-root-inside-repository: ${sequenceRoot} must live outside the tracked tree`,
      );
    }
  }
  const repositorySha = headSha(options.repoRoot);
  const installedPackageVersion = packageVersion(options.repoRoot);
  let studyPlanPathAbsolute: string | null = null;
  if (plan.study !== undefined) {
    studyPlanPathAbsolute = isAbsolute(plan.study.studyPlanPath)
      ? plan.study.studyPlanPath
      : resolve(options.repoRoot, plan.study.studyPlanPath);
    const validated = validateStudyFile(studyPlanPathAbsolute);
    if (
      validated.freeze.studyId !== plan.study.studyId ||
      validated.freeze.studyVersion !== plan.study.studyVersion ||
      validated.freeze.planSha256 !== plan.study.studyPlanSha256 ||
      validated.freeze.configFingerprint !== plan.study.studyConfigFingerprint
    ) {
      throw new Error(
        'study-binding-mismatch: the validated study declaration does not match the plan binding',
      );
    }
    // Semantic reconciliation (re-audit finding 2): an authentic study is
    // not enough — the plan must IMPLEMENT it.
    const reconcileIdentity = planExperimentIdentity(plan);
    reconcileStudyWithPlan(validated.study, plan, profile, {
      repoRoot: options.repoRoot,
      headSha: repositorySha,
      packageVersion: installedPackageVersion,
      experimentId: reconcileIdentity.experimentId,
      experimentVersion: reconcileIdentity.experimentVersion,
      promptVersion: reconcileIdentity.promptVersion,
      installedMetricVersions: {
        'behavior-fingerprint': BEHAVIOR_FINGERPRINT_VERSION,
        'behavior-similarity': BEHAVIOR_SIMILARITY_VERSION,
        'm2-calibration-variance-analysis': M2_CALIBRATION_ANALYSIS_VERSION,
        'm2-stage-a-acceptance-gates': M2_STAGE_A_ACCEPTANCE_GATES_VERSION,
      },
      installedAnalysisVersions: INSTALLED_ANALYSIS_VERSIONS,
    });
  }
  if (plan.repositorySha !== undefined && plan.repositorySha !== repositorySha) {
    throw new Error(
      `frozen-sha-mismatch: plan pins ${plan.repositorySha}, HEAD is ${repositorySha}`,
    );
  }
  if (plan.evidentiary && worktreeDirty(options.repoRoot)) {
    throw new Error('dirty-worktree: an evidentiary sequence requires a clean tracked worktree');
  }
  const experimentIdentity = planExperimentIdentity(plan);
  const identity = {
    planSha256: loaded.planSha256,
    repositorySha,
    packageVersion: installedPackageVersion,
    experimentId: experimentIdentity.experimentId,
    experimentVersion: experimentIdentity.experimentVersion,
    promptVersion: experimentIdentity.promptVersion,
    externalProviderId: experimentIdentity.externalProviderId,
    upstreamPlatform: experimentIdentity.upstreamPlatform,
    expectedModelId: plan.expectedTreatment?.modelId ?? 'none',
    expectedServingProviderId: plan.expectedTreatment?.servingProviderId ?? 'none',
    studyId: plan.study?.studyId ?? 'none',
    studyVersion: plan.study?.studyVersion ?? 'none',
    studyPlanSha256: plan.study?.studyPlanSha256 ?? 'none',
    thresholdProfileId: profile.profileId,
    thresholdProfileVersion: profile.profileVersion,
    configFingerprint: planConfigFingerprint(plan),
  };
  const freeze: FreezeIdentity = {
    repositorySha,
    packageVersion: identity.packageVersion,
    planSha256: loaded.planSha256,
    requireCleanWorktree: plan.evidentiary,
    configFingerprint: identity.configFingerprint,
    thresholdProfileId: profile.profileId,
    thresholdProfileVersion: profile.profileVersion,
    studyPlanSha256: plan.study?.studyPlanSha256 ?? null,
    studyPlanPathAbsolute,
    studyId: plan.study?.studyId ?? null,
    studyVersion: plan.study?.studyVersion ?? null,
    studyConfigFingerprint: plan.study?.studyConfigFingerprint ?? null,
    // The record's frozen byte identity (focused re-audit finding 4 §7.1)
    // derives from the reviewed plan binding BEFORE any write.
    studyFreezeRecordSha256:
      plan.study !== undefined
        ? sha256(Buffer.from(studyFreezeRecordContent(plan.study), 'utf8'))
        : null,
  };

  let state = readSequenceState(sequenceRoot);
  if (state && !options.resume) {
    throw new Error(
      `sequence-already-exists: ${sequenceRoot} — use --resume to continue it (identity-checked)`,
    );
  }
  if (!state && options.resume) {
    throw new Error(
      `resume-without-state: no sequence-state.json under ${controlRoot(sequenceRoot)}`,
    );
  }
  if (state) {
    assertResumeIdentity(state, identity); // read-only refusal on mismatch
    assertResumable(state); // re-audit finding 3: dispositions gate resume
  } else if (existsSync(sequenceRoot) && readdirSync(sequenceRoot).length > 0) {
    throw new Error(
      `sequence-root-not-empty: ${sequenceRoot} contains files but no sequence-state.json — refusing to adopt it`,
    );
  }

  // ---- No-op resume of a completed sequence (re-audit findings 1 and 5):
  // verify seals, root-vs-inventory byte equality, the final evidence
  // manifest, semantic revalidation, and the archive + receipt — all
  // read-only — then return without launching anything. ---------------------
  if (
    state &&
    state.status === 'completed' &&
    plan.attempts.every((attempt) => completedExecution(state!, attempt.attemptId) !== null)
  ) {
    await verifyCompletedSequence(sequenceRoot, state, plan);
    console.log(
      'no-op resume: sequence already completed; seals, inventory, manifest reconciliation, ' +
        'semantic revalidation, archive, and receipt all verified; nothing launched',
    );
    return {
      sequenceRoot,
      status: 'completed',
      executions: state.executions.length,
      failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
        .length,
      zipPath: state.archivePath,
      noOpResume: true,
      packagingRecovery: false,
    };
  }

  // ---- Packaging-ready recovery (focused re-audit finding 3): an
  // inventory in the evidence root means the root is FINAL — the ordinary
  // resume path (which launches processes and regenerates evidence) must
  // never touch it. Only the packaging transaction may run again. ----------
  if (state && readInventory(sequenceRoot) !== null) {
    return resumePackagingReady({
      options,
      sequenceRoot,
      plan,
      planSha256: loaded.planSha256,
      repositorySha,
      freeze,
      identity,
    });
  }

  // Keep-awake is LIVE-ONLY and acquired after every read-only refusal
  // (re-audit finding 6); the release scope begins immediately.
  const keepAwake = await acquireKeepAwakeForPlan(plan, options);
  const releaseFns: Array<() => void> = [];
  const processManager = new ProcessManager(join(sequenceRoot, 'process-log.jsonl'));
  let browser: Browser | null = null;
  let zipPath: string | null = null;

  try {
    // ---- Write path begins. -----------------------------------------------
    mkdirSync(sequenceRoot, { recursive: true });
    releaseFns.push(acquireSequenceLock(sequenceRoot));

    // Disk preflight against the evidence budget (re-audit §13.4).
    const evidenceBudgetBytes = plan.evidenceSizeBudgetBytes ?? DEFAULT_EVIDENCE_BUDGET_BYTES;
    const free = freeDiskBytes(sequenceRoot);
    if (free === null) {
      if (plan.evidentiary) {
        throw new Error(
          'disk-preflight-unavailable: cannot verify free space for an evidentiary sequence',
        );
      }
      console.warn('WARNING: free-disk preflight unavailable on this platform.');
    } else if (free < evidenceBudgetBytes) {
      throw new Error(
        `disk-preflight-insufficient: ${free} bytes free < evidence budget ${evidenceBudgetBytes}`,
      );
    }

    const persist = (transition: string): void => {
      state!.lastTransition = transition;
      state!.updatedAtUtc = nowUtc();
      writeSequenceState(sequenceRoot, state!);
    };
    const recordSequenceFailure = (stage: string, error: unknown): void => {
      if (!state) return;
      state.status = 'failed';
      state.sequenceFailureReason = `${stage}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      persist(`sequence-failed:${stage}`);
    };

    // Archive the exact reviewed plan bytes (finding 3), the exact study
    // bytes + freeze record (re-audit finding 2), and record the immutable
    // acknowledgement (finding 4).
    const archivedPlanPath = join(sequenceRoot, 'plan.archived.json');
    if (!existsSync(archivedPlanPath)) {
      copyFileSync(options.planPath, archivedPlanPath);
    }
    if (sha256(readFileSync(archivedPlanPath)) !== loaded.planSha256) {
      throw new Error('freeze-violation: archived plan bytes do not match the reviewed plan');
    }
    if (plan.study !== undefined && studyPlanPathAbsolute !== null) {
      const archivedStudyPath = join(sequenceRoot, 'study.archived.json');
      if (!existsSync(archivedStudyPath)) {
        copyFileSync(studyPlanPathAbsolute, archivedStudyPath);
      }
      if (sha256(readFileSync(archivedStudyPath)) !== plan.study.studyPlanSha256) {
        throw new Error('freeze-violation: archived study bytes do not match the registered study');
      }
      const freezeRecordPath = join(sequenceRoot, 'study.freeze.archived.json');
      const freezeRecord = studyFreezeRecordContent(plan.study);
      if (existsSync(freezeRecordPath)) {
        if (readFileSync(freezeRecordPath, 'utf8') !== freezeRecord) {
          throw new Error('freeze-violation: archived study freeze record differs');
        }
      } else {
        writeFileSync(freezeRecordPath, freezeRecord, 'utf8');
      }
    }
    recordLiveAcknowledgement(plan, sequenceRoot);

    let sequenceFailed = false;
    if (state) {
      verifySealedExecutions(sequenceRoot, state); // ALL terminal seals (finding 5)
      revalidateCompletedExecutions(sequenceRoot, state, plan); // semantic (finding 5)
      const interrupted = markInterruptedExecutions(sequenceRoot, state, nowUtc());
      for (const execution of interrupted) {
        const executionsUsed = state.executions.filter(
          (entry) => entry.attemptId === execution.attemptId,
        ).length;
        execution.replacementDisposition = assessReplacementDisposition(
          'interrupted',
          plan.replacementPolicy.retryableFailureClasses,
          executionsUsed,
          plan.replacementPolicy.maxReplacementAttempts,
        );
        if (execution.replacementDisposition !== 'permitted') {
          sequenceFailed = true;
          state.sequenceFailureReason = `attempt-failures-interrupted-${execution.replacementDisposition}`;
        }
      }
      state.status = sequenceFailed ? 'failed' : 'in-progress';
      persist(`resumed (${interrupted.length} interrupted execution(s) preserved+sealed)`);
    } else {
      state = {
        stateVersion: SEQUENCE_STATE_VERSION,
        sequenceId: plan.sequenceId,
        ...identity,
        status: 'in-progress',
        sequenceFailureReason: null,
        archivePath: null,
        archiveSha256: null,
        inventoryAggregateSha256: null,
        supersededArchives: [],
        freezeCheckpoints: [],
        executions: [],
        lastTransition: 'created',
        createdAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };
      writeSequenceState(sequenceRoot, state);
    }

    const checkpoint = (name: string): void => {
      checkFreeze(options.repoRoot, sequenceRoot, freeze);
      state!.freezeCheckpoints.push({ checkpoint: name, atUtc: nowUtc() });
      persist(`freeze-checkpoint:${name}`);
    };

    let browserVersion: string | null = null;
    if (!sequenceFailed) {
      // Preflight (§19.6): both automation ports must be free; no fallback.
      if (!(await portIsFree(AUTOMATION_VITE_PORT))) {
        throw new Error(`preflight-port-occupied: vite port ${AUTOMATION_VITE_PORT}`);
      }
      if (!(await portIsFree(AUTOMATION_GATEWAY_PORT))) {
        throw new Error(`preflight-port-occupied: gateway port ${AUTOMATION_GATEWAY_PORT}`);
      }
      tsxCliPath(options.repoRoot);

      await startVite(processManager, {
        repoRoot: options.repoRoot,
        logPath: join(sequenceRoot, 'vite.log'),
      });
      // The Chromium OS process receives the REDUCED browser environment
      // (focused re-audit finding 2): platform base only, plus the explicit
      // display/session allowlist in headed mode — an operator-exported
      // credential never enters the browser process.
      browser = await chromium.launch({
        headless: !options.headed,
        env: browserChildEnv(process.env, options.headed),
      });
      browserVersion = browser.version();
      const playwrightVersion = (
        JSON.parse(
          readFileSync(
            join(options.repoRoot, 'node_modules', '@playwright', 'test', 'package.json'),
            'utf8',
          ),
        ) as { version: string }
      ).version;
      const browserProvenance: BrowserProvenance = {
        playwrightVersion,
        browserVersion,
        headless: !options.headed,
        contextOptions: {
          acceptDownloads: true,
          tracingScreenshots: true,
          tracingSnapshots: true,
          tracingSources: false,
          // Phase 4 bounded tracing (§8.2): rotation cadence and the
          // explicit retention policy are execution provenance.
          tracingChunkIntervalMs: plan.tracing?.chunkIntervalMs ?? DEFAULT_TRACE_CHUNK_INTERVAL_MS,
          traceRetention: 'retain-all-chunks',
        },
      };

      for (const attempt of plan.attempts) {
        if (completedExecution(state, attempt.attemptId)) continue;
        const maxExecutions = 1 + plan.replacementPolicy.maxReplacementAttempts;
        let attemptCompleted = false;
        while (!attemptCompleted) {
          const executionsSoFar = state.executions.filter(
            (execution) => execution.attemptId === attempt.attemptId,
          ).length;
          if (executionsSoFar >= maxExecutions) {
            console.error(
              `attempt ${attempt.attemptId}: replacement policy exhausted ` +
                `(${executionsSoFar}/${maxExecutions} executions used) — sequence fails`,
            );
            sequenceFailed = true;
            state.sequenceFailureReason ??= 'attempt-failures-exhausted-policy';
            break;
          }
          // Evidence budget also gates BEFORE spending an execution
          // (re-audit §13.4).
          const rootBytesBeforeExecution = directorySizeBytes(sequenceRoot);
          if (rootBytesBeforeExecution > evidenceBudgetBytes) {
            sequenceFailed = true;
            state.sequenceFailureReason = `evidence-budget-exceeded: root over ${evidenceBudgetBytes} bytes`;
            persist('sequence-failed:evidence-budget');
            break;
          }
          // Sequence-level evidence forecast (Phase 4, §8.2): with at least
          // one completed execution measured, project the remaining
          // executions at the observed average and refuse to START an
          // execution the budget cannot absorb.
          {
            const executionsDone = state.executions.filter(
              (execution) => execution.endedAtUtc !== null,
            ).length;
            if (executionsDone > 0) {
              const avgBytesPerExecution = Math.ceil(rootBytesBeforeExecution / executionsDone);
              const projected = rootBytesBeforeExecution + avgBytesPerExecution;
              if (projected > evidenceBudgetBytes) {
                sequenceFailed = true;
                state.sequenceFailureReason =
                  `evidence-budget-exceeded: forecast ${projected} bytes ` +
                  `(${rootBytesBeforeExecution} + avg ${avgBytesPerExecution}/execution) ` +
                  `> ${evidenceBudgetBytes}`;
                persist('sequence-failed:evidence-forecast');
                break;
              }
            }
          }
          // Freeze recheck before every execution (finding 3).
          const executionId = nextExecutionId(state, attempt.attemptId);
          checkpoint(`pre-execution:${executionId}`);
          const execution: AttemptExecution = {
            executionId,
            attemptId: attempt.attemptId,
            status: 'in-progress',
            seal: null,
            failureReason: null,
            failureStage: null,
            artifactStatus: null,
            studyStatus: null,
            replacementDisposition: null,
            thresholdVerdicts: null,
            runId: null,
            dir: `attempt-${executionId}`,
            artifacts: [],
            verdicts: {},
            navigationCount: null,
            browserProvenance,
            startedAtUtc: nowUtc(),
            endedAtUtc: null,
          };
          state.executions.push(execution);
          persist(`execution-started:${executionId}`);

          await executeAttempt(
            browser,
            processManager,
            plan,
            profile,
            attempt,
            sequenceRoot,
            options.repoRoot,
            execution,
            { budgetBytes: evidenceBudgetBytes, rootBytesAtStart: rootBytesBeforeExecution },
          );

          // Freeze recheck AFTER the execution (finding 3): drift during an
          // attempt preserves the work but invalidates it.
          try {
            checkFreeze(options.repoRoot, sequenceRoot, freeze);
            state.freezeCheckpoints.push({
              checkpoint: `post-execution:${executionId}`,
              atUtc: nowUtc(),
            });
          } catch (freezeError: unknown) {
            execution.status = 'failed';
            execution.failureReason = 'freeze-violation';
            execution.failureStage = 'freeze';
            execution.artifactStatus = 'artifact-invalid';
            execution.studyStatus = 'not-evaluated';
            execution.endedAtUtc = nowUtc();
            writeFileSync(
              join(sequenceRoot, execution.dir, 'failure-message.txt'),
              `freeze-violation: ${
                freezeError instanceof Error ? freezeError.message : String(freezeError)
              }\n`,
              'utf8',
            );
            // Re-seal AFTER the failure artifacts (re-audit finding 5).
            execution.seal = sealExecution(sequenceRoot, execution.dir, 'failed');
          }
          persist(`execution-${execution.status}:${executionId}`);

          // Evidence budget (re-audit §13.4): measured after every attempt.
          const rootSize = directorySizeBytes(sequenceRoot);
          if (rootSize > evidenceBudgetBytes) {
            sequenceFailed = true;
            state.sequenceFailureReason = `evidence-budget-exceeded: ${rootSize} bytes > ${evidenceBudgetBytes}`;
            persist('sequence-failed:evidence-budget');
            break;
          }

          if (execution.status === 'completed') {
            attemptCompleted = true;
          } else {
            // Replacement disposition (re-audit finding 3): persisted so a
            // later resume inspects the RECORDED decision.
            const executionsUsed = executionsSoFar + 1;
            execution.replacementDisposition = assessReplacementDisposition(
              execution.failureReason ?? 'attempt-setup-failed',
              plan.replacementPolicy.retryableFailureClasses,
              executionsUsed,
              plan.replacementPolicy.maxReplacementAttempts,
            );
            persist(`execution-disposition:${executionId}:${execution.replacementDisposition}`);
            console.error(
              `attempt ${attempt.attemptId} execution ${executionId} FAILED ` +
                `(${execution.failureReason ?? 'unknown'} @ ${execution.failureStage ?? '?'}); ` +
                `disposition ${execution.replacementDisposition}; evidence preserved in ${execution.dir}`,
            );
            if (execution.replacementDisposition !== 'permitted') {
              console.error(
                `failure class '${execution.failureReason ?? 'unknown'}' ${
                  execution.replacementDisposition === 'forbidden'
                    ? 'is not registered as retryable'
                    : 'has no replacement capacity left'
                } — sequence fails`,
              );
              sequenceFailed = true;
              state.sequenceFailureReason ??= `attempt-failures-${execution.replacementDisposition}:${execution.failureReason ?? 'unknown'}`;
              break;
            }
          }
        }
        if (sequenceFailed) break;
      }
    }

    state.status = sequenceFailed ? 'failed' : 'attempts-complete';
    if (sequenceFailed && state.sequenceFailureReason === null) {
      state.sequenceFailureReason = 'attempt-failures-exhausted-policy';
    }
    persist(sequenceFailed ? 'sequence-failed:attempts' : 'attempts-complete');

    // Stop the browser and every remaining child BEFORE the derived reports
    // so exit codes land in the append-only process log (§19.5).
    if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
    await processManager.stopAll();

    const finalFacts = (
      outcome: string,
      attemptSetComplete: boolean,
      batchVerdict: string | null,
      evaluation: SequenceEvaluation | null,
    ): SequenceFinalFacts => ({
      sequenceOutcome: outcome,
      attemptSetComplete,
      batchVerdict,
      evaluation,
      processLogHealth: processManager.health(),
      browserVersion,
      launchFlags: [options.headed ? '--headed' : 'headless'],
      processLog: readProcessLog(sequenceRoot),
      finalizedAtUtc: nowUtc(),
    });

    if (sequenceFailed) {
      // Failed sequences preserve their evidence and reports; they are
      // never packaged and never reach `completed`.
      let evaluation: SequenceEvaluation | null = null;
      try {
        evaluation = evaluateFromState(sequenceRoot, state);
      } catch (evaluationError: unknown) {
        console.error(
          `evaluation skipped on failed sequence: ${
            evaluationError instanceof Error ? evaluationError.message : String(evaluationError)
          }`,
        );
      }
      const facts = finalFacts(
        `failed:${state.sequenceFailureReason ?? 'attempt-failures'}`,
        false,
        null,
        evaluation,
      );
      writeSequenceReport(sequenceRoot, state, facts);
      writeSequenceManifest(sequenceRoot, state, facts);
      persist('sequence-failed:reported');
    } else {
      const pipeline = await runPostSequencePipeline({
        checkpoint,
        runBatch: plan.postSequenceBatch
          ? async () => {
              const batch = processManager.spawnManaged({
                name: 'post-sequence-batch',
                command: process.execPath,
                args: [
                  tsxCliPath(options.repoRoot),
                  join(options.repoRoot, 'scripts', 'batch', 'run.ts'),
                ],
                cwd: options.repoRoot,
                env: batchChildEnv(process.env),
                logPath: join(sequenceRoot, 'post-sequence-batch.log'),
              });
              return batch.exited;
            }
          : null,
        evaluate: () => evaluateFromState(sequenceRoot, state!),
        assertProcessProvenance: () => {
          const health = processManager.health();
          if (
            plan.evidentiary &&
            (health.recordWriteFailures > 0 ||
              health.stopFailures > 0 ||
              health.runningChildren.length > 0)
          ) {
            throw new Error(
              `process-provenance-incomplete: ${health.recordWriteFailures} record failure(s), ` +
                `${health.stopFailures} stop failure(s), unreconciled=[${health.runningChildren.join(', ')}]`,
            );
          }
        },
        writeFinalEvidence: (batchVerdict, evaluation) => {
          const facts = finalFacts('evidence-finalized', true, batchVerdict, evaluation);
          writeSequenceReport(sequenceRoot, state!, facts);
          writeSequenceManifest(sequenceRoot, state!, facts);
        },
        markValidating: () => {
          state!.status = 'validating';
          persist('validating-sequence');
        },
        markPackaging: () => {
          state!.status = 'packaging';
          persist('packaging');
        },
        packageArchive: async (beforeReceipt) => {
          const archivePath = nextArchivePath(resolve(sequenceRoot, '..'), plan.sequenceId);
          const packagingLog = join(controlRoot(sequenceRoot), 'packaging-log.jsonl');
          const packaged = await packageSequence(
            sequenceRoot,
            archivePath,
            {
              sequenceId: plan.sequenceId,
              planSha256: loaded.planSha256,
              repositorySha,
              studyPlanSha256: plan.study?.studyPlanSha256 ?? null,
            },
            {
              beforeReceipt,
              maxArchiveBytes: evidenceBudgetBytes,
              onStage: options.onPackagingStage,
              // The aggregate is persisted in CONTROL state before the
              // inventory file exists (adversarial round): a later
              // packaging-recovery resume authenticates the on-disk
              // inventory against this recorded value.
              onInventory: (aggregateSha256) => {
                state!.inventoryAggregateSha256 = aggregateSha256;
                persist('inventory-recorded');
              },
              onHelper: (command, args) => {
                try {
                  writeFileSync(
                    packagingLog,
                    `${JSON.stringify({ atUtc: nowUtc(), command, args })}\n`,
                    { flag: 'a' },
                  );
                } catch {
                  // Control-side provenance must not break packaging.
                }
              },
            },
          );
          return {
            zipPath: packaged.zipPath,
            zipSha256: packaged.zipSha256,
            inventoryAggregateSha256: packaged.inventoryAggregateSha256,
          };
        },
        markCompleted: (packaged) => {
          state!.archivePath = packaged.zipPath;
          state!.archiveSha256 = packaged.zipSha256;
          state!.inventoryAggregateSha256 = packaged.inventoryAggregateSha256;
          // `completed` is written ONLY here — in the CONTROL root, after
          // the archive, its verification, the post-package freeze check,
          // and the receipt (findings 1 and 5). No evidence-root byte
          // changes after the inventory was computed.
          state!.status = 'completed';
          persist('sequence-completed');
        },
        fail: recordSequenceFailure,
      });
      zipPath = pipeline.zipPath;
      sequenceFailed = pipeline.failed;
    }

    return {
      sequenceRoot,
      status: sequenceFailed ? 'failed' : 'completed',
      executions: state.executions.length,
      failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
        .length,
      zipPath,
      noOpResume: false,
      packagingRecovery: false,
    };
  } catch (error: unknown) {
    if (state && readSequenceState(sequenceRoot)) {
      state.status = 'failed';
      state.sequenceFailureReason = `orchestration: ${
        error instanceof Error ? error.message : String(error)
      }`;
      state.lastTransition = 'sequence-failed:orchestration';
      state.updatedAtUtc = nowUtc();
      writeSequenceState(sequenceRoot, state);
    }
    throw error;
  } finally {
    if (browser) await (browser as Browser).close().catch(() => undefined);
    await processManager.stopAll();
    keepAwake?.release();
    for (const release of releaseFns) release();
  }
}

/** The append-only §19.5 process record for this sequence, across every
 * invocation (resume included). */
function readProcessLog(sequenceRoot: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(join(sequenceRoot, 'process-log.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
