import type { EventEnvelope } from '../../shared/events';
import type { LedgerFile } from '../../shared/ledgerFile';
import {
  ACTION_CATEGORIES,
  ACTION_MODES,
  NPC_IDS,
  type ActionCategory,
  type ActionMode,
  type NpcId,
} from '../../shared/ids';
import {
  BEHAVIOR_FINGERPRINT_VERSION,
  CATEGORY_TRANSITION_KEYS,
  MODE_TRANSITION_KEYS,
  TARGET_ORIENTATION_BUCKETS,
  behaviorFingerprintSetSchema,
  type BehaviorFingerprint,
  type BehaviorFingerprintSet,
  type TargetOrientationBucket,
} from '../../shared/behaviorArtifacts';
import { DECISION_REJECTION_REASONS, EXTERNAL_FAILURE_CODES } from '../../shared/decisionContracts';
import { replayLedger } from '../replay/replay';
import { V1_ROLES, roleOf } from '../scenarios/roles';
import { largestRemainderBp } from './arithmetic';

/**
 * Versioned behavioral fingerprints derived from a fully validated ledger
 * (M2 brief §10.4). Pure and deterministic: canonical events plus the final
 * summary in, exact integers out. Never reads rationale prose, decision
 * confidence, or score diagnostics (§10.1 and the R7 confidence ruling) —
 * those fields exist in decision events and are deliberately not consulted.
 *
 * The caller is responsible for validation (`validateLedgerFile`); this
 * module trusts the exact per-event schemas that validation enforced.
 */

/** Provider id of the deterministic utility provider — everything else is external. */
const DETERMINISTIC_PROVIDER_ID = 'deterministic-utility-v1';

interface OpenAction {
  startTick: number;
  category: ActionCategory;
  mode: ActionMode;
  isBenchSession: boolean;
}

interface NpcAccumulator {
  decisionOpportunities: number;
  actionsProposed: number;
  actionsStarted: number;
  actionsCompleted: number;
  actionsInterrupted: number;
  actionsRejected: number;
  activeTicks: number;
  timeByCategoryTicks: Map<string, number>;
  startsByCategory: Map<string, number>;
  startsByMode: Map<string, number>;
  continuationSelections: number;
  violationSelections: number;
  fallbackSelections: number;
  categoryTransitions: Map<string, number>;
  modeTransitions: Map<string, number>;
  previousStartCategory: ActionCategory | null;
  previousStartMode: ActionMode | null;
  targetNpcCounts: Map<string, number>;
  targetResourceCounts: Map<string, number>;
  targetOrientation: Map<string, number>;
  helpRequestsSent: number;
  reliefRequestsSent: number;
  mealTransferRequests: number;
  mealTransferAcceptances: number;
  mealTransferRefusals: number;
  renegotiationProposals: number;
  renegotiationAcceptances: number;
  renegotiationRejections: number;
  commitmentsFulfilledAsDebtor: number;
  commitmentsBrokenAsDebtor: number;
  ownershipViolations: number;
  firstTreatmentStartTick: number | null;
  treatmentCompletionTick: number | null;
  injuryWorsened: boolean;
  purifierContributionUnits: number;
  workSessionCount: number;
  longestWorkSessionTicks: number;
  externalActionCalls: number;
  acceptedExternalActions: number;
  deterministicFallbackDecisions: number;
  providerFailuresByCode: Map<string, number>;
  engineRejectionsByReason: Map<string, number>;
  openActions: Map<string, OpenAction>;
  relationships: Map<string, number>;
}

function freshAccumulator(): NpcAccumulator {
  return {
    decisionOpportunities: 0,
    actionsProposed: 0,
    actionsStarted: 0,
    actionsCompleted: 0,
    actionsInterrupted: 0,
    actionsRejected: 0,
    activeTicks: 0,
    timeByCategoryTicks: new Map(),
    startsByCategory: new Map(),
    startsByMode: new Map(),
    continuationSelections: 0,
    violationSelections: 0,
    fallbackSelections: 0,
    categoryTransitions: new Map(),
    modeTransitions: new Map(),
    previousStartCategory: null,
    previousStartMode: null,
    targetNpcCounts: new Map(),
    targetResourceCounts: new Map(),
    targetOrientation: new Map(),
    helpRequestsSent: 0,
    reliefRequestsSent: 0,
    mealTransferRequests: 0,
    mealTransferAcceptances: 0,
    mealTransferRefusals: 0,
    renegotiationProposals: 0,
    renegotiationAcceptances: 0,
    renegotiationRejections: 0,
    commitmentsFulfilledAsDebtor: 0,
    commitmentsBrokenAsDebtor: 0,
    ownershipViolations: 0,
    firstTreatmentStartTick: null,
    treatmentCompletionTick: null,
    injuryWorsened: false,
    purifierContributionUnits: 0,
    workSessionCount: 0,
    longestWorkSessionTicks: 0,
    externalActionCalls: 0,
    acceptedExternalActions: 0,
    deterministicFallbackDecisions: 0,
    providerFailuresByCode: new Map(),
    engineRejectionsByReason: new Map(),
    openActions: new Map(),
    relationships: new Map(),
  };
}

function bump(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function toCompleteRecord(
  map: ReadonlyMap<string, number>,
  keys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = map.get(key) ?? 0;
  return out;
}

function orientationBucket(
  targetNpcId: NpcId | null,
  targetResourceId: string | null,
): TargetOrientationBucket {
  if (targetNpcId !== null) return `role:${roleOf(V1_ROLES, targetNpcId)}`;
  if (targetResourceId === 'meal-1') return 'resource:meal';
  if (targetResourceId === 'workbench-slot') return 'resource:workbench';
  return 'untargeted';
}

/**
 * Builds one fingerprint per NPC from a validated exported ledger. Exported
 * ledgers always carry the V1 role assignment (`buildLedgerFile` refuses
 * rotated roles), so role buckets resolve against `V1_ROLES`.
 */
export function buildBehaviorFingerprints(file: LedgerFile): BehaviorFingerprintSet {
  const accumulators = new Map<NpcId, NpcAccumulator>(
    NPC_IDS.map((npcId) => [npcId, freshAccumulator()]),
  );
  const acc = (npcId: NpcId): NpcAccumulator => {
    const found = accumulators.get(npcId);
    if (!found) throw new Error(`fingerprint-unknown-npc:${npcId}`);
    return found;
  };

  const requestProviderById = new Map<string, string>();
  const commitmentDebtorById = new Map<string, NpcId>();
  let taskCompletionTick: number | null = null;
  let mealViolation = false;

  for (const event of file.events) {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'DecisionRequested': {
        const npcId = p.npcId as NpcId;
        const providerId = p.providerId as string;
        const a = acc(npcId);
        a.decisionOpportunities += 1;
        requestProviderById.set(p.requestId as string, providerId);
        if (providerId !== DETERMINISTIC_PROVIDER_ID) a.externalActionCalls += 1;
        break;
      }
      case 'DecisionResponseAccepted': {
        const npcId = p.npcId as NpcId;
        const a = acc(npcId);
        const selected = p.selectedAffordanceId as string;
        if (selected.includes(':continue:')) a.continuationSelections += 1;
        const usedFallback = p.usedFallback as boolean;
        if (usedFallback) a.fallbackSelections += 1;
        const provider = requestProviderById.get(p.requestId as string);
        if (!usedFallback && provider !== undefined && provider !== DETERMINISTIC_PROVIDER_ID) {
          a.acceptedExternalActions += 1;
        }
        break;
      }
      case 'DecisionResponseRejected': {
        const a = acc(p.npcId as NpcId);
        const reason = p.rejectionReason as string;
        if (!(DECISION_REJECTION_REASONS as readonly string[]).includes(reason)) {
          throw new Error(`fingerprint-unknown-rejection-reason:${reason}`);
        }
        bump(a.engineRejectionsByReason, reason);
        break;
      }
      case 'DecisionProviderFailed': {
        const a = acc(p.npcId as NpcId);
        const code = p.errorCode as string;
        if (!(EXTERNAL_FAILURE_CODES as readonly string[]).includes(code)) {
          throw new Error(`fingerprint-unknown-provider-failure-code:${code}`);
        }
        bump(a.providerFailuresByCode, code);
        break;
      }
      case 'FallbackDecisionUsed': {
        acc(p.npcId as NpcId).deterministicFallbackDecisions += 1;
        break;
      }
      case 'ActionProposed': {
        acc(p.npcId as NpcId).actionsProposed += 1;
        break;
      }
      case 'ActionStarted': {
        const npcId = p.npcId as NpcId;
        const a = acc(npcId);
        const category = p.category as ActionCategory;
        const mode = p.mode as ActionMode;
        a.actionsStarted += 1;
        bump(a.startsByCategory, category);
        bump(a.startsByMode, mode);
        if (p.violation === true) a.violationSelections += 1;
        if (a.previousStartCategory !== null) {
          bump(a.categoryTransitions, `${a.previousStartCategory}->${category}`);
        }
        if (a.previousStartMode !== null) {
          bump(a.modeTransitions, `${a.previousStartMode}->${mode}`);
        }
        a.previousStartCategory = category;
        a.previousStartMode = mode;
        const targetNpcId = (p.targetNpcId ?? null) as NpcId | null;
        const targetResourceId = (p.targetResourceId ?? null) as string | null;
        if (targetNpcId !== null) bump(a.targetNpcCounts, targetNpcId);
        if (targetResourceId !== null) bump(a.targetResourceCounts, targetResourceId);
        bump(a.targetOrientation, orientationBucket(targetNpcId, targetResourceId));
        const isBenchSession = mode === 'work' || mode === 'relieve';
        if (isBenchSession) a.workSessionCount += 1;
        a.openActions.set(p.actionId as string, {
          startTick: event.tick,
          category,
          mode,
          isBenchSession,
        });
        break;
      }
      case 'ActionCompleted':
      case 'ActionInterrupted': {
        const npcId = p.npcId as NpcId;
        const a = acc(npcId);
        if (event.type === 'ActionCompleted') a.actionsCompleted += 1;
        else a.actionsInterrupted += 1;
        const open = a.openActions.get(p.actionId as string);
        if (open) {
          const delta = event.tick - open.startTick;
          a.activeTicks += delta;
          bump(a.timeByCategoryTicks, open.category, delta);
          if (open.isBenchSession && delta > a.longestWorkSessionTicks) {
            a.longestWorkSessionTicks = delta;
          }
          a.openActions.delete(p.actionId as string);
        }
        break;
      }
      case 'ActionRejected': {
        acc(p.npcId as NpcId).actionsRejected += 1;
        break;
      }
      case 'RepairProgressed': {
        acc(p.npcId as NpcId).purifierContributionUnits += p.unitsDelta as number;
        break;
      }
      case 'HelpRequested': {
        acc(p.fromNpcId as NpcId).helpRequestsSent += 1;
        break;
      }
      case 'ReliefRequested': {
        acc(p.fromNpcId as NpcId).reliefRequestsSent += 1;
        break;
      }
      case 'ReservationTransferRequested': {
        acc(p.requesterNpcId as NpcId).mealTransferRequests += 1;
        break;
      }
      case 'ReservationTransferred': {
        if (p.requestId !== null) acc(p.fromNpcId as NpcId).mealTransferAcceptances += 1;
        break;
      }
      case 'ReservationTransferRefused': {
        acc(p.ownerNpcId as NpcId).mealTransferRefusals += 1;
        break;
      }
      case 'CommitmentCreated': {
        commitmentDebtorById.set(p.commitmentId as string, p.debtorId as NpcId);
        break;
      }
      case 'CommitmentRenegotiationProposed': {
        acc(p.proposedByNpcId as NpcId).renegotiationProposals += 1;
        break;
      }
      case 'CommitmentRenegotiationAccepted': {
        acc(p.acceptedByNpcId as NpcId).renegotiationAcceptances += 1;
        break;
      }
      case 'CommitmentRenegotiationRejected': {
        acc(p.rejectedByNpcId as NpcId).renegotiationRejections += 1;
        break;
      }
      case 'CommitmentFulfilled': {
        const debtor = commitmentDebtorById.get(p.commitmentId as string);
        if (debtor) acc(debtor).commitmentsFulfilledAsDebtor += 1;
        break;
      }
      case 'CommitmentBroken': {
        const debtor = commitmentDebtorById.get(p.commitmentId as string);
        if (debtor) acc(debtor).commitmentsBrokenAsDebtor += 1;
        break;
      }
      case 'OwnershipViolated': {
        acc(p.actorId as NpcId).ownershipViolations += 1;
        break;
      }
      case 'TreatmentStarted': {
        const a = acc(p.patientId as NpcId);
        if (a.firstTreatmentStartTick === null) a.firstTreatmentStartTick = event.tick;
        break;
      }
      case 'TreatmentCompleted': {
        const a = acc(p.patientId as NpcId);
        if (a.treatmentCompletionTick === null) a.treatmentCompletionTick = event.tick;
        break;
      }
      case 'InjuryWorsened': {
        acc(p.npcId as NpcId).injuryWorsened = true;
        break;
      }
      case 'MealConsumed': {
        if (p.violation === true) mealViolation = true;
        break;
      }
      case 'TaskCompleted': {
        taskCompletionTick = event.tick;
        break;
      }
      case 'RelationshipChanged': {
        const from = p.fromNpcId as NpcId;
        acc(from).relationships.set(p.toNpcId as string, p.valueMicro as number);
        break;
      }
      default:
        break;
    }
  }

  // Defensive close for any action still open at scenario end (the engine
  // interrupts everything at the end tick, so this is normally a no-op).
  for (const a of accumulators.values()) {
    for (const open of a.openActions.values()) {
      const delta = file.finalSummary.tick - open.startTick;
      a.activeTicks += delta;
      bump(a.timeByCategoryTicks, open.category, delta);
      if (open.isBenchSession && delta > a.longestWorkSessionTicks) {
        a.longestWorkSessionTicks = delta;
      }
    }
    a.openActions.clear();
  }

  const replay = replayLedger(file.scenario.id, file.events);
  const contributionByNpc = new Map<string, number>(
    NPC_IDS.map((npcId) => [npcId, acc(npcId).purifierContributionUnits]),
  );
  const contributionBp = largestRemainderBp(contributionByNpc, NPC_IDS);

  const npcFingerprints = {} as Record<NpcId, BehaviorFingerprint>;
  for (const npcId of NPC_IDS) {
    const a = acc(npcId);
    const npcState = replay.state.npcs[npcId];
    const relationshipsAtEnd: Record<string, number> = {};
    for (const other of NPC_IDS) {
      relationshipsAtEnd[other] = npcId === other ? 0 : (a.relationships.get(other) ?? 0);
    }
    npcFingerprints[npcId] = {
      fingerprintVersion: BEHAVIOR_FINGERPRINT_VERSION,
      scenarioId: file.scenario.id,
      scenarioVersion: file.scenario.version,
      seed: file.scenario.seed,
      conditionId: file.providerId,
      npcId,
      finalTick: file.finalSummary.tick,
      worldStateHash: file.worldStateHash,
      canonicalLedgerHash: file.canonicalLedgerHash,

      decisionOpportunities: a.decisionOpportunities,
      actionsProposed: a.actionsProposed,
      actionsStarted: a.actionsStarted,
      actionsCompleted: a.actionsCompleted,
      actionsInterrupted: a.actionsInterrupted,
      actionsRejected: a.actionsRejected,
      activeTicks: a.activeTicks,
      timeByCategoryTicks: toCompleteRecord(a.timeByCategoryTicks, ACTION_CATEGORIES),
      timeByCategoryBp: toCompleteRecord(
        largestRemainderBp(a.timeByCategoryTicks, ACTION_CATEGORIES),
        ACTION_CATEGORIES,
      ),
      startsByCategory: toCompleteRecord(a.startsByCategory, ACTION_CATEGORIES),
      startsByCategoryBp: toCompleteRecord(
        largestRemainderBp(a.startsByCategory, ACTION_CATEGORIES),
        ACTION_CATEGORIES,
      ),
      startsByMode: toCompleteRecord(a.startsByMode, ACTION_MODES),
      startsByModeBp: toCompleteRecord(
        largestRemainderBp(a.startsByMode, ACTION_MODES),
        ACTION_MODES,
      ),
      continuationSelections: a.continuationSelections,
      violationSelections: a.violationSelections,
      fallbackSelections: a.fallbackSelections,
      policyPatchSelections: 0,

      categoryTransitions: toCompleteRecord(a.categoryTransitions, CATEGORY_TRANSITION_KEYS),
      categoryTransitionBp: toCompleteRecord(
        largestRemainderBp(a.categoryTransitions, CATEGORY_TRANSITION_KEYS),
        CATEGORY_TRANSITION_KEYS,
      ),
      modeTransitions: toCompleteRecord(a.modeTransitions, MODE_TRANSITION_KEYS),

      targetNpcCounts: toCompleteRecord(a.targetNpcCounts, NPC_IDS),
      targetResourceCounts: toCompleteRecord(a.targetResourceCounts, ['meal-1', 'workbench-slot']),
      targetOrientation: toCompleteRecord(a.targetOrientation, TARGET_ORIENTATION_BUCKETS),
      targetOrientationBp: toCompleteRecord(
        largestRemainderBp(a.targetOrientation, TARGET_ORIENTATION_BUCKETS),
        TARGET_ORIENTATION_BUCKETS,
      ),
      helpRequestsSent: a.helpRequestsSent,
      // VS001 offers no affordance for answering a help request (§10.4's
      // not-observable rule): report the absence honestly, never a zero.
      helpRequestsAnswered: 'not-observable',
      reliefRequestsSent: a.reliefRequestsSent,
      mealTransferRequests: a.mealTransferRequests,
      mealTransferAcceptances: a.mealTransferAcceptances,
      mealTransferRefusals: a.mealTransferRefusals,
      renegotiationProposals: a.renegotiationProposals,
      renegotiationAcceptances: a.renegotiationAcceptances,
      renegotiationRejections: a.renegotiationRejections,
      commitmentsFulfilledAsDebtor: a.commitmentsFulfilledAsDebtor,
      commitmentsBrokenAsDebtor: a.commitmentsBrokenAsDebtor,
      ownershipViolations: a.ownershipViolations,

      firstTreatmentStartTick: a.firstTreatmentStartTick,
      treatmentCompletionTick: a.treatmentCompletionTick,
      injuryWorsened: a.injuryWorsened,
      incapacitatedAtEnd: npcState.incapacitated,
      mealConsumedBy: file.finalSummary.mealConsumedBy,
      mealViolation,
      hungerAtEnd: npcState.hungerMicro,
      fatigueAtEnd: npcState.fatigueMicro,

      taskOutcome: file.finalSummary.taskOutcome,
      taskCompletionTick,
      purifierContributionUnits: a.purifierContributionUnits,
      purifierContributionBp: contributionBp.get(npcId) ?? 0,
      workSessionCount: a.workSessionCount,
      longestWorkSessionTicks: a.longestWorkSessionTicks,

      commitmentTerminalStatus: file.finalSummary.promiseOutcome,

      relationshipsAtEnd,

      externalActionCalls: a.externalActionCalls,
      policyCompilationCalls: 0,
      acceptedExternalActions: a.acceptedExternalActions,
      acceptedPolicyPatches: 0,
      policyPatchUses: 0,
      policyPatchMisses: 0,
      policyPatchInvalidationsByReason: {},
      deterministicFallbackDecisions: a.deterministicFallbackDecisions,
      providerFailuresByCode: toCompleteRecord(a.providerFailuresByCode, EXTERNAL_FAILURE_CODES),
      engineRejectionsByReason: toCompleteRecord(
        a.engineRejectionsByReason,
        DECISION_REJECTION_REASONS,
      ),
    };
  }

  const set: BehaviorFingerprintSet = {
    fingerprintVersion: BEHAVIOR_FINGERPRINT_VERSION,
    scenarioId: file.scenario.id,
    scenarioVersion: file.scenario.version,
    seed: file.scenario.seed,
    conditionId: file.providerId,
    finalTick: file.finalSummary.tick,
    worldStateHash: file.worldStateHash,
    canonicalLedgerHash: file.canonicalLedgerHash,
    npcs: npcFingerprints as BehaviorFingerprintSet['npcs'],
  };
  return behaviorFingerprintSetSchema.parse(set);
}

export type { EventEnvelope };
