import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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
  stampTemplates,
} from '../../../scripts/experiments/m2/register';
import {
  readSequenceState,
  sealExecution,
  stateFilePath,
  controlRoot,
  writeSequenceState,
  SEQUENCE_STATE_VERSION,
  type AttemptExecution,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';
import { nextArchivePath, packageSequence } from '../../../scripts/experiments/m2/packageEvidence';
import {
  writeSequenceManifest,
  type SequenceFinalFacts,
} from '../../../scripts/experiments/m2/reporting';
import { validateStudyFile } from '../../../scripts/experiments/m2/studyRegistry';
import { studyFreezeRecordContent } from '../../../scripts/experiments/m2/orchestrate';
import { parsePlan } from '../../../scripts/experiments/m2/planSchema';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';
import {
  analyzeCalibrationSequence,
  analyzeRegisteredCalibration,
  loadRunEvidence,
  writeCalibrationAnalysis,
} from '../../../scripts/evaluation/calibrationVariance';
import { verifyPlanRegistration } from '../../../scripts/experiments/m2/registrationPreflight';

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

describe('sparse visual capture profile over REAL evidence (instrumentation revision)', () => {
  it('the drill trace manifests carry the profile and hashed visual checkpoints; no continuous screenshot stream', () => {
    const state = readSequenceState(DRILL_ROOT)!;
    for (const execution of state.executions) {
      const attemptDir = join(DRILL_ROOT, execution.dir);
      const manifest = JSON.parse(
        readFileSync(join(attemptDir, 'trace-manifest.json'), 'utf8'),
      ) as {
        captureProfile: string;
        visualCheckpoints: {
          filename: string;
          atUtc: string;
          tick: number | null;
          runStatus: string;
          sha256: string;
        }[];
        chunks: { name: string; bytes: number }[];
      };
      expect(manifest.captureProfile).toBe('semantic-trace-sparse-visual-v1');
      // Before-start and completion at minimum; rotations add more.
      expect(manifest.visualCheckpoints.length).toBeGreaterThanOrEqual(2);
      expect(manifest.visualCheckpoints[0]!.filename).toContain('before-start');
      expect(
        manifest.visualCheckpoints.some((checkpoint) => checkpoint.filename.includes('completion')),
      ).toBe(true);
      for (const checkpoint of manifest.visualCheckpoints) {
        const bytes = readFileSync(join(attemptDir, checkpoint.filename));
        expect(createHash('sha256').update(bytes).digest('hex'), checkpoint.filename).toBe(
          checkpoint.sha256,
        );
        expect(checkpoint.atUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(checkpoint.runStatus.length).toBeGreaterThan(0);
      }
      // Provenance binds the profile too.
      expect(
        (execution.browserProvenance as { contextOptions: Record<string, unknown> }).contextOptions
          .traceCaptureProfile,
      ).toBe('semantic-trace-sparse-visual-v1');
      expect(
        (execution.browserProvenance as { contextOptions: Record<string, unknown> }).contextOptions
          .tracingScreenshots,
      ).toBe(false);
    }
  }, 120_000);
});

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

    // LAUNCH preflight consumes the same registration end to end
    // (remediation C §5.5). The registered calibration plan's attempts
    // are LIVE by design, so the structural rule bites on the REAL plan:
    // drill-mode Stage A evidence can never authorize it.
    const planBytes = readFileSync(result.registeredPlanPath);
    await expect(
      verifyPlanRegistration({
        plan: loaded.plan,
        planBytes,
        planPath: result.registeredPlanPath,
        repoRoot: REPO,
      }),
    ).rejects.toThrow(/drill-mode Stage A evidence cannot authorize a live launch/);

    // The drill-mode POSITIVE path is proven with a keyless variant of the
    // same registration: the derivation proof reads the registered plan
    // BYTES (unchanged), while the live check reads the plan object's
    // attempts — all fake here, exactly what a keyless drill launch runs.
    const keylessVariant = {
      ...loaded.plan,
      attempts: loaded.plan.attempts.map((attempt) => ({
        ...attempt,
        gatewayMode: 'fake' as const,
      })),
    };
    const evidence = await verifyPlanRegistration({
      plan: keylessVariant,
      planBytes,
      planPath: result.registeredPlanPath,
      repoRoot: REPO,
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.prerequisite).not.toBeNull();
    expect(evidence!.prerequisiteSha256).toBe(result.stageAPrerequisiteSha256);
    expect(evidence!.provenance.stageADrillMode).toBe(true);

    const prerequisitePath = join(out, 'stage-a-prerequisite.json');
    const originalPrerequisite = readFileSync(prerequisitePath, 'utf8');
    writeFileSync(prerequisitePath, `${originalPrerequisite}\n`, 'utf8');
    await expect(
      verifyPlanRegistration({
        plan: keylessVariant,
        planBytes,
        planPath: result.registeredPlanPath,
        repoRoot: REPO,
      }),
    ).rejects.toThrow(/prerequisite bytes do not hash to the registered record/);
    writeFileSync(prerequisitePath, originalPrerequisite, 'utf8');
  }, 300_000);
});

/**
 * Fabricates a COMPLETE, fully verifying registered-calibration sequence
 * root (final targeted remediation B §4.4) without a browser: ten (or a
 * tweaked number of) copies of the drill's REAL strict-finalized M2
 * attempt, a stamped calibration study, fabricated schema-valid
 * provenance/prerequisite records archived with matching state hashes, a
 * real manifest, and a REAL packaged archive + inventory + receipt via
 * packageSequence. Every layer the production analyzer verifies is
 * genuine except the treatment mode (fake evidence under a fake-gateway
 * plan) — so each build-time tweak isolates exactly one refusal.
 */
interface FabricationTweaks {
  attemptCount?: number;
  addFailedReplacementFor?: string;
  addDuplicateValidFor?: string;
  mutateState?: (state: SequenceState) => void;
  mutatePlanJson?: (plan: Record<string, unknown>) => void;
}

const fabSha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

async function fabricateRegisteredCalibrationRoot(
  label: string,
  tweaks: FabricationTweaks = {},
): Promise<string> {
  const parent = tempDir(`m2-cal-fab-${label}-`);
  const root = join(parent, 'm2-calibration-variance-a');
  mkdirSync(root, { recursive: true });
  const drillState = readSequenceState(DRILL_ROOT)!;
  const sourceExecution = drillState.executions.find(
    (execution) => execution.attemptId === 'stage-a-per-decision',
  )!;
  const sourceDir = join(DRILL_ROOT, sourceExecution.dir);
  const entry = REGISTRATION_REGISTRY.find(
    (item) => item.registrationId === 'calibration-variance-a',
  )!;

  // Study: the real reviewed template, stamped with fabrication hashes.
  const studyTemplateText = readFileSync(join(REPO, entry.studyTemplatePath), 'utf8');
  const planTemplateText = readFileSync(join(REPO, entry.planTemplatePath), 'utf8');
  const prerequisiteRecord = {
    prerequisiteSchemaVersion: 'm2-stage-a-prerequisite-1.0.0',
    stageAStudyId: 'm2-stage-a-acceptance-001',
    stageAStudyVersion: '1.0.0',
    stageASequenceId: 'm2-stage-a-acceptance',
    repositorySha: drillState.repositorySha,
    packageVersion: drillState.packageVersion,
    experimentId: 'sparse-cognition-policy-001',
    experimentVersion: '1.0.0',
    attemptProfileId: 'm2-formal-attempt-profile',
    attemptProfileVersion: '1.0.0',
    baselineExecutionId: 'stage-a-baseline-e1',
    modelExecutionId: 'stage-a-per-decision-e1',
    baselineConditionId: 'deterministic-baseline-v1',
    baselineGatewayMode: 'off',
    modelConditionId: 'mara-model-per-decision-m2-v1',
    modelGatewayMode: 'fake',
    promptVersion: 'mara-action-selection-m2-1.0.0',
    modelId: 'google/gemini-2.5-flash-lite',
    servingProviderId: 'google-ai-studio',
    sequenceManifestPath: join(DRILL_ROOT, 'sequence-manifest.json'),
    sequenceManifestSha256: 'a'.repeat(64),
    evidenceArchivePath: `${DRILL_ROOT}.zip`,
    evidenceArchiveSha256: 'b'.repeat(64),
    receiptPath: `${DRILL_ROOT}.zip.receipt.json`,
    receiptSha256: 'c'.repeat(64),
    artifactValidVerdicts: { 'stage-a-baseline-e1': 'artifact-valid' },
    studyValidVerdicts: { 'stage-a-baseline-e1': 'study-valid' },
    strictFinalizationVerdict: 'completed',
    replayVerdicts: { 'stage-a-baseline-e1': true },
    treatmentThresholdVerdicts: [
      { metric: 'completionBp', npcId: 'mara', value: 10_000, min: 9_000, pass: true },
    ],
    secretScanVerdict: 'enforced-by-receipted-packaging',
    inventoryAggregateSha256: 'd'.repeat(64),
  };
  const prerequisiteBytes = `${JSON.stringify(prerequisiteRecord, null, 2)}\n`;
  const prerequisiteSha = fabSha256(prerequisiteBytes);
  const provenance = {
    registrationProvenanceSchemaVersion: 'm2-registration-provenance-1.0.0',
    registrationId: 'calibration-variance-a',
    headSha: drillState.repositorySha,
    atUtc: '2026-08-01T00:00:00.000Z',
    studyTemplate: {
      path: entry.studyTemplatePath,
      blobId: 'a'.repeat(40),
      sha256: fabSha256(studyTemplateText),
    },
    planTemplate: {
      path: entry.planTemplatePath,
      blobId: 'b'.repeat(40),
      sha256: fabSha256(planTemplateText),
    },
    registeredStudySha256: 'e'.repeat(64),
    stageAPrerequisiteSha256: prerequisiteSha,
    stageADrillMode: true,
  };
  const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
  const provenanceSha = fabSha256(provenanceBytes);

  const studyPath = join(parent, `${entry.studyId}.json`).replace(/\\/g, '/');
  const stamped = stampTemplates({
    studyTemplateText,
    planTemplateText,
    headSha: drillState.repositorySha,
    registeredStudyPath: studyPath,
    studySha256: 'f'.repeat(64),
    studyConfigFingerprint: 'a1b2c3d4e5f60718',
    studySourceBlobId: 'a'.repeat(40),
    studySourceSha256: fabSha256(studyTemplateText),
    provenanceSha256: provenanceSha,
    stageAPrerequisiteSha256: prerequisiteSha,
  });
  writeFileSync(studyPath, stamped.studyText, 'utf8');
  const validatedStudy = validateStudyFile(studyPath);

  // The plan: the stamped template rewritten as the keyless drill shape
  // (fake gateways — the fabricated evidence is fake-adapter evidence),
  // with the real study binding and fabricated registration hashes.
  const planJson = JSON.parse(stamped.planText) as Record<string, unknown> & {
    attempts: Array<Record<string, unknown>>;
    registration: Record<string, unknown>;
    study: Record<string, unknown>;
  };
  for (const attempt of planJson.attempts) attempt.gatewayMode = 'fake';
  planJson.study = {
    studyId: validatedStudy.freeze.studyId,
    studyVersion: validatedStudy.freeze.studyVersion,
    studyPlanPath: studyPath,
    studyPlanSha256: validatedStudy.freeze.planSha256,
    studyConfigFingerprint: validatedStudy.freeze.configFingerprint,
  };
  tweaks.mutatePlanJson?.(planJson);
  const planBytes = Buffer.from(`${JSON.stringify(planJson, null, 2)}\n`);
  const loadedPlan = parsePlan(planBytes);
  writeFileSync(join(root, 'plan.archived.json'), planBytes);
  writeFileSync(join(root, 'study.archived.json'), stamped.studyText, 'utf8');
  writeFileSync(
    join(root, 'study.freeze.archived.json'),
    studyFreezeRecordContent({
      studyId: validatedStudy.freeze.studyId,
      studyVersion: validatedStudy.freeze.studyVersion,
      studyPlanSha256: validatedStudy.freeze.planSha256,
      studyConfigFingerprint: validatedStudy.freeze.configFingerprint,
    }),
    'utf8',
  );
  writeFileSync(join(root, 'registration-provenance.archived.json'), provenanceBytes, 'utf8');
  writeFileSync(join(root, 'stage-a-prerequisite.archived.json'), prerequisiteBytes, 'utf8');

  // Attempt directories: real strict-finalized fake-adapter evidence,
  // slimmed of heavy trace payloads (nothing the analyzer verifies).
  const attemptCount = tweaks.attemptCount ?? 10;
  const attemptIds = loadedPlan.plan.attempts
    .slice(0, attemptCount)
    .map((attempt) => attempt.attemptId);
  const copyAttemptDir = (dir: string): void => {
    const target = join(root, dir);
    cpSync(sourceDir, target, { recursive: true });
    for (const heavy of [
      'attempt-trace.zip',
      'failure-trace.zip',
      'final-screenshot.png',
      'final-dom.html',
    ]) {
      rmSync(join(target, heavy), { force: true });
    }
    rmSync(join(target, 'trace-chunks'), { recursive: true, force: true });
  };
  const executions: AttemptExecution[] = [];
  const makeExecution = (
    attemptId: string,
    suffix: string,
    status: 'completed' | 'failed',
  ): AttemptExecution => {
    const dir = `attempt-${attemptId}-${suffix}`;
    copyAttemptDir(dir);
    return {
      executionId: `${attemptId}-${suffix}`,
      attemptId,
      status,
      seal: null,
      failureReason: status === 'failed' ? 'run-timeout' : null,
      failureStage: status === 'failed' ? 'browser-run' : null,
      artifactStatus: status === 'completed' ? 'artifact-valid' : null,
      studyStatus: status === 'completed' ? 'study-valid' : null,
      replacementDisposition: status === 'failed' ? 'permitted' : null,
      thresholdVerdicts: null,
      runId: sourceExecution.runId,
      dir,
      artifacts: [],
      verdicts:
        status === 'completed' ? { 'replay-match': true, 'strict-finalized': 'completed' } : {},
      navigationCount: 1,
      browserProvenance: null,
      startedAtUtc: '2026-08-01T00:00:00.000Z',
      endedAtUtc: '2026-08-01T00:45:00.000Z',
    };
  };
  for (const attemptId of attemptIds) {
    if (attemptId === tweaks.addFailedReplacementFor) {
      executions.push(makeExecution(attemptId, 'e0', 'failed'));
    }
    executions.push(makeExecution(attemptId, 'e1', 'completed'));
    if (attemptId === tweaks.addDuplicateValidFor) {
      executions.push(makeExecution(attemptId, 'e2', 'completed'));
    }
  }
  for (const execution of executions) {
    execution.seal = sealExecution(root, execution.dir, execution.status as 'completed' | 'failed');
  }

  const state: SequenceState = {
    stateVersion: SEQUENCE_STATE_VERSION,
    sequenceId: loadedPlan.plan.sequenceId,
    planSha256: loadedPlan.planSha256,
    repositorySha: drillState.repositorySha,
    packageVersion: drillState.packageVersion,
    experimentId: 'sparse-cognition-policy-001',
    experimentVersion: '1.0.0',
    promptVersion: 'mara-action-selection-m2-1.0.0',
    externalProviderId: 'openrouter-mara-action-m2-v1',
    upstreamPlatform: 'openrouter',
    expectedModelId: 'google/gemini-2.5-flash-lite',
    expectedServingProviderId: 'google-ai-studio',
    studyId: validatedStudy.freeze.studyId,
    studyVersion: validatedStudy.freeze.studyVersion,
    studyPlanSha256: validatedStudy.freeze.planSha256,
    thresholdProfileId: 'm2-formal-attempt-profile',
    thresholdProfileVersion: '1.0.0',
    registrationId: 'calibration-variance-a',
    registrationProvenanceSha256: provenanceSha,
    stageAPrerequisiteSha256: prerequisiteSha,
    configFingerprint: planConfigFingerprint(loadedPlan.plan),
    status: 'completed',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    inventoryAggregateSha256: null,
    supersededArchives: [],
    freezeCheckpoints: [],
    executions,
    lastTransition: 'fabricated',
    createdAtUtc: '2026-08-01T00:00:00.000Z',
    updatedAtUtc: '2026-08-01T01:00:00.000Z',
  };
  tweaks.mutateState?.(state);
  writeSequenceState(root, state);

  const facts: SequenceFinalFacts = {
    sequenceOutcome: 'completed',
    attemptSetComplete: true,
    batchVerdict: null,
    evaluation: null,
    processLogHealth: null,
    browserVersion: 'fabricated-fixture',
    launchFlags: [],
    processLog: [],
    finalizedAtUtc: '2026-08-01T01:00:00.000Z',
  };
  writeSequenceManifest(root, state, facts);

  const zipPath = nextArchivePath(parent, state.sequenceId);
  const result = await packageSequence(
    root,
    zipPath,
    {
      sequenceId: state.sequenceId,
      planSha256: state.planSha256,
      repositorySha: state.repositorySha,
      studyPlanSha256: state.studyPlanSha256,
    },
    {
      onInventory: (aggregate) => {
        state.inventoryAggregateSha256 = aggregate;
      },
    },
  );
  state.archivePath = result.zipPath;
  state.archiveSha256 = result.zipSha256;
  writeSequenceState(root, state);
  return root;
}

describe('production analyzer over a FABRICATED registered root (§4.4)', () => {
  it('the exact registered design analyzes end to end, with a replacement AS its attempt primary', async () => {
    const root = await fabricateRegisteredCalibrationRoot('happy', {
      addFailedReplacementFor: 'cal-var-a-04',
    });
    const report = await analyzeRegisteredCalibration(root);
    expect(report.runCount).toBe(10);
    expect(report.pairs).toHaveLength(45);
    expect(report.executionIds).toContain('cal-var-a-04-e1');
    expect(report.excludedExecutions).toEqual([
      { executionId: 'cal-var-a-04-e0', reason: 'status:failed:run-timeout' },
    ]);
    // The production write path over the same root (create-once).
    const outDir = join(tempDir('m2-cal-fab-out-'), 'derived');
    const written = await writeCalibrationAnalysis(root, outDir);
    expect(existsSync(written.jsonPath)).toBe(true);
    expect(existsSync(written.markdownPath)).toBe(true);
  }, 300_000);

  it('wrong study id, wrong sequence id, and wrong model each refuse with the field named', async () => {
    const wrongStudy = await fabricateRegisteredCalibrationRoot('wrongstudy', {
      mutateState: (state) => {
        state.studyId = 'm2-stage-a-acceptance-001';
      },
    });
    await expect(analyzeRegisteredCalibration(wrongStudy)).rejects.toThrow(
      /calibration-analysis-refused: studyId is 'm2-stage-a-acceptance-001'/,
    );
    const wrongSequence = await fabricateRegisteredCalibrationRoot('wrongseq', {
      mutateState: (state) => {
        state.sequenceId = 'm2-stage-a-acceptance';
      },
    });
    await expect(analyzeRegisteredCalibration(wrongSequence)).rejects.toThrow(
      /calibration-analysis-refused: sequenceId/,
    );
    const wrongModel = await fabricateRegisteredCalibrationRoot('wrongmodel', {
      mutateState: (state) => {
        state.expectedModelId = 'other/model';
      },
    });
    await expect(analyzeRegisteredCalibration(wrongModel)).rejects.toThrow(
      /calibration-analysis-refused: modelId is 'other\/model'/,
    );
  }, 300_000);

  it('a wrong scenario in the registered plan refuses at the design check', async () => {
    const root = await fabricateRegisteredCalibrationRoot('wrongscenario', {
      mutatePlanJson: (plan) => {
        (plan.attempts as Array<Record<string, unknown>>)[3]!.scenarioId = 'B1';
      },
    });
    await expect(analyzeRegisteredCalibration(root)).rejects.toThrow(/scenario is 'B1'/);
  }, 300_000);

  it('nine primaries and duplicate primaries for one attempt each refuse', async () => {
    const nine = await fabricateRegisteredCalibrationRoot('nine', { attemptCount: 9 });
    // The tenth planned attempt has no completed execution: refused at
    // manifest attempt-coverage — before the analyzer can even count.
    await expect(analyzeRegisteredCalibration(nine)).rejects.toThrow(
      /attempt-coverage|no valid primary/,
    );
    const duplicated = await fabricateRegisteredCalibrationRoot('dup', {
      addDuplicateValidFor: 'cal-var-a-07',
    });
    await expect(analyzeRegisteredCalibration(duplicated)).rejects.toThrow(
      /competing valid observations/,
    );
  }, 300_000);

  it('a tampered archive and a tampered archived provenance copy each refuse', async () => {
    const root = await fabricateRegisteredCalibrationRoot('tamper');
    const state = readSequenceState(root)!;
    const zipBytes = readFileSync(state.archivePath!);
    zipBytes[Math.floor(zipBytes.length / 2)] = zipBytes[Math.floor(zipBytes.length / 2)]! ^ 0xff;
    writeFileSync(state.archivePath!, zipBytes);
    await expect(analyzeRegisteredCalibration(root)).rejects.toThrow(/archive|sha256/i);

    const provenanceTamper = await fabricateRegisteredCalibrationRoot('provtamper');
    const archivedProvenance = join(provenanceTamper, 'registration-provenance.archived.json');
    writeFileSync(archivedProvenance, `${readFileSync(archivedProvenance, 'utf8')}\n`, 'utf8');
    await expect(analyzeRegisteredCalibration(provenanceTamper)).rejects.toThrow(
      /completed-root|manifest-registration-invalid/,
    );
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

  it('refuses a run directory that no longer strict-finalizes, and writeCalibrationAnalysis wires the same gate', async () => {
    const tampered = cloneRoot('ana-bundle');
    const state = readSequenceState(tampered)!;
    const modelExecution = state.executions.find(
      (execution) => execution.attemptId === 'stage-a-per-decision',
    )!;
    const runDir = join(tampered, modelExecution.dir, 'gateway', modelExecution.runId!);
    rmSync(join(runDir, 'finalized-trace.jsonl'), { force: true });
    expect(() => analyzeCalibrationSequence(tampered)).toThrow(/./);
    // The PRODUCTION entry point (registered analysis + create-once
    // write) refuses the tampered root at full-sequence verification —
    // BEFORE writing anything (remediation B §4.2 item 1).
    const outDir = join(tempDir('m2-ana-out-'), 'derived');
    await expect(writeCalibrationAnalysis(tampered, outDir)).rejects.toThrow(
      /resume-evidence-invalid|completed-root|completed-resume-verification-failed|resume-semantic-invalid/,
    );
    expect(existsSync(outDir)).toBe(false);
  }, 120_000);

  it('the production analyzer refuses an INTACT root that is not the registered calibration (§4.2 item 3)', async () => {
    // The drill root verifies end to end, but it is the drill sequence —
    // not m2-calibration-variance-a — and carries no registration. The
    // exact-design binding must name the offending field.
    const intact = cloneRoot('ana-unregistered');
    // The drill root binds no study and no registration: the typed
    // refusal fires at the archived-record stage, before any behavioral
    // fact is read.
    await expect(analyzeRegisteredCalibration(intact)).rejects.toThrow(
      /calibration-analysis-refused/,
    );
  }, 120_000);
});
