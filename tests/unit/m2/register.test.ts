import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TEMPLATE_FINGERPRINT_SENTINEL,
  TEMPLATE_SHA_SENTINEL,
  TEMPLATE_STUDY_PATH_SENTINEL,
  TEMPLATE_STUDY_SHA256_SENTINEL,
  registerTemplates,
  stampTemplates,
} from '../../../scripts/experiments/m2/register';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';
import { validateStudyFile } from '../../../scripts/experiments/m2/studyRegistry';

/**
 * The Phase 4 registration ritual: tracked, reviewed TEMPLATES carry
 * sentinel pins that can never match a real HEAD; `m2:register` stamps them
 * into registered instances at the operator's exact clean HEAD, outside the
 * repository, and fully re-validates both files. This resolves §21.2's
 * one-exact-SHA requirement without the self-referential impossibility of a
 * tracked file pinning its own commit.
 */

const REPO = process.cwd();
const STAGE_A_STUDY = join(
  REPO,
  'experiments',
  'm2',
  'templates',
  'm2-stage-a-acceptance-001.study.template.json',
);
const STAGE_A_PLAN = join(REPO, 'experiments', 'm2', 'templates', 'stage-a.plan.template.json');
const CAL_STUDY = join(
  REPO,
  'experiments',
  'm2',
  'templates',
  'm2-calibration-variance-a-001.study.template.json',
);
const CAL_PLAN = join(
  REPO,
  'experiments',
  'm2',
  'templates',
  'calibration-variance-a.plan.template.json',
);

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

/** A scratch git repository whose HEAD the ritual can pin. */
function scratchRepo(): string {
  const dir = tempDir('m2-register-repo-');
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, env: helperEnv(process.env), encoding: 'utf8' });
  git(['init', '--quiet']);
  writeFileSync(join(dir, 'README.md'), 'scratch\n', 'utf8');
  git(['add', '.']);
  git([
    '-c',
    'user.email=m2-register-test@example.invalid',
    '-c',
    'user.name=m2-register-test',
    'commit',
    '--quiet',
    '-m',
    'scratch',
  ]);
  return dir;
}

describe('stampTemplates (pure transformation)', () => {
  const studyText = readFileSync(STAGE_A_STUDY, 'utf8');
  const planText = readFileSync(STAGE_A_PLAN, 'utf8');

  it('replaces exactly the sentinels and nothing else', () => {
    const result = stampTemplates(
      studyText,
      planText,
      FAKE_HEAD,
      'C:/somewhere/m2-stage-a-acceptance-001.json',
      'f'.repeat(64),
      'a1b2c3d4e5f60718',
    );
    expect(result.studyText).not.toContain(TEMPLATE_SHA_SENTINEL);
    expect(result.studyText).toContain(FAKE_HEAD);
    expect(result.planText).not.toContain(TEMPLATE_SHA_SENTINEL);
    expect(result.planText).not.toContain(TEMPLATE_STUDY_SHA256_SENTINEL);
    expect(result.planText).not.toContain(TEMPLATE_FINGERPRINT_SENTINEL);
    expect(result.planText).not.toContain(TEMPLATE_STUDY_PATH_SENTINEL);
    expect(result.planText).toContain('C:/somewhere/m2-stage-a-acceptance-001.json');
    // Everything except the sentinels is byte-identical.
    const normalize = (text: string) =>
      text
        .split(FAKE_HEAD)
        .join(TEMPLATE_SHA_SENTINEL)
        .split('f'.repeat(64))
        .join(TEMPLATE_STUDY_SHA256_SENTINEL)
        .split('a1b2c3d4e5f60718')
        .join(TEMPLATE_FINGERPRINT_SENTINEL)
        .split('C:/somewhere/m2-stage-a-acceptance-001.json')
        .join(TEMPLATE_STUDY_PATH_SENTINEL);
    expect(normalize(result.studyText)).toBe(studyText);
    expect(normalize(result.planText)).toBe(planText);
  });

  it('refuses a non-SHA head, the sentinel itself, and already-stamped templates', () => {
    expect(() =>
      stampTemplates(studyText, planText, 'not-a-sha', 'x', 'f'.repeat(64), 'aabbccdd11223344'),
    ).toThrow(/register-invalid-head/);
    expect(() =>
      stampTemplates(
        studyText,
        planText,
        TEMPLATE_SHA_SENTINEL,
        'x',
        'f'.repeat(64),
        'aabbccdd11223344',
      ),
    ).toThrow(/register-invalid-head/);
    const stamped = stampTemplates(
      studyText,
      planText,
      FAKE_HEAD,
      'x',
      'f'.repeat(64),
      'aabbccdd11223344',
    );
    expect(() =>
      stampTemplates(
        stamped.studyText,
        stamped.planText,
        FAKE_HEAD,
        'x',
        'f'.repeat(64),
        'aabbccdd11223344',
      ),
    ).toThrow(/register-study-template-missing-sha-sentinel/);
  });
});

describe('registerTemplates (full ritual against a scratch repository)', () => {
  let repo: string;
  beforeAll(() => {
    repo = scratchRepo();
  });

  it('registers BOTH Phase 4 template pairs: stamped, validated, hashed, plan fully parsed', () => {
    for (const [studyTemplate, planTemplate] of [
      [STAGE_A_STUDY, STAGE_A_PLAN],
      [CAL_STUDY, CAL_PLAN],
    ] as const) {
      const out = tempDir('m2-register-out-');
      const result = registerTemplates(repo, studyTemplate, planTemplate, out);
      expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);
      // The registered study re-validates independently and its freeze
      // record matches what the plan binding was stamped with.
      const revalidated = validateStudyFile(result.registeredStudyPath);
      expect(revalidated.freeze.planSha256).toBe(result.studySha256);
      expect(revalidated.freeze.configFingerprint).toBe(result.studyConfigFingerprint);
      expect(revalidated.study.repositorySha).toBe(result.headSha);
      // The registered plan pins the same HEAD and the study's real hashes.
      const plan = JSON.parse(readFileSync(result.registeredPlanPath, 'utf8')) as {
        repositorySha: string;
        study: { studyPlanSha256: string; studyConfigFingerprint: string; studyPlanPath: string };
      };
      expect(plan.repositorySha).toBe(result.headSha);
      expect(plan.study.studyPlanSha256).toBe(result.studySha256);
      expect(plan.study.studyConfigFingerprint).toBe(result.studyConfigFingerprint);
      expect(plan.study.studyPlanPath.replace(/\//g, '\\')).toBe(
        result.registeredStudyPath.replace(/\//g, '\\'),
      );
    }
  });

  it('is create-once: a second registration into the same directory refuses', () => {
    const out = tempDir('m2-register-once-');
    registerTemplates(repo, STAGE_A_STUDY, STAGE_A_PLAN, out);
    expect(() => registerTemplates(repo, STAGE_A_STUDY, STAGE_A_PLAN, out)).toThrow(
      /register-already-exists/,
    );
  });

  it('refuses a dirty worktree and an output directory inside the repository', () => {
    const dirty = scratchRepo();
    writeFileSync(join(dirty, 'uncommitted.txt'), 'dirt\n', 'utf8');
    expect(() =>
      registerTemplates(dirty, STAGE_A_STUDY, STAGE_A_PLAN, tempDir('m2-register-dirty-out-')),
    ).toThrow(/register-dirty-worktree/);
    expect(() =>
      registerTemplates(repo, STAGE_A_STUDY, STAGE_A_PLAN, join(repo, 'inside')),
    ).toThrow(/register-out-dir-inside-repository/);
  });
});
