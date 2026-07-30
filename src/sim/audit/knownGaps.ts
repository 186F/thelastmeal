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
 * Registered gaps are never silently repaired in Milestone 2: their planned
 * resolution is Vertical Slice 002 (brief §7.3).
 */

export const KNOWN_GAP_REGISTRY_VERSION = 'vs001-known-gaps-1.0.0';

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
    sourceMilestone:
      'Milestone 1 (VS002 finding 3: the v1.1.0 live Run 2 eat-violation was advertised ' +
      '"non-interruptible once started" and terminated sustained-check-failed:meal-missing)',
    exactMatchCriteria: 'checkId and key must match exactly',
    plannedResolution: 'Vertical Slice 002 (interruption-contract semantics)',
  },
  {
    knownGapId: 'KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW',
    affectedScenarios: 'any',
    affectedMechanic: 'meal-transfer request lifecycle versus the violation temptation',
    expectedFinding: {
      checkId: 'dilemma-missing-lawful-exits',
      key: { dilemmaId: 'meal-scarcity-violation-choice', missingClasses: 'lawful-acquisition' },
    },
    sourceMilestone:
      'Milestone 2 Phase 2 auditor (first detection: deterministic scenario D, tick 90). ' +
      'While the actor’s own transfer request is pending (no-pending-own-request ' +
      'precondition) and during the post-refusal cooldown, request-transfer is withheld ' +
      'while eat-violation remains offered — the temptation stays on the table with no ' +
      'lawful-acquisition alternative in the same offer set',
    exactMatchCriteria:
      'checkId, dilemmaId, and the exact missing-class set (lawful-acquisition only) must ' +
      'match; an offer set missing the forgo class as well is unregistered',
    plannedResolution:
      'Vertical Slice 002 (dilemma coverage: suppress the violation offer during the ' +
      'pending/cooldown window, or represent the pending request as a lawful exit)',
  },
  {
    knownGapId: 'KG-VS001-RENEGOTIATION-RESPONSE-WINDOW',
    affectedScenarios: ['C'],
    affectedMechanic: 'renegotiation proposal-response availability',
    expectedFinding: {
      checkId: 'renegotiation-proposal-without-response-opportunity',
      key: { commitmentKind: 'relieve-at-bench' },
    },
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
