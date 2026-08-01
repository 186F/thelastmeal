# Milestone 2 — sparse cognition

**Objective.** Implement and evaluate the sparse-cognition decision
architecture: a model-compiled bounded declarative policy, applied by a
local deterministic interpreter, compared head-to-head against a matched
per-decision model condition — targeting at most 25% of the baseline's
upstream calls while preserving pre-registered behavioral similarity, with
exact replay and no loss of simulation authority.

**Status.** IN PROGRESS. Phases 1–3 are complete; the Phase 4
implementation (package 1.9.0) has its **final targeted remediation
complete and awaits the Advisor's targeted verification** (exact-floor
calibration entropy, exact registered-study analysis binding, mandatory
authenticated registration at formal launch, CI failure-path hygiene). No
Milestone 2 live model calls have been made; Stage A and the calibration
study execute only after the targeted verification, merge, and green
merged-`main` CI, and only from `m2:register`-pinned instances of the
reviewed study templates.

**Package / experiment versions.** Package 1.7.0 (Phase 2) → 1.8.0
(Phase 3) → 1.9.0 (Phase 4, current). Experiment
`sparse-cognition-policy-001` v1.0.0.
Target conditions `mara-model-per-decision-m2-v1` and
`mara-policy-patch-m2-v1`; the Milestone 1 prompt remains immutable.

**Relevant PRs and merge SHAs.**

| PR  | Merge     | What it landed                                                                                     |
| --- | --------- | --------------------------------------------------------------------------------------------------- |
| #10 | `b2b4d04` | Implementation brief + scope ruling (Phase 1)                                                       |
| #12 | `9cc1fac` | Phase 2 — laboratory foundation (1.7.0): fingerprints, similarity, study registry, reviewer packages |
| #13 | `eaa2393` | Phase 3 — unattended orchestrator (1.8.0), merged 2026-07-31 at pinned head `cd50a96`               |

**Authoritative documents.** The
[implementation brief](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md)
and the
[scope ruling and amendments](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md);
**the scope ruling governs on any ambiguity**.

**Chronological reading order.**

1. Brief and scope ruling (above) — Phase 1
2. [Phase 2 laboratory report](phase-02-laboratory/MILESTONE_002_PHASE2_LABORATORY_REPORT.md),
   with its audit sequence
   [audit](phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_AUDIT.md) →
   [re-audit](phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_REAUDIT.md) →
   [**targeted re-audit**](phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_TARGETED_REAUDIT.md) (final)
3. [Phase 3 orchestrator report](phase-03-orchestrator/MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md),
   with its audit sequence
   [audit](phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md) →
   [re-audit](phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_REAUDIT.md) →
   [focused re-audit](phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FOCUSED_REAUDIT.md) →
   [**final targeted audit**](phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FINAL_TARGETED_AUDIT.md) (final; authorized the merge)
4. [Phase 4 per-decision comparator report](phase-04-per-decision/MILESTONE_002_PHASE4_PER_DECISION_REPORT.md),
   its audit sequence
   [audit](phase-04-per-decision/audits/MILESTONE_002_PHASE4_PER_DECISION_AUDIT.md) →
   [final targeted remediation instructions](phase-04-per-decision/audits/MILESTONE_002_PHASE4_PER_DECISION_FINAL_TARGETED_REMEDIATION.md)
   (both remediated; targeted verification pending), and
   [status](phase-04-per-decision/README.md)

**Superseded documents.** Within each audit sequence, every document before
the final one is SUPERSEDED — RETAINED FOR PROVENANCE: the progression of
findings, remediations, and verifications is governance evidence and is
preserved unmodified.

**Next phase.** Phase 4 — the Milestone 2 per-decision comparator
([status and scope](phase-04-per-decision/README.md)), followed by the
sparse policy system (Phase 5) and the later gated phases through the
formal sequence.
