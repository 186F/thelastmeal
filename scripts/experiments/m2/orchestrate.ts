import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
// Phase 3 drives the existing Milestone 1 experiment paths; the sequence
// identity records THAT experiment. The M2 experiment identity joins in
// Phase 4 when its condition becomes orchestratable.
import { MODEL_EXPERIMENT_ID, MODEL_EXPERIMENT_VERSION } from '../../../src/shared/modelExperiment';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { fnv1a64Hex } from '../../../src/sim/replay/hash';
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
  writeSequenceState,
  SEQUENCE_STATE_VERSION,
  type AttemptExecution,
} from './sequenceState';
import { ProcessManager, type ManagedProcess } from './processManager';
import { startGateway, portIsFree, tsxCliPath } from './gatewayDriver';
import {
  AUTOMATION_GATEWAY_PORT,
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

/**
 * The unattended sequence orchestrator (M2 brief §19): one command runs a
 * complete planned sequence — preflight, one strict-fixed-port Vite server,
 * a fresh gateway process and a fresh browser context per attempt, paced
 * unattended runs through the real operator surface, automatic downloads,
 * in-browser replay gates, strict finalization, fingerprints, atomic
 * sequence state, failed-attempt preservation with replacement policy,
 * cross-run evaluation, secret scan, SHA256 inventory, and a portable ZIP.
 *
 * Secret boundary (§19.15): this process NEVER reads `.env.gateway` or any
 * credential. Live gateways are child processes that load their own config.
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
}

function nowUtc(): string {
  return new Date().toISOString();
}

function headSha(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function packageVersion(repoRoot: string): string {
  return (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string })
    .version;
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

/** §19.14: the live interlocks, printed and recorded before anything runs. */
function enforceLiveInterlocks(
  plan: OrchestratorPlan,
  sequenceRoot: string,
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
  const liveAttempts = plan.attempts.filter((attempt) => attempt.gatewayMode === 'live');
  const acknowledgement = {
    plannedLiveAttempts: liveAttempts.length,
    maxReplacementAttempts: plan.replacementPolicy.maxReplacementAttempts,
    perAttemptCaps: liveAttempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      maxCallsPerRun: attempt.maxCallsPerRun ?? null,
      maxTotalCalls: attempt.maxTotalCalls ?? null,
    })),
    acknowledgedLiveCallBudget: plan.liveCallBudget,
    note: 'model and provider are pinned by the gateway configuration; the orchestrator never reads them',
  };
  console.log(`live interlocks: ${JSON.stringify(acknowledgement)}`);
  writeFileSync(
    join(sequenceRoot, 'cost-acknowledgement.json'),
    `${JSON.stringify(acknowledgement, null, 2)}\n`,
    'utf8',
  );
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
      });
    }

    const browserResult = await runBrowserAttempt(browser, {
      origin: AUTOMATION_ORIGIN,
      attempt,
      attemptDir,
      timeouts: plan.timeouts,
      onGatewayStopTick:
        attempt.gatewayStopAtTick !== undefined && gateway !== null
          ? async () => {
              await processManager.stop(gateway!, 5_000);
            }
          : undefined,
    });

    // Stop the gateway BEFORE finalization (§19.4 order); harmless when the
    // planned stop already ended it.
    if (gateway) await processManager.stop(gateway, 5_000);

    execution.runId = browserResult.runId;
    execution.verdicts['replay-match'] = true;
    execution.verdicts['replay-verdict'] = browserResult.replayVerdict;
    execution.verdicts['final-tick'] = browserResult.finalTick;
    execution.verdicts['heartbeats'] = browserResult.heartbeatCount;
    execution.artifacts.push(`${execution.dir}/heartbeat.jsonl`);

    if (attempt.conditionId === 'deterministic-baseline-v1') {
      const evidence = finalizeDeterministicAttempt(attemptDir, browserResult.ledgerPath);
      execution.verdicts['ledger-validated'] = true;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(
        `${execution.dir}/${basenameOf(evidence.ledgerPath)}`,
        `${execution.dir}/behavior-fingerprint.json`,
      );
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
      execution.verdicts['strict-finalized'] = evidence.finalize.status;
      execution.verdicts['fingerprint'] = true;
      execution.artifacts.push(
        `${execution.dir}/gateway/${browserResult.runId}/bundle-manifest.json`,
        `${execution.dir}/behavior-fingerprint.json`,
      );
    }

    execution.status = 'completed';
    execution.endedAtUtc = nowUtc();
    return { execution, failure: null };
  } catch (error: unknown) {
    if (gateway) await processManager.stop(gateway, 5_000);
    const failure = error instanceof Error ? error : new Error(String(error));
    execution.status = 'failed';
    execution.failureReason = failure instanceof AttemptFailure ? failure.reason : 'error';
    execution.endedAtUtc = nowUtc();
    // Preserve the thrown message even when the browser driver could not
    // write failure.json itself (e.g. finalize-stage failures).
    writeFileSync(
      join(attemptDir, 'failure-message.txt'),
      `${execution.failureReason}: ${failure.message}\n`,
      'utf8',
    );
    return { execution, failure };
  }
}

function basenameOf(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() ?? path;
}

export async function orchestrateSequence(options: OrchestrateOptions): Promise<OrchestrateResult> {
  const planBytes = readFileSync(options.planPath);
  const loaded: LoadedPlan = parsePlan(planBytes);
  const { plan } = loaded;
  const sequenceRoot = isAbsolute(plan.outputRoot)
    ? plan.outputRoot
    : resolve(options.repoRoot, plan.outputRoot);
  mkdirSync(sequenceRoot, { recursive: true });

  const repositorySha = headSha(options.repoRoot);
  if (plan.repositorySha !== undefined && plan.repositorySha !== repositorySha) {
    throw new Error(
      `frozen-sha-mismatch: plan pins ${plan.repositorySha}, HEAD is ${repositorySha}`,
    );
  }
  const identity = {
    planSha256: loaded.planSha256,
    repositorySha,
    packageVersion: packageVersion(options.repoRoot),
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    configFingerprint: planConfigFingerprint(plan),
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
    assertResumeIdentity(state, identity);
    const interrupted = markInterruptedExecutions(state, nowUtc());
    state.status = 'in-progress';
    state.lastTransition = `resumed (${interrupted} interrupted execution(s) preserved)`;
    state.updatedAtUtc = nowUtc();
    writeSequenceState(sequenceRoot, state);
  } else {
    state = {
      stateVersion: SEQUENCE_STATE_VERSION,
      sequenceId: plan.sequenceId,
      ...identity,
      status: 'in-progress',
      executions: [],
      lastTransition: 'created',
      createdAtUtc: nowUtc(),
      updatedAtUtc: nowUtc(),
    };
    writeSequenceState(sequenceRoot, state);
  }

  const keepAwake = acquireKeepAwake();
  if (keepAwake === null) {
    console.warn('WARNING: no keep-awake lease could be established — the machine may sleep.');
  }
  const processManager = new ProcessManager();
  let browser: Browser | null = null;
  let batchVerdict: string | null = null;
  let evaluation: SequenceEvaluation | null = null;
  let zipPath: string | null = null;
  try {
    enforceLiveInterlocks(plan, sequenceRoot, options, keepAwake);

    // Preflight (§19.6): both automation ports must be free; no fallback.
    if (!(await portIsFree(AUTOMATION_VITE_PORT))) {
      throw new Error(`preflight-port-occupied: vite port ${AUTOMATION_VITE_PORT}`);
    }
    if (!(await portIsFree(AUTOMATION_GATEWAY_PORT))) {
      throw new Error(`preflight-port-occupied: gateway port ${AUTOMATION_GATEWAY_PORT}`);
    }
    tsxCliPath(options.repoRoot); // fail fast when node_modules is incomplete

    await startVite(processManager, {
      repoRoot: options.repoRoot,
      logPath: join(sequenceRoot, 'vite.log'),
    });
    browser = await chromium.launch({ headless: !options.headed });

    let sequenceFailed = false;
    for (const attempt of plan.attempts) {
      if (completedExecution(state, attempt.attemptId)) continue;
      let replacementsUsed = state.executions.filter(
        (execution) => execution.attemptId === attempt.attemptId && execution.status === 'failed',
      ).length;
      let attemptCompleted = false;
      while (!attemptCompleted) {
        const executionId = nextExecutionId(state, attempt.attemptId);
        const execution: AttemptExecution = {
          executionId,
          attemptId: attempt.attemptId,
          status: 'in-progress',
          failureReason: null,
          runId: null,
          dir: `attempt-${executionId}`,
          artifacts: [],
          verdicts: {},
          startedAtUtc: nowUtc(),
          endedAtUtc: null,
        };
        state.executions.push(execution);
        state.lastTransition = `execution-started:${executionId}`;
        state.updatedAtUtc = nowUtc();
        writeSequenceState(sequenceRoot, state);

        const outcome = await executeAttempt(
          browser,
          processManager,
          plan,
          attempt,
          sequenceRoot,
          options.repoRoot,
          execution,
        );
        state.lastTransition = `execution-${outcome.execution.status}:${executionId}`;
        state.updatedAtUtc = nowUtc();
        writeSequenceState(sequenceRoot, state);

        if (outcome.execution.status === 'completed') {
          attemptCompleted = true;
        } else {
          replacementsUsed += 1;
          console.error(
            `attempt ${attempt.attemptId} execution ${executionId} FAILED ` +
              `(${outcome.execution.failureReason ?? 'error'}); evidence preserved in ${execution.dir}`,
          );
          if (replacementsUsed > plan.replacementPolicy.maxReplacementAttempts) {
            sequenceFailed = true;
            break;
          }
        }
      }
      if (sequenceFailed) break;
    }

    if (!sequenceFailed && plan.postSequenceBatch) {
      const batchLog = join(sequenceRoot, 'post-sequence-batch.log');
      const batch = processManager.spawnManaged({
        name: 'post-sequence-batch',
        command: process.execPath,
        args: [tsxCliPath(options.repoRoot), join(options.repoRoot, 'scripts', 'batch', 'run.ts')],
        cwd: options.repoRoot,
        env: { ...process.env },
        logPath: batchLog,
      });
      const exit = await batch.exited;
      batchVerdict = exit === '0' ? 'PASSED' : `FAILED (exit ${exit})`;
      if (exit !== '0') sequenceFailed = true;
    }

    evaluation = evaluateFromState(sequenceRoot, state);
    state.status = sequenceFailed ? 'failed' : 'completed';
    state.lastTransition = sequenceFailed ? 'sequence-failed' : 'sequence-completed';
    state.updatedAtUtc = nowUtc();
    writeSequenceState(sequenceRoot, state);

    writeSequenceReport(sequenceRoot, state, {
      browserVersion: browser.version(),
      launchFlags: [options.headed ? '--headed' : 'headless'],
      processTable: processManager.processTable(),
      batchVerdict,
      evaluation,
    });

    if (!sequenceFailed) {
      zipPath = resolve(sequenceRoot, '..', `${plan.sequenceId}-evidence.zip`);
      await packageSequence(sequenceRoot, zipPath);
    }

    return {
      sequenceRoot,
      status: state.status === 'completed' ? 'completed' : 'failed',
      executions: state.executions.length,
      failedExecutions: state.executions.filter((execution) => execution.status === 'failed')
        .length,
      zipPath,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await processManager.stopAll();
    keepAwake?.release();
  }
}
