import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REGISTRATION_REGISTRY,
  registerFromRegistry,
  stampTemplates,
} from '../../../scripts/experiments/m2/register';
import { verifyPlanRegistration } from '../../../scripts/experiments/m2/registrationPreflight';
import { parsePlan, type OrchestratorPlan } from '../../../scripts/experiments/m2/planSchema';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';

/**
 * Launch-time registration preflight (final targeted remediation C §5.5):
 * no authenticated registration → no formal launch. Every case here is a
 * PRE-WRITE refusal — verifyPlanRegistration is called before the
 * orchestrator creates the sequence root or spawns anything, and the
 * function itself only reads. Drills run against a REAL m2:register
 * output inside a scratch Git repository carrying the real templates.
 */

const REAL_REPO = process.cwd();

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: helperEnv(process.env), encoding: 'utf8' });
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function scratchRepoWithTemplates(): string {
  const dir = tempDir('m2-preflight-repo-');
  git(dir, ['init', '--quiet']);
  for (const entry of REGISTRATION_REGISTRY) {
    for (const rel of [entry.studyTemplatePath, entry.planTemplatePath]) {
      const dest = join(dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(REAL_REPO, rel), dest);
    }
  }
  git(dir, ['add', '.']);
  git(dir, [
    '-c',
    'user.email=t@example.invalid',
    '-c',
    'user.name=t',
    'commit',
    '--quiet',
    '-m',
    'templates',
  ]);
  return dir;
}

let repo = '';
let registeredPlanPath = '';
let planBytes: Buffer;
let plan: OrchestratorPlan;

/** A fresh registered copy so destructive drills never disturb the shared
 * happy-path fixture. */
async function freshRegistration(label: string): Promise<{
  planPath: string;
  planBytes: Buffer;
  plan: OrchestratorPlan;
  provenancePath: string;
  studyPath: string;
}> {
  const out = join(tempDir(`m2-preflight-${label}-`), 'registered');
  const result = await registerFromRegistry({
    repoRoot: repo,
    registrationId: 'stage-a',
    outDir: out,
  });
  const bytes = readFileSync(result.registeredPlanPath);
  return {
    planPath: result.registeredPlanPath,
    planBytes: bytes,
    plan: parsePlan(bytes).plan,
    provenancePath: result.provenancePath,
    studyPath: result.registeredStudyPath,
  };
}

beforeAll(async () => {
  repo = scratchRepoWithTemplates();
  const fixture = await freshRegistration('base');
  registeredPlanPath = fixture.planPath;
  planBytes = fixture.planBytes;
  plan = fixture.plan;
}, 120_000);

describe('verifyPlanRegistration over a REAL m2:register output', () => {
  it('an intact registration passes and returns the authenticated evidence', async () => {
    const evidence = await verifyPlanRegistration({
      plan,
      planBytes,
      planPath: registeredPlanPath,
      repoRoot: repo,
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.entry.registrationId).toBe('stage-a');
    expect(evidence!.provenanceSha256).toBe(plan.registration!.provenanceSha256);
    expect(evidence!.prerequisite).toBeNull();
    expect(sha256(evidence!.provenanceBytes)).toBe(evidence!.provenanceSha256);
  });

  it('an unregistered evidentiary or live plan refuses; an unregistered rehearsal plan returns null', async () => {
    const rehearsal = parsePlan(
      readFileSync(join(REAL_REPO, 'experiments', 'm2', 'plans', 'rehearsal.json')),
    ).plan;
    await expect(
      verifyPlanRegistration({
        plan: rehearsal,
        planBytes: Buffer.from('{}'),
        planPath: 'x.json',
        repoRoot: repo,
      }),
    ).resolves.toBeNull();
    const evidentiary = { ...rehearsal, evidentiary: true };
    await expect(
      verifyPlanRegistration({
        plan: evidentiary,
        planBytes: Buffer.from('{}'),
        planPath: 'x.json',
        repoRoot: repo,
      }),
    ).rejects.toThrow(/launch only from an authenticated m2:register output/);
    const live = {
      ...rehearsal,
      attempts: rehearsal.attempts.map((attempt, index) =>
        index === 1 ? { ...attempt, gatewayMode: 'live' as const } : attempt,
      ),
    };
    await expect(
      verifyPlanRegistration({
        plan: live,
        planBytes: Buffer.from('{}'),
        planPath: 'x.json',
        repoRoot: repo,
      }),
    ).rejects.toThrow(/launch only from an authenticated m2:register output/);
  });

  it('a missing provenance file refuses before anything else', async () => {
    const fixture = await freshRegistration('noprov');
    rmSync(fixture.provenancePath);
    await expect(
      verifyPlanRegistration({
        plan: fixture.plan,
        planBytes: fixture.planBytes,
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/registration provenance missing/);
  }, 60_000);

  it('a hash-mismatched provenance record refuses', async () => {
    const fixture = await freshRegistration('provflip');
    const text = readFileSync(fixture.provenancePath, 'utf8');
    writeFileSync(
      fixture.provenancePath,
      text.replace('"stageADrillMode": false', '"stageADrillMode": true'),
      'utf8',
    );
    await expect(
      verifyPlanRegistration({
        plan: fixture.plan,
        planBytes: fixture.planBytes,
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/provenance hash .* does not match the plan binding/);
  }, 60_000);

  it('provenance naming a different source template refuses on the registry path', async () => {
    const fixture = await freshRegistration('provpath');
    // A consistent-but-wrong bundle: doctor the provenance, then re-stamp
    // the plan so its hash binding matches the doctored record — the
    // path check must still refuse.
    const doctored = JSON.parse(readFileSync(fixture.provenancePath, 'utf8')) as {
      studyTemplate: { path: string };
    };
    doctored.studyTemplate.path = 'experiments/m2/templates/other.study.template.json';
    const doctoredBytes = `${JSON.stringify(doctored, null, 2)}\n`;
    writeFileSync(fixture.provenancePath, doctoredBytes, 'utf8');
    const entry = REGISTRATION_REGISTRY.find((item) => item.registrationId === 'stage-a')!;
    const studyText = git(repo, ['show', `HEAD:${entry.studyTemplatePath}`]);
    const planText = git(repo, ['show', `HEAD:${entry.planTemplatePath}`]);
    const restamped = stampTemplates({
      studyTemplateText: studyText,
      planTemplateText: planText,
      headSha: fixture.plan.repositorySha!,
      registeredStudyPath: fixture.plan.study!.studyPlanPath,
      studySha256: fixture.plan.study!.studyPlanSha256,
      studyConfigFingerprint: fixture.plan.study!.studyConfigFingerprint,
      studySourceBlobId: git(repo, ['rev-parse', `HEAD:${entry.studyTemplatePath}`]).trim(),
      studySourceSha256: sha256(studyText),
      provenanceSha256: sha256(doctoredBytes),
      stageAPrerequisiteSha256: null,
    });
    const doctoredPlan = parsePlan(Buffer.from(restamped.planText)).plan;
    await expect(
      verifyPlanRegistration({
        plan: doctoredPlan,
        planBytes: Buffer.from(restamped.planText),
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/is not the registry's/);
  }, 60_000);

  it('an edited launched plan refuses on the derivation proof', async () => {
    const fixture = await freshRegistration('planedit');
    const edited = Buffer.from(`${fixture.planBytes.toString('utf8')}\n`);
    await expect(
      verifyPlanRegistration({
        plan: fixture.plan,
        planBytes: edited,
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/not byte-identical to the registered template/);
  }, 60_000);

  it('an edited registered study file refuses on the derivation proof', async () => {
    const fixture = await freshRegistration('studyedit');
    writeFileSync(fixture.studyPath, `${readFileSync(fixture.studyPath, 'utf8')}\n`, 'utf8');
    await expect(
      verifyPlanRegistration({
        plan: fixture.plan,
        planBytes: fixture.planBytes,
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/registered study file is not byte-identical/);
  }, 60_000);

  it('committed template bytes differing from the provenance record refuse', async () => {
    const fixture = await freshRegistration('templatemoved');
    // Doctor the recorded template hash (and rebind the plan consistently):
    // the Git-authenticated bytes at the pinned SHA no longer match.
    const doctored = JSON.parse(readFileSync(fixture.provenancePath, 'utf8')) as {
      studyTemplate: { sha256: string };
    };
    doctored.studyTemplate.sha256 = 'd'.repeat(64);
    const doctoredBytes = `${JSON.stringify(doctored, null, 2)}\n`;
    writeFileSync(fixture.provenancePath, doctoredBytes, 'utf8');
    const entry = REGISTRATION_REGISTRY.find((item) => item.registrationId === 'stage-a')!;
    const studyText = git(repo, ['show', `HEAD:${entry.studyTemplatePath}`]);
    const planText = git(repo, ['show', `HEAD:${entry.planTemplatePath}`]);
    const restamped = stampTemplates({
      studyTemplateText: studyText,
      planTemplateText: planText,
      headSha: fixture.plan.repositorySha!,
      registeredStudyPath: fixture.plan.study!.studyPlanPath,
      studySha256: fixture.plan.study!.studyPlanSha256,
      studyConfigFingerprint: fixture.plan.study!.studyConfigFingerprint,
      studySourceBlobId: git(repo, ['rev-parse', `HEAD:${entry.studyTemplatePath}`]).trim(),
      studySourceSha256: sha256(studyText),
      provenanceSha256: sha256(doctoredBytes),
      stageAPrerequisiteSha256: null,
    });
    const doctoredPlan = parsePlan(Buffer.from(restamped.planText)).plan;
    await expect(
      verifyPlanRegistration({
        plan: doctoredPlan,
        planBytes: Buffer.from(restamped.planText),
        planPath: fixture.planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/committed study template bytes do not hash to the provenance record/);
  }, 60_000);

  it('a calibration plan without a prerequisite path or hash refuses at the schema (§5.5)', () => {
    const template = JSON.parse(
      readFileSync(
        join(
          REAL_REPO,
          'experiments',
          'm2',
          'templates',
          'calibration-variance-a.plan.template.json',
        ),
        'utf8',
      ),
    ) as { registration: Record<string, unknown> };
    delete template.registration.stageAPrerequisiteSha256;
    delete template.registration.stageAPrerequisitePath;
    expect(() => parsePlan(Buffer.from(JSON.stringify(template)))).toThrow(
      /registration-stage-a-prerequisite-missing/,
    );
  });

  it('calibration preflight refuses a missing, tampered, or evidence-less prerequisite record (§5.5, unconditional)', async () => {
    // A hand-assembled but internally consistent CALIBRATION registration
    // in the scratch repository: real committed templates, fabricated
    // drill-mode provenance, fabricated schema-valid prerequisite record.
    // Every layer up to the Stage A evidence itself authenticates, so the
    // three refusals below each isolate ONE §5.5 case.
    const entry = REGISTRATION_REGISTRY.find(
      (item) => item.registrationId === 'calibration-variance-a',
    )!;
    const headSha = git(repo, ['rev-parse', 'HEAD']).trim();
    const outDir = tempDir('m2-preflight-cal-');
    const studyText = git(repo, ['show', `HEAD:${entry.studyTemplatePath}`]);
    const planText = git(repo, ['show', `HEAD:${entry.planTemplatePath}`]);
    const prerequisiteRecord = {
      prerequisiteSchemaVersion: 'm2-stage-a-prerequisite-1.0.0',
      stageAStudyId: 'm2-stage-a-acceptance-001',
      stageAStudyVersion: '1.0.0',
      stageASequenceId: 'm2-stage-a-acceptance',
      repositorySha: headSha,
      packageVersion: '1.9.0',
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
      sequenceManifestPath: join(outDir, 'no-such-stage-a-root', 'sequence-manifest.json'),
      sequenceManifestSha256: 'a'.repeat(64),
      evidenceArchivePath: join(outDir, 'no-such-stage-a-root.zip'),
      evidenceArchiveSha256: 'b'.repeat(64),
      receiptPath: join(outDir, 'no-such-stage-a-root.zip.receipt.json'),
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
    const prerequisiteSha = sha256(prerequisiteBytes);
    const registeredStudyPath = join(outDir, `${entry.studyId}.json`).replace(/\\/g, '/');
    // Study bytes do not depend on the provenance hash, so stamp them
    // first to learn the study identity the provenance must record.
    const provisional = stampTemplates({
      studyTemplateText: studyText,
      planTemplateText: planText,
      headSha,
      registeredStudyPath,
      studySha256: 'f'.repeat(64),
      studyConfigFingerprint: 'a1b2c3d4e5f60718',
      studySourceBlobId: git(repo, ['rev-parse', `HEAD:${entry.studyTemplatePath}`]).trim(),
      studySourceSha256: sha256(studyText),
      provenanceSha256: 'e'.repeat(64),
      stageAPrerequisiteSha256: prerequisiteSha,
    });
    writeFileSync(registeredStudyPath, provisional.studyText, 'utf8');
    const provenance = {
      registrationProvenanceSchemaVersion: 'm2-registration-provenance-1.0.0',
      registrationId: 'calibration-variance-a',
      headSha,
      atUtc: '2026-08-01T00:00:00.000Z',
      studyTemplate: {
        path: entry.studyTemplatePath,
        blobId: git(repo, ['rev-parse', `HEAD:${entry.studyTemplatePath}`]).trim(),
        sha256: sha256(studyText),
      },
      planTemplate: {
        path: entry.planTemplatePath,
        blobId: git(repo, ['rev-parse', `HEAD:${entry.planTemplatePath}`]).trim(),
        sha256: sha256(planText),
      },
      registeredStudySha256: sha256(provisional.studyText),
      stageAPrerequisiteSha256: prerequisiteSha,
      stageADrillMode: true,
    };
    const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
    const final = stampTemplates({
      studyTemplateText: studyText,
      planTemplateText: planText,
      headSha,
      registeredStudyPath,
      studySha256: sha256(provisional.studyText),
      studyConfigFingerprint: 'a1b2c3d4e5f60718',
      studySourceBlobId: provenance.studyTemplate.blobId,
      studySourceSha256: provenance.studyTemplate.sha256,
      provenanceSha256: sha256(provenanceBytes),
      stageAPrerequisiteSha256: prerequisiteSha,
    });
    // The plan bytes embed the study hash/fingerprint used at stamping,
    // so re-write the study to the FINAL bytes (identical inputs → the
    // study text is unchanged between the two stampings).
    writeFileSync(registeredStudyPath, final.studyText, 'utf8');
    const planPath = join(outDir, `${entry.expectedSequenceId}.plan.json`);
    writeFileSync(planPath, final.planText, 'utf8');
    writeFileSync(join(outDir, 'registration-provenance.json'), provenanceBytes, 'utf8');
    const calPlanBytes = Buffer.from(final.planText);
    const parsed = parsePlan(calPlanBytes);
    // Keyless drill shape: fake attempts so the drill/live rule passes.
    const calPlan = {
      ...parsed.plan,
      attempts: parsed.plan.attempts.map((attempt) => ({
        ...attempt,
        gatewayMode: 'fake' as const,
      })),
    };

    // §5.5: calibration registration missing its prerequisite record.
    await expect(
      verifyPlanRegistration({ plan: calPlan, planBytes: calPlanBytes, planPath, repoRoot: repo }),
    ).rejects.toThrow(/Stage A prerequisite missing at/);

    // §5.5: substituted/modified prerequisite record (hash mismatch).
    writeFileSync(join(outDir, 'stage-a-prerequisite.json'), `${prerequisiteBytes}\n`, 'utf8');
    await expect(
      verifyPlanRegistration({ plan: calPlan, planBytes: calPlanBytes, planPath, repoRoot: repo }),
    ).rejects.toThrow(/prerequisite bytes do not hash to the registered record/);

    // §5.5: intact record whose Stage A evidence is gone (stale/absent).
    writeFileSync(join(outDir, 'stage-a-prerequisite.json'), prerequisiteBytes, 'utf8');
    await expect(
      verifyPlanRegistration({ plan: calPlan, planBytes: calPlanBytes, planPath, repoRoot: repo }),
    ).rejects.toThrow(/Stage A evidence root missing/);

    // Structural rule: the SAME registration can never authorize the real
    // (live) calibration plan under drill-mode evidence.
    writeFileSync(join(outDir, 'stage-a-prerequisite.json'), prerequisiteBytes, 'utf8');
    await expect(
      verifyPlanRegistration({
        plan: parsed.plan,
        planBytes: calPlanBytes,
        planPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/drill-mode Stage A evidence cannot authorize a live launch/);
  }, 60_000);

  it('an unknown registration id and a missing pinned SHA refuse', async () => {
    await expect(
      verifyPlanRegistration({
        plan: {
          ...plan,
          registration: { ...plan.registration!, registrationId: 'my-own-study' },
        },
        planBytes,
        planPath: registeredPlanPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/not in the closed registration registry/);
    await expect(
      verifyPlanRegistration({
        plan: { ...plan, repositorySha: undefined },
        planBytes,
        planPath: registeredPlanPath,
        repoRoot: repo,
      }),
    ).rejects.toThrow(/must pin its repository SHA/);
  });
});
