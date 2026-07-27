import type { DecisionProvider, ProviderDecision } from './provider';

/**
 * External deferred provider (model integration milestone 001, section 8).
 *
 * The pure simulation-side stand-in for a real external model: its ONLY
 * behavior is to defer, which makes the engine record the exact replayable
 * pending request, emit one external request through the outbox seam, and
 * keep the NPC active through the provisional fallback. It imports no SDK,
 * performs no I/O, reads no environment, and uses no promises, timers, or
 * wall-clock time — the actual model call happens in the server-side gateway,
 * and the answer re-enters through `submit-decision-response` like any other
 * external response.
 *
 * The provider-id literal lives in src/shared/modelExperiment.ts (single
 * source of truth); this module re-exports it for existing importers.
 */
export { EXTERNAL_MARA_PROVIDER_ID } from '../../shared/modelExperiment';

export class ExternalDeferredProvider implements DecisionProvider {
  constructor(readonly id: string) {}

  decide(): ProviderDecision {
    return { deferred: true };
  }
}
