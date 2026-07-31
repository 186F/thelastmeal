import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { helperEnv } from './childEnv';
import { validateStudyFile } from './studyRegistry';
import { parsePlan } from './planSchema';

/**
 * Registration ritual for evidentiary plans and studies (Phase 4).
 *
 * A registered study must pin ONE exact repository SHA (§21.2), but a
 * tracked file cannot contain the SHA of the commit that introduces it —
 * the pin would invalidate itself. The resolution: the REVIEWED templates
 * are tracked (experiments/m2/templates/*.template.json) carrying sentinel
 * pins that are schema-valid but can never match a real HEAD, and this
 * command stamps them into REGISTERED instances at the operator's exact
 * merged HEAD, outside the repository, immediately before execution:
 *
 *   1. refuse unless the worktree is clean (registration must describe an
 *      exact reviewable state);
 *   2. stamp HEAD into the study template by pure text substitution (the
 *      registered bytes differ from the reviewed bytes ONLY in the pin);
 *   3. validate the registered study and write its freeze record;
 *   4. stamp HEAD, the registered study's path, its byte-exact sha256, and
 *      its config fingerprint into the plan template; parse the registered
 *      plan under the full schema (profile, budget, treatment contract);
 *   5. print every hash — execution consumes ONLY the registered files.
 *
 * The orchestrator then enforces the pins as before: HEAD must equal the
 * registered SHA at launch and at every freeze checkpoint, and the study's
 * archived bytes must match the registered file for the sequence lifetime.
 */

/** Sentinel pins carried by tracked templates. Chosen to be schema-valid
 * hex of the right widths while unmistakable and mutually non-overlapping
 * (an all-one SHA can never name a real commit). */
export const TEMPLATE_SHA_SENTINEL = '1111111111111111111111111111111111111111';
export const TEMPLATE_STUDY_SHA256_SENTINEL =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const TEMPLATE_FINGERPRINT_SENTINEL = '3333333333333333';
export const TEMPLATE_STUDY_PATH_SENTINEL = 'TEMPLATES-REGISTER-STUDY-PATH';

export interface StampResult {
  studyText: string;
  planText: string;
}

/**
 * Pure template-stamping transformation: replaces exactly the sentinels,
 * nothing else. Refuses templates that are missing a sentinel (already
 * stamped, or not a template) so double registration is impossible.
 */
export function stampTemplates(
  studyTemplateText: string,
  planTemplateText: string,
  headSha: string,
  registeredStudyPath: string,
  studySha256: string,
  studyConfigFingerprint: string,
): StampResult {
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`register-invalid-head: '${headSha}' is not a 40-hex commit SHA`);
  }
  if (headSha === TEMPLATE_SHA_SENTINEL) {
    throw new Error('register-invalid-head: HEAD equals the template sentinel');
  }
  if (!studyTemplateText.includes(TEMPLATE_SHA_SENTINEL)) {
    throw new Error('register-study-template-missing-sha-sentinel (already stamped?)');
  }
  for (const [name, sentinel] of [
    ['sha', TEMPLATE_SHA_SENTINEL],
    ['study-sha256', TEMPLATE_STUDY_SHA256_SENTINEL],
    ['fingerprint', TEMPLATE_FINGERPRINT_SENTINEL],
    ['study-path', TEMPLATE_STUDY_PATH_SENTINEL],
  ] as const) {
    if (!planTemplateText.includes(sentinel)) {
      throw new Error(`register-plan-template-missing-${name}-sentinel (already stamped?)`);
    }
  }
  // JSON strings need forward slashes to stay escape-free on Windows.
  const studyPathJson = registeredStudyPath.replace(/\\/g, '/');
  const studyText = studyTemplateText.split(TEMPLATE_SHA_SENTINEL).join(headSha);
  const planText = planTemplateText
    .split(TEMPLATE_SHA_SENTINEL)
    .join(headSha)
    .split(TEMPLATE_STUDY_SHA256_SENTINEL)
    .join(studySha256)
    .split(TEMPLATE_FINGERPRINT_SENTINEL)
    .join(studyConfigFingerprint)
    .split(TEMPLATE_STUDY_PATH_SENTINEL)
    .join(studyPathJson);
  return { studyText, planText };
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: helperEnv(process.env),
    encoding: 'utf8',
  }).trim();
}

export interface RegisterResult {
  headSha: string;
  registeredStudyPath: string;
  registeredPlanPath: string;
  studySha256: string;
  studyConfigFingerprint: string;
  planSha256: string;
}

/**
 * Registers one plan/study template pair at the current clean HEAD. The
 * registered instances land in `outDir` (which must be OUTSIDE the
 * repository, like the evidence root itself) and are fully re-validated:
 * the study through the registry pipeline (freeze record written beside
 * it), the plan through the complete orchestrator schema.
 */
export function registerTemplates(
  repoRoot: string,
  studyTemplatePath: string,
  planTemplatePath: string,
  outDir: string,
): RegisterResult {
  const dirty = git(repoRoot, ['status', '--porcelain']);
  if (dirty !== '') {
    throw new Error('register-dirty-worktree: registration requires a clean tracked worktree');
  }
  const headSha = git(repoRoot, ['rev-parse', 'HEAD']);
  const outAbsolute = isAbsolute(outDir) ? outDir : resolve(repoRoot, outDir);
  const repoAbsolute = resolve(repoRoot);
  if (
    outAbsolute === repoAbsolute ||
    outAbsolute.startsWith(`${repoAbsolute}\\`) ||
    outAbsolute.startsWith(`${repoAbsolute}/`)
  ) {
    throw new Error(
      `register-out-dir-inside-repository: registered evidentiary inputs live OUTSIDE the repo (${outAbsolute})`,
    );
  }
  mkdirSync(outAbsolute, { recursive: true });

  const studyTemplateText = readFileSync(studyTemplatePath, 'utf8');
  const planTemplateText = readFileSync(planTemplatePath, 'utf8');
  const studyFileName = (JSON.parse(studyTemplateText) as { studyId: string }).studyId;
  const registeredStudyPath = join(outAbsolute, `${studyFileName}.json`);
  const registeredPlanPath = join(
    outAbsolute,
    `${(JSON.parse(planTemplateText) as { sequenceId: string }).sequenceId}.plan.json`,
  );
  if (existsSync(registeredStudyPath) || existsSync(registeredPlanPath)) {
    throw new Error(
      'register-already-exists: a registered instance already exists in the output ' +
        'directory — registration is create-once; a new registration needs a new directory',
    );
  }

  // Stage 1: stamp + validate the study, then learn its real hashes.
  const provisional = stampTemplates(
    studyTemplateText,
    planTemplateText,
    headSha,
    registeredStudyPath,
    TEMPLATE_STUDY_SHA256_SENTINEL,
    TEMPLATE_FINGERPRINT_SENTINEL,
  );
  writeFileSync(registeredStudyPath, provisional.studyText, 'utf8');
  const validated = validateStudyFile(registeredStudyPath);
  writeFileSync(
    `${registeredStudyPath}.freeze.json`,
    `${JSON.stringify(validated.freeze, null, 2)}\n`,
    'utf8',
  );

  // Stage 2: stamp the plan with the study's REAL hashes and validate it
  // under the complete orchestrator schema.
  const final = stampTemplates(
    studyTemplateText,
    planTemplateText,
    headSha,
    registeredStudyPath,
    validated.freeze.planSha256,
    validated.freeze.configFingerprint,
  );
  writeFileSync(registeredPlanPath, final.planText, 'utf8');
  const loadedPlan = parsePlan(readFileSync(registeredPlanPath));

  return {
    headSha,
    registeredStudyPath,
    registeredPlanPath,
    studySha256: validated.freeze.planSha256,
    studyConfigFingerprint: validated.freeze.configFingerprint,
    planSha256: loadedPlan.planSha256,
  };
}
