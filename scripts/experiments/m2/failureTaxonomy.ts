/**
 * Closed failure taxonomy (Phase 3 re-audit finding 3, §7.2).
 *
 * Every attempt failure the orchestrator can record belongs to exactly one
 * class in this versioned, CLOSED vocabulary. The taxonomy partitions the
 * classes into:
 *
 *  - RETRYABLE-ELIGIBLE: transient environment classes a reviewed plan MAY
 *    register for automatic replacement;
 *  - HARD-STOP: integrity, treatment, and evidence classes that always halt
 *    the sequence. They are structurally impossible to register as
 *    retryable — the plan schema's `retryableFailureClasses` enum is built
 *    from the eligible list only, so a plan naming a hard-stop class fails
 *    to parse.
 *
 * The generic `error` catch-all is gone: post-browser failures carry a
 * typed finalization-stage class (re-audit §12), and every other throw site
 * names its class here.
 */

export const FAILURE_TAXONOMY_VERSION = 'm2-failure-taxonomy-1.0.0';

/** Transient classes a plan MAY register for automatic replacement. */
export const RETRYABLE_ELIGIBLE_FAILURE_CLASSES = [
  /** Wall-clock run timeout (§19.10). */
  'run-timeout',
  /** Stall watchdog fired past the grace period (§19.9). */
  'simulation-stall',
  /** Raw browser/Playwright failure (selector timeout, crash, download). */
  'browser-error',
  /** The app never showed the gateway as connected before Start. */
  'gateway-not-connected',
  /** The gateway child failed to spawn or missed its readiness deadline. */
  'gateway-launch-failed',
  /** A crash/kill left the execution in-progress; preserved on resume. */
  'interrupted',
] as const;

/** Classes that ALWAYS halt the sequence without spending a replacement. */
export const HARD_STOP_FAILURE_CLASSES = [
  // Operator-surface integrity: the app did not accept the planned setup.
  'condition-not-applied',
  'speed-not-applied',
  'bundle-export-not-enabled',
  'unexpected-navigation',
  // Replay and evidence integrity.
  'replay-verdict-timeout',
  'replay-mismatch',
  'model-evidence-incomplete',
  // Treatment identity and lifecycle.
  'treatment-mismatch',
  'treatment-verification-failed',
  'gateway-stop-not-fired',
  'gateway-died-unexpectedly',
  /** Artifact-valid but below the registered treatment thresholds
   * (re-audit finding 3): preserved, never completed primary evidence. */
  'invalid-treatment',
  // Freeze and budget governance.
  'freeze-violation',
  'evidence-budget-exceeded',
  // Typed post-browser finalization stages (re-audit §12).
  'attempt-setup-failed',
  'deterministic-validation-failed',
  'prepare-run-failed',
  'strict-finalize-failed',
  'evidence-enrichment-failed',
  'fingerprint-failed',
  'final-treatment-verification-failed',
  'execution-seal-failed',
] as const;

export type RetryableEligibleFailureClass = (typeof RETRYABLE_ELIGIBLE_FAILURE_CLASSES)[number];
export type HardStopFailureClass = (typeof HARD_STOP_FAILURE_CLASSES)[number];
export type FailureClass = RetryableEligibleFailureClass | HardStopFailureClass;

export const FAILURE_CLASSES: readonly FailureClass[] = [
  ...RETRYABLE_ELIGIBLE_FAILURE_CLASSES,
  ...HARD_STOP_FAILURE_CLASSES,
];

export function isKnownFailureClass(value: string): value is FailureClass {
  return (FAILURE_CLASSES as readonly string[]).includes(value);
}

export function isHardStopFailureClass(value: string): boolean {
  return (HARD_STOP_FAILURE_CLASSES as readonly string[]).includes(value);
}

/**
 * Typed attempt failure. `reason` is always a taxonomy class; `stage` names
 * the pipeline stage that threw when the class is a finalization-stage
 * class (re-audit §12), so the failure manifest can record exactly where an
 * attempt died.
 */
export class AttemptFailure extends Error {
  readonly reason: FailureClass;
  readonly stage: string | null;
  constructor(reason: FailureClass, message: string, stage: string | null = null) {
    super(message);
    this.name = 'AttemptFailure';
    this.reason = reason;
    this.stage = stage;
  }
}

export type ReplacementDisposition = 'permitted' | 'forbidden' | 'exhausted';

/**
 * Replacement disposition for one terminal failure (re-audit finding 3,
 * §7.3): persisted with the execution so a later `--resume` inspects the
 * recorded disposition instead of re-deriving replacement capacity — a
 * `forbidden` disposition permanently halts the attempt under this plan.
 */
export function assessReplacementDisposition(
  failureClass: string,
  registeredRetryable: readonly string[],
  executionsUsed: number,
  maxReplacementAttempts: number,
): ReplacementDisposition {
  if (isHardStopFailureClass(failureClass) || !registeredRetryable.includes(failureClass)) {
    return 'forbidden';
  }
  return executionsUsed >= 1 + maxReplacementAttempts ? 'exhausted' : 'permitted';
}
