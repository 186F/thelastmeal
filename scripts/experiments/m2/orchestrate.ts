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
// Phase 3 drives the existing Milestone 1 experiment paths; the sequence
// identity records THAT experiment. The M2 experiment identity joins in
// Phase 4 when its condition becomes orchestratable.
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
  MODEL_UPSTREAM_PLATFORM,
} from '../../../src/shared/modelExperiment';
import {
  BEHAVIOR_FINGERPRINT_VERSION,
  BEHAVIOR_SIMILARITY_VERSION,
} from '../../../src/shared/behaviorArtifacts';
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
} from './sequenceState';
import { ProcessManager, type ManagedProcess } from './processManager';
import { startGateway, portIsFree, tsxCliPath } from './gatewayDriver';
import {
  AUTOMATION_GATEWAY_PORT,
  AUTOMATION_GATEWAY_URL,
  AUTOMATION_ORIGIN,
  AUTOMATION_VITE_PORT,
  startVite,
} from './viteDriver';
import { runBrowserAttempt } from './browserDriver';
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
  verifyFinalManifestTreatment,
} from './runFinalizer';
import { evaluateFromState, type SequenceEvaluation } from './evaluateSequence';
import { nextArchivePath, packageSequence } from './packageEvidence';
import { writeSequenceManifest, writeSequenceReport, type SequenceFinalFacts } from './reporting';
import { revalidateCompletedExecutions, verifyCompletedSequence } from './sequenceVerification';
import { acquireKeepAwake, type KeepAwakeLease } from './keepAwake';
import { batchChildEnv, fakeGatewayEnv, helperEnv, liveGatewayEnv } from './childEnv';

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
}

export interface OrchestrateResult {
  sequenceRoot: string;
  status: 'completed' | 'failed';
  executions: number;
  failedExecutions: number;
  zipPath: string | null;
  noOpResume: boolean;
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

/** Freeze identity (audit finding 3; re-audit findings 2 and 4):
 * re-verified before AND after every execution and through the COMPLETE
 * post-sequence pipeline. Any drift invalidates the work as
 * `freeze-violation`. */
export interface FreezeIdentity {
  repositorySha: string;
  packageVersion: string;
  planSha256: string;
  requireCleanWorktree: boolean;
  configFingerprint: string;
  thresholdProfileId: string;
  thresholdProfileVersion: string;
  /** Study freeze (re-audit finding 2): archived bytes, the freeze record,
   * AND the external registered file are all rechecked. */
  studyPlanSha256: string | null;
  studyPlanPathAbsolute: string | null;
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
    if (!existsSync(join(sequenceRoot, 'study.freeze.archived.json'))) {
      throw new Error('freeze-violation: archived study freeze record missing');
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
  const checks: Array<[string, unknown, unknown]> = [
    ['modelId', config.modelId, expected.modelId],
    ['servingProviderId', config.servingProviderId, expected.servingProviderId],
    ['promptVersion', config.promptVersion, expected.promptVersion],
    ['conditionId', config.conditionId, expected.conditionId],
    ['experimentId', config.experimentId, expected.experimentId],
    ['experimentVersion', config.experimentVersion, expected.experimentVersion],
    ['providerId', config.providerId, EXTERNAL_MARA_PROVIDER_ID],
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

async function executeAttempt(
  browser: Browser,
  processManager: ProcessManager,
  plan: OrchestratorPlan,
  profile: AttemptProfile,
  attempt: PlannedAttempt,
  sequenceRoot: string,
  repoRoot: string,
  execution: AttemptExecution,
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
      onGatewayStopTick:
        attempt.gatewayStopAtTick !== undefined && gateway !== null
          ? async () => {
              plannedStopIssued = true;
              return processManager.stop(gateway!, 5_000);
            }
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
    // Unplanned gateway death (finding 8): a normal model attempt whose
    // gateway child exited on its own is not a valid treatment observation,
    // however cleanly the fallbacks carried the run.
    if (gateway && !plannedStopIssued && gateway.exitCode() !== null) {
      throw new AttemptFailure(
        'gateway-died-unexpectedly',
        `gateway child exited with ${String(gateway.exitCode())} during a normal attempt`,
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
    reconcileStudyWithPlan(validated.study, plan, profile, {
      repoRoot: options.repoRoot,
      headSha: repositorySha,
      packageVersion: installedPackageVersion,
      experimentId: MODEL_EXPERIMENT_ID,
      experimentVersion: MODEL_EXPERIMENT_VERSION,
      promptVersion: MODEL_PROMPT_VERSION,
      installedMetricVersions: {
        'behavior-fingerprint': BEHAVIOR_FINGERPRINT_VERSION,
        'behavior-similarity': BEHAVIOR_SIMILARITY_VERSION,
      },
      installedAnalysisVersion: BEHAVIOR_SIMILARITY_VERSION,
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
  const identity = {
    planSha256: loaded.planSha256,
    repositorySha,
    packageVersion: installedPackageVersion,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    promptVersion: MODEL_PROMPT_VERSION,
    externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
    upstreamPlatform: MODEL_UPSTREAM_PLATFORM,
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
      'no-op resume: sequence already completed; seals, inventory, manifest, semantic ' +
        'revalidation, archive, and receipt all verified; nothing launched',
    );
    return {
      sequenceRoot,
      status: 'completed',
      executions: state.executions.length,
      failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
        .length,
      zipPath: state.archivePath,
      noOpResume: true,
    };
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
      const freezeRecord = `${JSON.stringify(
        {
          studyId: plan.study.studyId,
          studyVersion: plan.study.studyVersion,
          planSha256: plan.study.studyPlanSha256,
          configFingerprint: plan.study.studyConfigFingerprint,
        },
        null,
        2,
      )}\n`;
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
      browser = await chromium.launch({ headless: !options.headed });
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
          if (directorySizeBytes(sequenceRoot) > evidenceBudgetBytes) {
            sequenceFailed = true;
            state.sequenceFailureReason = `evidence-budget-exceeded: root over ${evidenceBudgetBytes} bytes`;
            persist('sequence-failed:evidence-budget');
            break;
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
