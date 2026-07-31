import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  assertResumeIdentity,
  completedExecution,
  markInterruptedExecutions,
  nextExecutionId,
  readSequenceState,
  sealExecution,
  verifySealedExecutions,
  writeSequenceState,
  SEQUENCE_STATE_VERSION,
  type AttemptExecution,
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
import { AttemptFailure, runBrowserAttempt } from './browserDriver';
import { finalizeDeterministicAttempt, finalizeModelAttempt } from './runFinalizer';
import { evaluateFromState, type SequenceEvaluation } from './evaluateSequence';
import { packageSequence } from './packageEvidence';
import { writeSequenceReport } from './reporting';
import { acquireKeepAwake, type KeepAwakeLease } from './keepAwake';
import { batchChildEnv, fakeGatewayEnv, liveGatewayEnv } from './childEnv';

/**
 * The unattended sequence orchestrator (M2 brief §19), remediated per the
 * Phase 3 audit:
 *
 *  - refused invocations are observationally read-only (finding 4);
 *  - evidentiary sequences pin the frozen SHA, require a clean tracked
 *    worktree and an output root OUTSIDE the repository, archive the exact
 *    plan bytes, bind a validated study declaration, and re-verify the
 *    freeze before and after every execution (finding 3);
 *  - the reviewed treatment (model + serving route) is verified against the
 *    gateway's public configuration BEFORE Start and against the final
 *    manifest after finalization (finding 2);
 *  - completed executions carry immutable seals, revalidated on resume;
 *    missing or altered evidence refuses, never silently skips (finding 4);
 *  - the sequence lifecycle records typed failures and reaches `completed`
 *    only after the archive and its receipt verify (finding 5);
 *  - replacements are restricted to registered retryable failure classes; a
 *    planned gateway stop must fire and be evidenced; unplanned gateway
 *    death invalidates the treatment (finding 8);
 *  - non-gateway children receive allowlisted environments only; live
 *    credentials reach exactly the live gateway child (finding 9).
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

function nowUtc(): string {
  return new Date().toISOString();
}

function headSha(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function worktreeDirty(repoRoot: string): boolean {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return status.trim() !== '';
}

function packageVersion(repoRoot: string): string {
  return (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string })
    .version;
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
      expectedTreatment: plan.expectedTreatment ?? null,
      study: plan.study ?? null,
      replacementPolicy: plan.replacementPolicy,
      liveCallBudget: plan.liveCallBudget,
      timeouts: plan.timeouts,
      postSequenceBatch: plan.postSequenceBatch,
    }),
  );
}

function hasLiveAttempt(plan: OrchestratorPlan): boolean {
  return plan.attempts.some((attempt) => attempt.gatewayMode === 'live');
}

/** §19.14 gating (no writes): refuse a live plan before any directory or
 * state exists, so a corrected first launch starts clean. */
function checkLiveInterlocks(
  plan: OrchestratorPlan,
  options: OrchestrateOptions,
  keepAwake: KeepAwakeLease | null,
): void {
  if (!hasLiveAttempt(plan)) return;
  if (process.env.M2_LIVE_RUNS !== '1' || !options.acknowledgeLiveCost) {
    throw new Error(
      'live-plan-not-acknowledged: a live plan requires BOTH M2_LIVE_RUNS=1 and --acknowledge-live-cost',
    );
  }
  if (keepAwake === null && !options.allowSleepRisk) {
    throw new Error(
      'keep-awake-unavailable: no sleep-inhibition lease could be established — ' +
        'rerun with --allow-sleep-risk to accept the risk for a live plan',
    );
  }
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

/** Exclusive single-writer lock OUTSIDE the packaged evidence root (audit
 * findings 7.1/13.3): `<root>.lock` sibling with a unique holder token. */
function acquireSequenceLock(sequenceRoot: string): () => void {
  const lockPath = `${sequenceRoot}.lock`;
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

/** Freeze identity (audit finding 3): re-verified before AND after every
 * execution. Any drift invalidates the work as `freeze-violation`. */
interface FreezeIdentity {
  repositorySha: string;
  packageVersion: string;
  planSha256: string;
  requireCleanWorktree: boolean;
}

function checkFreeze(repoRoot: string, sequenceRoot: string, freeze: FreezeIdentity): void {
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
  const archivedPlan = join(sequenceRoot, 'plan.archived.json');
  if (!existsSync(archivedPlan) || sha256(readFileSync(archivedPlan)) !== freeze.planSha256) {
    throw new Error('freeze-violation: archived plan bytes missing or altered');
  }
}

/** Pre-Start treatment verification (audit finding 2): the gateway's public
 * nonsecret configuration must match the reviewed plan exactly. */
async function verifyGatewayTreatment(plan: OrchestratorPlan): Promise<Record<string, string>> {
  const expected = plan.expectedTreatment;
  if (!expected) throw new Error('treatment-verification-without-expected-treatment');
  const response = await fetch(`${AUTOMATION_GATEWAY_URL}/v1/provider-config`);
  if (!response.ok) {
    throw new Error(`treatment-verification-unreachable: status ${response.status}`);
  }
  const config = (await response.json()) as Record<string, unknown>;
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
      );
    }
  }
  return {
    'verified-model': String(config.modelId),
    'verified-serving-provider': String(config.servingProviderId),
  };
}

/** Post-finalization manifest cross-check (audit finding 2). The frozen
 * finalizer seeds `requestedModelId` from configuration per adapter kind:
 * the model SLUG for openrouter, the adapter id (`fake-decision-adapter-v1`)
 * for the fake kind — while the public config advertises `fake-adapter` for
 * fake mode. The cross-check honors those frozen semantics. */
function verifyFinalManifestTreatment(
  runDir: string,
  plan: OrchestratorPlan,
  gatewayMode: 'fake' | 'live',
): void {
  const expected = plan.expectedTreatment;
  if (!expected) return;
  const manifest = JSON.parse(
    readFileSync(join(runDir, 'run-manifest.final.json'), 'utf8'),
  ) as Record<string, unknown>;
  const expectedManifestModel =
    gatewayMode === 'fake' ? 'fake-decision-adapter-v1' : expected.modelId;
  const checks: Array<[string, unknown, unknown]> = [
    ['requestedModelId', manifest.requestedModelId, expectedManifestModel],
    ['conditionId', manifest.conditionId, expected.conditionId],
    ['promptVersion', manifest.promptVersion, expected.promptVersion],
    ['externalProviderId', manifest.externalProviderId, EXTERNAL_MARA_PROVIDER_ID],
  ];
  for (const [field, actual, wanted] of checks) {
    if (actual !== wanted) {
      throw new AttemptFailure(
        'treatment-mismatch',
        `final manifest ${field} is '${String(actual)}', reviewed plan requires '${String(wanted)}'`,
      );
    }
  }
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

interface AttemptOutcome {
  execution: AttemptExecution;
  failure: AttemptFailure | Error | null;
}

async function executeAttempt(
  browser: Browser,
  processManager: ProcessManager,
  plan: OrchestratorPlan,
  attempt: PlannedAttempt,
  sequenceRoot: string,
  repoRoot: string,
  execution: AttemptExecution,
): Promise<AttemptOutcome> {
  const attemptDir = join(sequenceRoot, execution.dir);
  mkdirSync(attemptDir, { recursive: true });
  let gateway: ManagedProcess | null = null;
  let plannedStopIssued = false;
  const traceDir = join(attemptDir, 'gateway');
  try {
    if (attempt.gatewayMode !== 'off') {
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
      const evidence = finalizeDeterministicAttempt(attemptDir, browserResult.ledgerPath);
      execution.verdicts['ledger-validated'] = true;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(`${execution.dir}/behavior-fingerprint.json`);
      void evidence;
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
        plan,
        attempt.gatewayMode === 'live' ? 'live' : 'fake',
      );
      execution.verdicts['strict-finalized'] = evidence.finalize.status;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(
        `${execution.dir}/gateway/${browserResult.runId}/bundle-manifest.json`,
        `${execution.dir}/behavior-fingerprint.json`,
      );
    }

    execution.status = 'completed';
    execution.endedAtUtc = nowUtc();
    execution.seal = sealExecution(sequenceRoot, execution.dir);
    return { execution, failure: null };
  } catch (error: unknown) {
    if (gateway) await processManager.stop(gateway, 5_000);
    const failure = error instanceof Error ? error : new Error(String(error));
    execution.status = 'failed';
    execution.failureReason = failure instanceof AttemptFailure ? failure.reason : 'error';
    execution.endedAtUtc = nowUtc();
    // Preserve the thrown message and bounded process context even when the
    // browser driver could not write diagnostics itself (finding 6): the
    // always-saved browser artifacts (trace, DOM, screenshot, console log)
    // already live in the attempt directory for post-browser failures.
    writeFileSync(
      join(attemptDir, 'failure-message.txt'),
      `${execution.failureReason}: ${failure.message}\n`,
      'utf8',
    );
    writeFileSync(
      join(attemptDir, 'context-logs.txt'),
      `--- vite.log (tail) ---\n${tailOf(join(sequenceRoot, 'vite.log'), 200)}\n` +
        `--- process-log.jsonl (tail) ---\n${tailOf(join(sequenceRoot, 'process-log.jsonl'), 100)}\n`,
      'utf8',
    );
    return { execution, failure };
  }
}

export async function orchestrateSequence(options: OrchestrateOptions): Promise<OrchestrateResult> {
  const planBytes = readFileSync(options.planPath);
  const loaded: LoadedPlan = parsePlan(planBytes);
  const { plan } = loaded;
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
  if (plan.study !== undefined) {
    const studyPath = isAbsolute(plan.study.studyPlanPath)
      ? plan.study.studyPlanPath
      : resolve(options.repoRoot, plan.study.studyPlanPath);
    const validated = validateStudyFile(studyPath);
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
  }
  const repositorySha = headSha(options.repoRoot);
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
    packageVersion: packageVersion(options.repoRoot),
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
    configFingerprint: planConfigFingerprint(plan),
  };
  const freeze: FreezeIdentity = {
    repositorySha,
    packageVersion: identity.packageVersion,
    planSha256: loaded.planSha256,
    requireCleanWorktree: plan.evidentiary,
  };

  let state = readSequenceState(sequenceRoot);
  if (state && !options.resume) {
    throw new Error(
      `sequence-already-exists: ${sequenceRoot} — use --resume to continue it (identity-checked)`,
    );
  }
  if (!state && options.resume) {
    throw new Error(`resume-without-state: no sequence-state.json under ${sequenceRoot}`);
  }
  if (state) {
    assertResumeIdentity(state, identity); // read-only refusal on mismatch
  } else if (existsSync(sequenceRoot) && readdirSync(sequenceRoot).length > 0) {
    throw new Error(
      `sequence-root-not-empty: ${sequenceRoot} contains files but no sequence-state.json — refusing to adopt it`,
    );
  }

  // ---- No-op resume of a completed sequence (finding 4): verify seals and
  // return without launching anything or changing any byte. ----------------
  if (
    state &&
    state.status === 'completed' &&
    plan.attempts.every((attempt) => completedExecution(state!, attempt.attemptId) !== null)
  ) {
    verifySealedExecutions(sequenceRoot, state);
    console.log(
      'no-op resume: sequence already completed; all execution seals verified; nothing launched',
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

  const keepAwake = await acquireKeepAwake();
  if (keepAwake === null) {
    console.warn('WARNING: no keep-awake lease could be established — the machine may sleep.');
  }
  checkLiveInterlocks(plan, options, keepAwake);

  // ---- Write path begins. -------------------------------------------------
  mkdirSync(sequenceRoot, { recursive: true });
  const releaseLock = acquireSequenceLock(sequenceRoot);
  const processManager = new ProcessManager(join(sequenceRoot, 'process-log.jsonl'));
  let browser: Browser | null = null;
  let batchVerdict: string | null = null;
  let evaluation: SequenceEvaluation | null = null;
  let zipPath: string | null = null;

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

  try {
    // Archive the exact reviewed plan bytes (finding 3) and record the
    // immutable acknowledgement (finding 4).
    const archivedPlanPath = join(sequenceRoot, 'plan.archived.json');
    if (!existsSync(archivedPlanPath)) {
      copyFileSync(options.planPath, archivedPlanPath);
    }
    if (sha256(readFileSync(archivedPlanPath)) !== loaded.planSha256) {
      throw new Error('freeze-violation: archived plan bytes do not match the reviewed plan');
    }
    recordLiveAcknowledgement(plan, sequenceRoot);

    if (state) {
      verifySealedExecutions(sequenceRoot, state); // finding 4: before continuing
      const interrupted = markInterruptedExecutions(state, nowUtc());
      state.status = 'in-progress';
      persist(`resumed (${interrupted} interrupted execution(s) preserved)`);
    } else {
      state = {
        stateVersion: SEQUENCE_STATE_VERSION,
        sequenceId: plan.sequenceId,
        ...identity,
        status: 'in-progress',
        sequenceFailureReason: null,
        archivePath: null,
        archiveSha256: null,
        executions: [],
        lastTransition: 'created',
        createdAtUtc: nowUtc(),
        updatedAtUtc: nowUtc(),
      };
      writeSequenceState(sequenceRoot, state);
    }

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

    let sequenceFailed = false;
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
          break;
        }
        // Freeze recheck before every execution (finding 3).
        checkFreeze(options.repoRoot, sequenceRoot, freeze);

        const executionId = nextExecutionId(state, attempt.attemptId);
        const execution: AttemptExecution = {
          executionId,
          attemptId: attempt.attemptId,
          status: 'in-progress',
          seal: null,
          failureReason: null,
          runId: null,
          dir: `attempt-${executionId}`,
          artifacts: [],
          verdicts: {},
          startedAtUtc: nowUtc(),
          endedAtUtc: null,
        };
        state.executions.push(execution);
        persist(`execution-started:${executionId}`);

        const outcome = await executeAttempt(
          browser,
          processManager,
          plan,
          attempt,
          sequenceRoot,
          options.repoRoot,
          execution,
        );

        // Freeze recheck AFTER the execution (finding 3): drift during an
        // attempt preserves the work but invalidates it.
        try {
          checkFreeze(options.repoRoot, sequenceRoot, freeze);
        } catch (freezeError: unknown) {
          execution.status = 'failed';
          execution.failureReason = 'freeze-violation';
          execution.seal = null;
          execution.endedAtUtc = nowUtc();
          writeFileSync(
            join(sequenceRoot, execution.dir, 'failure-message.txt'),
            `freeze-violation: ${
              freezeError instanceof Error ? freezeError.message : String(freezeError)
            }\n`,
            'utf8',
          );
        }
        persist(`execution-${execution.status}:${executionId}`);

        if (execution.status === 'completed') {
          attemptCompleted = true;
        } else {
          console.error(
            `attempt ${attempt.attemptId} execution ${executionId} FAILED ` +
              `(${execution.failureReason ?? 'error'}); evidence preserved in ${execution.dir}`,
          );
          // Replacements are restricted to registered retryable classes
          // (finding 8): integrity and treatment violations halt.
          if (
            !plan.replacementPolicy.retryableFailureClasses.includes(
              execution.failureReason ?? 'error',
            )
          ) {
            console.error(
              `failure class '${execution.failureReason ?? 'error'}' is not registered as ` +
                'retryable — sequence fails without spending a replacement',
            );
            sequenceFailed = true;
            break;
          }
        }
        void outcome;
      }
      if (sequenceFailed) break;
    }

    state.status = sequenceFailed ? 'failed' : 'attempts-complete';
    if (sequenceFailed && state.sequenceFailureReason === null) {
      state.sequenceFailureReason = 'attempt-failures-exhausted-policy';
    }
    persist(sequenceFailed ? 'sequence-failed:attempts' : 'attempts-complete');

    // Stop the browser and every remaining child BEFORE the derived reports
    // so exit codes land in the append-only process log (§19.5).
    const browserVersion = browser.version();
    await browser.close().catch(() => undefined);
    browser = null;
    await processManager.stopAll();

    if (!sequenceFailed && plan.postSequenceBatch) {
      const batch = processManager.spawnManaged({
        name: 'post-sequence-batch',
        command: process.execPath,
        args: [tsxCliPath(options.repoRoot), join(options.repoRoot, 'scripts', 'batch', 'run.ts')],
        cwd: options.repoRoot,
        env: batchChildEnv(process.env),
        logPath: join(sequenceRoot, 'post-sequence-batch.log'),
      });
      const exit = await batch.exited;
      batchVerdict = exit === '0' ? 'PASSED' : `FAILED (exit ${exit})`;
      if (exit !== '0') {
        sequenceFailed = true;
        state.status = 'failed';
        state.sequenceFailureReason = `post-sequence-batch: exit ${exit}`;
        persist('sequence-failed:batch');
      }
    }

    if (!sequenceFailed) {
      state.status = 'validating';
      persist('validating-sequence');
    }
    evaluation = evaluateFromState(sequenceRoot, state);

    writeSequenceReport(sequenceRoot, state, {
      browserVersion,
      launchFlags: [options.headed ? '--headed' : 'headless'],
      processLog: readProcessLog(sequenceRoot),
      batchVerdict,
      evaluation,
    });

    if (!sequenceFailed) {
      state.status = 'packaging';
      persist('packaging');
      zipPath = resolve(sequenceRoot, '..', `${plan.sequenceId}-evidence.zip`);
      const packaged = await packageSequence(sequenceRoot, zipPath, {
        sequenceId: plan.sequenceId,
        planSha256: loaded.planSha256,
        repositorySha,
      });
      state.archivePath = packaged.zipPath;
      state.archiveSha256 = packaged.zipSha256;
      // `completed` is written ONLY here, after the archive and receipt
      // verified (finding 5).
      state.status = 'completed';
      persist('sequence-completed');
    }

    return {
      sequenceRoot,
      status: state.status === 'completed' ? 'completed' : 'failed',
      executions: state.executions.length,
      failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
        .length,
      zipPath,
      noOpResume: false,
    };
  } catch (error: unknown) {
    recordSequenceFailure('orchestration', error);
    throw error;
  } finally {
    if (browser) await (browser as Browser).close().catch(() => undefined);
    await processManager.stopAll();
    keepAwake?.release();
    releaseLock();
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
