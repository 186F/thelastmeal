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
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REGISTRATION_REGISTRY,
  TEMPLATE_PROVENANCE_SHA256_SENTINEL,
  TEMPLATE_SHA_SENTINEL,
  TEMPLATE_STAGE_A_SHA256_SENTINEL,
  registerFromRegistry,
  stampTemplates,
} from '../../../scripts/experiments/m2/register';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';
import { validateStudyFile } from '../../../scripts/experiments/m2/studyRegistry';
import { parsePlan } from '../../../scripts/experiments/m2/planSchema';
import { planConfigFingerprint } from '../../../scripts/experiments/m2/orchestrate';

/**
 * The CLOSED Git-authenticated registration ritual (Phase 4 audit
 * finding 3): only the registry's tracked template pairs can be stamped;
 * every source is authenticated against `git show HEAD` byte-for-byte;
 * provenance carries blob ids and hashes; output is transactional and
 * create-once. The Stage A prerequisite path (finding 2) is drilled in
 * stage-a-prerequisite.test.ts against a real orchestrated root.
 */

const REAL_REPO = process.cwd();
const FAKE_HEAD = 'abcdef0123456789abcdef0123456789abcdef01';

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

/** A scratch repository carrying the REAL Phase 4 templates tracked at the
 * registry's repo-relative paths, so the closed registry resolves inside
 * it exactly as it does in the real repository. */
function scratchRepoWithTemplates(): string {
  const dir = tempDir('m2-register-repo-');
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
    'user.email=m2-register-test@example.invalid',
    '-c',
    'user.name=m2-register-test',
    'commit',
    '--quiet',
    '-m',
    'templates',
  ]);
  return dir;
}

const STAGE_A = REGISTRATION_REGISTRY.find((entry) => entry.registrationId === 'stage-a')!;
const CAL = REGISTRATION_REGISTRY.find(
  (entry) => entry.registrationId === 'calibration-variance-a',
)!;

/** A scratch repository whose tracked bytes at `dest` paths come from
 * OTHER template files (`swaps: destRelPath -> sourceRelPath`) — the
 * cross-pairing attack surface (audit §5.4). */
function scratchRepoWithSwaps(swaps: Record<string, string>): string {
  const dir = scratchRepoWithTemplates();
  for (const [dest, source] of Object.entries(swaps)) {
    cpSync(join(REAL_REPO, source), join(dir, dest));
  }
  git(dir, ['add', '.']);
  git(dir, [
    '-c',
    'user.email=m2-register-test@example.invalid',
    '-c',
    'user.name=m2-register-test',
    'commit',
    '--quiet',
    '-m',
    'swap',
  ]);
  return dir;
}

describe('the registration registry is closed and complete', () => {
  it('contains exactly the two Phase 4 registrations with tracked template paths', () => {
    expect(REGISTRATION_REGISTRY.map((entry) => entry.registrationId).sort()).toEqual([
      'calibration-variance-a',
      'stage-a',
    ]);
    for (const entry of REGISTRATION_REGISTRY) {
      // The declared paths are tracked in the REAL repository at HEAD.
      expect(existsSync(join(REAL_REPO, entry.studyTemplatePath))).toBe(true);
      expect(existsSync(join(REAL_REPO, entry.planTemplatePath))).toBe(true);
      expect(entry.attemptProfile).toEqual({
        profileId: 'm2-formal-attempt-profile',
        profileVersion: '1.0.0',
      });
    }
    expect(STAGE_A.stageAPrerequisiteRequired).toBe(false);
    expect(CAL.stageAPrerequisiteRequired).toBe(true);
  });
});

describe('stampTemplates (pure transformation)', () => {
  const studyText = readFileSync(join(REAL_REPO, STAGE_A.studyTemplatePath), 'utf8');
  const planText = readFileSync(join(REAL_REPO, STAGE_A.planTemplatePath), 'utf8');
  const base = {
    studyTemplateText: studyText,
    planTemplateText: planText,
    headSha: FAKE_HEAD,
    registeredStudyPath: 'C:/outside/m2-stage-a-acceptance-001.json',
    studySha256: 'f'.repeat(64),
    studyConfigFingerprint: 'a1b2c3d4e5f60718',
    studySourceBlobId: 'b'.repeat(40),
    studySourceSha256: 'c'.repeat(64),
    provenanceSha256: 'd'.repeat(64),
    stageAPrerequisiteSha256: null,
  };

  it('replaces exactly the sentinels and nothing else', () => {
    const result = stampTemplates(base);
    for (const sentinel of [TEMPLATE_SHA_SENTINEL, TEMPLATE_PROVENANCE_SHA256_SENTINEL]) {
      expect(result.studyText.includes(TEMPLATE_SHA_SENTINEL)).toBe(false);
      expect(result.planText.includes(sentinel)).toBe(false);
    }
    const normalize = (text: string) =>
      text
        .split(FAKE_HEAD)
        .join(TEMPLATE_SHA_SENTINEL)
        .split('f'.repeat(64))
        .join('2'.repeat(64))
        .split('a1b2c3d4e5f60718')
        .join('3'.repeat(16))
        .split('C:/outside/m2-stage-a-acceptance-001.json')
        .join('TEMPLATES-REGISTER-STUDY-PATH')
        .split('b'.repeat(40))
        .join('5'.repeat(40))
        .split('c'.repeat(64))
        .join('6'.repeat(64))
        .split('d'.repeat(64))
        .join('7'.repeat(64));
    expect(normalize(result.studyText)).toBe(studyText);
    expect(normalize(result.planText)).toBe(planText);
  });

  it('refuses bad heads, double stamping, and prerequisite slot mismatches', () => {
    expect(() => stampTemplates({ ...base, headSha: 'nope' })).toThrow(/register-invalid-head/);
    expect(() => stampTemplates({ ...base, headSha: TEMPLATE_SHA_SENTINEL })).toThrow(
      /register-invalid-head/,
    );
    const stamped = stampTemplates(base);
    expect(() =>
      stampTemplates({
        ...base,
        studyTemplateText: stamped.studyText,
        planTemplateText: stamped.planText,
      }),
    ).toThrow(/register-study-template-missing-sha-sentinel/);
    // The Stage A pair has no prerequisite slot: supplying a record refuses.
    expect(() => stampTemplates({ ...base, stageAPrerequisiteSha256: 'e'.repeat(64) })).toThrow(
      /register-stage-a-prerequisite-unexpected/,
    );
    // The calibration pair HAS the slot: omitting the record refuses.
    const calStudy = readFileSync(join(REAL_REPO, CAL.studyTemplatePath), 'utf8');
    const calPlan = readFileSync(join(REAL_REPO, CAL.planTemplatePath), 'utf8');
    expect(calStudy.includes(TEMPLATE_STAGE_A_SHA256_SENTINEL)).toBe(true);
    expect(calPlan.includes(TEMPLATE_STAGE_A_SHA256_SENTINEL)).toBe(true);
    expect(() =>
      stampTemplates({
        ...base,
        studyTemplateText: calStudy,
        planTemplateText: calPlan,
        registeredStudyPath: 'C:/outside/m2-calibration-variance-a-001.json',
      }),
    ).toThrow(/register-stage-a-prerequisite-missing/);
  });
});

describe('registerFromRegistry (closed, Git-authenticated, transactional)', () => {
  let repo: string;
  beforeAll(() => {
    repo = scratchRepoWithTemplates();
  });

  it('registers stage-a: stamped at HEAD, provenance with blob ids, plan fully parsed, fingerprint bound', async () => {
    const out = join(tempDir('m2-register-out-'), 'registered');
    const result = await registerFromRegistry({
      repoRoot: repo,
      registrationId: 'stage-a',
      outDir: out,
    });
    expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);
    // The registered study re-validates and carries the Git provenance.
    const revalidated = validateStudyFile(result.registeredStudyPath);
    expect(revalidated.freeze.planSha256).toBe(result.studySha256);
    expect(revalidated.study.repositorySha).toBe(result.headSha);
    expect(revalidated.study.registration?.registrationId).toBe('stage-a');
    expect(revalidated.study.registration?.sourceBlobId).toMatch(/^[0-9a-f]{40}$/);
    // The blob id is the REAL committed blob.
    const expectedBlob = git(repo, ['rev-parse', `HEAD:${STAGE_A.studyTemplatePath}`]).trim();
    expect(revalidated.study.registration?.sourceBlobId).toBe(expectedBlob);
    // Provenance file: exact paths, blob ids, hashes.
    const provenance = JSON.parse(readFileSync(result.provenancePath, 'utf8')) as {
      registrationId: string;
      headSha: string;
      studyTemplate: { path: string; blobId: string; sha256: string };
      planTemplate: { path: string; blobId: string };
      registeredStudySha256: string;
      stageADrillMode: boolean;
    };
    expect(provenance.registrationId).toBe('stage-a');
    expect(provenance.headSha).toBe(result.headSha);
    expect(provenance.studyTemplate.path).toBe(STAGE_A.studyTemplatePath);
    expect(provenance.studyTemplate.blobId).toBe(expectedBlob);
    expect(provenance.registeredStudySha256).toBe(result.studySha256);
    expect(provenance.stageADrillMode).toBe(false);
    // The registered plan binds the provenance hash into its fingerprint.
    const loaded = parsePlan(readFileSync(result.registeredPlanPath));
    expect(loaded.plan.registration?.registrationId).toBe('stage-a');
    expect(loaded.plan.registration?.provenanceSha256).toBe(result.provenanceSha256);
    const refingerprinted = planConfigFingerprint({
      ...loaded.plan,
      registration: {
        registrationId: 'stage-a',
        provenanceSha256: 'e'.repeat(64),
        provenancePath: 'registration-provenance.json',
      },
    });
    expect(refingerprinted).not.toBe(planConfigFingerprint(loaded.plan));
  });

  it('is create-once and transactional: no partial output survives a failure', async () => {
    const parent = tempDir('m2-register-once-');
    const out = join(parent, 'registered');
    await registerFromRegistry({ repoRoot: repo, registrationId: 'stage-a', outDir: out });
    await expect(
      registerFromRegistry({ repoRoot: repo, registrationId: 'stage-a', outDir: out }),
    ).rejects.toThrow(/register-already-exists/);
    // A failing registration (calibration without Stage A) leaves neither
    // the destination nor its staging sibling.
    const failedOut = join(parent, 'failed');
    await expect(
      registerFromRegistry({
        repoRoot: repo,
        registrationId: 'calibration-variance-a',
        outDir: failedOut,
      }),
    ).rejects.toThrow(/register-stage-a-required/);
    expect(existsSync(failedOut)).toBe(false);
    expect(existsSync(`${failedOut}.staging`)).toBe(false);
  });

  it('refuses everything outside the closed registry', async () => {
    const out = () => join(tempDir('m2-register-refuse-'), 'r');
    await expect(
      registerFromRegistry({ repoRoot: repo, registrationId: 'my-own-study', outDir: out() }),
    ).rejects.toThrow(/register-unknown-registration/);
  });

  it('refuses a modified working-tree template (bytes differ from HEAD)', async () => {
    const tampered = scratchRepoWithTemplates();
    const target = join(tampered, STAGE_A.studyTemplatePath);
    const text = readFileSync(target, 'utf8');
    writeFileSync(target, text.replace('"sampleSizeN": 2', '"sampleSizeN": 3'), 'utf8');
    // Uncommitted change: dirty-worktree refusal fires first.
    await expect(
      registerFromRegistry({
        repoRoot: tampered,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-tamper-'), 'r'),
      }),
    ).rejects.toThrow(/register-dirty-worktree/);
    // Committed tampering that breaks the registered pairing is refused by
    // the pairing check even with a clean worktree.
    const repaired = readFileSync(target, 'utf8').replace(
      '"studyId": "m2-stage-a-acceptance-001"',
      '"studyId": "m2-stage-a-acceptance-999"',
    );
    writeFileSync(target, repaired, 'utf8');
    git(tampered, ['add', '.']);
    git(tampered, [
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'user.name=t',
      'commit',
      '--quiet',
      '-m',
      'tamper',
    ]);
    await expect(
      registerFromRegistry({
        repoRoot: tampered,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-tamper2-'), 'r'),
      }),
    ).rejects.toThrow(/register-pairing-mismatch|register-invalid/);
  });

  it('refuses an untracked template and an output directory inside the repository', async () => {
    const missing = tempDir('m2-register-untracked-');
    git(missing, ['init', '--quiet']);
    writeFileSync(join(missing, 'README.md'), 'x\n', 'utf8');
    // The templates exist in the WORKTREE but were never committed.
    for (const entry of REGISTRATION_REGISTRY) {
      for (const rel of [entry.studyTemplatePath, entry.planTemplatePath]) {
        const dest = join(missing, rel);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(join(REAL_REPO, rel), dest);
      }
    }
    git(missing, ['add', 'README.md']);
    git(missing, [
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'user.name=t',
      'commit',
      '--quiet',
      '-m',
      'no templates',
    ]);
    await expect(
      registerFromRegistry({
        repoRoot: missing,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-untracked-out-'), 'r'),
      }),
    ).rejects.toThrow(/register-dirty-worktree|register-template-not-tracked/);

    await expect(
      registerFromRegistry({
        repoRoot: repo,
        registrationId: 'stage-a',
        outDir: join(repo, 'inside'),
      }),
    ).rejects.toThrow(/register-out-dir-inside-repository/);
  });

  it('rolls back a failure INSIDE the staging transaction: no destination, no staging sibling (§5.4)', async () => {
    // The tampered template passes every pre-staging check (pairing ids
    // intact, clean committed worktree) and fails at the metric-producer
    // gate — which runs after the staging directory exists and the study
    // has been written into it.
    const tampered = scratchRepoWithTemplates();
    const target = join(tampered, STAGE_A.studyTemplatePath);
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(
        '"per-run-integrity-gates"',
        '"metric-with-no-installed-producer"',
      ),
      'utf8',
    );
    git(tampered, ['add', '.']);
    git(tampered, [
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'user.name=t',
      'commit',
      '--quiet',
      '-m',
      'unproducible metric',
    ]);
    const out = join(tempDir('m2-register-rollback-'), 'registered');
    await expect(
      registerFromRegistry({ repoRoot: tampered, registrationId: 'stage-a', outDir: out }),
    ).rejects.toThrow(/study-metrics-unproducible.*metric-with-no-installed-producer/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.staging`)).toBe(false);
  });

  it('cross-pairing refuses: the CALIBRATION study committed at the stage-a study path (§5.4)', async () => {
    const swapped = scratchRepoWithSwaps({
      [STAGE_A.studyTemplatePath]: CAL.studyTemplatePath,
    });
    await expect(
      registerFromRegistry({
        repoRoot: swapped,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-swap1-'), 'r'),
      }),
    ).rejects.toThrow(
      /register-pairing-mismatch: study template declares 'm2-calibration-variance-a-001@1\.0\.0'/,
    );
  });

  it('cross-pairing refuses: the CALIBRATION plan committed at the stage-a plan path (§5.4)', async () => {
    const swapped = scratchRepoWithSwaps({
      [STAGE_A.planTemplatePath]: CAL.planTemplatePath,
    });
    await expect(
      registerFromRegistry({
        repoRoot: swapped,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-swap2-'), 'r'),
      }),
    ).rejects.toThrow(
      /register-pairing-mismatch: plan template sequenceId 'm2-calibration-variance-a'/,
    );
  });

  it('cross-pairing refuses mirrored: stage-a templates committed at the calibration paths (§5.4)', async () => {
    // Pairing enforcement fires BEFORE the Stage A prerequisite block, so
    // no Stage A root is needed to prove these refusals.
    const swappedStudy = scratchRepoWithSwaps({
      [CAL.studyTemplatePath]: STAGE_A.studyTemplatePath,
    });
    await expect(
      registerFromRegistry({
        repoRoot: swappedStudy,
        registrationId: 'calibration-variance-a',
        outDir: join(tempDir('m2-register-swap3-'), 'r'),
      }),
    ).rejects.toThrow(
      /register-pairing-mismatch: study template declares 'm2-stage-a-acceptance-001@1\.0\.0'/,
    );

    const swappedPlan = scratchRepoWithSwaps({
      [CAL.planTemplatePath]: STAGE_A.planTemplatePath,
    });
    await expect(
      registerFromRegistry({
        repoRoot: swappedPlan,
        registrationId: 'calibration-variance-a',
        outDir: join(tempDir('m2-register-swap4-'), 'r'),
      }),
    ).rejects.toThrow(
      /register-pairing-mismatch: plan template sequenceId 'm2-stage-a-acceptance'/,
    );
  });

  it('refuses a Stage A root offered to a registration that takes none', async () => {
    await expect(
      registerFromRegistry({
        repoRoot: repo,
        registrationId: 'stage-a',
        outDir: join(tempDir('m2-register-nostagea-'), 'r'),
        stageARoot: 'somewhere',
      }),
    ).rejects.toThrow(/register-stage-a-unexpected/);
  });
});
