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
| [Milestone 3 index](milestones/003-parallel-causal-life-laboratory/README.md)                              | ACTIVE        | Current Milestone 3 status, authorization boundary, and reading order             |
| [Milestone 3 research charter](milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md) | AUTHORITATIVE | Current research direction, claim boundaries, sequencing, and governance only    |
| [Milestone 3 Work Package 2 index](milestones/003-parallel-causal-life-laboratory/work-packages/002-minimum-parallel-run-laboratory/README.md) | ACTIVE | Status, boundary, and reading order for the distinct main specification and conformance document, each at version `1.0.0` |
| [Work Package 2 main specification](milestones/003-parallel-causal-life-laboratory/work-packages/002-minimum-parallel-run-laboratory/WORK_PACKAGE_002_MINIMUM_PARALLEL_RUN_LABORATORY_SPECIFICATION.md) | ESTABLISHED | Main-specification identity, version `1.0.0`; normative technical, evidence, acceptance, and handoff contract |
| [Work Package 2 conformance document](milestones/003-parallel-causal-life-laboratory/work-packages/002-minimum-parallel-run-laboratory/WORK_PACKAGE_002_CONFORMANCE_REQUIREMENTS.md) | ESTABLISHED | Conformance-document identity, version `1.0.0`; mapping, suite, evidence, and acceptance contract |
| [Milestone 2 implementation brief](milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) | HISTORICAL | The specification that governed Milestone 2 (closed; preserved unchanged)        |
| [Milestone 2 scope ruling](milestones/002-sparse-cognition/MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md)    | HISTORICAL    | Amendments and rulings that governed on any ambiguity with the brief (preserved) |
| [Milestone 2 closeout report](milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md)             | COMPLETED     | The final Milestone 2 record: disposition, findings, and claim boundary          |
| [Milestone 2 canonical calibration analysis](milestones/002-sparse-cognition/calibration/m2-calibration-variance-a-001.analysis.md) | COMPLETED | The registered calibration result preserved as historical evidence               |
| [Milestone 2 operator runbook](operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md)                         | HISTORICAL    | The run procedure that governed completed Milestone 2 sequences                   |

## 2. Current project state

| Field                    | Value                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package version          | 1.9.0                                                                                                                                                        |
| Frozen scenario data     | `vs001-1.0.0` (never changes)                                                                                                                                |
| Current milestone        | Milestone 3 — Parallel Causal Life Laboratory                                                                                                               |
| Established documentation | The Work Package 2 main specification and distinct conformance document each carry version `1.0.0`, conditioned on the unchanged exact head passing full CI and receiving final Advisor clearance. This establishes documentation only; no implementation, experiment, model call, evidence generation, or Work Package 3 activity is authorized. |
| Documentation gate       | Full CI on the exact documentation head precedes final Advisor review for that same head; neither step authorizes implementation or any later work package |
| Live model calls to date | Milestone 1 acceptance; Milestone 2 Stage A (47 calls, 2026-08-01) and the ten-run calibration (473 emitted / 472 accepted, 2026-08-02), all registered, sealed, and analyzed — no other live calls                                                                       |
| Controlling documents    | The Milestone 3 charter controls research direction and claim boundaries; the distinct Work Package 2 main specification and conformance document each carry version `1.0.0` under their exact-head acceptance condition; the Vertical Slice 001 coding brief and technical reference continue to govern the current implementation |

## 3. Document-status legend

| Status                                | Meaning                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AUTHORITATIVE`                       | Governs current work; conflicts resolve in its favor                                     |
| `ACTIVE`                              | Maintained to describe the present; updated as the project moves                         |
| `ESTABLISHED`                         | Versioned specification content, valid only under any exact-head acceptance condition it states |
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
   per-decision comparator (1.9.0, PR #15 merged at `8282dfe`; PR #16
   evidence-instrumentation revision merged at `cadcca7`) → Stage A
   acceptance passed (2026-08-01) → registered ten-run calibration
   completed (2026-08-02) → **CLOSED AFTER CALIBRATION** without the
   policy-patch comparison; no sparse-cognition acceptance claim
   ([closeout report](milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md)).
4. **Milestone 3 — Parallel Causal Life Laboratory**
   ([index](milestones/003-parallel-causal-life-laboratory/README.md)) — Item 2
   established the
   [research charter](milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md),
   including the research objective, candidate allocation space, causal method,
   measurement taxonomy, work-package sequence, claim boundaries, and
   governance. Work Package 2 then established the distinct
   [main-specification and conformance contracts](milestones/003-parallel-causal-life-laboratory/work-packages/002-minimum-parallel-run-laboratory/README.md),
   each carrying version `1.0.0`,
   valid only for the unchanged exact head after full CI and final Advisor
   clearance. No implementation, experiment, model call, evidence generation,
   or Work Package 3 activity is authorized.

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
