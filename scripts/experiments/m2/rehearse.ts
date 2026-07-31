import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { orchestrateSequence, type OrchestrateResult } from './orchestrate';
import { readSequenceState, stateFilePath } from './sequenceState';
import { readInventory, verifyTreeAgainstInventory } from './packageEvidence';
import { sequenceManifestSchema } from './reporting';
import { runCli } from './cli';
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
 * finalization, enrichment, packaging — then asserts the §19 properties
 * and the re-audit's evidence-governance mechanisms:
 *
 *   1. the three-attempt keyless plan completes unattended with every
 *      execution artifact-valid, study-valid under the rehearsal profile,
 *      sealed, and inside a versioned receipt-verified archive whose root
 *      still matches its inventory byte-for-byte;
 *   2. the gateway-stop attempt preserves emitted > attempted upstream;
 *   3. `--resume` on the completed sequence is a NO-OP that verifies
 *      seals, inventory, manifest, semantic revalidation, archive, and
 *      receipt without changing a byte or launching a process;
 *   4. resume under a modified plan is REFUSED (identity mismatch);
 *   5. the failure drill produces a preserved, SEALED failed attempt
 *      (run-timeout, disposition `forbidden`) with diagnostics, a typed
 *      failure manifest, and a failed sequence state;
 *   6. resuming the failed drill is REFUSED by the recorded disposition;
 *   7. `m2:evaluate` on the completed sequence writes ONLY to the derived
 *      directory — the sealed root stays byte-identical.
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
  const sequencesRoot = resolve(repoRoot, 'artifacts', 'm2-sequences');
  const rehearsalRoot = join(sequencesRoot, 'rehearsal');
  const failureRoot = join(sequencesRoot, 'failure-drill');
  const reportDir = resolve(repoRoot, 'artifacts', 'm2-rehearsal');

  // Non-evidentiary roots (sequence roots, control roots, derived dirs,
  // versioned archives): cleared at start so every rehearsal is fresh.
  rmSync(sequencesRoot, { recursive: true, force: true });
  rmSync(reportDir, { recursive: true, force: true });
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
  check(
    first.zipPath!.endsWith('m2-orchestrator-rehearsal-evidence-001.zip'),
    `archive name not versioned: ${first.zipPath!}`,
  );
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
    // Re-audit finding 3: artifact validity and study validity are separate
    // recorded verdicts, both required for a completed primary observation.
    check(
      execution.artifactStatus === 'artifact-valid',
      `execution ${execution.executionId} artifactStatus ${String(execution.artifactStatus)}`,
    );
    check(
      execution.studyStatus === 'study-valid',
      `execution ${execution.executionId} studyStatus ${String(execution.studyStatus)}`,
    );
    // Re-audit §13.2/§13.3: per-execution browser provenance and exactly
    // one main-frame navigation.
    check(
      execution.browserProvenance !== null &&
        execution.browserProvenance.playwrightVersion.length > 0,
      `execution ${execution.executionId} missing browser provenance`,
    );
    check(
      execution.navigationCount === 1,
      `execution ${execution.executionId} navigationCount ${String(execution.navigationCount)}`,
    );
  }
  const modelExecutions = state.executions.filter((execution) => execution.runId !== null);
  check(modelExecutions.length === 2, 'expected 2 model executions with run ids');
  for (const execution of modelExecutions) {
    check(
      execution.verdicts['strict-finalized'] === 'completed',
      `model execution ${execution.executionId} not strict-finalized`,
    );
    check(
      execution.verdicts['verified-model'] === 'fake-adapter' &&
        execution.verdicts['verified-serving-provider'] === 'local',
      `model execution ${execution.executionId} missing pre-Start treatment verification`,
    );
    // Re-audit finding 3: threshold verdicts recorded under the rehearsal
    // profile, all passing.
    check(
      execution.thresholdVerdicts !== null &&
        execution.thresholdVerdicts.length > 0 &&
        execution.thresholdVerdicts.every((verdict) => verdict.pass),
      `model execution ${execution.executionId} missing passing threshold verdicts`,
    );
  }
  // Every completed execution is sealed (completed seal) and carries its
  // always-saved diagnostics.
  for (const execution of state.executions) {
    check(
      execution.seal !== null && execution.seal.sealedStatus === 'completed',
      `execution ${execution.executionId} has no completed seal`,
    );
    for (const artifact of [
      'attempt-trace.zip',
      'final-screenshot.png',
      'final-dom.html',
      'console-log.json',
      'diagnostics-manifest.json',
    ]) {
      check(
        existsSync(join(rehearsalRoot, execution.dir, artifact)),
        `execution ${execution.executionId} missing ${artifact}`,
      );
    }
  }
  // Re-audit finding 1: the completed root still matches its recorded
  // inventory byte-for-byte (nothing changed after packaging), the final
  // evidence manifest describes the completed attempt set, and the archive
  // receipt agrees with the state and inventory.
  const inventory = readInventory(rehearsalRoot);
  check(inventory !== null, 'sha256-inventory.json missing from completed root');
  check(
    state.inventoryAggregateSha256 === inventory.aggregateSha256,
    'state inventory aggregate disagrees with the inventory file',
  );
  verifyTreeAgainstInventory(rehearsalRoot, inventory, 'rehearsal-post-completion');
  const manifest = sequenceManifestSchema.parse(
    JSON.parse(readFileSync(join(rehearsalRoot, 'sequence-manifest.json'), 'utf8')),
  );
  check(manifest.attemptSetComplete, 'manifest does not record a complete attempt set');
  check(
    manifest.sequenceOutcome === 'evidence-finalized',
    `manifest outcome ${manifest.sequenceOutcome}`,
  );
  check(
    manifest.executions.every((execution) => execution.status === 'completed'),
    'manifest holds non-completed executions',
  );
  for (const expected of [
    'pre-batch',
    'pre-evaluation',
    'post-evaluation',
    'pre-package',
    'post-package',
  ]) {
    check(
      state.freezeCheckpoints.some((entry) => entry.checkpoint === expected),
      `freeze checkpoint '${expected}' missing`,
    );
  }
  check(existsSync(`${first.zipPath!}.sha256`), 'archive .sha256 receipt missing');
  const receipt = JSON.parse(readFileSync(`${first.zipPath!}.receipt.json`, 'utf8')) as {
    archiveSha256: string;
    inventoryAggregateSha256: string;
    planSha256: string;
    repositorySha: string;
  };
  check(
    state.archiveSha256 === receipt.archiveSha256,
    'archive receipt sha does not match sequence state',
  );
  check(
    receipt.inventoryAggregateSha256 === inventory.aggregateSha256 &&
      receipt.planSha256 === state.planSha256 &&
      receipt.repositorySha === state.repositorySha,
    'archive receipt identity fields disagree',
  );
  notes.push('completed root immutable vs inventory; manifest + receipt verified');
  // Planned-stop evidence (audit finding 8).
  const stopVerdict = state.executions.find(
    (execution) => execution.attemptId === 'a-model-fake-gateway-stop',
  )!.verdicts['gateway-stop'];
  check(
    typeof stopVerdict === 'string' && (JSON.parse(stopVerdict) as { fired: boolean }).fired,
    'planned gateway stop was not evidenced as fired',
  );

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

  // --- 2. No-op resume on the completed sequence (re-audit findings 1+5):
  // seals, inventory, manifest, semantic revalidation, archive, and receipt
  // all verified; NOTHING launched; no byte of state or evidence changed. --
  const processLogBefore = readFileSync(join(rehearsalRoot, 'process-log.jsonl'), 'utf8');
  const stateBytesBefore = readFileSync(stateFilePath(rehearsalRoot), 'utf8');
  const resumed = await orchestrateSequence({
    planPath: rehearsalPlan,
    resume: true,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot,
  });
  check(resumed.status === 'completed', `resume status ${resumed.status}`);
  check(resumed.noOpResume, 'completed-sequence resume was not a no-op');
  check(
    resumed.executions === 3,
    `resume created new executions: ${resumed.executions} (expected 3)`,
  );
  check(
    readFileSync(join(rehearsalRoot, 'process-log.jsonl'), 'utf8') === processLogBefore,
    'no-op resume spawned processes (process log changed)',
  );
  check(
    readFileSync(stateFilePath(rehearsalRoot), 'utf8') === stateBytesBefore,
    'no-op resume changed the sequence state bytes',
  );
  verifyTreeAgainstInventory(rehearsalRoot, inventory, 'rehearsal-post-noop-resume');
  notes.push(
    'resume on completed sequence: NO-OP (seals + inventory + manifest + semantic ' +
      'revalidation + archive + receipt verified; nothing launched or changed)',
  );

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
  // Re-audit finding 3: the terminal disposition is RECORDED — run-timeout
  // is not registered as retryable by this plan, so it is forbidden.
  check(
    drillExecution.replacementDisposition === 'forbidden',
    `drill disposition ${String(drillExecution.replacementDisposition)} (expected forbidden)`,
  );
  // Re-audit finding 5: failed attempts are sealed terminal evidence.
  check(
    drillExecution.seal !== null && drillExecution.seal.sealedStatus === 'failed',
    'drill execution is not sealed as failed',
  );
  const drillDir = join(failureRoot, drillExecution.dir);
  for (const artifact of [
    'failure.json',
    'failure-screenshot.png',
    'heartbeat.jsonl',
    'failure-manifest.json',
    'failure-message.txt',
  ]) {
    check(existsSync(join(drillDir, artifact)), `drill artifact missing: ${artifact}`);
  }
  const failureManifest = JSON.parse(
    readFileSync(join(drillDir, 'failure-manifest.json'), 'utf8'),
  ) as { failureClass: string; stage: string };
  check(
    failureManifest.failureClass === 'run-timeout' && failureManifest.stage === 'browser',
    `drill failure manifest ${failureManifest.failureClass}@${failureManifest.stage}`,
  );
  notes.push(
    'failure drill: run-timeout attempt preserved+sealed with typed failure manifest; disposition forbidden',
  );

  // --- 5. Resuming the failed drill is refused by the RECORDED disposition
  // (re-audit finding 3, §7.3), even though replacement capacity math alone
  // would not stop a fresh loop. ---------------------------------------------
  await waitForAutomationPortsFree();
  let dispositionRefused = false;
  try {
    await orchestrateSequence({
      planPath: failureDrillPlan,
      resume: true,
      acknowledgeLiveCost: false,
      allowSleepRisk: true,
      headed: false,
      repoRoot,
    });
  } catch (error: unknown) {
    dispositionRefused =
      error instanceof Error && error.message.startsWith('resume-blocked-forbidden-failure');
  }
  check(dispositionRefused, 'failed-drill resume was not refused by the recorded disposition');
  notes.push('failed-drill resume refused (resume-blocked-forbidden-failure)');

  // --- 6. Derived evaluation: the completed root stays byte-identical. ------
  const evaluateExit = await runCli([
    'evaluate',
    '--sequence',
    join('artifacts', 'm2-sequences', 'rehearsal'),
  ]);
  check(evaluateExit === 0, `m2:evaluate exit ${evaluateExit}`);
  verifyTreeAgainstInventory(rehearsalRoot, inventory, 'rehearsal-post-derived-evaluate');
  check(
    readFileSync(stateFilePath(rehearsalRoot), 'utf8') === stateBytesBefore,
    'derived evaluate changed the sequence state bytes',
  );
  check(existsSync(`${rehearsalRoot}.derived`), 'derived evaluation directory missing');
  notes.push('m2:evaluate on completed sequence wrote ONLY to the derived directory');

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
