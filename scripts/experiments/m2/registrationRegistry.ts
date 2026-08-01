import { z } from 'zod';
import {
  M2_ACTION_PROMPT_VERSION,
  M2_PER_DECISION_CONDITION_ID,
} from '../../../src/shared/m2Experiment';

/**
 * The CLOSED formal-registration registry (Phase 4 audit finding 3; final
 * targeted remediation C): the only template pairs `m2:register` will ever
 * stamp, and the only registration ids an evidentiary or live plan may
 * carry. Held in its own module so the plan schema, the registration
 * command, the launch preflight, and the analyzer can all consult it
 * without import cycles.
 */

export const REGISTRATION_PROVENANCE_SCHEMA_VERSION = 'm2-registration-provenance-1.0.0';

/** The reviewed treatment identity a registration's model attempts must
 * pin — literals matching the committed, reviewed plan templates. */
export interface RegistrationTreatmentPins {
  conditionId: string;
  modelId: string;
  servingProviderId: string;
  promptVersion: string;
}

export interface RegistrationEntry {
  registrationId: string;
  studyId: string;
  studyVersion: string;
  studyTemplatePath: string;
  planTemplatePath: string;
  expectedSequenceId: string;
  attemptProfile: { profileId: string; profileVersion: string };
  expectedTreatment: RegistrationTreatmentPins;
  stageAPrerequisiteRequired: boolean;
  /** Which closed-registry registration must have PRODUCED the Stage A
   * evidence this registration consumes (re-audit: SHA equality alone
   * would accept any completed two-attempt sequence). Null when no Stage A
   * prerequisite is required. */
  stageASourceRegistrationId: string | null;
}

const M2_TREATMENT_PINS: RegistrationTreatmentPins = {
  conditionId: M2_PER_DECISION_CONDITION_ID,
  modelId: 'google/gemini-2.5-flash-lite',
  servingProviderId: 'google-ai-studio',
  promptVersion: M2_ACTION_PROMPT_VERSION,
};

export const REGISTRATION_REGISTRY: readonly RegistrationEntry[] = [
  {
    registrationId: 'stage-a',
    studyId: 'm2-stage-a-acceptance-001',
    studyVersion: '1.0.0',
    studyTemplatePath: 'experiments/m2/templates/m2-stage-a-acceptance-001.study.template.json',
    planTemplatePath: 'experiments/m2/templates/stage-a.plan.template.json',
    expectedSequenceId: 'm2-stage-a-acceptance',
    attemptProfile: { profileId: 'm2-formal-attempt-profile', profileVersion: '1.0.0' },
    expectedTreatment: M2_TREATMENT_PINS,
    stageAPrerequisiteRequired: false,
    stageASourceRegistrationId: null,
  },
  {
    registrationId: 'calibration-variance-a',
    studyId: 'm2-calibration-variance-a-001',
    studyVersion: '1.0.0',
    studyTemplatePath: 'experiments/m2/templates/m2-calibration-variance-a-001.study.template.json',
    planTemplatePath: 'experiments/m2/templates/calibration-variance-a.plan.template.json',
    expectedSequenceId: 'm2-calibration-variance-a',
    attemptProfile: { profileId: 'm2-formal-attempt-profile', profileVersion: '1.0.0' },
    expectedTreatment: M2_TREATMENT_PINS,
    stageAPrerequisiteRequired: true,
    stageASourceRegistrationId: 'stage-a',
  },
];

export function registrationEntry(registrationId: string): RegistrationEntry | undefined {
  return REGISTRATION_REGISTRY.find((entry) => entry.registrationId === registrationId);
}

const sha64 = z.string().regex(/^[0-9a-f]{64}$/);
const sha40 = z.string().regex(/^[0-9a-f]{40}$/);

/** The registration-provenance record `m2:register` writes beside every
 * registered pair — schema-validated (not merely hashed) at launch
 * preflight (final targeted remediation C §5.3). */
export const registrationProvenanceSchema = z
  .object({
    registrationProvenanceSchemaVersion: z.literal(REGISTRATION_PROVENANCE_SCHEMA_VERSION),
    registrationId: z.string().min(1),
    headSha: sha40,
    atUtc: z.string().min(1),
    studyTemplate: z.object({ path: z.string().min(1), blobId: sha40, sha256: sha64 }).strict(),
    planTemplate: z.object({ path: z.string().min(1), blobId: sha40, sha256: sha64 }).strict(),
    registeredStudySha256: sha64,
    stageAPrerequisiteSha256: sha64.nullable(),
    stageADrillMode: z.boolean(),
  })
  .strict();

export type RegistrationProvenance = z.infer<typeof registrationProvenanceSchema>;
