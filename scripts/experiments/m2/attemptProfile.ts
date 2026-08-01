import type { BehaviorFingerprintSet } from '../../../src/shared/behaviorArtifacts';
import {
  HARD_STOP_FAILURE_CLASSES,
  RETRYABLE_ELIGIBLE_FAILURE_CLASSES,
  type FailureClass,
  type RetryableEligibleFailureClass,
} from './failureTaxonomy';

/**
 * Versioned attempt execution/threshold profiles (Phase 3 re-audit
 * finding 3, §7.1/§7.4).
 *
 * A profile is the registered definition of what makes one attempt a valid
 * PRIMARY OBSERVATION, separating two distinct verdicts Milestone 1 proved
 * can diverge:
 *
 *  - artifact-valid  — the evidence pipeline succeeded end to end (ledger
 *    validated, replay matched, strict finalization, fingerprint written);
 *  - study-valid     — the artifact ALSO clears the registered treatment
 *    thresholds (e.g. upstream completion coverage).
 *
 * An artifact can strict-finalize and replay exactly while its upstream
 * coverage is too poor to count as the registered treatment; such an
 * attempt is preserved and classified `invalid-treatment`, never completed
 * primary evidence.
 *
 * Phase 3 registered only the keyless REHEARSAL profile (`formalUse:
 * false`), so the mechanism is exercised in CI. Phase 4 registers the
 * FORMAL profile alongside its studies (Stage A acceptance and the R2
 * calibration study), lifting parsePlan's evidentiary/live refusal — the
 * profile id and version are bound into the sequence resume identity and
 * into the study declaration's `thresholds` record.
 */

export const ATTEMPT_PROFILE_SCHEMA_VERSION = 'm2-attempt-profile-1.0.0';

/** Generic treatment metrics computable from an ENRICHED fingerprint. */
export type TreatmentMetric = 'upstream-completion-ratio-bp' | 'upstream-calls-attempted';

export interface TreatmentThresholdRule {
  metric: TreatmentMetric;
  /** The treatment NPC the metric is computed for. */
  npcId: string;
  /** Inclusive integer minimum (basis points for ratio metrics). */
  min: number;
}

export interface AttemptProfile {
  profileId: string;
  profileVersion: string;
  schemaVersion: typeof ATTEMPT_PROFILE_SCHEMA_VERSION;
  /** True only for profiles reviewed for evidentiary/live sequences. */
  formalUse: boolean;
  /** The artifact gates every attempt must pass (enforced by the attempt
   * pipeline; named here so the profile is the complete registered
   * definition of validity). */
  artifactGates: readonly string[];
  gatewayLifecycle: {
    plannedStopMustFire: boolean;
    unplannedDeathInvalidates: boolean;
  };
  /** Treatment thresholds applied to MODEL-BACKED attempts after strict
   * finalization. Deterministic attempts have no upstream treatment; their
   * validity is the artifact gates. */
  treatmentThresholds: readonly TreatmentThresholdRule[];
  /** The taxonomy partition this profile enforces (referenced, not
   * redefined: the taxonomy is the single source). */
  hardStopFailureClasses: readonly FailureClass[];
  retryableFailureClasses: readonly RetryableEligibleFailureClass[];
  /** Upper bound on a plan's maxReplacementAttempts under this profile. */
  maxReplacementAttempts: number;
  stopRule: string;
}

export interface ThresholdVerdict {
  metric: TreatmentMetric;
  npcId: string;
  /** Observed integer value; null when the metric is not observable from
   * the fingerprint (itself a failing verdict — strict finalization always
   * yields enriched counts, so null means degraded evidence). */
  value: number | null;
  min: number;
  pass: boolean;
}

export interface ThresholdEvaluation {
  profileId: string;
  profileVersion: string;
  verdicts: ThresholdVerdict[];
  pass: boolean;
}

const REHEARSAL_PROFILE: AttemptProfile = {
  profileId: 'm2-rehearsal-attempt-profile',
  profileVersion: '1.0.0',
  schemaVersion: ATTEMPT_PROFILE_SCHEMA_VERSION,
  formalUse: false,
  artifactGates: [
    'worker-ready',
    'condition-applied',
    'speed-applied',
    'run-complete',
    'ledger-validated-or-strict-finalized',
    'in-browser-replay-match',
    'fingerprint-written',
    'no-unexpected-navigation',
  ],
  gatewayLifecycle: { plannedStopMustFire: true, unplannedDeathInvalidates: true },
  treatmentThresholds: [
    // The fake adapter answers every accepted request, so a healthy keyless
    // attempt completes 100% of attempted upstream calls and attempts at
    // least one. A below-threshold run is preserved as invalid-treatment.
    { metric: 'upstream-completion-ratio-bp', npcId: 'mara', min: 10_000 },
    { metric: 'upstream-calls-attempted', npcId: 'mara', min: 1 },
  ],
  hardStopFailureClasses: HARD_STOP_FAILURE_CLASSES,
  retryableFailureClasses: RETRYABLE_ELIGIBLE_FAILURE_CLASSES,
  maxReplacementAttempts: 1,
  stopRule: 'fixed attempt set; stop after every planned attempt reaches a terminal disposition',
};

/**
 * The FORMAL attempt profile (Phase 4; brief §23.1–§23.2, §24.2, §24.5) —
 * the reviewed definition of a valid evidentiary/live primary observation,
 * registered together with its studies (m2-stage-a-acceptance-001 and
 * m2-calibration-variance-a-001). Registering it lifts parsePlan's
 * `formal-attempt-profile-required` refusal.
 *
 * Every numeric bound here is pre-registered in the brief, not chosen ad
 * hoc: the treatment threshold is the §23.2 upstream reliability gate
 * (callsCompleted / upstreamCallsAttempted >= 0.90 — a normalized-rationale
 * output still counts as completed, which the M2 contract guarantees by
 * construction); the replacement cap is the §24.2 allowance of ONE
 * identical replacement for a transient failure; the stop rule carries
 * §24.5. Artifact gates and gateway lifecycle are identical to the
 * rehearsal profile — the rehearsal exists precisely to exercise the same
 * gates keylessly.
 */
const FORMAL_PROFILE: AttemptProfile = {
  profileId: 'm2-formal-attempt-profile',
  profileVersion: '1.0.0',
  schemaVersion: ATTEMPT_PROFILE_SCHEMA_VERSION,
  formalUse: true,
  artifactGates: [
    'worker-ready',
    'condition-applied',
    'speed-applied',
    'run-complete',
    'ledger-validated-or-strict-finalized',
    'in-browser-replay-match',
    'fingerprint-written',
    'no-unexpected-navigation',
    // §23.1 per-run integrity gate: a primary run with ANY budget-exhausted
    // upstream call is not valid primary evidence (enforced from the final
    // manifest's callsFailedByCategory; the planned gateway-stop run is
    // exempt per §23.8).
    'no-budget-exhausted-failure',
  ],
  gatewayLifecycle: { plannedStopMustFire: true, unplannedDeathInvalidates: true },
  treatmentThresholds: [
    // §23.2 upstream reliability gate: >= 90% of attempted upstream calls
    // completed, and at least one call attempted (a zero-call "model" run is
    // never the registered treatment).
    { metric: 'upstream-completion-ratio-bp', npcId: 'mara', min: 9_000 },
    { metric: 'upstream-calls-attempted', npcId: 'mara', min: 1 },
  ],
  hardStopFailureClasses: HARD_STOP_FAILURE_CLASSES,
  retryableFailureClasses: RETRYABLE_ELIGIBLE_FAILURE_CLASSES,
  maxReplacementAttempts: 1,
  stopRule:
    'fixed attempt set; one identical replacement per transient failure (§24.2); ' +
    'a replacement failing for the same reason stops the sequence for ' +
    'investigation (§24.5)',
};

/** The registered profiles. Phase 4 registers the formal profile WITH its
 * studies; the rehearsal profile remains the only non-formal profile. */
export const REGISTERED_ATTEMPT_PROFILES: readonly AttemptProfile[] = [
  REHEARSAL_PROFILE,
  FORMAL_PROFILE,
];

export function getAttemptProfile(profileId: string, profileVersion: string): AttemptProfile {
  const profile = REGISTERED_ATTEMPT_PROFILES.find((entry) => entry.profileId === profileId);
  if (!profile) {
    throw new Error(`unknown-attempt-profile: '${profileId}' is not registered`);
  }
  if (profile.profileVersion !== profileVersion) {
    throw new Error(
      `attempt-profile-version-mismatch: '${profileId}' is registered at ` +
        `${profile.profileVersion}, plan requires ${profileVersion}`,
    );
  }
  return profile;
}

/**
 * Evaluates the profile's treatment thresholds over one ENRICHED
 * fingerprint set (re-audit finding 3): the generic study-validity
 * mechanism. Called for model-backed attempts only.
 */
export function evaluateTreatmentThresholds(
  profile: AttemptProfile,
  fingerprints: BehaviorFingerprintSet,
): ThresholdEvaluation {
  const verdicts: ThresholdVerdict[] = [];
  for (const rule of profile.treatmentThresholds) {
    const npc = (
      fingerprints.npcs as Record<
        string,
        | {
            upstreamActionCallsAttempted?: number;
            upstreamActionCallsCompleted?: number;
          }
        | undefined
      >
    )[rule.npcId];
    const attempted = npc?.upstreamActionCallsAttempted;
    const completed = npc?.upstreamActionCallsCompleted;
    let value: number | null = null;
    if (rule.metric === 'upstream-calls-attempted') {
      value = typeof attempted === 'number' ? attempted : null;
    } else if (typeof attempted === 'number' && typeof completed === 'number' && attempted > 0) {
      value = Math.floor((10_000 * completed) / attempted);
    }
    verdicts.push({
      metric: rule.metric,
      npcId: rule.npcId,
      value,
      min: rule.min,
      pass: value !== null && value >= rule.min,
    });
  }
  return {
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    verdicts,
    pass: verdicts.every((verdict) => verdict.pass),
  };
}
