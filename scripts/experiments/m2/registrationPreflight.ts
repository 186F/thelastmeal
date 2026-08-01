import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { helperEnv } from './childEnv';
import type { OrchestratorPlan } from './planSchema';
import { stampTemplates } from './register';
import {
  registrationEntry,
  registrationProvenanceSchema,
  type RegistrationEntry,
  type RegistrationProvenance,
} from './registrationRegistry';
import {
  buildStageAPrerequisite,
  stageAPrerequisiteSchema,
  type StageAPrerequisite,
} from './stageAPrerequisite';

/**
 * Launch-time registration preflight (final targeted remediation C §5.3).
 *
 * The plan schema already refuses a formal plan without a registration
 * binding; this module makes the binding MEAN something at launch: before
 * the orchestrator writes a byte or spawns a process, every external
 * record the plan claims to be bound to is reopened, schema-validated,
 * re-hashed, and re-proven:
 *
 *  1. the registration provenance record — bytes re-hashed against the
 *     plan binding, schema-validated, identities matched to the closed
 *     registry entry;
 *  2. both source templates — re-read from Git AT THE PINNED SHA
 *     (`git show <sha>:<path>`), byte-hashed and blob-compared against
 *     the provenance record;
 *  3. the DERIVATION itself — the committed templates are re-stamped with
 *     the recorded hashes, and the launched plan file must equal the
 *     re-stamped plan BYTE FOR BYTE (and the registered study file the
 *     re-stamped study), so a hand-edited "registered" plan can never
 *     launch;
 *  4. for calibration — the Stage A prerequisite record is re-hashed and
 *     schema-validated, the Stage A evidence root it names is re-verified
 *     END TO END (seals, inventory, manifest reconciliation, semantic
 *     revalidation, archive, sidecar, receipt, repository SHA, registered
 *     identity, live requirement), and the canonical record is REBUILT
 *     and required to be byte-identical to the registered one.
 *
 * Everything here is read-only. Any absence, mutation, or staleness is a
 * typed refusal before the sequence root exists.
 */

export interface RegistrationPreflightEvidence {
  entry: RegistrationEntry;
  provenance: RegistrationProvenance;
  provenanceBytes: Buffer;
  provenanceSha256: string;
  prerequisite: StageAPrerequisite | null;
  prerequisiteBytes: Buffer | null;
  prerequisiteSha256: string | null;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function refuse(detail: string): never {
  throw new Error(`registration-preflight-refused: ${detail}`);
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: helperEnv(process.env),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Committed bytes + blob id of one template at the PINNED sha — never
 * the working tree, never HEAD. */
function committedTemplate(
  repoRoot: string,
  pinnedSha: string,
  path: string,
): { text: string; blobId: string } {
  try {
    const text = git(repoRoot, ['show', `${pinnedSha}:${path}`]);
    const blobId = git(repoRoot, ['rev-parse', `${pinnedSha}:${path}`]).trim();
    return { text, blobId };
  } catch {
    refuse(
      `cannot read '${path}' at pinned ${pinnedSha} — the pinned commit or template is unavailable in this repository`,
    );
  }
}

/**
 * Verifies the plan's registration binding end to end. Returns null only
 * for plans WITHOUT a registration block (rehearsal/test plans); a formal
 * plan without one is refused here even if the schema gate were bypassed.
 */
export async function verifyPlanRegistration(args: {
  plan: OrchestratorPlan;
  planBytes: Buffer;
  planPath: string;
  repoRoot: string;
}): Promise<RegistrationPreflightEvidence | null> {
  const { plan, planBytes, planPath, repoRoot } = args;
  const anyLive = plan.attempts.some((attempt) => attempt.gatewayMode === 'live');
  if (plan.registration === undefined) {
    if (plan.evidentiary || anyLive) {
      refuse('evidentiary or live plans launch only from an authenticated m2:register output');
    }
    return null;
  }

  const entry = registrationEntry(plan.registration.registrationId);
  if (entry === undefined) {
    refuse(`'${plan.registration.registrationId}' is not in the closed registration registry`);
  }
  if (plan.repositorySha === undefined) {
    refuse('a registered plan must pin its repository SHA');
  }

  // 1. The provenance record: bytes → hash → schema → identities.
  const planDir = dirname(resolve(planPath));
  const provenancePath = isAbsolute(plan.registration.provenancePath)
    ? plan.registration.provenancePath
    : join(planDir, plan.registration.provenancePath);
  if (!existsSync(provenancePath)) {
    refuse(`registration provenance missing at ${provenancePath}`);
  }
  const provenanceBytes = readFileSync(provenancePath);
  const provenanceSha256 = sha256(provenanceBytes);
  if (provenanceSha256 !== plan.registration.provenanceSha256) {
    refuse(
      `registration provenance hash ${provenanceSha256} does not match the plan binding ` +
        plan.registration.provenanceSha256,
    );
  }
  let provenance: RegistrationProvenance;
  try {
    provenance = registrationProvenanceSchema.parse(JSON.parse(provenanceBytes.toString('utf8')));
  } catch (error) {
    refuse(
      `registration provenance is not a valid record: ${
        error instanceof Error ? error.message.slice(0, 200) : String(error)
      }`,
    );
  }
  if (provenance.registrationId !== entry.registrationId) {
    refuse(
      `provenance names registration '${provenance.registrationId}', plan binds '${entry.registrationId}'`,
    );
  }
  if (provenance.headSha !== plan.repositorySha) {
    refuse(`provenance was recorded at ${provenance.headSha}, the plan pins ${plan.repositorySha}`);
  }
  if (provenance.studyTemplate.path !== entry.studyTemplatePath) {
    refuse(`provenance study template '${provenance.studyTemplate.path}' is not the registry's`);
  }
  if (provenance.planTemplate.path !== entry.planTemplatePath) {
    refuse(`provenance plan template '${provenance.planTemplate.path}' is not the registry's`);
  }
  const recordedPrerequisiteSha = plan.registration.stageAPrerequisiteSha256 ?? null;
  if (provenance.stageAPrerequisiteSha256 !== recordedPrerequisiteSha) {
    refuse('provenance and plan disagree about the Stage A prerequisite hash');
  }

  // 2. Both source templates re-read from Git at the pinned SHA.
  const studySource = committedTemplate(repoRoot, provenance.headSha, entry.studyTemplatePath);
  const planSource = committedTemplate(repoRoot, provenance.headSha, entry.planTemplatePath);
  if (sha256(studySource.text) !== provenance.studyTemplate.sha256) {
    refuse('committed study template bytes do not hash to the provenance record');
  }
  if (studySource.blobId !== provenance.studyTemplate.blobId) {
    refuse('committed study template blob id differs from the provenance record');
  }
  if (sha256(planSource.text) !== provenance.planTemplate.sha256) {
    refuse('committed plan template bytes do not hash to the provenance record');
  }
  if (planSource.blobId !== provenance.planTemplate.blobId) {
    refuse('committed plan template blob id differs from the provenance record');
  }

  // 3. Derivation proof: re-stamp the committed templates with the
  // recorded hashes; the launched plan and the registered study must BE
  // the stamped output, byte for byte.
  if (plan.study === undefined) {
    refuse('a registered plan must carry its study binding');
  }
  const registeredStudyPath = isAbsolute(plan.study.studyPlanPath)
    ? plan.study.studyPlanPath
    : resolve(repoRoot, plan.study.studyPlanPath);
  const restamped = stampTemplates({
    studyTemplateText: studySource.text,
    planTemplateText: planSource.text,
    headSha: provenance.headSha,
    registeredStudyPath: plan.study.studyPlanPath,
    studySha256: plan.study.studyPlanSha256,
    studyConfigFingerprint: plan.study.studyConfigFingerprint,
    studySourceBlobId: provenance.studyTemplate.blobId,
    studySourceSha256: provenance.studyTemplate.sha256,
    provenanceSha256,
    stageAPrerequisiteSha256: recordedPrerequisiteSha,
  });
  if (planBytes.toString('utf8') !== restamped.planText) {
    refuse(
      'the launched plan is not byte-identical to the registered template stamped with its ' +
        'recorded hashes — formal plans launch only from unmodified m2:register output',
    );
  }
  if (!existsSync(registeredStudyPath)) {
    refuse(`registered study missing at ${registeredStudyPath}`);
  }
  if (readFileSync(registeredStudyPath, 'utf8') !== restamped.studyText) {
    refuse('the registered study file is not byte-identical to the stamped template output');
  }
  if (sha256(restamped.studyText) !== provenance.registeredStudySha256) {
    refuse('the stamped study bytes do not hash to the provenance registeredStudySha256');
  }

  // 4. Stage A prerequisite: re-hash, re-validate, re-verify the evidence
  // it names, and rebuild the canonical record to byte equality.
  let prerequisite: StageAPrerequisite | null = null;
  let prerequisiteBytes: Buffer | null = null;
  if (entry.stageAPrerequisiteRequired) {
    if (
      plan.registration.stageAPrerequisitePath === undefined ||
      recordedPrerequisiteSha === null
    ) {
      refuse('calibration launches require the Stage A prerequisite path and hash');
    }
    const prerequisitePath = isAbsolute(plan.registration.stageAPrerequisitePath)
      ? plan.registration.stageAPrerequisitePath
      : join(planDir, plan.registration.stageAPrerequisitePath);
    if (!existsSync(prerequisitePath)) {
      refuse(`Stage A prerequisite missing at ${prerequisitePath}`);
    }
    prerequisiteBytes = readFileSync(prerequisitePath);
    if (sha256(prerequisiteBytes) !== recordedPrerequisiteSha) {
      refuse('Stage A prerequisite bytes do not hash to the registered record');
    }
    try {
      prerequisite = stageAPrerequisiteSchema.parse(JSON.parse(prerequisiteBytes.toString('utf8')));
    } catch (error) {
      refuse(
        `Stage A prerequisite is not a valid record: ${
          error instanceof Error ? error.message.slice(0, 200) : String(error)
        }`,
      );
    }
    // The drill escape is keyless test infrastructure ONLY: fake-gateway
    // Stage A evidence can never authorize a live launch.
    if (provenance.stageADrillMode && anyLive) {
      refuse('drill-mode Stage A evidence cannot authorize a live launch');
    }
    const sourceEntry = registrationEntry(entry.stageASourceRegistrationId ?? '');
    if (sourceEntry === undefined) {
      refuse('the registry names no Stage A source registration for this calibration');
    }
    const stageARoot = dirname(prerequisite.sequenceManifestPath);
    if (!existsSync(stageARoot)) {
      refuse(`Stage A evidence root missing at ${stageARoot}`);
    }
    const rebuilt = await buildStageAPrerequisite({
      stageARoot,
      expectedHeadSha: provenance.headSha,
      requireLiveModel: !provenance.stageADrillMode,
      expectedIdentity: provenance.stageADrillMode
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
    if (rebuilt.recordBytes !== prerequisiteBytes.toString('utf8')) {
      refuse(
        'the Stage A evidence no longer verifies to the registered prerequisite record — ' +
          'any change to the evidence requires Stage A to run again',
      );
    }
  }

  return {
    entry,
    provenance,
    provenanceBytes,
    provenanceSha256,
    prerequisite,
    prerequisiteBytes,
    prerequisiteSha256: recordedPrerequisiteSha,
  };
}
