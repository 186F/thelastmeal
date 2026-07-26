import type { EventEnvelope } from '../../shared/events';
import type { CanonicalState } from '../domain/state';
import { applyEvent } from '../events/reduce';
import type { SimEvent } from '../events/types';
import { getScenario } from '../scenarios/definitions';
import { buildInitialState } from '../scenarios/initialState';
import { hashCanonicalState } from './hash';
import type { ScenarioId } from '../../shared/ids';

/**
 * Deterministic replay: reconstructs final canonical state from the local
 * scenario definition plus the ordered authoritative event ledger. Replay
 * never consults a decision provider — it folds the reducer over recorded
 * events, exactly the invariant that makes the ledger authoritative.
 */

export interface ReplayResult {
  state: CanonicalState;
  finalStateHash: string;
  /** Hash recorded in the ledger's ScenarioEnded event, if present. */
  recordedHash: string | null;
}

export function replayLedger(
  scenarioId: ScenarioId,
  events: readonly EventEnvelope[],
): ReplayResult {
  const scenario = getScenario(scenarioId);
  const state = buildInitialState(scenario);
  let recordedHash: string | null = null;
  for (const event of events) {
    applyEvent(state, event as SimEvent);
    if (event.type === 'ScenarioEnded') {
      recordedHash = (event.payload as { finalStateHash: string }).finalStateHash;
    }
  }
  return { state, finalStateHash: hashCanonicalState(state), recordedHash };
}
