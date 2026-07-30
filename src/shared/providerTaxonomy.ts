import { EXTERNAL_MARA_PROVIDER_ID } from './modelExperiment';
import {
  M2_ACTION_PROVIDER_ID,
  M2_POLICY_COMPILER_PROVIDER_ID,
  M2_POLICY_EXECUTOR_PROVIDER_ID,
} from './m2Experiment';

/**
 * Explicit provider-source taxonomy for behavioral evidence (Phase 2 audit,
 * blocking finding 1). A decision request's provider ID is classified against
 * this closed registry — never by a negative comparison against one literal.
 *
 * The distinction this protects: an engine decision REQUEST is not an
 * upstream model CALL. Milestone 1 Run 6 emitted 75 external decision
 * requests while the stopped gateway completed only 10 upstream calls, and
 * the Milestone 2 policy executor (`mara-policy-patch-executor-v1`) is a
 * deterministic LOCAL provider whose decisions must never count as external
 * calls — the 25% call-reduction target (brief §2, restated as RQ1 in §3)
 * depends on it.
 */

export const PROVIDER_SOURCE_CLASSES = [
  /** The frozen deterministic utility provider (baseline wiring). */
  'deterministic-utility',
  /** A registered external action authority: requests MAY become upstream calls. */
  'external-action-request',
  /** The M2 policy executor: a deterministic local provider. Never upstream. */
  'local-policy-executor',
  /** The M2 policy compiler authority: upstream-capable, but never serves
   * per-decision action requests (it compiles policies out of band). */
  'external-policy-compilation',
] as const;
export type ProviderSourceClass = (typeof PROVIDER_SOURCE_CLASSES)[number];

/**
 * The complete classification registry for provider IDs that may appear on
 * `DecisionRequested.providerId`, spanning the Milestone 1 legacy action
 * authority (retained for historical evidence) and the full Milestone 2
 * identity vocabulary imported from the central `m2Experiment.ts` module
 * (never redeclared here). The fallback provider
 * (`fallback-continue-or-wait-v2`) is deliberately absent: it serves
 * RESPONSES for an existing request (flagged `usedFallback`), it is never the
 * authority a request is addressed to.
 *
 * A `Map`, not an object literal: provider IDs come from evidence files, and
 * an object index would resolve `Object.prototype` member names
 * (`constructor`, `toString`, `__proto__`, ...) to inherited values instead
 * of `undefined`, silently bypassing the unknown-ID error below.
 */
export const PROVIDER_SOURCE_TAXONOMY: ReadonlyMap<string, ProviderSourceClass> = new Map([
  ['deterministic-utility-v1', 'deterministic-utility'],
  [EXTERNAL_MARA_PROVIDER_ID, 'external-action-request'],
  [M2_ACTION_PROVIDER_ID, 'external-action-request'],
  [M2_POLICY_EXECUTOR_PROVIDER_ID, 'local-policy-executor'],
  [M2_POLICY_COMPILER_PROVIDER_ID, 'external-policy-compilation'],
]);

/** Provider IDs whose requests can legally reach an upstream model service —
 * exactly the M1 and M2 action authorities plus the M2 compiler. Everything
 * else is local by construction. */
export const UPSTREAM_CAPABLE_PROVIDER_IDS: readonly string[] = [
  EXTERNAL_MARA_PROVIDER_ID,
  M2_ACTION_PROVIDER_ID,
  M2_POLICY_COMPILER_PROVIDER_ID,
];

/** Typed classification failure: an unknown provider ID must fail loudly,
 * never default to `external` (audit §3.4 requirement 5). */
export class ProviderClassificationError extends Error {
  readonly providerId: string;
  constructor(providerId: string) {
    super(`provider-id-not-in-taxonomy:${providerId}`);
    this.name = 'ProviderClassificationError';
    this.providerId = providerId;
  }
}

export function classifyProviderId(providerId: string): ProviderSourceClass {
  const sourceClass = PROVIDER_SOURCE_TAXONOMY.get(providerId);
  if (sourceClass === undefined) throw new ProviderClassificationError(providerId);
  return sourceClass;
}

export function isUpstreamCapableProviderId(providerId: string): boolean {
  return UPSTREAM_CAPABLE_PROVIDER_IDS.includes(providerId);
}

export {
  EXTERNAL_MARA_PROVIDER_ID,
  M2_ACTION_PROVIDER_ID,
  M2_POLICY_COMPILER_PROVIDER_ID,
  M2_POLICY_EXECUTOR_PROVIDER_ID,
};
