# Documentation index

This index is the single authoritative source for **mutable project
status**. Briefs, reports, and audits describe only the state they governed
at the time they were written; when a status statement here disagrees with
one inside a historical document, this index is current and the document is
historical.

## 1. Start here

| Document                                                                                                    | Status        | What it is                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| [Vertical Slice 001 coding brief](reference/VERTICAL_SLICE_001_CODING_BRIEF.md)                             | AUTHORITATIVE | The frozen specification of the simulation, scenarios, and experiment identity   |
| [Technical reference](reference/TECHNICAL_REFERENCE.md)                                                     | ACTIVE        | The living engineering contract: determinism rules, decision lifecycle, evidence |
| [Milestone 2 implementation brief](milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) | AUTHORITATIVE | The governing specification for current Milestone 2 work                         |
| [Milestone 2 scope ruling](milestones/002-sparse-cognition/MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md)    | AUTHORITATIVE | Amendments and rulings; **governs on any ambiguity with the brief**              |
| [Operator runbook](operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md)                                     | ACTIVE        | How to launch, supervise, resume, and recover unattended experiment sequences    |

## 2. Current project state

| Field                    | Value                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package version          | 1.9.0                                                                                                                                                        |
| Frozen scenario data     | `vs001-1.0.0` (never changes)                                                                                                                                |
| Current milestone        | Milestone 2 — sparse cognition (`sparse-cognition-policy-001` v1.0.0)                                                                                        |
| Last completed phase     | Phase 3 — unattended orchestrator (PR #13, merged 2026-07-31 at pinned head `cd50a96`, merge `eaa2393`, merged-`main` CI green)                              |
| Current phase            | Phase 4 — per-decision comparator: **implemented, under Advisor audit** ([status](milestones/002-sparse-cognition/phase-04-per-decision/README.md))          |
| Next authorized work     | Advisor audit of the Phase 4 PR; Stage A and the calibration study execute only after audit, merge, and green merged-`main` CI                               |
| Live model calls to date | Milestone 1 acceptance only; **no Milestone 2 live calls have been made** — evidentiary/live execution additionally requires the `m2:register` pinning ritual |
| Controlling documents    | Milestone 2 brief + scope ruling (see Start here)                                                                                                            |

## 3. Document-status legend

| Status                                | Meaning                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AUTHORITATIVE`                       | Governs current work; conflicts resolve in its favor                                     |
| `ACTIVE`                              | Maintained to describe the present; updated as the project moves                         |
| `COMPLETED`                           | Final record of finished work; accurate for its scope, no longer updated                 |
| `HISTORICAL`                          | Record of an earlier era of the project, preserved unchanged                             |
| `SUPERSEDED — RETAINED FOR PROVENANCE` | A later document replaced it (e.g. a re-audit); kept because the progression is evidence |

## 4. Milestone chronology

1. **Vertical Slice 001 remediation** ([history](history/vertical-slice-001-remediation/)) — the
   pre-model-integration audit and remediation round that hardened the
   deterministic simulation (releases through 1.2.0). HISTORICAL.
2. **Milestone 1 — model integration** ([index](milestones/001-model-integration/README.md)) —
   implementation (1.3.0) → artifact integrity and CI rehearsal (1.5.0) →
   OpenRouter migration (1.6.0) → event-semantics correction (1.6.1) →
   experiment v1.2.0 treatment change (1.6.2) → **live acceptance: PASSED**
   (six-run formal sequence, 2026-07-29 → 30, frozen SHA `38026cc`). COMPLETED.
3. **Milestone 2 — sparse cognition** ([index](milestones/002-sparse-cognition/README.md)) —
   brief and scope ruling (PR #10) → Phase 2 laboratory foundation (1.7.0,
   PR #12) → Phase 3 unattended orchestrator (1.8.0, PR #13) → Phase 4
   per-decision comparator (1.9.0, implemented — under Advisor audit).
   IN PROGRESS.

## 5. Audit reading order

Audit sequences are preserved in full — what was found, what was claimed
fixed, and which claims survived re-audit are part of the project's
governance evidence. The **final** document of each sequence states the
accepted outcome; earlier ones are SUPERSEDED — RETAINED FOR PROVENANCE.

| Sequence                     | Reading order (final in bold)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone 2 Phase 2 audits   | [audit](milestones/002-sparse-cognition/phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_AUDIT.md) → [re-audit](milestones/002-sparse-cognition/phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_REAUDIT.md) → [**targeted re-audit**](milestones/002-sparse-cognition/phase-02-laboratory/audits/MILESTONE_002_PHASE2_LABORATORY_TARGETED_REAUDIT.md)                                                                                                                           |
| Milestone 2 Phase 3 audits   | [audit](milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md) → [re-audit](milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_REAUDIT.md) → [focused re-audit](milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FOCUSED_REAUDIT.md) → [**final targeted audit**](milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FINAL_TARGETED_AUDIT.md) |
| Milestone 1 remediation arc  | See the [Milestone 1 index](milestones/001-model-integration/README.md) for the brief → report chronology; the [**live acceptance report**](milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md) is the final record                                                                                                                                                                                                                                |
| Vertical Slice 001 remediation | [brief](history/vertical-slice-001-remediation/THE_LAST_MEAL_AUDIT_REMEDIATION_BRIEF.md) → [report](history/vertical-slice-001-remediation/AUDIT_REMEDIATION_REPORT.md) → [re-audit notes](history/vertical-slice-001-remediation/REAUDIT_REMEDIATION_NOTES.md) → [**re-audit report**](history/vertical-slice-001-remediation/REMEDIATION_REAUDIT_REPORT.md)                                                                                                                                        |

## Directory layout

| Directory     | Contents                                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| `reference/`  | The frozen specification and the living technical reference                           |
| `operations/` | Operator instructions for running experiments                                         |
| `milestones/` | One directory per milestone: briefs, reports, audits, acceptance records, and an index |
| `history/`    | Completed historical record — organized, preserved, never rewritten                   |
