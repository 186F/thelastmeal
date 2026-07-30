import type { EventEnvelope } from '../../shared/events';
import type { ActionMode, NpcId, ScenarioId } from '../../shared/ids';
import {
  COMMITMENT_LIFECYCLE_CONTRACTS,
  DILEMMA_CHECKPOINTS,
  INTERRUPTION_CONTRACTS,
  interruptionContractFor,
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
 * Event-stream conformance findings for one validated ledger's events.
 */
export function auditEventStream(
  scenarioId: ScenarioId,
  events: readonly EventEnvelope[],
): AuditFinding[] {
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
        //    lawful exits whenever the trigger mode is offered.
        for (const dilemma of DILEMMA_CHECKPOINTS) {
          if (!offered.some((o) => o.mode === dilemma.triggerMode)) continue;
          const missingClasses: string[] = [];
          for (const exitClass of dilemma.exitClasses) {
            if (!offered.some((o) => (exitClass.modes as readonly string[]).includes(o.mode))) {
              missingClasses.push(exitClass.classId);
            }
          }
          const distinctClasses = dilemma.exitClasses.length - missingClasses.length;
          if (distinctClasses < 2) {
            push({
              checkId: 'dilemma-missing-lawful-exits',
              scenarioId,
              key: { dilemmaId: dilemma.id, missingClasses: missingClasses.sort().join('+') },
              detail:
                `offer set at tick ${event.tick} triggers '${dilemma.id}' but provides ` +
                `${distinctClasses} distinct lawful exit class(es) (missing: ${missingClasses.join(', ')}); 2 required`,
            });
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
          // as 'incapacitated' by the engine).
          const universal = reason === 'incapacitated' || reason === 'scenario-ended';
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

  return findings.sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b)));
}
