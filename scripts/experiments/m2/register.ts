import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { helperEnv } from './childEnv';
import { validateStudyFile } from './studyRegistry';
import { parsePlan } from './planSchema';
import { buildStageAPrerequisite } from './stageAPrerequisite';
import {
  REGISTRATION_PROVENANCE_SCHEMA_VERSION,
  REGISTRATION_REGISTRY,
  type RegistrationEntry,
} from './registrationRegistry';
import { assertMetricsProducible } from '../../../src/shared/calibrationAnalysis';

export { REGISTRATION_PROVENANCE_SCHEMA_VERSION, REGISTRATION_REGISTRY };
export type { RegistrationEntry };

/**
 * Registration ritual for evidentiary plans and studies (Phase 4; reworked
 * for audit findings 2 and 3).
 *
 * A registered study must pin ONE exact repository SHA (§21.2), but a
 * tracked file cannot contain the SHA of the commit that introduces it —
 * the pin would invalidate itself. The resolution: REVIEWED templates are
 * tracked in the repository carrying sentinel pins that are schema-valid
 * but can never match a real HEAD, and this command stamps them into
 * REGISTERED instances at the operator's exact clean HEAD, outside the
 * repository, immediately before execution.
 *
 * The audit's closure requirements:
 *
 *  - CLOSED REGISTRY: callers select a registration by ID; the template
 *    paths come from the registry below, never from the command line, so
 *    arbitrary design files can never be stamped.
 *  - GIT AUTHENTICATION: for each template the committed bytes are loaded
 *    with `git show HEAD:<path>`, the working-tree bytes must equal them,
 *    and the blob id and SHA-256 are recorded in a provenance record whose
 *    hash is stamped into the registered plan (and thereby the plan
 *    configuration fingerprint, the resume identity, and every freeze
 *    checkpoint).
 *  - STAGE A PREREQUISITE: a registration flagged as requiring Stage A
 *    verifies a completed Stage A root end to end (seals, inventory,
 *    manifest reconciliation, semantic revalidation, archive, receipt,
 *    SHA equality with the current HEAD) and stamps the canonical record's
 *    SHA-256 into the registered calibration study and plan.
 *  - TRANSACTIONAL OUTPUT: everything is constructed and validated in a
 *    staging sibling, then atomically renamed into the create-once
 *    destination; a failure leaves no partial registration.
 */

/** Sentinel pins carried by tracked templates. Chosen to be schema-valid
 * hex of the right widths while unmistakable and mutually non-overlapping
 * (an all-one SHA can never name a real commit). */
export const TEMPLATE_SHA_SENTINEL = '1111111111111111111111111111111111111111';
export const TEMPLATE_STUDY_SHA256_SENTINEL =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const TEMPLATE_FINGERPRINT_SENTINEL = '3333333333333333';
export const TEMPLATE_STUDY_PATH_SENTINEL = 'TEMPLATES-REGISTER-STUDY-PATH';
export const TEMPLATE_SOURCE_BLOB_SENTINEL = '5555555555555555555555555555555555555555';
export const TEMPLATE_SOURCE_SHA256_SENTINEL =
  '6666666666666666666666666666666666666666666666666666666666666666';
export const TEMPLATE_PROVENANCE_SHA256_SENTINEL =
  '7777777777777777777777777777777777777777777777777777777777777777';
export const TEMPLATE_STAGE_A_SHA256_SENTINEL =
  '8888888888888888888888888888888888888888888888888888888888888888';

// REGISTRATION_REGISTRY and the provenance schema live in
// registrationRegistry.ts (re-exported above) so the plan schema and the
// launch preflight consult the same closed registry without cycles.

export interface StampResult {
  studyText: string;
  planText: string;
}

/**
 * Pure template-stamping transformation: replaces exactly the sentinels,
 * nothing else. Refuses templates that are missing a sentinel (already
 * stamped, or not a template) so double registration is impossible.
 */
export function stampTemplates(args: {
  studyTemplateText: string;
  planTemplateText: string;
  headSha: string;
  registeredStudyPath: string;
  studySha256: string;
  studyConfigFingerprint: string;
  studySourceBlobId: string;
  studySourceSha256: string;
  provenanceSha256: string;
  stageAPrerequisiteSha256: string | null;
}): StampResult {
  const {
    studyTemplateText,
    planTemplateText,
    headSha,
    registeredStudyPath,
    studySha256,
    studyConfigFingerprint,
    studySourceBlobId,
    studySourceSha256,
    provenanceSha256,
    stageAPrerequisiteSha256,
  } = args;
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`register-invalid-head: '${headSha}' is not a 40-hex commit SHA`);
  }
  if (headSha === TEMPLATE_SHA_SENTINEL) {
    throw new Error('register-invalid-head: HEAD equals the template sentinel');
  }
  for (const [name, sentinel, where] of [
    ['sha', TEMPLATE_SHA_SENTINEL, studyTemplateText],
    ['source-blob', TEMPLATE_SOURCE_BLOB_SENTINEL, studyTemplateText],
    ['source-sha256', TEMPLATE_SOURCE_SHA256_SENTINEL, studyTemplateText],
  ] as const) {
    if (!where.includes(sentinel)) {
      throw new Error(`register-study-template-missing-${name}-sentinel (already stamped?)`);
    }
  }
  for (const [name, sentinel] of [
    ['sha', TEMPLATE_SHA_SENTINEL],
    ['study-sha256', TEMPLATE_STUDY_SHA256_SENTINEL],
    ['fingerprint', TEMPLATE_FINGERPRINT_SENTINEL],
    ['study-path', TEMPLATE_STUDY_PATH_SENTINEL],
    ['provenance-sha256', TEMPLATE_PROVENANCE_SHA256_SENTINEL],
  ] as const) {
    if (!planTemplateText.includes(sentinel)) {
      throw new Error(`register-plan-template-missing-${name}-sentinel (already stamped?)`);
    }
  }
  const requiresStageA =
    studyTemplateText.includes(TEMPLATE_STAGE_A_SHA256_SENTINEL) ||
    planTemplateText.includes(TEMPLATE_STAGE_A_SHA256_SENTINEL);
  if (requiresStageA && stageAPrerequisiteSha256 === null) {
    throw new Error('register-stage-a-prerequisite-missing: template requires the Stage A record');
  }
  if (!requiresStageA && stageAPrerequisiteSha256 !== null) {
    throw new Error('register-stage-a-prerequisite-unexpected: template has no prerequisite slot');
  }

  // JSON strings need forward slashes to stay escape-free on Windows.
  const studyPathJson = registeredStudyPath.replace(/\\/g, '/');
  let studyText = studyTemplateText
    .split(TEMPLATE_SHA_SENTINEL)
    .join(headSha)
    .split(TEMPLATE_SOURCE_BLOB_SENTINEL)
    .join(studySourceBlobId)
    .split(TEMPLATE_SOURCE_SHA256_SENTINEL)
    .join(studySourceSha256);
  let planText = planTemplateText
    .split(TEMPLATE_SHA_SENTINEL)
    .join(headSha)
    .split(TEMPLATE_STUDY_SHA256_SENTINEL)
    .join(studySha256)
    .split(TEMPLATE_FINGERPRINT_SENTINEL)
    .join(studyConfigFingerprint)
    .split(TEMPLATE_STUDY_PATH_SENTINEL)
    .join(studyPathJson)
    .split(TEMPLATE_PROVENANCE_SHA256_SENTINEL)
    .join(provenanceSha256);
  if (stageAPrerequisiteSha256 !== null) {
    studyText = studyText.split(TEMPLATE_STAGE_A_SHA256_SENTINEL).join(stageAPrerequisiteSha256);
    planText = planText.split(TEMPLATE_STAGE_A_SHA256_SENTINEL).join(stageAPrerequisiteSha256);
  }
  return { studyText, planText };
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: helperEnv(process.env),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git-authenticates one tracked template: committed bytes via
 * `git show HEAD:<path>`, working-tree byte equality, blob id. */
function authenticateTemplate(
  repoRoot: string,
  repoRelativePath: string,
): { text: string; blobId: string; sha256: string } {
  let committed: string;
  let blobId: string;
  try {
    committed = git(repoRoot, ['show', `HEAD:${repoRelativePath}`]);
    blobId = git(repoRoot, ['rev-parse', `HEAD:${repoRelativePath}`]).trim();
  } catch {
    throw new Error(`register-template-not-tracked: '${repoRelativePath}' is not tracked at HEAD`);
  }
  const workingPath = join(repoRoot, repoRelativePath);
  if (!existsSync(workingPath)) {
    throw new Error(`register-template-missing: '${repoRelativePath}' absent from the worktree`);
  }
  // Git itself judges working-vs-HEAD equality (eol-translation aware — a
  // raw byte comparison would false-refuse CRLF checkouts). Stamping uses
  // the COMMITTED bytes regardless, so the registered instance derives
  // from HEAD even if this check were somehow bypassed.
  try {
    git(repoRoot, ['diff', '--quiet', 'HEAD', '--', repoRelativePath]);
  } catch {
    throw new Error(
      `register-template-modified: '${repoRelativePath}' working tree differs from HEAD`,
    );
  }
  return { text: committed, blobId, sha256: sha256(committed) };
}

export interface RegisterResult {
  registrationId: string;
  headSha: string;
  registeredStudyPath: string;
  registeredPlanPath: string;
  provenancePath: string;
  studySha256: string;
  studyConfigFingerprint: string;
  planSha256: string;
  provenanceSha256: string;
  stageAPrerequisiteSha256: string | null;
}

/**
 * Registers one CLOSED-REGISTRY template pair at the current clean HEAD.
 * Output is transactional: everything is built and validated in a staging
 * sibling and atomically renamed into the create-once destination.
 */
export async function registerFromRegistry(options: {
  repoRoot: string;
  registrationId: string;
  outDir: string;
  stageARoot?: string;
  /** KEYLESS DRILLS ONLY: accept fake-gateway Stage A evidence so the
   * complete verification path is exercised without live spend. Recorded
   * in the registration provenance — a real calibration registration with
   * this flag set is immediately visible to audit. */
  allowFakeStageAForDrill?: boolean;
}): Promise<RegisterResult> {
  const { repoRoot, registrationId, outDir, stageARoot } = options;
  const drillMode = options.allowFakeStageAForDrill === true;
  const entry = REGISTRATION_REGISTRY.find((item) => item.registrationId === registrationId);
  if (!entry) {
    throw new Error(
      `register-unknown-registration: '${registrationId}' — the registry is closed; ` +
        `known ids: ${REGISTRATION_REGISTRY.map((item) => item.registrationId).join(', ')}`,
    );
  }

  const dirty = git(repoRoot, ['status', '--porcelain']).trim();
  if (dirty !== '') {
    throw new Error('register-dirty-worktree: registration requires a clean tracked worktree');
  }
  const headSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();

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
  if (existsSync(outAbsolute)) {
    throw new Error(
      'register-already-exists: registration is create-once; a new registration needs a new directory',
    );
  }

  // Git authentication of BOTH sources (audit finding 3).
  const studySource = authenticateTemplate(repoRoot, entry.studyTemplatePath);
  const planSource = authenticateTemplate(repoRoot, entry.planTemplatePath);

  // Pairing enforcement: the committed templates must BE the registered
  // pair — study id/version, plan sequence id, and profile binding.
  const studyParsed = JSON.parse(studySource.text) as {
    studyId?: string;
    studyVersion?: string;
  };
  if (studyParsed.studyId !== entry.studyId || studyParsed.studyVersion !== entry.studyVersion) {
    throw new Error(
      `register-pairing-mismatch: study template declares '${String(studyParsed.studyId)}@${String(
        studyParsed.studyVersion,
      )}', registry expects '${entry.studyId}@${entry.studyVersion}'`,
    );
  }
  const planParsed = JSON.parse(planSource.text) as {
    sequenceId?: string;
    attemptProfile?: { profileId?: string; profileVersion?: string };
    study?: { studyId?: string };
  };
  if (planParsed.sequenceId !== entry.expectedSequenceId) {
    throw new Error(
      `register-pairing-mismatch: plan template sequenceId '${String(planParsed.sequenceId)}', ` +
        `registry expects '${entry.expectedSequenceId}'`,
    );
  }
  if (
    planParsed.attemptProfile?.profileId !== entry.attemptProfile.profileId ||
    planParsed.attemptProfile?.profileVersion !== entry.attemptProfile.profileVersion
  ) {
    throw new Error(
      'register-pairing-mismatch: plan template attempt profile differs from registry',
    );
  }
  if (planParsed.study?.studyId !== entry.studyId) {
    throw new Error(
      `register-pairing-mismatch: plan template binds study '${String(planParsed.study?.studyId)}', ` +
        `registry expects '${entry.studyId}'`,
    );
  }

  // Stage A prerequisite (audit finding 2): verified, never trusted.
  let prerequisite: { recordBytes: string; recordSha256: string } | null = null;
  if (entry.stageAPrerequisiteRequired) {
    if (!stageARoot) {
      throw new Error(
        'register-stage-a-required: this registration needs --stage-a <verified Stage A sequence root>',
      );
    }
    const sourceEntry = REGISTRATION_REGISTRY.find(
      (item) => item.registrationId === entry.stageASourceRegistrationId,
    );
    if (!sourceEntry) {
      throw new Error(
        `register-stage-a-source-unknown: '${String(entry.stageASourceRegistrationId)}' names no registry entry`,
      );
    }
    prerequisite = await buildStageAPrerequisite({
      stageARoot: resolve(repoRoot, stageARoot),
      expectedHeadSha: headSha,
      requireLiveModel: !drillMode,
      // Drill roots are non-evidentiary by construction (drill sequence and
      // study ids); the identity binding is what forces REAL calibration
      // registrations to consume the registered Stage A sequence.
      expectedIdentity: drillMode
        ? null
        : {
            stageARegistrationId: sourceEntry.registrationId,
            studyId: sourceEntry.studyId,
            studyVersion: sourceEntry.studyVersion,
            sequenceId: sourceEntry.expectedSequenceId,
            attemptProfileId: sourceEntry.attemptProfile.profileId,
            attemptProfileVersion: sourceEntry.attemptProfile.profileVersion,
          },
    });
  } else if (stageARoot) {
    throw new Error('register-stage-a-unexpected: this registration takes no Stage A root');
  }

  // Transactional staging (audit finding 3): build + validate everything
  // in a sibling, atomically rename into the create-once destination.
  const stagingDir = `${outAbsolute}.staging`;
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  try {
    const registeredStudyPath = join(outAbsolute, `${entry.studyId}.json`);
    const registeredPlanPath = join(outAbsolute, `${entry.expectedSequenceId}.plan.json`);
    const stagedStudyPath = join(stagingDir, `${entry.studyId}.json`);
    const stagedPlanPath = join(stagingDir, `${entry.expectedSequenceId}.plan.json`);
    const provenancePath = join(outAbsolute, 'registration-provenance.json');
    const stagedProvenancePath = join(stagingDir, 'registration-provenance.json');

    // Stage 1: stamp + validate the study, learning its real hashes.
    const provisional = stampTemplates({
      studyTemplateText: studySource.text,
      planTemplateText: planSource.text,
      headSha,
      registeredStudyPath,
      studySha256: TEMPLATE_STUDY_SHA256_SENTINEL,
      studyConfigFingerprint: TEMPLATE_FINGERPRINT_SENTINEL,
      studySourceBlobId: studySource.blobId,
      studySourceSha256: studySource.sha256,
      provenanceSha256: TEMPLATE_PROVENANCE_SHA256_SENTINEL,
      stageAPrerequisiteSha256: prerequisite?.recordSha256 ?? null,
    });
    writeFileSync(stagedStudyPath, provisional.studyText, 'utf8');
    const validated = validateStudyFile(stagedStudyPath);
    // Metric-producer completeness at registration time (audit §3.4.G): a
    // study may never register outputs the installed analysis surface
    // cannot generate.
    assertMetricsProducible(validated.study);
    writeFileSync(
      `${stagedStudyPath}.freeze.json`,
      `${JSON.stringify(validated.freeze, null, 2)}\n`,
      'utf8',
    );

    // Stage 2: the provenance record — hashed, then stamped into the plan.
    const provenance = {
      registrationProvenanceSchemaVersion: REGISTRATION_PROVENANCE_SCHEMA_VERSION,
      registrationId: entry.registrationId,
      headSha,
      atUtc: new Date().toISOString(),
      studyTemplate: {
        path: entry.studyTemplatePath,
        blobId: studySource.blobId,
        sha256: studySource.sha256,
      },
      planTemplate: {
        path: entry.planTemplatePath,
        blobId: planSource.blobId,
        sha256: planSource.sha256,
      },
      registeredStudySha256: validated.freeze.planSha256,
      stageAPrerequisiteSha256: prerequisite?.recordSha256 ?? null,
      stageADrillMode: drillMode,
    };
    const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
    writeFileSync(stagedProvenancePath, provenanceBytes, 'utf8');
    const provenanceSha256 = sha256(provenanceBytes);

    // Stage 3: stamp the plan with every real hash and fully validate it.
    const final = stampTemplates({
      studyTemplateText: studySource.text,
      planTemplateText: planSource.text,
      headSha,
      registeredStudyPath,
      studySha256: validated.freeze.planSha256,
      studyConfigFingerprint: validated.freeze.configFingerprint,
      studySourceBlobId: studySource.blobId,
      studySourceSha256: studySource.sha256,
      provenanceSha256,
      stageAPrerequisiteSha256: prerequisite?.recordSha256 ?? null,
    });
    writeFileSync(stagedPlanPath, final.planText, 'utf8');
    const loadedPlan = parsePlan(readFileSync(stagedPlanPath));

    if (prerequisite !== null) {
      writeFileSync(
        join(stagingDir, 'stage-a-prerequisite.json'),
        prerequisite.recordBytes,
        'utf8',
      );
    }

    // Atomic commit of the completed set.
    renameSync(stagingDir, outAbsolute);

    return {
      registrationId: entry.registrationId,
      headSha,
      registeredStudyPath,
      registeredPlanPath,
      provenancePath,
      studySha256: validated.freeze.planSha256,
      studyConfigFingerprint: validated.freeze.configFingerprint,
      planSha256: loadedPlan.planSha256,
      provenanceSha256,
      stageAPrerequisiteSha256: prerequisite?.recordSha256 ?? null,
    };
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
