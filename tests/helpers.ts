import type { EventEnvelope } from '../src/shared/events';
import type { EventType, ScenarioId } from '../src/shared/ids';
import { SCHEMA_VERSION } from '../src/shared/versions';
import type { CanonicalState } from '../src/sim/domain/state';
import type { SimEvent } from '../src/sim/events/types';
import { createRun, runToCompletion, type EngineRun } from '../src/sim/runtime/engine';
import { buildInitialState } from '../src/sim/scenarios/initialState';
import { getScenario } from '../src/sim/scenarios/definitions';

let fakeSeq = 0;

/** Builds a synthetic event for direct reducer tests. */
export function mkEvent(
  type: EventType,
  tick: number,
  payload: Record<string, unknown>,
  extras: Partial<
    Pick<EventEnvelope, 'actorId' | 'targetId' | 'causationId' | 'correlationId'>
  > = {},
): SimEvent {
  fakeSeq += 1;
  return {
    id: `evt-test-${fakeSeq}`,
    seq: fakeSeq,
    type,
    tick,
    schemaVersion: SCHEMA_VERSION,
    actorId: extras.actorId ?? null,
    targetId: extras.targetId ?? null,
    causationId: extras.causationId ?? null,
    correlationId: extras.correlationId ?? null,
    payload,
  } as SimEvent;
}

export function freshState(scenarioId: ScenarioId = 'A'): CanonicalState {
  return buildInitialState(getScenario(scenarioId));
}

const completedRuns = new Map<ScenarioId, EngineRun>();

/** Runs a scenario to completion once per test process and caches the result. */
export function completedRun(scenarioId: ScenarioId): EngineRun {
  let run = completedRuns.get(scenarioId);
  if (!run) {
    run = createRun(scenarioId);
    runToCompletion(run);
    completedRuns.set(scenarioId, run);
  }
  return run;
}

export function eventsOfType(run: EngineRun, type: EventType): SimEvent[] {
  return run.ledger.events.filter((e) => e.type === type) as SimEvent[];
}

export function firstEventOfType(run: EngineRun, type: EventType): SimEvent | undefined {
  return run.ledger.events.find((e) => e.type === type) as SimEvent | undefined;
}
