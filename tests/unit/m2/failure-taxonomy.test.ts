import { describe, expect, it } from 'vitest';
import {
  AttemptFailure,
  FAILURE_CLASSES,
  HARD_STOP_FAILURE_CLASSES,
  RETRYABLE_ELIGIBLE_FAILURE_CLASSES,
  assessReplacementDisposition,
  isHardStopFailureClass,
  isKnownFailureClass,
} from '../../../scripts/experiments/m2/failureTaxonomy';

/**
 * Closed failure taxonomy (re-audit finding 3, §7.2): the vocabulary is
 * closed and partitioned; hard-stop classes always yield a forbidden
 * disposition; replacement dispositions are pure functions of the recorded
 * class, the registered retryable set, and the spent capacity.
 */

describe('failure taxonomy', () => {
  it('partitions the closed vocabulary with no overlap', () => {
    const eligible = new Set<string>(RETRYABLE_ELIGIBLE_FAILURE_CLASSES);
    for (const hardStop of HARD_STOP_FAILURE_CLASSES) {
      expect(eligible.has(hardStop), hardStop).toBe(false);
    }
    expect(new Set(FAILURE_CLASSES).size).toBe(FAILURE_CLASSES.length);
    expect(FAILURE_CLASSES.length).toBe(
      RETRYABLE_ELIGIBLE_FAILURE_CLASSES.length + HARD_STOP_FAILURE_CLASSES.length,
    );
  });

  it('classifies membership', () => {
    expect(isKnownFailureClass('run-timeout')).toBe(true);
    expect(isKnownFailureClass('treatment-mismatch')).toBe(true);
    expect(isKnownFailureClass('made-up-class')).toBe(false);
    expect(isHardStopFailureClass('replay-mismatch')).toBe(true);
    expect(isHardStopFailureClass('run-timeout')).toBe(false);
  });

  it('every typed finalization stage has a registered hard-stop class (re-audit §12)', () => {
    for (const stage of [
      'deterministic-validation',
      'prepare-run',
      'strict-finalize',
      'evidence-enrichment',
      'fingerprint',
      'final-treatment-verification',
      'execution-seal',
    ]) {
      expect(HARD_STOP_FAILURE_CLASSES).toContain(`${stage}-failed`);
    }
  });

  it('AttemptFailure carries the class and the throwing stage', () => {
    const failure = new AttemptFailure('strict-finalize-failed', 'boom', 'strict-finalize');
    expect(failure.reason).toBe('strict-finalize-failed');
    expect(failure.stage).toBe('strict-finalize');
    expect(new AttemptFailure('run-timeout', 'slow').stage).toBeNull();
  });

  it('hard-stop classes are forbidden regardless of registration or capacity (§7.3)', () => {
    for (const hardStop of HARD_STOP_FAILURE_CLASSES) {
      expect(assessReplacementDisposition(hardStop, [hardStop], 1, 5), hardStop).toBe('forbidden');
    }
  });

  it('unregistered transient classes are forbidden; registered ones follow capacity', () => {
    expect(assessReplacementDisposition('run-timeout', [], 1, 1)).toBe('forbidden');
    expect(assessReplacementDisposition('run-timeout', ['run-timeout'], 1, 1)).toBe('permitted');
    expect(assessReplacementDisposition('run-timeout', ['run-timeout'], 2, 1)).toBe('exhausted');
    expect(assessReplacementDisposition('interrupted', ['interrupted'], 1, 0)).toBe('exhausted');
  });
});
