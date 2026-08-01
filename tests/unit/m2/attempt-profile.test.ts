import { describe, expect, it } from 'vitest';
import type { BehaviorFingerprintSet } from '../../../src/shared/behaviorArtifacts';
import {
  ATTEMPT_PROFILE_SCHEMA_VERSION,
  REGISTERED_ATTEMPT_PROFILES,
  evaluateTreatmentThresholds,
  getAttemptProfile,
} from '../../../scripts/experiments/m2/attemptProfile';
import { isHardStopFailureClass } from '../../../scripts/experiments/m2/failureTaxonomy';

/**
 * Versioned attempt profiles and the generic study-validity threshold
 * mechanism (re-audit finding 3, §7.1/§7.4): artifact validity and study
 * validity are distinct; a below-threshold run classifies as
 * invalid-treatment (a hard-stop class, never confused with artifact
 * corruption and never retryable).
 */

function fingerprintsWith(attempted: number | undefined, completed: number | undefined) {
  return {
    npcs: {
      mara: {
        upstreamActionCallsAttempted: attempted,
        upstreamActionCallsCompleted: completed,
      },
    },
  } as unknown as BehaviorFingerprintSet;
}

describe('attempt profiles', () => {
  const profile = getAttemptProfile('m2-rehearsal-attempt-profile', '1.0.0');

  it('registers the rehearsal profile (non-formal) and the Phase 4 formal profile', () => {
    expect(REGISTERED_ATTEMPT_PROFILES).toHaveLength(2);
    const rehearsal = REGISTERED_ATTEMPT_PROFILES.find(
      (entry) => entry.profileId === 'm2-rehearsal-attempt-profile',
    )!;
    expect(rehearsal.formalUse).toBe(false);
    expect(rehearsal.schemaVersion).toBe(ATTEMPT_PROFILE_SCHEMA_VERSION);
    const formal = REGISTERED_ATTEMPT_PROFILES.find(
      (entry) => entry.profileId === 'm2-formal-attempt-profile',
    )!;
    expect(formal.formalUse).toBe(true);
    expect(formal.profileVersion).toBe('1.0.0');
    expect(formal.schemaVersion).toBe(ATTEMPT_PROFILE_SCHEMA_VERSION);
  });

  it('the formal profile pins the pre-registered brief values, never ad-hoc ones', () => {
    const formal = getAttemptProfile('m2-formal-attempt-profile', '1.0.0');
    // §23.2 upstream reliability gate: completed/attempted >= 0.90.
    expect(formal.treatmentThresholds).toContainEqual({
      metric: 'upstream-completion-ratio-bp',
      npcId: 'mara',
      min: 9_000,
    });
    expect(formal.treatmentThresholds).toContainEqual({
      metric: 'upstream-calls-attempted',
      npcId: 'mara',
      min: 1,
    });
    // §24.2 replacement allowance: ONE identical replacement.
    expect(formal.maxReplacementAttempts).toBe(1);
    expect(formal.stopRule).toMatch(/§24\.2/);
    expect(formal.stopRule).toMatch(/§24\.5/);
    // The rehearsal's gates plus the §23.1 no-budget-exhausted-failure
    // per-run integrity gate; identical gateway lifecycle.
    const rehearsal = getAttemptProfile('m2-rehearsal-attempt-profile', '1.0.0');
    expect(formal.artifactGates).toEqual([
      ...rehearsal.artifactGates,
      'no-budget-exhausted-failure',
    ]);
    expect(formal.gatewayLifecycle).toEqual(rehearsal.gatewayLifecycle);
    // §23.2 boundary: exactly 90.00% passes, one basis point under fails.
    const boundary = evaluateTreatmentThresholds(formal, fingerprintsWith(100, 90));
    expect(boundary.pass).toBe(true);
    const under = evaluateTreatmentThresholds(formal, fingerprintsWith(100, 89));
    expect(under.pass).toBe(false);
  });

  it('resolves by id and exact version with typed refusals', () => {
    expect(profile.profileId).toBe('m2-rehearsal-attempt-profile');
    expect(() => getAttemptProfile('missing', '1.0.0')).toThrow(/unknown-attempt-profile/);
    expect(() => getAttemptProfile('m2-rehearsal-attempt-profile', '2.0.0')).toThrow(
      /attempt-profile-version-mismatch/,
    );
  });

  it('a fully completed treatment passes every threshold', () => {
    const evaluation = evaluateTreatmentThresholds(profile, fingerprintsWith(10, 10));
    expect(evaluation.pass).toBe(true);
    expect(evaluation.profileId).toBe(profile.profileId);
    const ratio = evaluation.verdicts.find(
      (verdict) => verdict.metric === 'upstream-completion-ratio-bp',
    )!;
    expect(ratio.value).toBe(10_000);
    expect(ratio.pass).toBe(true);
  });

  it('a strict-finalizable but under-covered run FAILS study validity (§7.5)', () => {
    const evaluation = evaluateTreatmentThresholds(profile, fingerprintsWith(10, 7));
    expect(evaluation.pass).toBe(false);
    const ratio = evaluation.verdicts.find(
      (verdict) => verdict.metric === 'upstream-completion-ratio-bp',
    )!;
    expect(ratio.value).toBe(7_000);
    expect(ratio.pass).toBe(false);
    // The attempted-count gate still passes: the verdicts separate WHICH
    // threshold failed rather than reporting a generic artifact failure.
    const attempted = evaluation.verdicts.find(
      (verdict) => verdict.metric === 'upstream-calls-attempted',
    )!;
    expect(attempted.pass).toBe(true);
  });

  it('unobservable metrics fail explicitly with null values, never silently pass', () => {
    const missing = evaluateTreatmentThresholds(profile, fingerprintsWith(undefined, undefined));
    expect(missing.pass).toBe(false);
    expect(missing.verdicts.every((verdict) => verdict.value === null)).toBe(true);
    const zeroAttempted = evaluateTreatmentThresholds(profile, fingerprintsWith(0, 0));
    expect(zeroAttempted.pass).toBe(false);
  });

  it('invalid-treatment is a hard-stop class: a threshold failure can never spend a replacement', () => {
    expect(isHardStopFailureClass('invalid-treatment')).toBe(true);
  });
});
