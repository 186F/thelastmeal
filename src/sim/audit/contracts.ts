import { ACTION_MODES, type ActionMode, type ScenarioId } from '../../shared/ids';

/**
 * Declared behavioral contracts for the VS001 affordance and commitment
 * machinery (M2 brief §27.6, per the Advisor's R4 ruling).
 *
 * These declarations describe the ACTUAL frozen VS001 engine, honestly —
 * including its documented limitations. The auditor checks observed
 * affordances and event streams against them; targeted unit tests prove the
 * engine's validation functions match the declared classes. Where a
 * declaration exposes a known VS001 gap (an advertised-non-interruptible
 * mode that a world event can terminate mid-flight), the gap is REGISTERED
 * in the known-gap registry rather than repaired: VS001 mechanics, event
 * streams, and golden hashes are immutable in Milestone 2 (brief §6.2, §7.3).
 */

export const AUDIT_CONTRACTS_VERSION = 'vs001-audit-contracts-1.0.0';

/**
 * Termination classes that apply to EVERY action regardless of its
 * interruptibility declaration, and therefore never count against a
 * `non-interruptible` advertisement: incapacitation of the actor and the
 * scenario end tick. `non-interruptible` in VS001 precisely means: no
 * voluntary preemption via a new decision, and no mode-specific world-event
 * termination — except that incapacitation and scenario end always win.
 */
export const UNIVERSAL_TERMINATION_CLASSES = ['actor-incapacitated', 'scenario-ended'] as const;

export interface InterruptionContract {
  mode: ActionMode;
  /** The `interruptible` flag the affordance builder advertises for offers of this mode. */
  advertisedInterruptible: boolean;
  /**
   * Mode-specific sustained-check failure classes (`validateSustained`) that
   * terminate the active action mid-flight, beyond the universal classes.
   */
  sustainedTerminationClasses: readonly string[];
  /** Mode-specific completion-time staleness classes (`validateCompletion`). */
  completionStaleClasses: readonly string[];
}

export const INTERRUPTION_CONTRACTS: readonly InterruptionContract[] = [
  {
    mode: 'work',
    advertisedInterruptible: true,
    sustainedTerminationClasses: ['actor-not-capable-of-repair', 'bench-reservation-lost'],
    completionStaleClasses: [],
  },
  {
    mode: 'relieve',
    advertisedInterruptible: true,
    sustainedTerminationClasses: ['actor-not-capable-of-repair', 'bench-reservation-lost'],
    completionStaleClasses: [],
  },
  {
    mode: 'treat',
    advertisedInterruptible: false,
    sustainedTerminationClasses: ['patient-absent'],
    completionStaleClasses: ['patient-absent'],
  },
  {
    mode: 'eat',
    advertisedInterruptible: false,
    sustainedTerminationClasses: ['meal-missing'],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'eat-violation',
    advertisedInterruptible: false,
    sustainedTerminationClasses: ['meal-missing'],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'request-transfer',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'transfer',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'release',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'refuse-request',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: ['meal-missing'],
  },
  {
    mode: 'ask-help',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'request-break',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'propose-renegotiation',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'accept-renegotiation',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'reject-renegotiation',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'rest',
    advertisedInterruptible: true,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'wait',
    advertisedInterruptible: true,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'routine-work',
    advertisedInterruptible: true,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'deliver-materials',
    advertisedInterruptible: false,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
  {
    mode: 'stay-at-cot',
    advertisedInterruptible: true,
    sustainedTerminationClasses: [],
    completionStaleClasses: [],
  },
];

export function interruptionContractFor(mode: ActionMode): InterruptionContract {
  const contract = INTERRUPTION_CONTRACTS.find((c) => c.mode === mode);
  if (!contract) throw new Error(`audit-missing-interruption-contract:${mode}`);
  return contract;
}

// Completeness guard: every action mode must carry a contract (checked at
// module load, mirroring the MODE_TO_CATEGORY completeness pattern).
for (const mode of ACTION_MODES) interruptionContractFor(mode);

export interface CommitmentLifecycleContract {
  kind: string;
  fulfillmentRecognition: 'automatic' | 'explicit-response';
  renegotiation: 'forbidden' | 'unilateral' | 'target-response-required';
  preventionOrWaiver: 'applicable' | 'not-applicable';
  requiredResponseModes: readonly ActionMode[];
}

/**
 * VS001's single commitment kind, declared as the engine actually behaves:
 * fulfillment is recognized automatically from observed relief performance
 * (no explicit acceptance affordance exists, by design); a renegotiation
 * proposal requires a response action from the non-proposing party; there is
 * no prevention or waiver resolution (the documented VS002-deferred gap —
 * breach attribution never inspects proximate cause).
 */
export const COMMITMENT_LIFECYCLE_CONTRACTS: readonly CommitmentLifecycleContract[] = [
  {
    kind: 'relieve-at-bench',
    fulfillmentRecognition: 'automatic',
    renegotiation: 'target-response-required',
    preventionOrWaiver: 'not-applicable',
    requiredResponseModes: ['accept-renegotiation', 'reject-renegotiation'],
  },
];

export function commitmentContractFor(kind: string): CommitmentLifecycleContract {
  const contract = COMMITMENT_LIFECYCLE_CONTRACTS.find((c) => c.kind === kind);
  if (!contract) throw new Error(`audit-missing-commitment-contract:${kind}`);
  return contract;
}

export interface DilemmaCheckpoint {
  id: string;
  description: string;
  /** The offered mode whose presence marks the dilemma. */
  triggerMode: ActionMode;
  /**
   * Exit classes, each a set of modes. A triggering offer set must contain
   * modes from at least two DISTINCT classes ("consequentially distinct
   * lawful exits" — syntactic wait variants share one class).
   */
  exitClasses: ReadonlyArray<{ classId: string; modes: readonly ActionMode[] }>;
}

/**
 * Registered dilemma checkpoints (per the R4 ruling, the two-lawful-exits
 * rule applies only to registered checkpoints). VS001 registers the meal
 * scarcity dilemma: whenever the reservation-violating grab is on the table,
 * a lawful acquisition path and a forgo path must both be available.
 */
export const DILEMMA_CHECKPOINTS: readonly DilemmaCheckpoint[] = [
  {
    id: 'meal-scarcity-violation-choice',
    description:
      'When eat-violation is offered, the offer set must also contain a lawful ' +
      'acquisition path and a forgo path — two consequentially distinct lawful exits.',
    triggerMode: 'eat-violation',
    exitClasses: [
      { classId: 'lawful-acquisition', modes: ['request-transfer'] },
      {
        classId: 'forgo',
        modes: ['work', 'relieve', 'rest', 'routine-work', 'wait', 'request-break'],
      },
    ],
  },
];

export type { ActionMode, ScenarioId };
