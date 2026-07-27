import type { NpcId } from '../../shared/ids';
import type { ExternalDecisionRequest } from '../../shared/decisionContracts';
import {
  isScheduledResponseSource,
  type DecisionProvider,
  type ScheduledResponseSource,
} from './provider';

/**
 * Run-level provider plan (model integration milestone 001, section 7).
 *
 * The engine began with one provider per run; a plan generalizes that to an
 * engine-owned, per-NPC provider selection while preserving the existing
 * baseline byte-for-byte:
 *
 * - `id` is the stable run-level configuration identity, recorded in
 *   `ScenarioStarted.providerId` and the ledger-file `providerId` field. The
 *   default single-provider plan's id IS the provider's own id, so every
 *   frozen ledger and golden hash is unchanged.
 * - `providerFor(npcId)` names the decision authority for that NPC; each
 *   `DecisionRequested.providerId` records this actual provider, and the
 *   acceptance gate binds responses to it (re-audit finding 1).
 * - `scheduledResponseSources()` lists tick-scheduled response sources in
 *   deterministic provider-ID order; the engine drains them at the fixed
 *   response-drain point inside stepTick.
 * - `externalProviderIds()` names the providers whose deferrals are intended
 *   for an external gateway. The engine itself treats every deferral
 *   identically (pending replayable request + provisional fallback); this
 *   list is the transport layer's allowlist.
 */
export interface ProviderPlan {
  readonly id: string;
  providerFor(npcId: NpcId): DecisionProvider;
  scheduledResponseSources(): ScheduledResponseSource[];
  externalProviderIds(): readonly string[];
  /**
   * Optional condition-carried validator for outbound external requests
   * (re-audit remediation, deviation D4). Returns null for a valid request
   * or a short error code; the engine throws
   * `external-request-condition-violation` on any non-null return, AFTER the
   * generic schema validation. Carried as data on the plan so the engine
   * itself stays experiment-agnostic.
   */
  validateExternalRequest?(request: ExternalDecisionRequest): string | null;
}

/**
 * The default plan: one provider for every NPC, read live through a getter so
 * existing tests that mutate `run.provider` after creation keep their exact
 * semantics. Its id is the provider's id — for the frozen scenarios that is
 * `deterministic-utility-v1` (or the scripted-failure wrapper's identical id
 * in Scenario F), which keeps ScenarioStarted payloads and exported ledger
 * metadata byte-identical to the pre-plan engine.
 */
export function singleProviderPlan(getProvider: () => DecisionProvider): ProviderPlan {
  return {
    get id(): string {
      return getProvider().id;
    },
    providerFor: () => getProvider(),
    scheduledResponseSources: () => {
      const provider = getProvider();
      return isScheduledResponseSource(provider) ? [provider] : [];
    },
    externalProviderIds: () => [],
  };
}

/**
 * A fixed per-NPC plan. Scheduled sources are the unique providers that
 * implement ScheduledResponseSource, in ascending provider-ID order —
 * deterministic regardless of construction order.
 */
export function perNpcPlan(
  id: string,
  providers: Record<NpcId, DecisionProvider>,
  externalProviderIds: readonly string[],
  validateExternalRequest?: (request: ExternalDecisionRequest) => string | null,
): ProviderPlan {
  const unique = new Map<string, DecisionProvider>();
  for (const provider of Object.values(providers)) {
    unique.set(provider.id, provider);
  }
  const scheduled = [...unique.values()]
    .filter(isScheduledResponseSource)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const plan: ProviderPlan = {
    id,
    providerFor: (npcId) => providers[npcId],
    scheduledResponseSources: () => scheduled,
    externalProviderIds: () => externalProviderIds,
  };
  if (validateExternalRequest) {
    plan.validateExternalRequest = validateExternalRequest;
  }
  return plan;
}
