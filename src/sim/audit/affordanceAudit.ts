import type { EventEnvelope } from '../../shared/events';
import type { ActionMode, NpcId, ScenarioId } from '../../shared/ids';
import { REQUEST_REFUSAL_COOLDOWN_TICKS } from '../config';
import {
  COMMITMENT_LIFECYCLE_CONTRACTS,
  DILEMMA_CHECKPOINTS,
  INTERRUPTION_CONTRACTS,
  interruptionContractFor,
  type DilemmaStateSatisfaction,
} from './contracts';
import { findingSortKey, type AuditFinding } from './findings';

/**
 * Affordance-space and interruption-contract auditor (M2 brief §27.6).
 * Pure functions over declared contracts and canonical event streams; the
 * CLI in `scripts/audit/` handles run generation, known-gap classification,
 * and CI exit behavior.
 */

const VOLUNTARY_PREEMPTION_REASON = 'preempted-by-new-decision';
const SUSTAINED_PREFIX = 'sustained-check-failed:';
/**
 * Completion-time staleness is the engine's universal completion discipline
 * (outcome suppression of a FINISHED action), not mid-flight interruption —
 * excluded from the non-interruptible gap rule (see contracts.ts).
 */
const STALE_AT_COMPLETION_PREFIX = 'stale-at-completion:';

/**
 * Declaration-level findings, independent of any run: an advertised
 * non-interruptible mode whose contract admits mode-specific world-event
 * termination classes contradicts its own advertisement. These are the
 * documented VS001 gaps; they must match the known-gap registry exactly.
 */
export function auditStaticContracts(): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const contract of INTERRUPTION_CONTRACTS) {
    if (!contract.advertisedInterruptible && contract.sustainedTerminationClasses.length > 0) {
      findings.push({
        checkId: 'non-interruptible-mode-has-world-interruption',
        scenarioId: 'static',
        key: {
          mode: contract.mode,
          classes: [...contract.sustainedTerminationClasses].sort().join('+'),
        },
        detail:
          `mode '${contract.mode}' is advertised interruptible:false yet the engine's ` +
          `sustained checks can terminate it mid-flight (${contract.sustainedTerminationClasses.join(', ')})`,
      });
    }
  }
  // Commitment contracts requiring target responses must have their response
  // modes present in the action vocabulary (consumability).
  for (const contract of COMMITMENT_LIFECYCLE_CONTRACTS) {
    if (contract.renegotiation === 'target-response-required') {
      for (const mode of contract.requiredResponseModes) {
        // interruptionContractFor throws on unknown modes, proving the
        // response vocabulary exists; a throw here is a build-breaking error,
        // not a finding.
        interruptionContractFor(mode);
      }
    }
  }
  return findings.sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b)));
}

interface OfferedAffordanceView {
  id: string;
  mode: ActionMode;
  interruptible: boolean;
  proposalId: string | null;
}

interface CommitmentView {
  kind: string;
  debtorId: NpcId;
  creditorId: NpcId;
  terminalCount: number;
}

/**
 * Per-checkpoint dilemma evaluation accounting (Phase 2 audit §4.4: the
 * pending-request and refusal-cooldown sub-states are evaluated SEPARATELY
 * and reported, never silently merged into one satisfied bucket).
 */
export interface DilemmaEvaluationStats {
  dilemmaId: string;
  /** Offer sets containing the trigger mode. */
  triggeringOfferSets: number;
  /** Sets where every exit class had an offered mode. */
  satisfiedByOfferedModes: number;
  /** Sets where lawful acquisition was satisfied only by the actor's own
   * pending transfer request (acquisition in progress). */
  satisfiedByPendingRequest: number;
  /** Sets where the acquisition class was RESOLVED by the post-refusal
   * cooldown: the actor exercised the lawful path and the owner lawfully
   * refused it. Per the re-audit §3.3 ruling this is not a currently
   * available acquisition exit — the checkpoint's acquisition requirement is
   * inapplicable after that resolution, and the state is reported
   * separately, never merged with the pending sub-state. */
  resolvedByRefusalCooldown: number;
  /** Sets that produced a missing-lawful-exits finding. */
  missingExitFindings: number;
}

export interface EventStreamAuditResult {
  findings: AuditFinding[];
  dilemmaStats: DilemmaEvaluationStats[];
}

/**
 * Event-stream conformance findings for one validated ledger's events.
 */
export function auditEventStream(
  scenarioId: ScenarioId,
  events: readonly EventEnvelope[],
): AuditFinding[] {
  return auditEventStreamDetailed(scenarioId, events).findings;
}

/** Full event-stream audit: findings plus dilemma-evaluation accounting. */
export function auditEventStreamDetailed(
  scenarioId: ScenarioId,
  events: readonly EventEnvelope[],
): EventStreamAuditResult {
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  const push = (finding: AuditFinding): void => {
    const key = findingSortKey(finding);
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };

  const commitments = new Map<string, CommitmentView>();
  interface PendingProposal {
    proposalId: string;
    commitmentId: string;
    responderId: NpcId;
    proposedAtTick: number;
    resolved: boolean;
    responseOpportunityObserved: boolean;
  }
  const proposals = new Map<string, PendingProposal>();
  const startedNonInterruptible = new Map<string, ActionMode>();

  // Transfer-request lifecycle state for dilemma state satisfactions. VS001
  // has exactly one transferable resource (the meal), so tracking is keyed by
  // requester. The cooldown horizon reuses the frozen engine constant.
  const pendingOwnTransferRequest = new Map<NpcId, string>();
  const requestRefusalCooldownUntil = new Map<NpcId, number>();
  const dilemmaStats = new Map<string, DilemmaEvaluationStats>(
    DILEMMA_CHECKPOINTS.map((dilemma) => [
      dilemma.id,
      {
        dilemmaId: dilemma.id,
        triggeringOfferSets: 0,
        satisfiedByOfferedModes: 0,
        satisfiedByPendingRequest: 0,
        resolvedByRefusalCooldown: 0,
        missingExitFindings: 0,
      },
    ]),
  );
  const stateSatisfied = (
    satisfaction: DilemmaStateSatisfaction,
    npcId: NpcId,
    tick: number,
  ): boolean => {
    if (satisfaction === 'own-transfer-request-pending') {
      return pendingOwnTransferRequest.has(npcId);
    }
    const until = requestRefusalCooldownUntil.get(npcId);
    return until !== undefined && tick < until;
  };

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'DecisionRequested': {
        const npcId = p.npcId as NpcId;
        const offered = (p.offeredAffordances as OfferedAffordanceView[] | undefined) ?? [];
        // 1. Advertised-flag conformance: every offer must match the declared
        //    contract (continuation pseudo-affordances are always true).
        for (const offer of offered) {
          const expected = offer.id.includes(':continue:')
            ? true
            : interruptionContractFor(offer.mode).advertisedInterruptible;
          if (offer.interruptible !== expected) {
            push({
              checkId: 'contract-advertisement-mismatch',
              scenarioId,
              key: { mode: offer.mode, advertised: String(offer.interruptible) },
              detail:
                `offer ${offer.id} advertises interruptible:${String(offer.interruptible)} but the ` +
                `declared contract says ${String(expected)}`,
            });
          }
        }
        // 2. Registered dilemma checkpoints: two consequentially distinct
        //    lawful exits whenever the trigger mode is offered. An exit class
        //    is satisfied by an offered mode or by one of its declared world
        //    states (audit §4.4: a pending own transfer request is lawful
        //    acquisition in progress; the post-refusal cooldown is the modeled
        //    consequence of an exercised-and-refused acquisition — each
        //    evaluated and reported separately).
        for (const dilemma of DILEMMA_CHECKPOINTS) {
          if (!offered.some((o) => o.mode === dilemma.triggerMode)) continue;
          const stats = dilemmaStats.get(dilemma.id)!;
          stats.triggeringOfferSets += 1;
          const missingClasses: string[] = [];
          let allByOffer = true;
          let usedPendingRequest = false;
          let usedRefusalCooldown = false;
          for (const exitClass of dilemma.exitClasses) {
            const offeredMode = offered.some((o) =>
              (exitClass.modes as readonly string[]).includes(o.mode),
            );
            if (offeredMode) continue;
            allByOffer = false;
            const bySatisfaction = exitClass.stateSatisfactions.find((satisfaction) =>
              stateSatisfied(satisfaction, npcId, event.tick),
            );
            if (bySatisfaction === 'own-transfer-request-pending') usedPendingRequest = true;
            else if (bySatisfaction === 'own-request-refusal-cooldown') usedRefusalCooldown = true;
            else missingClasses.push(exitClass.classId);
          }
          const distinctClasses = dilemma.exitClasses.length - missingClasses.length;
          if (distinctClasses < 2) {
            stats.missingExitFindings += 1;
            push({
              checkId: 'dilemma-missing-lawful-exits',
              scenarioId,
              key: { dilemmaId: dilemma.id, missingClasses: missingClasses.sort().join('+') },
              detail:
                `offer set at tick ${event.tick} triggers '${dilemma.id}' but provides ` +
                `${distinctClasses} distinct lawful exit class(es) (missing: ${missingClasses.join(', ')}); 2 required`,
            });
          } else if (allByOffer) {
            stats.satisfiedByOfferedModes += 1;
          } else {
            if (usedPendingRequest) stats.satisfiedByPendingRequest += 1;
            if (usedRefusalCooldown) stats.resolvedByRefusalCooldown += 1;
          }
        }
        // 3. Renegotiation response opportunity: an offer of a required
        //    response mode for a pending proposal satisfies the contract.
        for (const proposal of proposals.values()) {
          if (proposal.resolved || proposal.responseOpportunityObserved) continue;
          if (npcId !== proposal.responderId) continue;
          if (
            offered.some(
              (o) =>
                (o.mode === 'accept-renegotiation' || o.mode === 'reject-renegotiation') &&
                o.proposalId === proposal.proposalId,
            )
          ) {
            proposal.responseOpportunityObserved = true;
          }
        }
        break;
      }
      case 'ActionStarted': {
        if (p.interruptible === false) {
          startedNonInterruptible.set(p.actionId as string, p.mode as ActionMode);
        }
        break;
      }
      case 'ActionInterrupted': {
        const mode = startedNonInterruptible.get(p.actionId as string);
        if (mode !== undefined) {
          const reason = p.reasonCode as string;
          // Observed reason codes for the universal classes declared in
          // UNIVERSAL_TERMINATION_CLASSES ('actor-incapacitated' is emitted
          // as 'incapacitated' by the engine), plus completion-time
          // staleness, which is universal completion discipline rather than
          // mid-flight interruption.
          const universal =
            reason === 'incapacitated' ||
            reason === 'scenario-ended' ||
            reason.startsWith(STALE_AT_COMPLETION_PREFIX);
          if (!universal) {
            if (reason.startsWith(SUSTAINED_PREFIX)) {
              push({
                checkId: 'non-interruptible-mode-has-world-interruption',
                scenarioId,
                key: { mode, classes: reason.slice(SUSTAINED_PREFIX.length) },
                detail:
                  `action started as interruptible:false (mode '${mode}') was terminated ` +
                  `mid-flight by '${reason}' at tick ${event.tick}`,
              });
            } else if (reason === VOLUNTARY_PREEMPTION_REASON) {
              push({
                checkId: 'voluntary-preemption-of-non-interruptible',
                scenarioId,
                key: { mode },
                detail:
                  `action started as interruptible:false (mode '${mode}') was voluntarily ` +
                  `preempted at tick ${event.tick}`,
              });
            } else {
              push({
                checkId: 'unclassified-non-interruptible-termination',
                scenarioId,
                key: { mode, reason },
                detail:
                  `action started as interruptible:false (mode '${mode}') ended with ` +
                  `unclassified interruption reason '${reason}' at tick ${event.tick}`,
              });
            }
          }
        }
        break;
      }
      case 'ReservationTransferRequested': {
        pendingOwnTransferRequest.set(p.requesterNpcId as NpcId, p.requestId as string);
        break;
      }
      case 'ReservationTransferred': {
        if (p.requestId !== null) {
          for (const [requester, requestId] of pendingOwnTransferRequest) {
            if (requestId === (p.requestId as string)) pendingOwnTransferRequest.delete(requester);
          }
        }
        break;
      }
      case 'ReservationTransferRefused': {
        const requester = p.requesterNpcId as NpcId;
        pendingOwnTransferRequest.delete(requester);
        requestRefusalCooldownUntil.set(requester, event.tick + REQUEST_REFUSAL_COOLDOWN_TICKS);
        break;
      }
      case 'CommitmentCreated': {
        commitments.set(p.commitmentId as string, {
          kind: p.kind as string,
          debtorId: p.debtorId as NpcId,
          creditorId: p.creditorId as NpcId,
          terminalCount: 0,
        });
        break;
      }
      case 'CommitmentRenegotiationProposed': {
        const commitment = commitments.get(p.commitmentId as string);
        if (commitment) {
          const proposedBy = p.proposedByNpcId as NpcId;
          proposals.set(p.proposalId as string, {
            proposalId: p.proposalId as string,
            commitmentId: p.commitmentId as string,
            responderId:
              proposedBy === commitment.debtorId ? commitment.creditorId : commitment.debtorId,
            proposedAtTick: event.tick,
            resolved: false,
            responseOpportunityObserved: false,
          });
        }
        break;
      }
      case 'CommitmentRenegotiationAccepted':
      case 'CommitmentRenegotiationRejected': {
        const proposal = proposals.get(p.proposalId as string);
        if (proposal) {
          proposal.resolved = true;
          proposal.responseOpportunityObserved = true;
        }
        break;
      }
      case 'CommitmentFulfilled':
      case 'CommitmentBroken': {
        const commitment = commitments.get(p.commitmentId as string);
        if (commitment) commitment.terminalCount += 1;
        // A commitment terminal also closes any still-pending proposal window.
        for (const proposal of proposals.values()) {
          if (proposal.commitmentId === (p.commitmentId as string)) proposal.resolved = true;
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [commitmentId, commitment] of commitments) {
    if (commitment.terminalCount !== 1) {
      push({
        checkId: 'commitment-unresolved',
        scenarioId,
        key: { commitmentKind: commitment.kind, terminals: String(commitment.terminalCount) },
        detail: `commitment ${commitmentId} reached ${commitment.terminalCount} terminal events (expected 1)`,
      });
    }
  }
  for (const proposal of proposals.values()) {
    if (!proposal.responseOpportunityObserved) {
      const commitment = commitments.get(proposal.commitmentId);
      push({
        checkId: 'renegotiation-proposal-without-response-opportunity',
        scenarioId,
        key: { commitmentKind: commitment?.kind ?? 'unknown' },
        detail:
          `proposal ${proposal.proposalId} (tick ${proposal.proposedAtTick}) was never ` +
          `accepted or rejected and the responder was never offered a response mode while it was pending`,
      });
    }
  }

  return {
    findings: findings.sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b))),
    dilemmaStats: [...dilemmaStats.values()],
  };
}
