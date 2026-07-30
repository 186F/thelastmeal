import { z } from 'zod';
import { SCENARIO_IDS } from '../../shared/ids';
import type { AuditFinding } from './findings';

/**
 * VS001 known-gap registry (M2 brief §27.7, per the Advisor's R4 ruling).
 *
 * The auditor must not turn CI permanently red by rediscovering limitations
 * Milestone 1 already documented. Every expected finding is registered here
 * with exact match criteria. Classification (§27.7):
 *
 *   Known finding matching the registry exactly → known limitation, no fail.
 *   New unregistered gap                        → fail.
 *   Known gap that changed shape or scope      → no exact match → fail.
 *   New M2 mechanic lacking coverage           → fail.
 *
 * Coverage guarantee (Phase 2 audit, blocking finding 2): every entry
 * declares at least one CI-exercisable coverage source that must reproduce
 * its exact finding on every audit run. A registered gap that stops being
 * observed — because a detector regressed, a scenario path moved, or a
 * fixture disappeared — FAILS CI: a gap that silently vanishes is itself a
 * shape change. New registry entries require explicit Advisor approval after
 * independent review of the detector's semantics; a detector's own first
 * report is never sufficient grounds for registration.
 *
 * Registered gaps are never silently repaired in Milestone 2: their planned
 * resolution is Vertical Slice 002 (brief §7.3).
 */

export const KNOWN_GAP_REGISTRY_VERSION = 'vs001-known-gaps-1.0.0';

/**
 * Where a registered gap's finding is deterministically reproduced:
 *
 *  - `static-contract`: emitted by `auditStaticContracts()` from the declared
 *    contracts alone, on every run.
 *  - `deterministic-scenario`: emitted by the fresh keyless run of the named
 *    frozen scenario.
 *  - `committed-synthetic-fixture`: emitted by auditing a committed synthetic
 *    event-stream fixture through the real `auditEventStream` code.
 *  - `retained-live-evidence-fixture`: reproducible only from retained live
 *    evidence outside the Git tree — legal for documentation, but it cannot
 *    satisfy the CI coverage guarantee on its own.
 */
export const coverageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static-contract') }).strict(),
  z
    .object({ kind: z.literal('deterministic-scenario'), scenarioId: z.enum(SCENARIO_IDS) })
    .strict(),
  z
    .object({ kind: z.literal('committed-synthetic-fixture'), fixturePath: z.string().min(1) })
    .strict(),
  z
    .object({ kind: z.literal('retained-live-evidence-fixture'), description: z.string().min(1) })
    .strict(),
]);
export type CoverageSource = z.infer<typeof coverageSourceSchema>;

const CI_EXERCISABLE_KINDS = new Set([
  'static-contract',
  'deterministic-scenario',
  'committed-synthetic-fixture',
]);

export const knownGapSchema = z
  .object({
    knownGapId: z.string().regex(/^KG-[A-Z0-9-]{3,64}$/),
    affectedScenarios: z.union([z.literal('any'), z.array(z.enum(SCENARIO_IDS)).min(1)]),
    affectedMechanic: z.string().min(1),
    expectedFinding: z
      .object({
        checkId: z.string().min(1),
        key: z.record(z.string(), z.string()),
      })
      .strict(),
    coverage: z
      .array(coverageSourceSchema)
      .min(1)
      .superRefine((coverage, ctx) => {
        if (!coverage.some((source) => CI_EXERCISABLE_KINDS.has(source.kind))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'known-gap-needs-ci-exercisable-coverage-source',
          });
        }
      }),
    sourceMilestone: z.string().min(1),
    exactMatchCriteria: z.string().min(1),
    plannedResolution: z.string().min(1),
  })
  .strict();

export type KnownGap = z.infer<typeof knownGapSchema>;

export const KNOWN_GAPS: readonly KnownGap[] = [
  {
    knownGapId: 'KG-VS001-TREAT-SUSTAINED-INTERRUPTION',
    affectedScenarios: 'any',
    affectedMechanic: 'treatment movement semantics',
    expectedFinding: {
      checkId: 'non-interruptible-mode-has-world-interruption',
      key: { mode: 'treat', classes: 'patient-absent' },
    },
    coverage: [{ kind: 'static-contract' }],
    sourceMilestone:
      'Milestone 1 (VS002 findings, finding-3 family; observed live in the v1.2.0 Run 5 ' +
      'ledger: treat advertised interruptible:false, terminated sustained-check-failed:patient-absent)',
    exactMatchCriteria:
      'checkId and key must match exactly; any additional termination class on treat is unregistered',
    plannedResolution:
      'Vertical Slice 002 — Social Causality and Counterparty Agency (treatment-interruption semantics)',
  },
  {
    knownGapId: 'KG-VS001-EAT-SUSTAINED-INTERRUPTION',
    affectedScenarios: 'any',
    affectedMechanic: 'meal persistence versus non-interruptible eating',
    expectedFinding: {
      checkId: 'non-interruptible-mode-has-world-interruption',
      key: { mode: 'eat', classes: 'meal-missing' },
    },
    coverage: [{ kind: 'static-contract' }],
    sourceMilestone: 'Milestone 1 (VS002 finding 3 family; scenario E removes the meal by script)',
    exactMatchCriteria: 'checkId and key must match exactly',
    plannedResolution: 'Vertical Slice 002 (interruption-contract semantics)',
  },
  {
    knownGapId: 'KG-VS001-EAT-VIOLATION-SUSTAINED-INTERRUPTION',
    affectedScenarios: 'any',
    affectedMechanic: 'meal persistence versus non-interruptible violating grab',
    expectedFinding: {
      checkId: 'non-interruptible-mode-has-world-interruption',
      key: { mode: 'eat-violation', classes: 'meal-missing' },
    },
    coverage: [{ kind: 'static-contract' }],
    sourceMilestone:
      'Milestone 1 (VS002 finding 3: the v1.1.0 live Run 2 eat-violation was advertised ' +
      '"non-interruptible once started" and terminated sustained-check-failed:meal-missing)',
    exactMatchCriteria: 'checkId and key must match exactly',
    plannedResolution: 'Vertical Slice 002 (interruption-contract semantics)',
  },
  {
    knownGapId: 'KG-VS001-RENEGOTIATION-RESPONSE-WINDOW',
    affectedScenarios: ['C'],
    affectedMechanic: 'renegotiation proposal-response availability',
    expectedFinding: {
      checkId: 'renegotiation-proposal-without-response-opportunity',
      key: { commitmentKind: 'relieve-at-bench' },
    },
    coverage: [
      {
        kind: 'committed-synthetic-fixture',
        // Named `...-window-events` (no dot after `window`): the architecture
        // purity scan greps pure-core sources for platform tokens like
        // `window.` and would otherwise flag this path literal.
        fixturePath: 'scripts/audit/fixtures/kg-vs001-renegotiation-response-window-events.json',
      },
      {
        kind: 'retained-live-evidence-fixture',
        description:
          'v1.2.0 Run 5 ledger (thelastmeal-live-acceptance-002/run-05-C-live, outside Git): ' +
          'the live occurrence that motivated registration',
      },
    ],
    sourceMilestone:
      'Milestone 1 (v1.2.0 live Run 5: CommitmentRenegotiationProposed fired and no ' +
      'accept/reject-renegotiation mode appeared in any of the responder’s offered sets ' +
      'while the proposal was pending; conditional on the responder’s activity state)',
    exactMatchCriteria:
      'checkId, scenario C, and commitmentKind must match exactly; the same finding in any ' +
      'other scenario is unregistered',
    plannedResolution: 'Vertical Slice 002 (renegotiation response affordances)',
  },
];

// Registry entries must satisfy their own schema at module load.
for (const gap of KNOWN_GAPS) knownGapSchema.parse(gap);

/** Exact-match classification per §27.7. */
export function matchKnownGap(finding: AuditFinding): KnownGap | null {
  for (const gap of KNOWN_GAPS) {
    if (gap.expectedFinding.checkId !== finding.checkId) continue;
    if (gap.affectedScenarios !== 'any') {
      if (finding.scenarioId === 'static') continue;
      if (!(gap.affectedScenarios as readonly string[]).includes(finding.scenarioId)) continue;
    }
    const expectedKey = gap.expectedFinding.key;
    const findingKeys = Object.keys(finding.key);
    const expectedKeys = Object.keys(expectedKey);
    if (findingKeys.length !== expectedKeys.length) continue;
    let equal = true;
    for (const key of expectedKeys) {
      if (finding.key[key] !== expectedKey[key]) {
        equal = false;
        break;
      }
    }
    if (equal) return gap;
  }
  return null;
}
