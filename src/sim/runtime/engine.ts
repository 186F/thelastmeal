import { NPC_IDS, type NpcId } from '../../shared/ids';
import {
  BENCH_RESOURCE_ID,
  COMMITMENT_RELIEF_GRACE_TICK,
  COMMITMENT_RELIEF_MIN_DURATION_TICKS,
  COMMITMENT_RELIEF_START_TICK,
  DELIVER_MATERIALS_DURATION_TICKS,
  INJURY_WORSEN_DELAY_TICKS,
  INJURY_WORSENED_SEVERITY,
  MAX_REEVALUATION_INTERVAL_TICKS,
  MEAL_HUNGER_REDUCTION,
  MEAL_RESOURCE_ID,
  RELATIONSHIP_MAX,
  RELATIONSHIP_MIN,
  REL_DELTA_MEAL_VIOLATION,
  REL_DELTA_PROMISE_BROKEN,
  REL_DELTA_TREATMENT_SUCCESS,
  REPAIR_RATE_PER_TICK,
  REPAIR_TOTAL_UNITS,
  ROUTINE_WORK_BLOCK_TICKS,
  SCENARIO_END_TICK,
  SOCIAL_SIGNAL_RECENCY_TICKS,
  TASK_ID,
  TRAVEL_TICKS,
  TREATMENT_BY_HEALER,
} from '../config';
import { generateAffordances, type Affordance } from '../actions/affordances';
import { validateCompletion, validateStart, validateSustained } from '../actions/validation';
import { beliefDeltasFor, perceivableSummary } from '../cognition/perception';
import { IDENTITIES } from '../domain/identities';
import type { CanonicalState, NpcState, PendingActionState } from '../domain/state';
import { EventLedger, makeDraft } from '../events/ledger';
import { applyEvent } from '../events/reduce';
import type { EventDraft, SimEvent } from '../events/types';
import { evaluateConstraints } from '../decisions/constraints';
import { hardDependencyFingerprint } from '../decisions/dependencyFingerprint';
import { DeterministicProvider } from '../decisions/deterministicProvider';
import { FallbackProvider } from '../decisions/fallbackProvider';
import { ScriptedFailureProvider } from '../decisions/failingProvider';
import {
  ProviderFailureError,
  isDeferred,
  isScheduledResponseSource,
  type CommitmentView,
  type DecisionContext,
  type DecisionProvider,
  type DecisionResult,
} from '../decisions/provider';
import type {
  DecisionRejectionReason,
  DecisionRequest,
  DecisionResponse,
} from '../../shared/decisionContracts';
import { DECISION_REQUEST_TTL_TICKS } from '../config';
import { SeededRng } from '../rng/rng';
import { canonicalLedgerHash } from '../replay/ledgerHash';
import { worldStateHash } from '../replay/worldHash';
import { buildInitialState } from '../scenarios/initialState';
import { getScenario, type ScenarioDefinition } from '../scenarios/definitions';
import {
  V1_ROLES,
  assertValidRoles,
  commitmentIdForRoles,
  roleOf,
  type RoleAssignment,
} from '../scenarios/roles';
import type { ScenarioId } from '../../shared/ids';

/**
 * The deterministic simulation engine.
 *
 * All canonical mutations flow: system logic -> event draft -> ledger append
 * -> reducer. The engine holds only non-canonical bookkeeping (ID counters);
 * everything the reducer needs lives in the event stream, which is what makes
 * reducer-only replay exact.
 */

export interface EngineRun {
  scenario: ScenarioDefinition;
  /** Structural role assignment; always V1_ROLES outside the eval harness. */
  roles: RoleAssignment;
  state: CanonicalState;
  ledger: EventLedger;
  rng: SeededRng;
  provider: DecisionProvider;
  fallback: DecisionProvider;
  counters: { action: number; decision: number; request: number; proposal: number; signal: number };
  /** Semantic world-state hash, set at scenario end (remediation 4). */
  worldStateHash: string | null;
  /** Canonical event-stream hash, set at scenario end (remediation 4). */
  canonicalLedgerHash: string | null;
  /**
   * Externally injected decision responses (worker command
   * `submit-decision-response`), drained at exactly one fixed point inside
   * stepTick so canonical outcomes never depend on operator tick-batch sizes.
   * Non-canonical transport: every processed response is event-recorded.
   */
  responseInbox: DecisionResponse[];
  /**
   * Outbox of pending requests whose provider deferred — the seam intended
   * for a future external gateway. This build never forwards them to any
   * network; the worker exposes them as diagnostics-only messages.
   */
  externalRequests: DecisionRequest[];
}

export function createRun(scenarioId: ScenarioId): EngineRun {
  return createRunWithRoles(getScenario(scenarioId), V1_ROLES);
}

/**
 * Role-parameterized run creation for the individuality-eval harness
 * (remediation 7). Every v1.0 path calls createRun, which fixes V1_ROLES;
 * with the default assignment this function reproduces v1.0 byte-exactly.
 */
export function createRunWithRoles(scenario: ScenarioDefinition, roles: RoleAssignment): EngineRun {
  assertValidRoles(roles);
  const state = buildInitialState(scenario, roles);
  const base = new DeterministicProvider();
  const provider =
    scenario.providerFailureFromTick !== null
      ? new ScriptedFailureProvider(base, scenario.providerFailureFromTick)
      : base;
  const run: EngineRun = {
    scenario,
    roles,
    state,
    ledger: new EventLedger(),
    rng: new SeededRng(scenario.seed),
    provider,
    fallback: new FallbackProvider(),
    counters: { action: 0, decision: 0, request: 0, proposal: 0, signal: 0 },
    worldStateHash: null,
    canonicalLedgerHash: null,
    responseInbox: [],
    externalRequests: [],
  };
  emitScenarioStart(run);
  return run;
}

export function isTerminal(run: EngineRun): boolean {
  return run.state.terminal;
}

/** Advance exactly one logical tick. No-op once terminal. */
export function stepTick(run: EngineRun): void {
  if (run.state.terminal) return;
  const state = run.state;
  const tick = state.tick + 1;

  // 1. Time advances (reducer applies fixed need drift).
  emit(run, { type: 'TimeAdvanced', tick, actorId: null, targetId: null, payload: { tick } });

  // 2. Scripted scenario events.
  applyScriptedEvents(run, tick);

  // 3. Injury worsening monitor.
  injuryWorseningMonitor(run, tick);

  // 4. Movement arrivals, then start-validation for the arriving action.
  processArrivals(run, tick);

  // 5. Sustained validation of active actions.
  sustainedValidation(run, tick);

  // 6. Repair progression for the active bench worker.
  progressRepair(run, tick);

  // 7. Duration-based completions.
  processCompletions(run, tick);

  // 8. Commitment monitor (fulfillment / breach).
  commitmentMonitor(run, tick);

  // 9. Decision-response drain: scheduled and externally injected responses
  //    are processed at exactly this point, in deterministic order, so
  //    canonical outcomes are independent of operator tick-batch sizes.
  drainDecisionResponses(run, tick);

  // 10. Expire overdue decision requests.
  expireDecisionRequests(run, tick);

  // 11. Scenario end: task outcome, final hash, sealed ledger.
  if (tick >= state.endTick) {
    endScenario(run, tick);
    return;
  }

  // 12. Decision phase.
  decisionPhase(run, tick);
}

/** Run to the terminal state in deterministic whole-tick batches. */
export function runToCompletion(run: EngineRun, maxTicks = SCENARIO_END_TICK + 10): void {
  let guard = 0;
  while (!run.state.terminal && guard < maxTicks) {
    stepTick(run);
    guard += 1;
  }
  if (!run.state.terminal) {
    throw new Error('run-did-not-terminate');
  }
}

// ---------------------------------------------------------------------------
// Event emission with perception cascade
// ---------------------------------------------------------------------------

interface DraftFields {
  type: SimEvent['type'];
  tick: number;
  actorId: NpcId | null;
  targetId: string | null;
  payload: SimEvent['payload'];
  causationId?: string | null;
  correlationId?: string | null;
}

function emit(run: EngineRun, fields: DraftFields): SimEvent {
  const draft = makeDraft({
    type: fields.type,
    tick: fields.tick,
    actorId: fields.actorId,
    targetId: fields.targetId,
    causationId: fields.causationId ?? null,
    correlationId: fields.correlationId ?? null,
    payload: fields.payload,
  } as Omit<EventDraft, 'schemaVersion'>);
  const event = run.ledger.append(draft);
  applyEvent(run.state, event);
  cascadePerception(run, event);
  return event;
}

function cascadePerception(run: EngineRun, source: SimEvent): void {
  const summary = perceivableSummary(run.state, source);
  if (summary === null) return;
  for (const npcId of NPC_IDS) {
    const perception = run.ledger.append(
      makeDraft({
        type: 'PerceptionRecorded',
        tick: source.tick,
        actorId: npcId,
        targetId: source.id,
        causationId: source.id,
        correlationId: source.correlationId,
        payload: {
          npcId,
          sourceEventId: source.id,
          sourceEventType: source.type,
          summaryCode: summary,
        },
      }),
    );
    applyEvent(run.state, perception);
    for (const delta of beliefDeltasFor(npcId, run.state, source)) {
      const npc = run.state.npcs[npcId];
      const beliefId = `bel-${npcId}-${delta.subject}`;
      const existing = npc.beliefs.find((b) => b.id === beliefId);
      if (existing && existing.value === delta.value) continue;
      const beliefEvent = run.ledger.append(
        makeDraft({
          type: 'BeliefUpdated',
          tick: source.tick,
          actorId: npcId,
          targetId: null,
          causationId: perception.id,
          correlationId: source.correlationId,
          payload: {
            npcId,
            beliefId,
            subject: delta.subject,
            value: delta.value,
            confidenceMicro: delta.confidenceMicro,
            provenanceKind: 'perception',
            provenanceEventId: perception.id,
          },
        }),
      );
      applyEvent(run.state, beliefEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Run start
// ---------------------------------------------------------------------------

function emitScenarioStart(run: EngineRun): void {
  const { scenario, roles } = run;
  emit(run, {
    type: 'ScenarioStarted',
    tick: 0,
    actorId: null,
    targetId: null,
    payload: {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      seed: scenario.seed,
      configVersion: run.state.configVersion,
      providerId: run.provider.id,
    },
  });

  // The meal is reserved for the meal-owner role at scenario start (v1.0:
  // Rin); everyone knows.
  emit(run, {
    type: 'ResourceReserved',
    tick: 0,
    actorId: roles.mealOwner,
    targetId: MEAL_RESOURCE_ID,
    payload: {
      resourceId: MEAL_RESOURCE_ID,
      holderNpcId: roles.mealOwner,
      kind: 'consumption-right',
    },
  });

  // The pre-existing typed relief commitment: debtor role owes the bench
  // worker (creditor) role. v1.0: Jonas relieves Mara.
  emit(run, {
    type: 'CommitmentCreated',
    tick: 0,
    actorId: roles.debtor,
    targetId: roles.benchWorker,
    payload: {
      commitmentId: commitmentIdForRoles(roles),
      kind: 'relieve-at-bench',
      debtorId: roles.debtor,
      creditorId: roles.benchWorker,
      terms: {
        startTick: COMMITMENT_RELIEF_START_TICK,
        graceTick: COMMITMENT_RELIEF_GRACE_TICK,
        minDurationTicks: COMMITMENT_RELIEF_MIN_DURATION_TICKS,
      },
    },
  });

  // Scripted initial actions follow the structural roles (v1.0 assignment
  // coincides with the identity cards).
  startScriptedInitialAction(run, 'mara');
  startScriptedInitialAction(run, 'jonas');
  startScriptedInitialAction(run, 'rin');
}

const INITIAL_MODE_BY_ROLE = {
  benchWorker: 'work',
  debtor: 'routine-work',
  mealOwner: 'deliver-materials',
} as const;

function startScriptedInitialAction(run: EngineRun, npcId: NpcId): void {
  const mode = INITIAL_MODE_BY_ROLE[roleOf(run.roles, npcId)];
  const actionId = nextActionId(run);
  if (mode === 'work') {
    emit(run, {
      type: 'ResourceReserved',
      tick: 0,
      actorId: npcId,
      targetId: BENCH_RESOURCE_ID,
      payload: { resourceId: BENCH_RESOURCE_ID, holderNpcId: npcId, kind: 'exclusive-use' },
      correlationId: actionId,
    });
  }
  const durations = {
    work: SCENARIO_END_TICK,
    'routine-work': ROUTINE_WORK_BLOCK_TICKS,
    'deliver-materials': DELIVER_MATERIALS_DURATION_TICKS,
  } as const;
  const categories = {
    work: 'work-on-purifier',
    'routine-work': 'rest-or-wait',
    'deliver-materials': 'rest-or-wait',
  } as const;
  emit(run, {
    type: 'ActionStarted',
    tick: 0,
    actorId: npcId,
    targetId: null,
    correlationId: actionId,
    payload: {
      actionId,
      affordanceId: `scripted:${mode}`,
      npcId,
      category: categories[mode],
      mode,
      targetNpcId: null,
      targetResourceId: mode === 'work' ? BENCH_RESOURCE_ID : null,
      locationId: run.state.npcs[npcId].locationId,
      durationTicks: durations[mode],
      stateVersion: run.state.stateVersion,
      interruptible: mode !== 'deliver-materials',
      violation: false,
      commitmentId: null,
      proposalId: null,
      requestId: null,
      proposedTerms: null,
      completesAtTick: durations[mode] === SCENARIO_END_TICK ? SCENARIO_END_TICK : durations[mode],
    },
  });
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

function applyScriptedEvents(run: EngineRun, tick: number): void {
  const { scenario, state } = run;
  if (scenario.injury && scenario.injury.atTick === tick) {
    // The scripted injury targets the meal-owner ROLE. The frozen v1.0
    // scenario data pins that role to Rin (validated by npm run validate);
    // only the eval harness ever rotates it.
    const injuredNpcId = run.roles.mealOwner;
    emit(run, {
      type: 'InjuryOccurred',
      tick,
      actorId: null,
      targetId: injuredNpcId,
      payload: {
        npcId: injuredNpcId,
        severityMicro: scenario.injury.severityMicro,
        cause: 'scripted',
      },
    });
  }
  if (scenario.mealRemovalAtTick === tick && state.meal.exists) {
    const holder = state.meal.reservedForNpcId;
    if (holder !== null) {
      emit(run, {
        type: 'ReservationReleased',
        tick,
        actorId: null,
        targetId: MEAL_RESOURCE_ID,
        payload: {
          resourceId: MEAL_RESOURCE_ID,
          previousHolderNpcId: holder,
          reasonCode: 'scripted-world-event',
        },
      });
    }
    emit(run, {
      type: 'ResourceRemoved',
      tick,
      actorId: null,
      targetId: MEAL_RESOURCE_ID,
      payload: { resourceId: MEAL_RESOURCE_ID, reasonCode: 'scripted-world-event' },
    });
  }
}

function injuryWorseningMonitor(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    const injury = npc.injury;
    if (
      injury.injuredAtTick !== null &&
      !injury.worsened &&
      injury.severityMicro > 0 &&
      injury.severityMicro < INJURY_WORSENED_SEVERITY &&
      injury.treatmentStartedTick === null &&
      // ">=" rather than "===": if a treatment started in time but was later
      // aborted after the deadline, the untreated injury still worsens (on
      // the first tick the patient is again untreated past the deadline).
      tick >= injury.injuredAtTick + INJURY_WORSEN_DELAY_TICKS
    ) {
      const worsened = emit(run, {
        type: 'InjuryWorsened',
        tick,
        actorId: null,
        targetId: npcId,
        payload: {
          npcId,
          severityMicro: INJURY_WORSENED_SEVERITY,
          reasonCode: 'treatment-not-started-in-time',
        },
      });
      if (npc.currentAction) {
        interruptAction(run, npc, tick, 'incapacitated', worsened.id);
      }
    }
  }
}

function processArrivals(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    const transit = npc.transit;
    if (!transit || transit.arriveTick !== tick) continue;
    const arrival = emit(run, {
      type: 'MovementCompleted',
      tick,
      actorId: npcId,
      targetId: transit.toLocationId,
      correlationId: transit.actionId,
      payload: { npcId, actionId: transit.actionId, locationId: transit.toLocationId },
    });
    const action = npc.currentAction;
    if (action && action.phase === 'moving' && action.id === transit.actionId) {
      const check = validateStart(run.state, action, true);
      if (check.ok) {
        beginActivePhase(run, npc, action, tick, arrival.id);
      } else {
        emit(run, {
          type: 'ActionRejected',
          tick,
          actorId: npcId,
          targetId: null,
          causationId: arrival.id,
          correlationId: action.id,
          payload: {
            actionId: action.id,
            affordanceId: action.affordanceId,
            npcId,
            category: action.category,
            mode: action.mode,
            reasonCode: 'stale-preconditions-at-start',
            failedPreconditions: check.failed,
          },
        });
      }
    }
  }
}

function sustainedValidation(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    const action = npc.currentAction;
    if (!action || action.phase !== 'active') continue;
    const check = validateSustained(run.state, action);
    if (!check.ok) {
      interruptAction(
        run,
        npc,
        tick,
        `sustained-check-failed:${check.failed[0] ?? 'unknown'}`,
        null,
      );
    }
  }
}

function progressRepair(run: EngineRun, tick: number): void {
  const workerId = run.state.purifier.activeWorkerId;
  if (!workerId) return;
  const worker = run.state.npcs[workerId];
  const action = worker.currentAction;
  if (
    !action ||
    action.phase !== 'active' ||
    (action.mode !== 'work' && action.mode !== 'relieve')
  ) {
    return;
  }
  const progress = run.state.purifier.progressUnits;
  const delta = Math.min(REPAIR_RATE_PER_TICK[workerId], REPAIR_TOTAL_UNITS - progress);
  if (delta <= 0) return;
  emit(run, {
    type: 'RepairProgressed',
    tick,
    actorId: workerId,
    targetId: TASK_ID,
    correlationId: action.id,
    payload: { npcId: workerId, unitsDelta: delta, progressUnits: progress + delta },
  });
  if (run.state.purifier.progressUnits >= REPAIR_TOTAL_UNITS) {
    completeBenchSession(run, worker, tick, 'repair-target-reached');
  }
}

function processCompletions(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    const action = npc.currentAction;
    if (!action || action.phase !== 'active') continue;
    if (action.completesAtTick !== tick) continue;
    if (action.mode === 'work' || action.mode === 'relieve') {
      completeBenchSession(run, npc, tick, 'shift-ended');
      continue;
    }
    const check = validateCompletion(run.state, action);
    if (!check.ok) {
      interruptAction(run, npc, tick, `stale-at-completion:${check.failed[0] ?? 'unknown'}`, null);
      continue;
    }
    completeAction(run, npc, tick);
  }
}

function commitmentMonitor(run: EngineRun, tick: number): void {
  for (const commitment of run.state.commitments) {
    if (commitment.status !== 'active') continue;
    const { terms } = commitment;
    const runStart = commitment.activeReliefStartTick;
    if (
      runStart !== null &&
      tick - runStart >= terms.minDurationTicks &&
      runStart <= terms.graceTick &&
      tick >= terms.startTick
    ) {
      emit(run, {
        type: 'CommitmentFulfilled',
        tick,
        actorId: commitment.debtorId,
        targetId: commitment.id,
        payload: { commitmentId: commitment.id, reliefStartTick: runStart, reliefEndTick: tick },
      });
      continue;
    }
    if (tick > terms.graceTick && !(runStart !== null && runStart <= terms.graceTick)) {
      const broken = emit(run, {
        type: 'CommitmentBroken',
        tick,
        actorId: commitment.debtorId,
        targetId: commitment.id,
        payload: { commitmentId: commitment.id, reasonCode: 'grace-deadline-passed' },
      });
      changeRelationship(
        run,
        tick,
        commitment.creditorId,
        commitment.debtorId,
        REL_DELTA_PROMISE_BROKEN,
        'promise-broken',
        [broken.id],
      );
    }
  }
}

function endScenario(run: EngineRun, tick: number): void {
  // Force-expire any pending decision requests at a fixed point (NPC order)
  // so the terminal state is never ordering-dependent on outstanding
  // requests, then interrupt anything still running.
  // (pendingAction is always transient within a single tick's decision phase,
  // so nothing else can be outstanding here.)
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    if (npc.pendingDecision) {
      emit(run, {
        type: 'DecisionRequestExpired',
        tick,
        actorId: npcId,
        targetId: null,
        payload: { npcId, requestId: npc.pendingDecision.requestId, reasonCode: 'scenario-ended' },
      });
    }
  }
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    if (npc.currentAction) {
      interruptAction(run, npc, tick, 'scenario-ended', null);
    }
  }

  const progress = run.state.purifier.progressUnits;
  if (progress >= REPAIR_TOTAL_UNITS) {
    emit(run, {
      type: 'TaskCompleted',
      tick,
      actorId: null,
      targetId: TASK_ID,
      payload: { taskId: TASK_ID, progressUnits: progress },
    });
  } else {
    emit(run, {
      type: 'TaskDeadlineMissed',
      tick,
      actorId: null,
      targetId: TASK_ID,
      payload: { taskId: TASK_ID, progressUnits: progress },
    });
  }

  // Hash the state exactly as it will be after ScenarioEnded applies. The
  // world-state projection excludes the stateVersion/worldRevision counters,
  // so only the terminal flag needs mirroring on the provisional clone.
  const provisional = structuredClone(run.state);
  provisional.terminal = true;
  const finalWorldStateHash = worldStateHash(provisional);
  emit(run, {
    type: 'ScenarioEnded',
    tick,
    actorId: null,
    targetId: null,
    payload: {
      worldStateHash: finalWorldStateHash,
      taskOutcome: run.state.taskOutcome as 'completed' | 'deadline-missed',
    },
  });
  run.worldStateHash = finalWorldStateHash;
  // The ledger hash covers the complete canonical stream including
  // ScenarioEnded, so it can only live at run/file level (a hash cannot be
  // embedded in an event it covers).
  run.canonicalLedgerHash = canonicalLedgerHash(run.ledger.events);
  run.ledger.seal();
}

// ---------------------------------------------------------------------------
// Decision phase
// ---------------------------------------------------------------------------

function decisionPhase(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    if (npc.incapacitated || npc.transit !== null) continue;
    const action = npc.currentAction;
    let shouldDecide: boolean;
    if (!action) {
      shouldDecide = true;
    } else if (action.phase !== 'active' || !action.interruptible) {
      shouldDecide = false;
    } else {
      shouldDecide =
        npc.needsReevaluation || tick - npc.lastDecisionTick >= MAX_REEVALUATION_INTERVAL_TICKS;
    }
    if (!shouldDecide) continue;
    decideForNpc(run, npc, tick);
  }
}

function decideForNpc(run: EngineRun, npc: NpcState, tick: number): void {
  const stateVersion = run.state.stateVersion;
  const affordances = generateAffordances(run.state, npc.id, tick, stateVersion);
  if (affordances.length === 0) return;

  run.counters.decision += 1;
  const requestId = `dec-${String(run.counters.decision).padStart(4, '0')}`;

  // A new decision opportunity supersedes any outstanding request for this NPC.
  if (npc.pendingDecision) {
    emit(run, {
      type: 'DecisionRequestSuperseded',
      tick,
      actorId: npc.id,
      targetId: null,
      payload: {
        npcId: npc.id,
        requestId: npc.pendingDecision.requestId,
        supersededByRequestId: requestId,
      },
    });
  }

  const fingerprint = hardDependencyFingerprint(run.state, npc.id);
  const expiresAtTick = tick + DECISION_REQUEST_TTL_TICKS;
  const requested = emit(run, {
    type: 'DecisionRequested',
    tick,
    actorId: npc.id,
    targetId: null,
    payload: {
      npcId: npc.id,
      requestId,
      providerId: run.provider.id,
      stateVersion,
      worldRevision: run.state.worldRevision,
      expiresAtTick,
      hardDependencyFingerprint: fingerprint,
      affordanceIds: affordances.map((a) => a.id),
      offeredAffordances: affordances,
    },
  });

  const ctx = buildDecisionContext(run, npc, tick, stateVersion, requestId, affordances);
  try {
    const returned = run.provider.decide(ctx);
    if (isDeferred(returned)) {
      // The request stays pending; the world never blocks on a provider.
      run.externalRequests.push({
        requestId,
        npcId: npc.id,
        scenarioId: run.state.scenarioId,
        requestedAtTick: tick,
        expiresAtTick,
        worldRevisionAtRequest: run.state.worldRevision,
        providerId: run.provider.id,
        offeredAffordances: affordances,
        offeredAffordanceIds: affordances.map((a) => a.id),
        hardDependencyFingerprint: fingerprint,
      });
      if (!npc.currentAction) {
        // Idle NPCs act on the deterministic fallback immediately, without
        // consuming the pending request (provisional behavior).
        provisionalFallback(run, npc, tick, requestId, ctx, requested.id);
      }
      return;
    }
    const response = localResponse(run, requestId, npc.id, run.provider.id, returned, '');
    const outcome = processDecisionResponse(run, response, tick, false);
    if (!outcome.accepted) {
      // The provider's own response failed the acceptance gate (unoffered
      // affordance, constraint violation, ...): one bounded retry through
      // the deterministic fallback, which terminates on the always-offered
      // `wait`.
      runFallbackThroughGate(run, npc, tick, requestId, ctx);
    }
  } catch (error) {
    const errorCode =
      error instanceof ProviderFailureError ? error.errorCode : 'provider-exception';
    emit(run, {
      type: 'DecisionProviderFailed',
      tick,
      actorId: npc.id,
      targetId: null,
      causationId: requested.id,
      payload: { npcId: npc.id, requestId, providerId: run.provider.id, errorCode },
    });
    runFallbackThroughGate(run, npc, tick, requestId, ctx);
  }
}

function localResponse(
  run: EngineRun,
  requestId: string,
  npcId: NpcId,
  providerId: string,
  result: DecisionResult,
  suffix: string,
): DecisionResponse {
  return {
    responseId: `${requestId}-res${suffix}`,
    requestId,
    npcId,
    scenarioId: run.state.scenarioId,
    providerId,
    selectedAffordanceId: result.affordanceId,
    confidenceBp: result.confidenceBp,
    reasonCode: result.reasonCode,
    scores: result.scores,
  };
}

/**
 * Fallback routed through the same acceptance gate as every other response
 * (remediation 2, section 6.4). Bounded to a single retry: the fallback is
 * itself constraint-filtered and the constraint layer's allowed set is never
 * empty for a non-empty offer, so the gate can only reject its choice if the
 * world changed mid-tick — in which case the request simply stays pending
 * until expiry and the NPC re-decides.
 */
function runFallbackThroughGate(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  requestId: string,
  ctx: DecisionContext,
): void {
  const fallbackDecision = run.fallback.decide(ctx);
  if (isDeferred(fallbackDecision)) {
    throw new Error('fallback-provider-deferred');
  }
  emit(run, {
    type: 'FallbackDecisionUsed',
    tick,
    actorId: npc.id,
    targetId: null,
    payload: {
      npcId: npc.id,
      requestId,
      affordanceId: fallbackDecision.affordanceId,
      reasonCode: fallbackDecision.reasonCode,
    },
  });
  const response = localResponse(run, requestId, npc.id, run.fallback.id, fallbackDecision, '-fb');
  processDecisionResponse(run, response, tick, true);
}

/**
 * Provisional fallback while an external-capable request is pending: the NPC
 * acts, but the request is NOT consumed — a valid late response may still
 * preempt the (always interruptible) provisional action.
 */
function provisionalFallback(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  requestId: string,
  ctx: DecisionContext,
  causeEventId: string,
): void {
  const fallbackDecision = run.fallback.decide(ctx);
  if (isDeferred(fallbackDecision)) {
    throw new Error('fallback-provider-deferred');
  }
  const used = emit(run, {
    type: 'FallbackDecisionUsed',
    tick,
    actorId: npc.id,
    targetId: null,
    causationId: causeEventId,
    payload: {
      npcId: npc.id,
      requestId,
      affordanceId: fallbackDecision.affordanceId,
      reasonCode: `provisional:${fallbackDecision.reasonCode}`,
    },
  });
  const chosen = ctx.affordances.find((a) => a.id === fallbackDecision.affordanceId);
  if (!chosen || chosen.continuesActionId !== null) return;
  proposeAndLaunch(run, npc, tick, chosen, used.id);
}

/** Drain scheduled and injected decision responses in deterministic order. */
function drainDecisionResponses(run: EngineRun, tick: number): void {
  const due: DecisionResponse[] = [];
  if (isScheduledResponseSource(run.provider)) {
    due.push(...run.provider.dueResponses(tick));
  }
  if (run.responseInbox.length > 0) {
    due.push(...run.responseInbox);
    run.responseInbox.length = 0;
  }
  for (const response of due) {
    processDecisionResponse(run, response, tick, false);
  }
}

function expireDecisionRequests(run: EngineRun, tick: number): void {
  for (const npcId of NPC_IDS) {
    const npc = run.state.npcs[npcId];
    const pending = npc.pendingDecision;
    if (pending && tick > pending.expiresAtTick) {
      emit(run, {
        type: 'DecisionRequestExpired',
        tick,
        actorId: npcId,
        targetId: null,
        payload: { npcId, requestId: pending.requestId, reasonCode: 'ttl-expired' },
      });
    }
  }
}

/**
 * THE decision-response acceptance gate (remediations 1 and 2). Every
 * response — same-tick local, fallback, tick-scheduled, or externally
 * injected — passes through this single path. Order of checks follows the
 * audit's lifecycle semantics; every outcome is event-recorded.
 */
function processDecisionResponse(
  run: EngineRun,
  response: DecisionResponse,
  tick: number,
  usedFallback: boolean,
): { accepted: boolean } {
  const npc = run.state.npcs[response.npcId];
  const pending = npc.pendingDecision;
  const isCurrentRequest = pending !== null && pending.requestId === response.requestId;
  const seenBefore = isCurrentRequest && pending.responseIdsSeen.includes(response.responseId);

  const received = emit(run, {
    type: 'DecisionResponseReceived',
    tick,
    actorId: response.npcId,
    targetId: null,
    payload: {
      npcId: response.npcId,
      requestId: response.requestId,
      responseId: response.responseId,
      providerId: response.providerId,
      selectedAffordanceId: response.selectedAffordanceId,
      confidenceBp: response.confidenceBp,
      reasonCode: response.reasonCode,
      scores: response.scores,
    },
  });

  const reject = (
    rejectionReason: DecisionRejectionReason,
    constraintCodes: string[] = [],
  ): { accepted: boolean } => {
    emit(run, {
      type: 'DecisionResponseRejected',
      tick,
      actorId: response.npcId,
      targetId: null,
      causationId: received.id,
      payload: {
        npcId: response.npcId,
        requestId: response.requestId,
        responseId: response.responseId,
        selectedAffordanceId: response.selectedAffordanceId,
        rejectionReason,
        constraintCodes,
      },
    });
    return { accepted: false };
  };

  if (!isCurrentRequest) {
    return reject(
      npc.lastSupersededRequestId === response.requestId ? 'superseded-request' : 'unknown-request',
    );
  }
  if (response.scenarioId !== run.state.scenarioId || response.npcId !== npc.id) {
    return reject('unknown-request');
  }
  if (seenBefore) {
    return reject('duplicate-response');
  }
  if (tick > pending.expiresAtTick) {
    return reject('response-expired');
  }
  const affordance = pending.offeredAffordances.find((a) => a.id === response.selectedAffordanceId);
  if (!affordance) {
    return reject('unoffered-affordance');
  }
  if (hardDependencyFingerprint(run.state, response.npcId) !== pending.hardDependencyFingerprint) {
    return reject('stale-dependencies');
  }

  // Provider-independent constraints, evaluated on the CURRENT context over
  // the ORIGINAL offer (authoritative; providers cannot opt out).
  const evaluation = evaluateConstraints(
    {
      npcId: npc.id,
      hungerMicro: npc.hungerMicro,
      injury: npc.injury,
      incapacitated: npc.incapacitated,
      beliefs: npc.beliefs,
    },
    pending.offeredAffordances,
  );
  if (!evaluation.allowedAffordanceIds.includes(affordance.id)) {
    const forbidden = evaluation.forbidden.find((f) => f.affordanceId === affordance.id);
    return reject(
      'constraint-violation',
      forbidden ? forbidden.reasonCodes : evaluation.activeConstraintCodes,
    );
  }

  if (affordance.continuesActionId !== null) {
    if (!npc.currentAction || npc.currentAction.id !== affordance.continuesActionId) {
      return reject('action-no-longer-valid');
    }
  } else {
    if (
      npc.currentAction &&
      (npc.currentAction.phase !== 'active' || !npc.currentAction.interruptible)
    ) {
      return reject('actor-busy-noninterruptible');
    }
    if (npc.transit !== null) {
      return reject('actor-busy-noninterruptible');
    }
    const probe: PendingActionState = {
      id: 'gate-validation',
      affordanceId: affordance.id,
      category: affordance.category,
      mode: affordance.mode,
      actorId: npc.id,
      targetNpcId: affordance.targetNpcId,
      targetResourceId: affordance.targetResourceId,
      locationId: affordance.requiredLocationId,
      durationTicks: affordance.durationTicks,
      stateVersionAtProposal: run.state.stateVersion,
      interruptible: affordance.interruptible,
      violation: affordance.violation,
      commitmentId: affordance.commitmentId,
      proposalId: affordance.proposalId,
      requestId: affordance.requestId,
      proposedTerms: affordance.proposedTerms ? { ...affordance.proposedTerms } : null,
    };
    const check = validateStart(run.state, probe, false);
    if (!check.ok) {
      return reject('action-no-longer-valid');
    }
  }

  const accepted = emit(run, {
    type: 'DecisionResponseAccepted',
    tick,
    actorId: response.npcId,
    targetId: null,
    causationId: received.id,
    payload: {
      npcId: response.npcId,
      requestId: response.requestId,
      responseId: response.responseId,
      selectedAffordanceId: response.selectedAffordanceId,
      confidenceBp: response.confidenceBp,
      reasonCode: response.reasonCode,
      usedFallback,
    },
  });

  if (affordance.continuesActionId !== null) {
    return { accepted: true };
  }
  if (npc.currentAction) {
    interruptAction(run, npc, tick, 'preempted-by-new-decision', accepted.id);
  }
  proposeAndLaunch(run, npc, tick, affordance, accepted.id);
  return { accepted: true };
}

function proposeAndLaunch(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  affordance: Affordance,
  causeEventId: string,
): void {
  const actionId = nextActionId(run);
  const proposedTerms = affordance.proposedTerms ? { ...affordance.proposedTerms } : null;
  const descriptor = {
    actionId,
    affordanceId: affordance.id,
    npcId: npc.id,
    category: affordance.category,
    mode: affordance.mode,
    targetNpcId: affordance.targetNpcId,
    targetResourceId: affordance.targetResourceId,
    locationId: affordance.requiredLocationId,
    durationTicks: affordance.durationTicks,
    stateVersion: affordance.stateVersion,
    interruptible: affordance.interruptible,
    violation: affordance.violation,
    commitmentId: affordance.commitmentId,
    proposalId: affordance.proposalId,
    requestId: affordance.requestId,
    proposedTerms,
  };
  emit(run, {
    type: 'ActionProposed',
    tick,
    actorId: npc.id,
    targetId: affordance.targetNpcId,
    causationId: causeEventId,
    correlationId: actionId,
    payload: descriptor,
  });

  const pending = npc.pendingAction;
  if (!pending) return;

  const preCheck = validateStart(run.state, pending, false);
  if (!preCheck.ok) {
    emit(run, {
      type: 'ActionRejected',
      tick,
      actorId: npc.id,
      targetId: null,
      correlationId: actionId,
      payload: {
        actionId,
        affordanceId: affordance.id,
        npcId: npc.id,
        category: affordance.category,
        mode: affordance.mode,
        reasonCode: 'preconditions-failed',
        failedPreconditions: preCheck.failed,
      },
    });
    return;
  }

  if (pending.locationId !== null && npc.locationId !== pending.locationId) {
    emit(run, {
      type: 'MovementStarted',
      tick,
      actorId: npc.id,
      targetId: pending.locationId,
      correlationId: actionId,
      payload: {
        npcId: npc.id,
        actionId,
        fromLocationId: npc.locationId,
        toLocationId: pending.locationId,
        arriveTick: tick + TRAVEL_TICKS,
      },
    });
    return;
  }

  // No travel needed: begin the active phase immediately.
  const startCheck = validateStart(run.state, pending, true);
  if (!startCheck.ok) {
    emit(run, {
      type: 'ActionRejected',
      tick,
      actorId: npc.id,
      targetId: null,
      correlationId: actionId,
      payload: {
        actionId,
        affordanceId: affordance.id,
        npcId: npc.id,
        category: affordance.category,
        mode: affordance.mode,
        reasonCode: 'preconditions-failed',
        failedPreconditions: startCheck.failed,
      },
    });
    return;
  }
  beginActivePhase(run, npc, pending, tick, causeEventId);
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

function beginActivePhase(
  run: EngineRun,
  npc: NpcState,
  action: PendingActionState,
  tick: number,
  causeEventId: string | null,
): void {
  const state = run.state;

  // Mode-specific entry effects (reservations, handover, violations).
  if (action.mode === 'work') {
    emit(run, {
      type: 'ResourceReserved',
      tick,
      actorId: npc.id,
      targetId: BENCH_RESOURCE_ID,
      correlationId: action.id,
      causationId: causeEventId,
      payload: { resourceId: BENCH_RESOURCE_ID, holderNpcId: npc.id, kind: 'exclusive-use' },
    });
  }

  if (action.mode === 'relieve') {
    const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
    if (bench && bench.holderNpcId !== npc.id) {
      const occupant = state.npcs[bench.holderNpcId];
      if (occupant.currentAction) {
        interruptAction(run, occupant, tick, 'relieved-at-bench', causeEventId);
      } else {
        emit(run, {
          type: 'ReservationReleased',
          tick,
          actorId: bench.holderNpcId,
          targetId: BENCH_RESOURCE_ID,
          correlationId: action.id,
          payload: {
            resourceId: BENCH_RESOURCE_ID,
            previousHolderNpcId: bench.holderNpcId,
            reasonCode: 'relieved',
          },
        });
      }
    }
    emit(run, {
      type: 'ResourceReserved',
      tick,
      actorId: npc.id,
      targetId: BENCH_RESOURCE_ID,
      correlationId: action.id,
      causationId: causeEventId,
      payload: { resourceId: BENCH_RESOURCE_ID, holderNpcId: npc.id, kind: 'exclusive-use' },
    });
  }

  if (action.mode === 'eat-violation') {
    const ownerId = state.meal.reservedForNpcId;
    if (ownerId !== null && ownerId !== npc.id) {
      const violation = emit(run, {
        type: 'OwnershipViolated',
        tick,
        actorId: npc.id,
        targetId: ownerId,
        correlationId: action.id,
        payload: {
          actorId: npc.id,
          resourceId: state.meal.resourceId,
          ownerNpcId: ownerId,
          violationKind: 'took-reserved-meal',
        },
      });
      changeRelationship(run, tick, ownerId, npc.id, REL_DELTA_MEAL_VIOLATION, 'meal-taken', [
        violation.id,
      ]);
    }
  }

  if (action.mode === 'treat' && action.targetNpcId) {
    const capability = TREATMENT_BY_HEALER[npc.id];
    emit(run, {
      type: 'TreatmentStarted',
      tick,
      actorId: npc.id,
      targetId: action.targetNpcId,
      correlationId: action.id,
      causationId: causeEventId,
      payload: {
        actionId: action.id,
        healerId: npc.id,
        patientId: action.targetNpcId,
        expectedDurationTicks: capability ? capability.durationTicks : 0,
      },
    });
  }

  const isBenchSession = action.mode === 'work' || action.mode === 'relieve';
  const completesAtTick = isBenchSession ? run.state.endTick : tick + action.durationTicks;
  emit(run, {
    type: 'ActionStarted',
    tick,
    actorId: npc.id,
    targetId: action.targetNpcId,
    correlationId: action.id,
    causationId: causeEventId,
    payload: {
      actionId: action.id,
      affordanceId: action.affordanceId,
      npcId: npc.id,
      category: action.category,
      mode: action.mode,
      targetNpcId: action.targetNpcId,
      targetResourceId: action.targetResourceId,
      locationId: action.locationId,
      durationTicks: action.durationTicks,
      stateVersion: action.stateVersionAtProposal,
      interruptible: action.interruptible,
      violation: action.violation,
      commitmentId: action.commitmentId,
      proposalId: action.proposalId,
      requestId: action.requestId,
      proposedTerms: action.proposedTerms ? { ...action.proposedTerms } : null,
      completesAtTick,
    },
  });
}

function completeBenchSession(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  outcomeCode: string,
): void {
  const action = npc.currentAction;
  if (!action) return;
  maybeFulfillBeforeRunEnd(run, npc, tick);
  emit(run, {
    type: 'ActionCompleted',
    tick,
    actorId: npc.id,
    targetId: null,
    correlationId: action.id,
    payload: {
      actionId: action.id,
      npcId: npc.id,
      category: action.category,
      mode: action.mode,
      startedTick: action.phaseStartTick,
      outcomeCode,
    },
  });
  releaseBenchIfHeld(run, npc, tick, 'session-ended');
}

function completeAction(run: EngineRun, npc: NpcState, tick: number): void {
  const state = run.state;
  const action = npc.currentAction;
  if (!action) return;

  const finish = (outcomeCode: string): void => {
    emit(run, {
      type: 'ActionCompleted',
      tick,
      actorId: npc.id,
      targetId: action.targetNpcId,
      correlationId: action.id,
      payload: {
        actionId: action.id,
        npcId: npc.id,
        category: action.category,
        mode: action.mode,
        startedTick: action.phaseStartTick,
        outcomeCode,
      },
    });
  };

  switch (action.mode) {
    case 'eat':
    case 'eat-violation': {
      const before = npc.hungerMicro;
      const after = Math.max(0, before - MEAL_HUNGER_REDUCTION);
      emit(run, {
        type: 'MealConsumed',
        tick,
        actorId: npc.id,
        targetId: state.meal.resourceId,
        correlationId: action.id,
        payload: {
          npcId: npc.id,
          resourceId: state.meal.resourceId,
          hungerBeforeMicro: before,
          hungerAfterMicro: after,
          violation: action.violation,
        },
      });
      finish('meal-consumed');
      break;
    }
    case 'treat': {
      const patientId = action.targetNpcId;
      const capability = TREATMENT_BY_HEALER[npc.id];
      if (patientId && capability) {
        const patient = state.npcs[patientId];
        const completed = emit(run, {
          type: 'TreatmentCompleted',
          tick,
          actorId: npc.id,
          targetId: patientId,
          correlationId: action.id,
          payload: {
            actionId: action.id,
            healerId: npc.id,
            patientId,
            severityBeforeMicro: patient.injury.severityMicro,
            severityAfterMicro: capability.resultSeverity,
          },
        });
        changeRelationship(
          run,
          tick,
          patientId,
          npc.id,
          REL_DELTA_TREATMENT_SUCCESS,
          'treatment-received',
          [completed.id],
        );
      }
      finish('treatment-succeeded');
      break;
    }
    case 'request-transfer': {
      const ownerId = state.meal.reservedForNpcId;
      if (ownerId !== null && ownerId !== npc.id) {
        run.counters.request += 1;
        const requestId = `req-${String(run.counters.request).padStart(3, '0')}`;
        emit(run, {
          type: 'ReservationTransferRequested',
          tick,
          actorId: npc.id,
          targetId: ownerId,
          correlationId: action.id,
          payload: {
            requestId,
            resourceId: state.meal.resourceId,
            requesterNpcId: npc.id,
            ownerNpcId: ownerId,
          },
        });
      }
      finish('request-sent');
      break;
    }
    case 'transfer': {
      const toId = action.targetNpcId;
      if (toId) {
        emit(run, {
          type: 'ReservationTransferred',
          tick,
          actorId: npc.id,
          targetId: toId,
          correlationId: action.id,
          payload: {
            resourceId: state.meal.resourceId,
            fromNpcId: npc.id,
            toNpcId: toId,
            requestId: action.requestId,
          },
        });
      }
      finish('reservation-transferred');
      break;
    }
    case 'refuse-request': {
      const requesterId = action.targetNpcId;
      if (requesterId && action.requestId) {
        emit(run, {
          type: 'ReservationTransferRefused',
          tick,
          actorId: npc.id,
          targetId: requesterId,
          correlationId: action.id,
          payload: {
            requestId: action.requestId,
            resourceId: state.meal.resourceId,
            ownerNpcId: npc.id,
            requesterNpcId: requesterId,
            reasonCode: 'owner-declined',
          },
        });
      }
      finish('request-refused');
      break;
    }
    case 'release': {
      emit(run, {
        type: 'ReservationReleased',
        tick,
        actorId: npc.id,
        targetId: state.meal.resourceId,
        correlationId: action.id,
        payload: {
          resourceId: state.meal.resourceId,
          previousHolderNpcId: npc.id,
          reasonCode: 'voluntary-release',
        },
      });
      finish('reservation-released');
      break;
    }
    case 'ask-help': {
      run.counters.signal += 1;
      emit(run, {
        type: 'HelpRequested',
        tick,
        actorId: npc.id,
        targetId: action.targetNpcId,
        correlationId: action.id,
        payload: {
          signalId: `sig-${String(run.counters.signal).padStart(3, '0')}`,
          fromNpcId: npc.id,
          toNpcId: action.targetNpcId,
          topicCode: 'need-treatment',
        },
      });
      finish('help-requested');
      break;
    }
    case 'request-break': {
      run.counters.signal += 1;
      emit(run, {
        type: 'ReliefRequested',
        tick,
        actorId: npc.id,
        targetId: null,
        correlationId: action.id,
        payload: {
          signalId: `sig-${String(run.counters.signal).padStart(3, '0')}`,
          fromNpcId: npc.id,
          toNpcId: null,
          topicCode: 'wants-relief',
        },
      });
      finish('relief-requested');
      break;
    }
    case 'propose-renegotiation': {
      const commitment = state.commitments.find((c) => c.id === action.commitmentId);
      if (commitment && action.proposedTerms) {
        run.counters.proposal += 1;
        const proposalId = `prop-${String(run.counters.proposal).padStart(3, '0')}`;
        emit(run, {
          type: 'CommitmentRenegotiationProposed',
          tick,
          actorId: npc.id,
          targetId: commitment.id,
          correlationId: action.id,
          payload: {
            commitmentId: commitment.id,
            proposalId,
            proposedByNpcId: npc.id,
            proposedTerms: { ...action.proposedTerms },
            reasonCode: 'care-conflict',
          },
        });
      }
      finish('renegotiation-proposed');
      break;
    }
    case 'accept-renegotiation': {
      const commitment = state.commitments.find((c) => c.id === action.commitmentId);
      if (
        commitment &&
        commitment.pendingProposal &&
        commitment.pendingProposal.proposalId === action.proposalId
      ) {
        emit(run, {
          type: 'CommitmentRenegotiationAccepted',
          tick,
          actorId: npc.id,
          targetId: commitment.id,
          correlationId: action.id,
          payload: {
            commitmentId: commitment.id,
            proposalId: commitment.pendingProposal.proposalId,
            acceptedByNpcId: npc.id,
            newTerms: { ...commitment.pendingProposal.proposedTerms },
          },
        });
      }
      finish('renegotiation-accepted');
      break;
    }
    case 'reject-renegotiation': {
      const commitment = state.commitments.find((c) => c.id === action.commitmentId);
      if (
        commitment &&
        commitment.pendingProposal &&
        commitment.pendingProposal.proposalId === action.proposalId
      ) {
        emit(run, {
          type: 'CommitmentRenegotiationRejected',
          tick,
          actorId: npc.id,
          targetId: commitment.id,
          correlationId: action.id,
          payload: {
            commitmentId: commitment.id,
            proposalId: commitment.pendingProposal.proposalId,
            rejectedByNpcId: npc.id,
          },
        });
      }
      finish('renegotiation-rejected');
      break;
    }
    case 'rest':
      finish('rest-applied');
      break;
    case 'wait':
      finish('waited');
      break;
    case 'routine-work':
      finish('routine-work-block-done');
      break;
    case 'deliver-materials':
      finish('materials-delivered');
      break;
    case 'stay-at-cot':
      finish('stayed-at-cot');
      break;
    default:
      finish('completed');
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function interruptAction(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  reasonCode: string,
  causeEventId: string | null,
): void {
  const action = npc.currentAction;
  if (!action) return;
  const isBenchSession =
    action.phase === 'active' && (action.mode === 'work' || action.mode === 'relieve');
  if (isBenchSession) {
    maybeFulfillBeforeRunEnd(run, npc, tick);
  }
  emit(run, {
    type: 'ActionInterrupted',
    tick,
    actorId: npc.id,
    targetId: null,
    correlationId: action.id,
    causationId: causeEventId,
    payload: {
      actionId: action.id,
      npcId: npc.id,
      category: action.category,
      mode: action.mode,
      reasonCode,
    },
  });
  if (isBenchSession) {
    releaseBenchIfHeld(run, npc, tick, reasonCode);
  }
}

function releaseBenchIfHeld(run: EngineRun, npc: NpcState, tick: number, reasonCode: string): void {
  const bench = run.state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
  if (bench && bench.holderNpcId === npc.id) {
    emit(run, {
      type: 'ReservationReleased',
      tick,
      actorId: npc.id,
      targetId: BENCH_RESOURCE_ID,
      payload: {
        resourceId: BENCH_RESOURCE_ID,
        previousHolderNpcId: npc.id,
        reasonCode,
      },
    });
  }
}

/**
 * If the debtor's bench run is about to end and already satisfies the
 * commitment terms, record fulfillment before the run-end event clears the
 * run marker.
 */
function maybeFulfillBeforeRunEnd(run: EngineRun, npc: NpcState, tick: number): void {
  for (const commitment of run.state.commitments) {
    if (commitment.status !== 'active') continue;
    if (commitment.debtorId !== npc.id) continue;
    const runStart = commitment.activeReliefStartTick;
    if (
      runStart !== null &&
      tick - runStart >= commitment.terms.minDurationTicks &&
      runStart <= commitment.terms.graceTick &&
      tick >= commitment.terms.startTick
    ) {
      emit(run, {
        type: 'CommitmentFulfilled',
        tick,
        actorId: commitment.debtorId,
        targetId: commitment.id,
        payload: { commitmentId: commitment.id, reliefStartTick: runStart, reliefEndTick: tick },
      });
    }
  }
}

function changeRelationship(
  run: EngineRun,
  tick: number,
  fromId: NpcId,
  toId: NpcId,
  deltaMicro: number,
  reasonCode: string,
  causeEventIds: string[],
): void {
  const rel = run.state.relationships.find((r) => r.fromNpcId === fromId && r.toNpcId === toId);
  const current = rel ? rel.valueMicro : 0;
  const next = Math.max(RELATIONSHIP_MIN, Math.min(RELATIONSHIP_MAX, current + deltaMicro));
  emit(run, {
    type: 'RelationshipChanged',
    tick,
    actorId: fromId,
    targetId: toId,
    payload: {
      fromNpcId: fromId,
      toNpcId: toId,
      deltaMicro: next - current,
      valueMicro: next,
      reasonCode,
      causeEventIds,
    },
  });
}

function nextActionId(run: EngineRun): string {
  run.counters.action += 1;
  return `act-${String(run.counters.action).padStart(4, '0')}`;
}

function buildDecisionContext(
  run: EngineRun,
  npc: NpcState,
  tick: number,
  stateVersion: number,
  requestId: string,
  affordances: Affordance[],
): DecisionContext {
  const state = run.state;
  const bench = state.reservations.find((r) => r.resourceId === BENCH_RESOURCE_ID);
  const occupantId = bench ? bench.holderNpcId : null;
  let occupantRun: number | null = null;
  if (occupantId) {
    const occupantAction = state.npcs[occupantId].currentAction;
    if (
      occupantAction &&
      occupantAction.phase === 'active' &&
      (occupantAction.mode === 'work' || occupantAction.mode === 'relieve')
    ) {
      occupantRun = tick - occupantAction.phaseStartTick;
    }
  }
  const commitments: CommitmentView[] = state.commitments
    .filter((c) => c.debtorId === npc.id || c.creditorId === npc.id)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      role: c.debtorId === npc.id ? 'debtor' : 'creditor',
      otherPartyId: c.debtorId === npc.id ? c.creditorId : c.debtorId,
      terms: { ...c.terms },
      status: c.status,
      renegotiated: c.renegotiated,
      pendingProposalId: c.pendingProposal ? c.pendingProposal.proposalId : null,
      activeReliefStartTick: c.activeReliefStartTick,
    }));
  return {
    npcId: npc.id,
    scenarioId: state.scenarioId,
    tick,
    stateVersion,
    requestId,
    identity: IDENTITIES[npc.id],
    hungerMicro: npc.hungerMicro,
    fatigueMicro: npc.fatigueMicro,
    injury: { ...npc.injury },
    incapacitated: npc.incapacitated,
    locationId: npc.locationId,
    goalId: IDENTITIES[npc.id].goalId,
    beliefs: npc.beliefs,
    memories: npc.memories,
    commitments,
    relationships: state.relationships.filter((r) => r.fromNpcId === npc.id),
    affordances,
    benchOccupantId: occupantId,
    benchOccupantRunTicks: occupantRun,
    purifierProgressUnits: state.purifier.progressUnits,
    recentSignals: state.socialSignals
      .filter((s) => tick - s.tick < SOCIAL_SIGNAL_RECENCY_TICKS)
      .map((s) => ({ kind: s.kind, fromNpcId: s.fromNpcId, toNpcId: s.toNpcId, tick: s.tick })),
  };
}
