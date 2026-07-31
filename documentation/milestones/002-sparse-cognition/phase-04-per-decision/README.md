# Milestone 2 Phase 4 — per-decision comparator

**Status: IMPLEMENTED — under Advisor audit.** The Phase 4 implementation
(package 1.9.0) is complete and exercised keylessly; it awaits the
Advisor's audit and merge. **No live model call has been made.** Stage A
and the calibration study execute only after the implementation PR is
audited, merged, and green on merged-`main` CI.

**Scope delivered** (implementation brief §31, scope ruling §14):

1. The M2 action condition and prompt: `mara-model-per-decision-m2-v1` /
   `openrouter-mara-action-m2-v1` / `mara-action-selection-m2-1.0.0` under
   the revised diagnostic-output contract (§17.5 — rationale and
   self-reported confidence are normalized diagnostics, never structural
   gates).
2. The registered formal attempt profile (`m2-formal-attempt-profile`
   v1.0.0, §23.1–§23.2/§24.2 values) and both registered study templates —
   `m2-stage-a-acceptance-001` and `m2-calibration-variance-a-001`
   (§22.6) — with the `m2:register` ritual that pins them to one exact
   repository SHA immediately before execution (§21.2).
3. Bounded/chunked Playwright tracing with evidence-size forecasting and
   the explicit retain-all-chunks policy, validated keylessly before any
   1× live run (Phase 3 final targeted audit §7).
4. Prepared (NOT executed) Stage A and calibration plans.

**Documents.**

- [Implementation report](MILESTONE_002_PHASE4_PER_DECISION_REPORT.md)

**Controlling documents.** The
[Milestone 2 brief](../MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md)
and [scope ruling](../MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) (the
ruling governs on ambiguity).
