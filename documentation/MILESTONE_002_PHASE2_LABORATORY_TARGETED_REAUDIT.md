# Milestone 002 — Phase 2 Laboratory Foundation Targeted Re-Audit

**Date:** July 30, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#12 — Milestone 2 Phase 2: laboratory foundation (1.7.0)`  
**Targeted-verification implementation head:** `f63f120db87a5aec741e1dba94048e8b493acce5`  
**Base:** `b2b4d045016c0991a6aede33e002fd034503cec1`  
**Prior audit:** [`MILESTONE_002_PHASE2_LABORATORY_AUDIT.md`](MILESTONE_002_PHASE2_LABORATORY_AUDIT.md)  
**Prior re-audit:** [`MILESTONE_002_PHASE2_LABORATORY_REAUDIT.md`](MILESTONE_002_PHASE2_LABORATORY_REAUDIT.md)  
**Status:** **REQUEST CHANGES — ONE FOCUSED EVIDENCE-INTEGRITY BLOCKER REMAINS**  
**Scope:** Targeted verification only. No live model calls and no broad architectural re-audit are required.

---

# 1. Executive verdict

PR #12 is now very close to merge-ready.

The coding agent correctly completed the first two audits’ difficult architectural remediations. The exact implementation head is green under the complete clean-checkout workflow, and the following version-1 contracts are accepted:

- the central Milestone 2 identity vocabulary;
- explicit provider-source classification;
- separation of engine requests from upstream calls;
- local policy-executor classification;
- movement-inclusive behavioral active time;
- provider-plan versus registered-condition provenance;
- strict study pacing and execution-setting freezes;
- known-gap coverage enforcement;
- the four-entry VS001 known-gap registry;
- the Scenario D no-new-gap ruling;
- strict-finalized run-directory enrichment in principle;
- reviewer-package and score-document schemas;
- the `liveSmoke.ts` shutdown repair;
- all previously accepted evaluator arithmetic and similarity formulas.

One narrow evidence-integrity gap remains in the strict-finalized run-directory loader:

> The loader validates trace rows individually and validates aggregate attempted/completed counts, but it does not yet prove a one-to-one identity join between every finalized-trace row and every external `DecisionRequested` event in the canonical ledger.

This should be corrected before the Phase 2 version-1 evidence contract becomes authoritative.

Do not begin Phase 3 until PR #12 merges after this focused correction.

---

# 2. Verification performed

## 2.1 Pull-request and CI state

At the targeted-verification head:

```text
PR: #12
Head: f63f120db87a5aec741e1dba94048e8b493acce5
Package: 1.7.0
```

GitHub Actions run `30577140977` completed successfully. The required clean-checkout job passed:

- application typecheck;
- gateway typecheck;
- lint and formatting;
- frozen-data validation;
- full unit and integration suite;
- gateway suite;
- formal model-bundle suite;
- application and gateway production builds;
- distribution secret scan;
- Playwright browser tests;
- 100-runs-per-scenario deterministic batch;
- keyless formal model-run rehearsal;
- affordance and interruption-contract audit.

The exact-head CI totals are:

```text
61 Vitest files
571 Vitest tests
55 gateway tests
127 model-bundle tests
```

All fourteen deterministic golden hashes remain unchanged.

## 2.2 Targeted scope

This verification examined only the three remaining version-1 contract gaps named in the prior re-audit:

1. the missing M2 per-decision provider identity and taxonomy entry;
2. strict-finalized run-directory evidence enrichment;
3. study pacing and execution-setting freezes.

The movement metric, similarity arithmetic, known-gap architecture, Scenario D ruling, smoke shutdown repair, and frozen-baseline preservation were already accepted and were not reopened.

---

# 3. Confirmed remediations

## 3.1 Central M2 identity module and provider taxonomy — resolved

The repository now defines the complete Milestone 2 identity vocabulary in:

```text
src/shared/m2Experiment.ts
```

It includes:

```text
M2_EXPERIMENT_ID
M2_EXPERIMENT_VERSION
M2_PER_DECISION_CONDITION_ID
M2_POLICY_PATCH_CONDITION_ID
M2_ACTION_PROVIDER_ID
M2_POLICY_COMPILER_PROVIDER_ID
M2_POLICY_EXECUTOR_PROVIDER_ID
M2_ACTION_PROMPT_VERSION
M2_POLICY_PROMPT_VERSION
```

The provider taxonomy now correctly classifies:

```text
openrouter-mara-action-v1             external-action-request (legacy M1)
openrouter-mara-action-m2-v1          external-action-request
openrouter-mara-policy-compiler-v1    external-policy-compilation
mara-policy-patch-executor-v1         local-policy-executor
deterministic-utility-v1              deterministic-utility
```

The upstream-capable set is exactly:

```text
openrouter-mara-action-v1
openrouter-mara-action-m2-v1
openrouter-mara-policy-compiler-v1
```

The policy executor remains local, and unknown provider IDs still fail with the typed classification error.

**Ruling:** resolved. Preserve this implementation.

## 3.2 Study pacing and execution-setting freeze — resolved

The study declaration now carries an `executionSettings` object. For a live study, the schema requires execution settings and binds them into the study-local configuration fingerprint.

The current contract correctly enforces:

```text
speed > 0 and integer
live studies must declare executionSettings
speed = 1 for ordinary live evidence
non-1× live pacing requires a registered pacing-comparability authorization
changes to speed or other declared runtime settings move the config fingerprint
non-live studies do not have to invent irrelevant model settings
```

The canonical R2 calibration declaration with `speed: 1` validates, and pacing changes are covered by regression tests.

**Ruling:** resolved. Preserve this implementation.

## 3.3 Strict-finalized run-directory evidence layer — architecture resolved

The repository now distinguishes two evidence grades:

```text
bare-ledger
strict-finalized-run
```

For a bare ledger, the evaluator correctly leaves these fields unavailable:

```text
registeredConditionId
upstreamActionCallsAttempted
upstreamActionCallsCompleted
upstreamPolicyCompilationCallsAttempted
upstreamPolicyCompilationCallsCompleted
```

For a strict-finalized run directory, the evidence loader now:

- verifies bundle-manifest whole-directory coverage;
- recomputes per-file hashes and the aggregate hash;
- rejects missing or extra files;
- requires `status: completed` and no failed criteria;
- validates `run-manifest.final.json`;
- validates `finalized-trace.jsonl`;
- checks scenario, seed, world hash, ledger hash, provider-plan identity, condition identity, and external-provider identity;
- derives attempted and completed upstream action-call counts from gateway evidence;
- enriches fingerprints with the manifest-proven condition and per-NPC call counts;
- rejects degraded, incomplete, tampered, or contradictory directories rather than silently downgrading them to bare-ledger evidence.

The resulting evidence model can express the Milestone 1 gateway-stop distinction:

```text
external requests emitted: 75
upstream calls attempted:   10
upstream calls completed:   10
```

This is the correct architecture. The remaining finding concerns one missing identity-level join inside that architecture.

---

# 4. Remaining blocker — finalized trace is not joined exactly to ledger requests

**Severity:** High  
**Affected areas:** evidence completeness, per-NPC upstream metrics, condition studies, call-reduction analysis

## 4.1 Governing evidence contract

The finalized trace is defined as:

```text
one finalized row per external requestId
```

A strict-finalized directory should therefore prove an exact one-to-one relationship between:

```text
canonical external DecisionRequested events
and
finalized-trace rows
```

Aggregate equality alone is insufficient.

## 4.2 Current validation

The loader currently verifies that every trace row agrees with the manifest on:

```text
runId
conditionId
providerId
scenarioId
```

It also recomputes aggregate:

```text
upstreamCallsAttempted
callsCompleted
```

and compares those aggregates with the final manifest.

However, it does not yet prove that the finalized trace contains exactly one row for every canonical external request.

The loader does not currently reject all of the following:

- a missing trace row whose `gatewayOutcome` was `null`;
- a duplicated request ID;
- an extra trace row naming no canonical request;
- a substituted request ID;
- a trace row assigned to the wrong NPC;
- a trace row with the wrong provider for its specific request;
- a trace row with a requested logical tick that differs from the canonical request event.

## 4.3 Why aggregate checks do not close the gap

Consider the gateway-stop shape:

```text
75 canonical external requests
10 attempted upstream calls
65 finalized rows with gatewayOutcome = null
```

If one of the 65 null-outcome rows is deleted and the directory is resealed:

```text
attempted remains 10
completed remains 10
```

The aggregate count checks still pass, even though the finalized trace no longer covers every engine request.

A second example affects per-NPC evidence. If one trace row is changed from:

```text
npcId: mara
```

to:

```text
npcId: jonas
```

then total attempted/completed counts remain unchanged, but the enriched per-NPC call counts become false.

The bundle hash proves the current files agree with the current bundle manifest. It does not prove that a deliberately modified and resealed artifact set remains semantically joined to the canonical ledger.

## 4.4 Required correction

Build a canonical external-request map from the validated ledger:

```text
requestId → {
  npcId,
  providerId,
  requestedAtLogicalTick
}
```

Then validate the finalized trace against it.

The following conditions must all hold:

```text
trace request-ID set exactly equals ledger external request-ID set
exactly one trace row exists per request ID
no unknown or extra trace request ID exists
no duplicate trace request ID exists
row.npcId equals the canonical request npcId
row.providerId equals the canonical request providerId
row.requestedAtLogicalTick equals the canonical DecisionRequested tick
```

Any violation must fail with a typed or clearly prefixed:

```text
run-evidence-conflict
```

Do not repair mismatches, choose the first duplicate, or downgrade the directory to bare-ledger evidence.

## 4.5 Required tests

Add reseal-style regression tests proving that each of the following is rejected:

1. Delete one `gatewayOutcome: null` finalized-trace row.
2. Duplicate an existing trace request ID.
3. Replace one row’s request ID with an unknown request ID.
4. Change one row’s `npcId` from Mara to Jonas.
5. Change one row’s provider ID.
6. Change one row’s `requestedAtLogicalTick`.
7. Substitute one canonical request ID for another while preserving aggregate attempted/completed counts.

The ordinary finalized-run and gateway-stop fixtures should continue to pass after the exact join is enforced.

No live model call is required.

---

# 5. Minor corrections

## 5.1 Exact-head test-file count

The implementation report and PR description currently say:

```text
62 Vitest files
571 tests
```

The exact-head CI log reports:

```text
61 Vitest files
571 tests
```

Update the tracked report and PR description to the exact CI figure.

## 5.2 Reviewer answer-key source provenance

For a strict-finalized run-directory input, the answer key currently stores the extracted ledger path as `sourcePath`.

That ledger path cannot independently reproduce the enriched condition and upstream-call evidence. The original finalized run directory is the proving source.

Use either:

```text
sourcePath = evidence.sourcePath
ledgerPath = evidence.ledgerPath
```

or retain only `sourcePath` but set it to the original run-directory input. Storing both is preferable because it distinguishes the proving evidence root from the canonical ledger inside it.

---

# 6. Merge gate

The coding agent should make one focused remediation commit that:

1. adds the exact trace-to-ledger request join;
2. adds all required mismatch and reseal-style tests;
3. corrects the test-file count;
4. corrects reviewer answer-key source provenance;
5. obtains green exact-head clean-checkout CI.

The required CI remains:

```text
application typecheck
gateway typecheck
lint
frozen-data validation
full unit/integration suite
gateway suite
formal model-bundle suite
application and gateway builds
dist secret scan
Playwright
100-run deterministic batch
keyless formal rehearsal
affordance/known-gap audit
```

After that focused correction is pushed and exact-head CI is green, **PR #12 is authorized to merge without another broad audit**. Only the trace-to-ledger identity join and the two minor documentation/provenance corrections require targeted confirmation.

Phase 3 remains blocked until PR #12 merges.