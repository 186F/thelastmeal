import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  orchestrateSequence,
  planConfigFingerprint,
} from '../../../scripts/experiments/m2/orchestrate';
import { buildStageAPrerequisite } from '../../../scripts/experiments/m2/stageAPrerequisite';
import {
  registerFromRegistry,
  REGISTRATION_REGISTRY,
} from '../../../scripts/experiments/m2/register';
import {
  readSequenceState,
  stateFilePath,
  controlRoot,
} from '../../../scripts/experiments/m2/sequenceState';
import { parsePlan } from '../../../scripts/experiments/m2/planSchema';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';
import {
  analyzeCalibrationSequence,
  loadRunEvidence,
  writeCalibrationAnalysis,
} from '../../../scripts/evaluation/calibrationVariance';

/**
 * The authenticated Stage A prerequisite (Phase 4 audit finding 2, §4.5
 * drills): ONE real keyless Stage A-shaped sequence (deterministic
 * baseline gateway-off + M2 per-decision through the fake gateway) is
 * produced through the complete unattended pipeline; every drill then
 * operates on an independent copy of that root, proving the builder
 * verifies rather than trusts — and that the full calibration
 * registration path consumes the record end to end.
 *
 * The "prerequisite remains stable through launch, resume, and packaging"
 * drill is interpreted at the identity level (a real 1× calibration launch
 * is live-gated): the record's SHA enters the registered plan's
 * configuration fingerprint, which IS the resume identity and freeze
 * checkpoint binding — asserted below by fingerprint movement.
 */

const REPO = process.cwd();
const DRILL_PLAN = join(REPO, 'experiments', 'm2', 'plans', 'stage-a-drill.json');
const DRILL_ROOT = join(REPO, 'artifacts', 'm2-sequences', 'stage-a-drill');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Copies the drill root, its control root, and its archive trio into an
 * isolated directory, repointing the copied state's archivePath — the
 * only state field that carries an absolute location. */
function cloneRoot(label: string): string {
  const parent = tempDir(`m2-stagea-${label}-`);
  const root = join(parent, 'stage-a-drill');
  cpSync(DRILL_ROOT, root, { recursive: true });
  cpSync(controlRoot(DRILL_ROOT), controlRoot(root), { recursive: true });
  const state = readSequenceState(DRILL_ROOT)!;
  const archiveName = basename(state.archivePath!);
  for (const suffix of ['', '.sha256', '.receipt.json']) {
    cpSync(`${state.archivePath!}${suffix}`, join(parent, `${archiveName}${suffix}`));
  }
  const cloned = readSequenceState(root)!;
  cloned.archivePath = join(parent, archiveName);
  writeFileSync(stateFilePath(root), `${JSON.stringify(cloned, null, 2)}\n`, 'utf8');
  return root;
}

let headSha = '';

beforeAll(async () => {
  headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO,
    env: helperEnv(process.env),
    encoding: 'utf8',
  }).trim();
  rmSync(DRILL_ROOT, { recursive: true, force: true });
  rmSync(controlRoot(DRILL_ROOT), { recursive: true, force: true });
  const result = await orchestrateSequence({
    planPath: DRILL_PLAN,
    resume: false,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot: REPO,
  });
  expect(result.status).toBe('completed');
}, 600_000);

describe('buildStageAPrerequisite over intact evidence', () => {
  it('verifies the complete root and extracts every audit-specified fact', async () => {
    const state = readSequenceState(DRILL_ROOT)!;
    const built = await buildStageAPrerequisite({
      stageARoot: DRILL_ROOT,
      expectedHeadSha: state.repositorySha,
      requireLiveModel: false,
      expectedIdentity: null,
    });
    expect(built.recordSha256).toMatch(/^[0-9a-f]{64}$/);
    const record = built.record;
    expect(record.stageASequenceId).toBe('m2-stage-a-drill');
    expect(record.baselineConditionId).toBe('deterministic-baseline-v1');
    expect(record.baselineGatewayMode).toBe('off');
    expect(record.modelConditionId).toBe('mara-model-per-decision-m2-v1');
    expect(record.modelGatewayMode).toBe('fake');
    expect(record.experimentId).toBe('sparse-cognition-policy-001');
    expect(record.promptVersion).toBe('mara-action-selection-m2-1.0.0');
    expect(record.strictFinalizationVerdict).toBe('completed');
    expect(Object.keys(record.artifactValidVerdicts)).toHaveLength(2);
    expect(record.treatmentThresholdVerdicts.length).toBeGreaterThan(0);
    expect(record.inventoryAggregateSha256).toBe(state.inventoryAggregateSha256);
    // Byte-determinism: rebuilding over the same evidence is identical.
    const rebuilt = await buildStageAPrerequisite({
      stageARoot: DRILL_ROOT,
      expectedHeadSha: state.repositorySha,
      requireLiveModel: false,
      expectedIdentity: null,
    });
    expect(rebuilt.recordBytes).toBe(built.recordBytes);
  }, 300_000);

  it('the RULING requirement bites: fake-gateway Stage A evidence refuses under requireLiveModel', async () => {
    const state = readSequenceState(DRILL_ROOT)!;
    await expect(
      buildStageAPrerequisite({
        stageARoot: DRILL_ROOT,
        expectedHeadSha: state.repositorySha,
        requireLiveModel: true,
        expectedIdentity: null,
      }),
    ).rejects.toThrow(/Stage A run 2 is a LIVE run/);
  }, 300_000);

  it('the REGISTERED identity binding bites: evidence that is not the registered Stage A sequence refuses', async () => {
    // The re-audit's defeat scenario: a completed two-attempt sequence at
    // the right SHA that is NOT the registered Stage A sequence. The drill
    // root is exactly such a sequence — under the real calibration
    // registration's expected identity (derived from the closed registry's
    // 'stage-a' entry) it must refuse on identity, not pass on SHA.
    const state = readSequenceState(DRILL_ROOT)!;
    const stageA = REGISTRATION_REGISTRY.find((entry) => entry.registrationId === 'stage-a')!;
    await expect(
      buildStageAPrerequisite({
        stageARoot: DRILL_ROOT,
        expectedHeadSha: state.repositorySha,
        requireLiveModel: false,
        expectedIdentity: {
          stageARegistrationId: stageA.registrationId,
          studyId: stageA.studyId,
          studyVersion: stageA.studyVersion,
          sequenceId: stageA.expectedSequenceId,
          attemptProfileId: stageA.attemptProfile.profileId,
          attemptProfileVersion: stageA.attemptProfile.profileVersion,
        },
      }),
    ).rejects.toThrow(/Stage A identity mismatch/);
  }, 300_000);

  it('a Stage A SHA different from the calibration HEAD refuses (source change forces a new Stage A)', async () => {
    await expect(
      buildStageAPrerequisite({
        stageARoot: DRILL_ROOT,
        expectedHeadSha: 'f'.repeat(40),
        requireLiveModel: false,
        expectedIdentity: null,
      }),
    ).rejects.toThrow(/requires Stage A to run again/);
  }, 300_000);
});

describe('tampered Stage A evidence refuses (§4.5)', () => {
  async function expectRefusal(root: string, pattern: RegExp): Promise<void> {
    const state = readSequenceState(root)!;
    await expect(
      buildStageAPrerequisite({
        stageARoot: root,
        expectedHeadSha: state.repositorySha,
        requireLiveModel: false,
        expectedIdentity: null,
      }),
    ).rejects.toThrow(pattern);
  }

  it('a missing baseline or model attempt directory refuses at seal verification', async () => {
    const missingBaseline = cloneRoot('nobase');
    const state = readSequenceState(missingBaseline)!;
    const baselineDir = state.executions.find((e) => e.attemptId === 'stage-a-baseline')!.dir;
    rmSync(join(missingBaseline, baselineDir), { recursive: true, force: true });
    await expectRefusal(missingBaseline, /seal|inventory|missing/i);

    const missingModel = cloneRoot('nomodel');
    const modelDir = readSequenceState(missingModel)!.executions.find(
      (e) => e.attemptId === 'stage-a-per-decision',
    )!.dir;
    rmSync(join(missingModel, modelDir), { recursive: true, force: true });
    await expectRefusal(missingModel, /seal|inventory|missing/i);
  }, 300_000);

  it('a doctored study/artifact verdict in control state refuses against the immutable manifest', async () => {
    const root = cloneRoot('verdict');
    const state = readSequenceState(root)!;
    state.executions.find((e) => e.attemptId === 'stage-a-per-decision')!.studyStatus =
      'invalid-treatment';
    writeFileSync(stateFilePath(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await expectRefusal(root, /studyStatus|divergence/i);
  }, 300_000);

  it('a tampered archived plan (e.g. rewriting the baseline to a gateway mode) refuses', async () => {
    const root = cloneRoot('plan');
    const planPath = join(root, 'plan.archived.json');
    writeFileSync(
      planPath,
      readFileSync(planPath, 'utf8').replace('"gatewayMode": "off"', '"gatewayMode": "fake"'),
      'utf8',
    );
    // The tamper dies at the earliest applicable gate: the plan schema's
    // own baseline-gateway rule; a shape-preserving tamper would fall to
    // the recorded plan-hash check instead.
    await expectRefusal(root, /baseline-attempt-must-run-gateway-off|plan|inventory/i);
  }, 300_000);

  it('a modified inventory entry and a modified archive byte both refuse', async () => {
    const inventoryTamper = cloneRoot('inventory');
    const inventoryPath = join(inventoryTamper, 'sha256-inventory.json');
    writeFileSync(
      inventoryPath,
      readFileSync(inventoryPath, 'utf8').replace(/"aggregateSha256": "[0-9a-f]{4}/, (match) =>
        match.endsWith('0') ? `${match.slice(0, -1)}1` : `${match.slice(0, -1)}0`,
      ),
      'utf8',
    );
    await expectRefusal(inventoryTamper, /inventory/i);

    const archiveTamper = cloneRoot('archive');
    const archivePath = readSequenceState(archiveTamper)!.archivePath!;
    const bytes = readFileSync(archivePath);
    bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 0xff;
    writeFileSync(archivePath, bytes);
    await expectRefusal(archiveTamper, /archive|sha256/i);
  }, 300_000);
});

describe('calibration registration consumes the prerequisite end to end', () => {
  const worktreeClean = () =>
    execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO,
      env: helperEnv(process.env),
      encoding: 'utf8',
    }).trim() === '';

  it('refuses without a Stage A root, and with a bad one', async () => {
    await expect(
      registerFromRegistry({
        repoRoot: REPO,
        registrationId: 'calibration-variance-a',
        outDir: join(tempDir('m2-cal-reg-none-'), 'r'),
      }),
    ).rejects.toThrow(/register-stage-a-required|register-dirty-worktree/);
  });

  // The full happy path needs a CLEAN worktree at the drill root's exact
  // HEAD — true on CI's clean checkout, impossible mid-development. The
  // drill-mode flag is recorded in provenance.
  it('intact Stage A evidence allows calibration registration, binding the record everywhere (clean-checkout runs)', async (context) => {
    if (!worktreeClean()) {
      context.skip();
      return;
    }
    const state = readSequenceState(DRILL_ROOT)!;
    if (state.repositorySha !== headSha) {
      context.skip();
      return;
    }
    const out = join(tempDir('m2-cal-reg-ok-'), 'registered');
    const result = await registerFromRegistry({
      repoRoot: REPO,
      registrationId: 'calibration-variance-a',
      outDir: out,
      stageARoot: DRILL_ROOT,
      allowFakeStageAForDrill: true,
    });
    expect(result.stageAPrerequisiteSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(out, 'stage-a-prerequisite.json'))).toBe(true);
    const provenance = JSON.parse(
      readFileSync(join(out, 'registration-provenance.json'), 'utf8'),
    ) as { stageADrillMode: boolean; stageAPrerequisiteSha256: string };
    expect(provenance.stageADrillMode).toBe(true);
    expect(provenance.stageAPrerequisiteSha256).toBe(result.stageAPrerequisiteSha256);
    // The record's hash is stamped into study AND plan; the plan carries it
    // into the configuration fingerprint (resume identity + freeze).
    const registeredStudy = JSON.parse(readFileSync(result.registeredStudyPath, 'utf8')) as {
      stageAPrerequisiteSha256: string;
    };
    expect(registeredStudy.stageAPrerequisiteSha256).toBe(result.stageAPrerequisiteSha256);
    const loaded = parsePlan(readFileSync(result.registeredPlanPath));
    expect(loaded.plan.registration?.stageAPrerequisiteSha256).toBe(
      result.stageAPrerequisiteSha256,
    );
    const altered = planConfigFingerprint({
      ...loaded.plan,
      registration: {
        ...loaded.plan.registration!,
        stageAPrerequisiteSha256: 'e'.repeat(64),
      },
    });
    expect(altered).not.toBe(planConfigFingerprint(loaded.plan));
  }, 300_000);
});

describe('calibration analysis entry point over REAL evidence (§3.5)', () => {
  it('loadRunEvidence derives the decision timeline from the validated ledger, trace, and manifest', () => {
    const state = readSequenceState(DRILL_ROOT)!;
    const modelExecution = state.executions.find(
      (execution) => execution.attemptId === 'stage-a-per-decision',
    )!;
    const evidence = loadRunEvidence(DRILL_ROOT, modelExecution);
    // Every external Mara decision joins a context hash from the finalized
    // trace and an engine-accepted selection from the ledger.
    expect(evidence.decisions.length).toBeGreaterThan(0);
    for (const decision of evidence.decisions) {
      expect(decision.contextHash).toMatch(/^[0-9a-f]+$/);
      expect(decision.selectedAffordanceId).not.toBeNull();
      expect(decision.offeredIds.length).toBeGreaterThan(0);
      expect(decision.offeredIds).toContain(decision.selectedAffordanceId);
      expect(decision.hardDependencyFingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
    // The timeline is exactly the manifest's external request accounting,
    // and each request contributed one last-row latency observation.
    expect(evidence.decisions.length).toBe(evidence.manifest.externalRequestsEmitted);
    expect(evidence.latenciesMs.length).toBe(evidence.decisions.length);
    expect(evidence.manifest.returnedModelIds.length).toBeGreaterThan(0);
  }, 120_000);

  it('the filesystem analyzer excludes the deterministic run and refuses a single-primary sequence', () => {
    // The drill root holds ONE M2 primary and one deterministic run: the
    // loader and exclusion classifier both execute on real evidence, then
    // pairing refuses — proving the entry point runs end to end.
    expect(() => analyzeCalibrationSequence(DRILL_ROOT)).toThrow(
      /1 primary observation\(s\) — nothing to pair/,
    );
  }, 120_000);

  it('refuses a non-completed sequence and a doctored study verdict', () => {
    const failedStatus = cloneRoot('ana-status');
    const state = readSequenceState(failedStatus)!;
    (state as { status: string }).status = 'failed';
    writeFileSync(stateFilePath(failedStatus), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    expect(() => analyzeCalibrationSequence(failedStatus)).toThrow(/'failed' is not completed/);

    // An invalid-treatment M2 execution is EXCLUDED (never a primary): with
    // zero primaries left the refusal names the count.
    const excluded = cloneRoot('ana-excluded');
    const excludedState = readSequenceState(excluded)!;
    excludedState.executions.find((e) => e.attemptId === 'stage-a-per-decision')!.studyStatus =
      'invalid-treatment';
    writeFileSync(stateFilePath(excluded), `${JSON.stringify(excludedState, null, 2)}\n`, 'utf8');
    expect(() => analyzeCalibrationSequence(excluded)).toThrow(
      /0 primary observation\(s\) — nothing to pair/,
    );
  }, 120_000);

  it('refuses a run directory that no longer strict-finalizes, and writeCalibrationAnalysis wires the same gate', () => {
    const tampered = cloneRoot('ana-bundle');
    const state = readSequenceState(tampered)!;
    const modelExecution = state.executions.find(
      (execution) => execution.attemptId === 'stage-a-per-decision',
    )!;
    const runDir = join(tampered, modelExecution.dir, 'gateway', modelExecution.runId!);
    rmSync(join(runDir, 'finalized-trace.jsonl'), { force: true });
    expect(() => analyzeCalibrationSequence(tampered)).toThrow(/./);
    // The public entry point (analyze + create-once write) hits the same
    // loader gate before writing anything.
    const outDir = join(tempDir('m2-ana-out-'), 'derived');
    expect(() => writeCalibrationAnalysis(tampered, outDir)).toThrow(/./);
    expect(existsSync(outDir)).toBe(false);
  }, 120_000);
});
