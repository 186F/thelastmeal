import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { orchestrateSequence, type OrchestrateResult } from './orchestrate';
import { readSequenceState } from './sequenceState';
import { portIsFree } from './gatewayDriver';
import { AUTOMATION_GATEWAY_PORT, AUTOMATION_VITE_PORT } from './viteDriver';
import { behaviorFingerprintSetSchema } from '../../../src/shared/behaviorArtifacts';

/**
 * `npm run m2:rehearse -- [--ci]`
 *
 * Self-verifying keyless orchestrator rehearsal (M2 brief §19.16 precursor;
 * the gateway-stop path demonstrated keylessly BEFORE any live spend).
 * Drives the COMPLETE unattended pipeline — real Vite on the strict
 * automation port, real Chromium, a fresh fake-adapter gateway child
 * process per model attempt, real downloads, in-browser replay, strict
 * finalization, enrichment, packaging — then asserts the §19 properties:
 *
 *   1. the three-attempt keyless plan completes unattended
 *      (deterministic baseline / per-decision fake / mid-run gateway stop);
 *   2. the gateway-stop attempt preserves emitted > attempted upstream;
 *   3. `--resume` on the completed sequence is idempotent (no new
 *      executions; derived reports regenerated);
 *   4. resume under a modified plan is REFUSED (identity mismatch);
 *   5. the failure drill produces a preserved failed attempt (run-timeout)
 *      with diagnostics, heartbeats, and a failed sequence state.
 *
 * All rehearsal output is non-evidentiary and lives under artifacts/.
 */

class RehearsalAssertion extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RehearsalAssertion(message);
}

async function waitForAutomationPortsFree(): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await portIsFree(AUTOMATION_VITE_PORT)) && (await portIsFree(AUTOMATION_GATEWAY_PORT))) {
      return;
    }
    if (Date.now() > deadline) throw new RehearsalAssertion('automation-ports-not-released');
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
}

export async function runM2Rehearsal(repoRoot: string): Promise<{
  ok: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  const rehearsalPlan = join(repoRoot, 'experiments', 'm2', 'plans', 'rehearsal.json');
  const failureDrillPlan = join(repoRoot, 'experiments', 'm2', 'plans', 'failure-drill.json');
  const rehearsalRoot = resolve(repoRoot, 'artifacts', 'm2-sequences', 'rehearsal');
  const failureRoot = resolve(repoRoot, 'artifacts', 'm2-sequences', 'failure-drill');
  const reportDir = resolve(repoRoot, 'artifacts', 'm2-rehearsal');

  // Non-evidentiary roots: cleared at start so every rehearsal is fresh.
  for (const root of [rehearsalRoot, failureRoot, reportDir]) {
    rmSync(root, { recursive: true, force: true });
  }
  rmSync(resolve(rehearsalRoot, '..', 'm2-orchestrator-rehearsal-evidence.zip'), { force: true });
  mkdirSync(reportDir, { recursive: true });

  // --- 1. The keyless three-attempt sequence, unattended. -------------------
  const first: OrchestrateResult = await orchestrateSequence({
    planPath: rehearsalPlan,
    resume: false,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot,
  });
  check(first.status === 'completed', `rehearsal sequence status ${first.status}`);
  check(first.executions === 3, `expected 3 executions, saw ${first.executions}`);
  check(
    first.failedExecutions === 0,
    `expected 0 failed executions, saw ${first.failedExecutions}`,
  );
  check(first.zipPath !== null && existsSync(first.zipPath), 'evidence zip missing');
  notes.push(`sequence completed: 3/3 executions; zip ${first.zipPath}`);

  const state = readSequenceState(rehearsalRoot);
  check(state !== null, 'sequence state missing');
  for (const execution of state.executions) {
    check(execution.status === 'completed', `execution ${execution.executionId} not completed`);
    check(
      execution.verdicts['replay-match'] === true,
      `no replay match for ${execution.executionId}`,
    );
    check(
      existsSync(join(rehearsalRoot, execution.dir, 'heartbeat.jsonl')),
      `no heartbeat for ${execution.executionId}`,
    );
  }
  const modelExecutions = state.executions.filter((execution) => execution.runId !== null);
  check(modelExecutions.length === 2, 'expected 2 model executions with run ids');
  for (const execution of modelExecutions) {
    check(
      execution.verdicts['strict-finalized'] === 'completed',
      `model execution ${execution.executionId} not strict-finalized`,
    );
  }

  // The gateway-stop drill must preserve the emitted-versus-called
  // distinction in its ENRICHED fingerprint (the M1 Run 6 shape, keyless).
  const stopExecution = state.executions.find(
    (execution) => execution.attemptId === 'a-model-fake-gateway-stop',
  );
  check(stopExecution !== undefined, 'gateway-stop execution missing');
  const stopFingerprints = behaviorFingerprintSetSchema.parse(
    JSON.parse(
      readFileSync(join(rehearsalRoot, stopExecution.dir, 'behavior-fingerprint.json'), 'utf8'),
    ),
  );
  const stopMara = stopFingerprints.npcs.mara;
  check(
    typeof stopMara.upstreamActionCallsAttempted === 'number' &&
      stopMara.externalActionRequestsEmitted > stopMara.upstreamActionCallsAttempted,
    `gateway-stop drill: emitted ${stopMara.externalActionRequestsEmitted} not > attempted ${String(
      stopMara.upstreamActionCallsAttempted,
    )}`,
  );
  notes.push(
    `gateway-stop drill: emitted ${stopMara.externalActionRequestsEmitted}, ` +
      `attempted ${String(stopMara.upstreamActionCallsAttempted)}, ` +
      `completed ${String(stopMara.upstreamActionCallsCompleted)}`,
  );

  // --- 2. Idempotent resume on the completed sequence. ----------------------
  await waitForAutomationPortsFree();
  const resumed = await orchestrateSequence({
    planPath: rehearsalPlan,
    resume: true,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot,
  });
  check(resumed.status === 'completed', `resume status ${resumed.status}`);
  check(
    resumed.executions === 3,
    `resume created new executions: ${resumed.executions} (expected 3)`,
  );
  notes.push('resume on completed sequence: idempotent (no new executions; reports regenerated)');

  // --- 3. Resume under a modified plan is refused. --------------------------
  const mutatedPlanPath = join(reportDir, 'rehearsal-mutated-plan.json');
  const mutatedPlan = JSON.parse(readFileSync(rehearsalPlan, 'utf8')) as Record<string, unknown>;
  mutatedPlan.description = 'MUTATED for the resume-identity drill';
  writeFileSync(mutatedPlanPath, JSON.stringify(mutatedPlan, null, 2), 'utf8');
  let identityRefused = false;
  await waitForAutomationPortsFree();
  try {
    await orchestrateSequence({
      planPath: mutatedPlanPath,
      resume: true,
      acknowledgeLiveCost: false,
      allowSleepRisk: true,
      headed: false,
      repoRoot,
    });
  } catch (error: unknown) {
    identityRefused =
      error instanceof Error && error.message.startsWith('resume-identity-mismatch');
  }
  check(identityRefused, 'mutated-plan resume was not refused with resume-identity-mismatch');
  notes.push('mutated-plan resume refused (resume-identity-mismatch)');

  // --- 4. Failure drill: run-timeout produces a preserved failed attempt. ---
  await waitForAutomationPortsFree();
  const drill = await orchestrateSequence({
    planPath: failureDrillPlan,
    resume: false,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot,
  });
  check(drill.status === 'failed', `failure drill status ${drill.status} (expected failed)`);
  const drillState = readSequenceState(failureRoot);
  check(drillState !== null && drillState.status === 'failed', 'drill state not failed');
  const drillExecution = drillState.executions[0];
  check(drillExecution !== undefined, 'drill execution missing');
  check(
    drillExecution.status === 'failed' && drillExecution.failureReason === 'run-timeout',
    `drill failure reason ${String(drillExecution?.failureReason)} (expected run-timeout)`,
  );
  const drillDir = join(failureRoot, drillExecution.dir);
  for (const artifact of ['failure.json', 'failure-screenshot.png', 'heartbeat.jsonl']) {
    check(existsSync(join(drillDir, artifact)), `drill artifact missing: ${artifact}`);
  }
  notes.push('failure drill: run-timeout attempt preserved with diagnostics and heartbeats');

  return { ok: true, notes };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const repoRoot = process.cwd();
  runM2Rehearsal(repoRoot).then(
    (result) => {
      const reportPath = join(repoRoot, 'artifacts', 'm2-rehearsal', 'm2-rehearsal-report.json');
      writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(`m2:rehearse — OK\n${result.notes.map((note) => `  - ${note}`).join('\n')}`);
      process.exitCode = 0;
    },
    (error: unknown) => {
      console.error(
        `m2:rehearse FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    },
  );
}
