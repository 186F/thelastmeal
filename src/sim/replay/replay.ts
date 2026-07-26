import type { EventEnvelope } from '../../shared/events';
import type { CanonicalState } from '../domain/state';
import { applyEvent } from '../events/reduce';
import type { SimEvent } from '../events/types';
import { getScenario } from '../scenarios/definitions';
import { buildInitialState } from '../scenarios/initialState';
import { V1_ROLES, type RoleAssignment } from '../scenarios/roles';
import { worldStateHash } from './worldHash';
import type { ScenarioId } from '../../shared/ids';

/**
 * Deterministic replay: reconstructs final canonical state from the local
 * scenario definition plus the ordered authoritative event ledger. Replay
 * never consults a decision provider — it folds the reducer over recorded
 * events, exactly the invariant that makes the ledger authoritative.
 *
 * Replay reproduces the semantic `worldStateHash`. The canonical ledger hash
 * is a function of the event stream itself, so re-simulating (not replaying)
 * is the axis that verifies it; see the determinism suite.
 */

export interface ReplayResult {
  state: CanonicalState;
  worldStateHash: string;
  /** Hash recorded in the ledger's ScenarioEnded event, if present. */
  recordedWorldStateHash: string | null;
}

export function replayLedger(
  scenarioId: ScenarioId,
  events: readonly EventEnvelope[],
  roles: RoleAssignment = V1_ROLES,
): ReplayResult {
  const scenario = getScenario(scenarioId);
  const state = buildInitialState(scenario, roles);
  let recordedWorldStateHash: string | null = null;
  for (const event of events) {
    applyEvent(state, event as SimEvent);
    if (event.type === 'ScenarioEnded') {
      recordedWorldStateHash = (event.payload as { worldStateHash: string }).worldStateHash;
    }
  }
  return { state, worldStateHash: worldStateHash(state), recordedWorldStateHash };
}
