# Milestone 2 Phase 4 — per-decision comparator

**Status: NOT STARTED.** Phase 4 was unlocked by the Phase 3 merge and
green merged-`main` CI (2026-07-31), but formal Phase 4 work is gated on
explicit authorization from the Project Advisor. This directory is a
navigation placeholder; Phase 4 documents will be added here when the phase
begins.

**Scope** (implementation brief §31, restated by the scope ruling §14):

1. Implement the new M2 action prompt and condition.
2. Run **Stage A** of the §19.16 staged unattended acceptance (the
   deterministic-baseline and per-decision runs).
3. Execute the §22.6 variance calibration study
   (`m2-calibration-variance-a-001`).

**Standing gates before any live execution** (Phase 3 final targeted audit
§7):

- Register the formal attempt profile together with its registered study —
  until then, every evidentiary or live plan is refused at parse time
  (`formal-attempt-profile-required`).
- Implement and validate bounded or chunked Playwright tracing, with
  evidence-size forecasting and explicit retention behavior, before the
  first 1× live Stage A run.

**Controlling documents.** The
[Milestone 2 brief](../MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md)
and [scope ruling](../MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) (the
ruling governs on ambiguity).
