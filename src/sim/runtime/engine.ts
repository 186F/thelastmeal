import { NPC_IDS, type NpcId } from '../../shared/ids';
import {
  BENCH_RESOURCE_ID,
  COMMITMENT_RELIEF_GRACE_TICK,
  COMMITMENT_RELIEF_ID,
  COMMITMENT_RELIEF_MIN_DURATION_TICKS,
  COMMITMENT_RELIEF_START_TICK,
  DELIVER_MATERIALS_DURATION_TICKS,
  INJURY_WORSEN_DELAY_TICKS,
  INJURY_WORSENED_SEVERITY,
  MAX_REEVALUATION_INTERVAL_TICKS,
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
import { DeterministicProvider } from '../decisions/deterministicProvider';
import { FallbackProvider } from '../decisions/fallbackProvider';
import { ScriptedFailureProvider } from '../decisions/failingProvider';
import {
  ProviderFailureError,
  type CommitmentView,
  type DecisionContext,
  type DecisionProvider,
  type DecisionResult,
} from '../decisions/provider';
import { SeededRng } from '../rng/rng';
import { hashCanonicalState } from '../replay/hash';
import { buildInitialState } from '../scenarios/initialState';
import { getScenario, type ScenarioDefinition } from '../scenarios/definitions';
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
  state: CanonicalState;
  ledger: EventLedger;
  rng: SeededRng;
  provider: DecisionProvider;
  fallback: DecisionProvider;
  counters: { action: number; decision: number; request: number; proposal: number; signal: number };
  finalStateHash: string | null;
}

export function createRun(scenarioId: ScenarioId): EngineRun {
  const scenario = getScenario(scenarioId);
  const state = buildInitialState(scenario);
  const base = new DeterministicProvider();
  const provider =
    scenario.providerFailureFromTick !== null
      ? new ScriptedFailureProvider(base, scenario.providerFailureFromTick)
      : base;
  const run: EngineRun = {
    scenario,
    state,
    ledger: new EventLedger(),
    rng: new SeededRng(scenario.seed),
    provider,
    fallback: new FallbackProvider(),
    counters: { action: 0, decision: 0, request: 0, proposal: 0, signal: 0 },
    finalStateHash: null,
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

  // 9. Scenario end: task outcome, final hash, sealed ledger.
  if (tick >= state.endTick) {
    endScenario(run, tick);
    return;
  }

  // 10. Decision phase.
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
  const { scenario } = run;
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

  // The meal is reserved for Rin at scenario start; everyone knows.
  emit(run, {
    type: 'ResourceReserved',
    tick: 0,
    actorId: 'rin',
    targetId: MEAL_RESOURCE_ID,
    payload: { resourceId: MEAL_RESOURCE_ID, holderNpcId: 'rin', kind: 'consumption-right' },
  });

  // Jonas's pre-existing typed commitment to relieve Mara.
  emit(run, {
    type: 'CommitmentCreated',
    tick: 0,
    actorId: 'jonas',
    targetId: 'mara',
    payload: {
      commitmentId: COMMITMENT_RELIEF_ID,
      kind: 'relieve-at-bench',
      debtorId: 'jonas',
      creditorId: 'mara',
      terms: {
        startTick: COMMITMENT_RELIEF_START_TICK,
        graceTick: COMMITMENT_RELIEF_GRACE_TICK,
        minDurationTicks: COMMITMENT_RELIEF_MIN_DURATION_TICKS,
      },
    },
  });

  // Scripted initial actions per the identity cards.
  startScriptedInitialAction(run, 'mara');
  startScriptedInitialAction(run, 'jonas');
  startScriptedInitialAction(run, 'rin');
}

function startScriptedInitialAction(run: EngineRun, npcId: NpcId): void {
  const identity = IDENTITIES[npcId];
  const mode = identity.initial.initialActionMode;
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
      locationId: identity.initial.locationId,
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
    emit(run, {
      type: 'InjuryOccurred',
      tick,
      actorId: null,
      targetId: scenario.injury.npcId,
      payload: {
        npcId: scenario.injury.npcId,
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
      tick === injury.injuredAtTick + INJURY_WORSEN_DELAY_TICKS
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
  // Interrupt anything still running; the scenario window is over.
  // (pendingAction is always transient within a single tick's decision phase,
  // so nothing else can be outstanding here.)
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

  // Hash the state exactly as it will be after ScenarioEnded applies
  // (terminal flag set and state-version advanced by that event).
  const provisional = structuredClone(run.state);
  provisional.terminal = true;
  provisional.stateVersion += 1;
  const finalStateHash = hashCanonicalState(provisional);
  emit(run, {
    type: 'ScenarioEnded',
    tick,
    actorId: null,
    targetId: null,
    payload: {
      finalStateHash,
      taskOutcome: run.state.taskOutcome as 'completed' | 'deadline-missed',
    },
  });
  run.finalStateHash = finalStateHash;
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
      affordanceIds: affordances.map((a) => a.id),
    },
  });

  const ctx = buildDecisionContext(run, npc, tick, stateVersion, requestId, affordances);
  let result: DecisionResult;
  let decisionEventId: string;
  try {
    const returned = run.provider.decide(ctx);
    if (!affordances.some((a) => a.id === returned.affordanceId)) {
      throw new ProviderFailureError('provider-chose-unoffered-affordance');
    }
    result = returned;
    const returnedEvent = emit(run, {
      type: 'DecisionReturned',
      tick,
      actorId: npc.id,
      targetId: null,
      causationId: requested.id,
      payload: {
        npcId: npc.id,
        requestId,
        affordanceId: returned.affordanceId,
        confidenceBp: returned.confidenceBp,
        reasonCode: returned.reasonCode,
        scores: returned.scores,
      },
    });
    decisionEventId = returnedEvent.id;
  } catch (error) {
    const errorCode =
      error instanceof ProviderFailureError ? error.errorCode : 'provider-exception';
    const failedEvent = emit(run, {
      type: 'DecisionProviderFailed',
      tick,
      actorId: npc.id,
      targetId: null,
      causationId: requested.id,
      payload: { npcId: npc.id, requestId, providerId: run.provider.id, errorCode },
    });
    const fallbackResult = run.fallback.decide(ctx);
    result = fallbackResult;
    const fallbackEvent = emit(run, {
      type: 'FallbackDecisionUsed',
      tick,
      actorId: npc.id,
      targetId: null,
      causationId: failedEvent.id,
      payload: {
        npcId: npc.id,
        requestId,
        affordanceId: fallbackResult.affordanceId,
        reasonCode: fallbackResult.reasonCode,
      },
    });
    decisionEventId = fallbackEvent.id;
  }

  const chosen = affordances.find((a) => a.id === result.affordanceId);
  if (!chosen) return; // unreachable: both paths guarantee an offered ID
  if (chosen.continuesActionId !== null) return; // keep doing the current action

  if (npc.currentAction) {
    interruptAction(run, npc, tick, 'preempted-by-new-decision', decisionEventId);
  }
  proposeAndLaunch(run, npc, tick, chosen, decisionEventId);
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
          violationKind: 'consumed-reserved-meal',
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
      const after = Math.max(0, before - 550_000);
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
      .filter((s) => tick - s.tick < 600)
      .map((s) => ({ kind: s.kind, fromNpcId: s.fromNpcId, toNpcId: s.toNpcId, tick: s.tick })),
  };
}
