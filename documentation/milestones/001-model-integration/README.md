# Milestone 1 — model integration

**Objective.** Connect one character (Mara) to a real language model through
a local gateway under full evidence discipline: a per-decision condition in
which the model chooses each action from the engine's offered menu, with
treatment fidelity verified, every run strict-finalized and exactly
replayable, and pre-registered thresholds evaluated against sealed
artifacts.

**Final status.** COMPLETE — **PASSED**. The six-run formal live sequence
was executed 2026-07-29 → 2026-07-30 under experiment v1.2.0 at frozen SHA
`38026cc986f59e8526053417666c921826dd34e9`; every pre-registered threshold
was met. An earlier sequence (experiment v1.1.0) was aborted after Run 2 on
a valid but threshold-failing artifact and is preserved as non-acceptance
evidence. Acceptance tag: `model-integration-milestone-001-accepted`.

**Package / experiment versions.** Package 1.3.0 (implementation) through
1.6.2 (accepted state). Experiment `model-backed-npc-001` v1.0.0 →
v1.2.0 (v1.1.0 was the aborted treatment; v1.2.0 the accepted one).
Prompt `mara-action-selection-1.0.0` (immutable since).

**Relevant PRs and merge SHAs.**

| PR  | Merge     | What it landed                                                        |
| --- | --------- | --------------------------------------------------------------------- |
| #2  | closed    | Implementation brief (content on `main` via the implementation commit) |
| #3  | closed    | Re-audit remediation brief (content on `main` identically)             |
| #4  | closed    | Artifact-integrity/CI/rehearsal brief (content on `main` identically)  |
| #5  | `ea89bc3` | Artifact integrity, CI verification, keyless rehearsal (1.5.0)         |
| #6  | `8620eba` | Pinned OpenRouter model integration (1.6.0)                            |
| #7  | `6a1ea5c` | Artifact event-semantics remediation brief                             |
| #8  | `219079b` | Finalized-trace event provenance correction (1.6.1, schema v3)         |
| #9  | `38026cc` | Experiment v1.2.0 treatment change (1.6.2) — the frozen acceptance SHA |
| #11 | `63a5243` | Milestone close-out: acceptance sequence folded into the report        |

**Authoritative documents.** The
[live acceptance report](acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)
is the final record of the milestone. The
[technical reference](../../reference/TECHNICAL_REFERENCE.md) carries the
still-current model-evidence contract.

**Chronological reading order.**

1. [Implementation brief](briefs/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_BRIEF.md) →
   [implementation report](reports/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md) (1.3.0)
2. [Re-audit remediation brief](briefs/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_BRIEF.md) →
   [re-audit remediation report](reports/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_REPORT.md)
3. [Artifact integrity, CI, and rehearsal brief](briefs/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md) →
   [implementation report](reports/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md) (1.5.0)
4. [OpenRouter integration report](reports/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md) (1.6.0)
5. [Event-semantics remediation brief](briefs/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_REMEDIATION_BRIEF.md) →
   [implementation report](reports/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md) (1.6.1)
6. [Live acceptance report](acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md) — **final**

**Superseded documents.** None deleted. The briefs are COMPLETED
specifications of work that has since shipped; earlier reports remain
accurate for their scope. Where a status statement inside any of them
disagrees with the [documentation index](../../README.md), the index is
current.

**Next milestone.** [Milestone 2 — sparse cognition](../002-sparse-cognition/README.md).
