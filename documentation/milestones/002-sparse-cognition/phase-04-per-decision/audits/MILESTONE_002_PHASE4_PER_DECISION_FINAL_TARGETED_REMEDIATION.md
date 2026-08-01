# Milestone 2 Phase 4 — Final Targeted Remediation Instructions

**Date:** 2026-07-31  
**Repository:** `186F/thelastmeal`  
**Pull request:** #15 — Milestone 2 Phase 4: the M2 per-decision comparator (`1.9.0`)  
**PR head when this ruling was issued:** `f73b911cd418c63dd0dcf62a469490be5fc90040`  
**Status:** **FINAL FOCUSED REMEDIATION — DO NOT MERGE; DO NOT EXECUTE STAGE A**  
**Live model calls authorized:** **None**

## 1. Executive directive

The Phase 4 comparator architecture and the first audit remediation are substantially accepted. Do not redesign the M2 condition, prompt, gateway pairing, normalized diagnostic contract, finalization path, trace rotation, evidence forecasting, formal attempt profile, or frozen Milestone 1 / VS001 surfaces unless a correction below directly requires it.

One final focused remediation is required before PR #15 may merge. It has four goals:

1. Make the registered calibration arithmetic correct, honestly specified, and fast enough for routine use.
2. Bind the calibration analyzer to the exact registered ten-run study rather than to any completed model-backed sequence.
3. Make Git-authenticated registration and the still-valid Stage A prerequisite mandatory at formal launch, not merely available through the registration command.
4. Correct the CI behavior exposed by the failed remediation run so early failures do not upload large, unrelated partial evidence or create secondary artifact-upload failures.

No live API call is needed. The work must be exercised entirely with deterministic fixtures and the fake gateway.

## 2. Accepted work that must remain intact

The following areas are accepted and are not to be reopened absent a direct regression:

- `mara-model-per-decision-m2-v1` / `openrouter-mara-action-m2-v1` / `mara-action-selection-m2-1.0.0` under `sparse-cognition-policy-001` v1.0.0.
- The closed model-condition contract and one-gateway-process-per-condition pairing.
- M2 rationale and confidence as normalized diagnostics, never structural acceptance gates.
- The frozen Milestone 1 prompt, condition, artifacts, scenarios, mechanics, and all fourteen deterministic golden hashes.
- The formal attempt profile, call-budget arithmetic, treatment verification, replacement policy, and Stage A attempt shape.
- Chunked Playwright tracing, trace manifests, evidence forecasting, and retain-all formal-evidence policy.
- The closed registration registry, Git template authentication, pair matching, and transactional registration output architecture.
- The Stage A prerequisite concept and its current end-to-end archive / receipt / verdict verification.
- Routine compact CI artifacts, explicit full-evidence mode, retention periods, and the rule that formal live evidence is retained outside expiring Actions storage.
- No Phase 5 policy compiler, policy interpreter, novelty broker, or policy lifecycle state in this PR.

## 3. Remediation A — calibration entropy must be correct and performant

### 3.1 Problem

The current calibration analyzer advertises an exact milli-bit Shannon-entropy floor, but the implemented Q20 logarithm approximation can undercount by one.

Required regression case:

```text
counts: [1785, 2031]
true entropy × 1000: 997.000152150330…
required floor: 997 milli-bits
current implementation: 996 milli-bits
```

The same implementation is also expensive enough that the first clean-checkout remediation CI run timed out three tests in `calibration-analysis.test.ts`. A ten-run report construction took roughly three seconds; tests constructing two reports exceeded Vitest's default five-second limit.

Do not resolve this merely by increasing test timeouts.

### 3.2 Required implementation

Implement entropy arithmetic whose documented contract is true.

Preferred outcome:

```text
entropyMilliBits(counts)
= floor(1000 × ShannonEntropyBase2(counts))
```

with a deterministic, cross-platform proof that the returned integer is the correct floor.

A suitable design is interval refinement with exact integer / BigInt bounds:

1. Compute lower and upper rational bounds for each required logarithm.
2. Accumulate lower and upper bounds for the full entropy expression.
3. Refine only until both bounds fall within the same integer milli-bit bucket.
4. Cache repeated `(total, count)` logarithm results within an analysis.

Another implementation is acceptable only if it gives the same deterministic exact-floor guarantee and is demonstrably efficient. Do not rely on `Math.log2` for canonical evidence arithmetic.

Because no Phase 4 live data or registered calibration dataset exists and package `1.9.0` is not merged, a corrected exact implementation may retain:

```text
m2-calibration-variance-analysis-1.0.0
```

If the implementation instead adopts a bounded approximation, change the version literal and every binding before data collection, state the error and rounding contract precisely, and do not use the word `exact`.

### 3.3 Required tests

Add or retain tests for:

- `[1785, 2031] → 997` milli-bits.
- Exact closed forms: uniform powers of two, `(1/4, 1/4, 1/2)`, empty, one outcome, and zero-count exclusion.
- Irrational distributions such as `[1, 2]` and `[1, 9]`.
- A deterministic property sweep over representative count vectors against an independent higher-precision or exact-interval test reference.
- Repeated analysis of identical evidence producing byte-identical output.
- The full synthetic ten-run fixture producing all 45 pairs without increasing the global test timeout.

Performance acceptance:

- A ten-run synthetic report must complete comfortably within the ordinary five-second unit-test allowance.
- Two consecutive report constructions in the byte-identity test must also complete within that allowance.
- Do not hide a pathological production algorithm behind per-test timeout increases.

## 4. Remediation B — bind analysis to the exact registered calibration study

### 4.1 Problem

The production analyzer currently accepts a completed sequence with at least two completed, artifact-valid, study-valid model runs. That is insufficient. A report labeled as the Phase 4 calibration must prove it analyzed exactly the registered design:

```text
study: m2-calibration-variance-a-001
study version: 1.0.0
sequence: m2-calibration-variance-a
condition: mara-model-per-decision-m2-v1
scenario: A
seed: 1001
primary n: 10
profile: m2-formal-attempt-profile@1.0.0
analysis: m2-calibration-variance-analysis-1.0.0
model: google/gemini-2.5-flash-lite
serving provider: google-ai-studio
prompt: mara-action-selection-m2-1.0.0
```

The pure report builder may remain reusable for small deterministic unit fixtures, but the production `m2:analyze` entry point must enforce the registered study exactly.

### 4.2 Required pre-analysis verification

Before reading behavioral facts, `m2:analyze` must:

1. Verify the completed sequence as a whole using the existing seal, inventory, immutable-manifest, semantic-revalidation, archive, sidecar, and receipt machinery.
2. Load and validate:
   - `plan.archived.json`;
   - `study.archived.json`;
   - the archived study-freeze record;
   - registration provenance;
   - the Stage A prerequisite record bound to the calibration registration.
3. Require the exact identities listed above.
4. Require exactly ten planned calibration attempt IDs and exactly one valid primary observation for each planned attempt.
5. Treat a permitted successful replacement as the primary observation for its plan-level attempt, not as an eleventh observation.
6. Preserve failed and superseded executions as exclusions with typed reasons.
7. Refuse:
   - fewer or more than ten valid primaries;
   - a different condition, scenario, seed, profile, study, sequence, model, provider, prompt, package, experiment, metric, or analysis version;
   - duplicate primaries for one planned attempt;
   - an execution not present in the registered attempt set;
   - an unverified or semantically stale run directory.

### 4.3 Interpretable first-divergence context

The report currently exposes hashes and request IDs, but the registered output calls for the tick **and semantic context** of first divergence.

Add a bounded structural context record for each pair's first divergence, using only fields actually present in the validated archived request envelopes. Include, where available:

```text
logical tick
location and current activity
relevant need / injury state
relevant beliefs and memories
commitment and relationship state
engine-offered affordance descriptors
hard-dependency differences
left and right selected affordance
```

Requirements:

- Do not emit unbounded prompt text.
- Do not infer facts absent from the archived request.
- Make differences explicit rather than requiring the reader to interpret two opaque hashes.
- Continue to state that ordinal matching is invalid after the first selection or semantic-context divergence.
- Update the output schema and Markdown renderer together.

Because this output contract has not been used for live evidence, it may remain analysis version `1.0.0` if corrected before merge.

### 4.4 Required tests

Add production-entry-point refusals for:

- wrong study ID or version;
- wrong sequence ID;
- wrong condition;
- wrong scenario or seed;
- nine and eleven primary observations;
- two completed executions competing for one planned attempt;
- a replacement incorrectly counted in addition to its primary;
- wrong model, route, prompt, profile, metric, or analysis version;
- missing or tampered archived plan, study, provenance, prerequisite, archive, or receipt;
- semantic first-divergence context that differs in beliefs / memories, offered descriptors, and hard dependencies.

## 5. Remediation C — formal launch must require authenticated registration

### 5.1 Problem

The closed `m2:register` command now produces credible provenance, but the formal plan schema still permits an evidentiary or live plan to omit `registration`. The orchestrator fingerprints a registration block when present, but does not require it or reopen the external records it claims to hash.

A hand-authored plan can therefore bypass the registration ritual, and a registered calibration plan can remain launchable after its provenance, Stage A prerequisite, or underlying Stage A evidence is removed or altered.

The required invariant is:

```text
no authenticated registration
        → no formal launch

no still-valid Stage A evidence
        → no calibration launch
```

### 5.2 Required plan contract

For every evidentiary or live plan using the formal attempt profile:

- `registration` is mandatory.
- The registration ID must be a member of the closed registry.
- The registration ID, study ID, sequence ID, profile, and expected treatment must match the registry entry.
- The registered plan must identify resolvable records for:
  - `registration-provenance.json`;
  - `stage-a-prerequisite.json` when required.

Prefer paths relative to the registered plan file so moving the entire create-once registration directory does not break its internal references. Hashes remain mandatory.

### 5.3 Required orchestrator preflight

Before any write or process spawn, the orchestrator must:

1. Load and schema-validate registration provenance.
2. Recompute its SHA-256 and compare it with the plan binding.
3. Verify its registration ID, pinned HEAD, source paths, Git blob IDs, and committed-byte hashes.
4. Use `git show <pinned-sha>:<path>` or equivalent to prove both source templates are still the reviewed bytes at the pinned repository SHA.
5. Verify the registered study and plan derive from the correct closed-registry pair.
6. For calibration:
   - load and schema-validate the Stage A prerequisite record;
   - recompute and match its SHA-256;
   - locate the Stage A evidence root / manifest / archive recorded by the prerequisite;
   - rerun the complete Stage A verification, including archive, receipt, two required attempts, strict finalization, replay, treatment thresholds, secret-scan witness, and exact repository SHA;
   - rebuild the canonical prerequisite and require byte equality with the registered record.
7. Refuse if any external record or underlying evidence is absent, changed, stale, or no longer verifiable.

### 5.4 Freeze and evidence requirements

Archive the exact registration provenance and, where applicable, Stage A prerequisite record into the sequence evidence root before execution.

Add their exact byte hashes and parsed identities to the freeze identity. Recheck them at every existing freeze checkpoint through post-sequence packaging.

The final immutable sequence manifest must record at least:

```text
registration ID
registration provenance SHA-256
source template paths and Git blob IDs
Stage A prerequisite SHA-256 (when applicable)
Stage A sequence / archive identities (when applicable)
```

Completed-sequence verification and no-op resume must reconcile these fields against control state and archived evidence.

### 5.5 Required tests

Add no-write / no-spawn refusal tests for:

- evidentiary plan without registration;
- live formal plan without registration;
- unknown registration ID;
- missing or hash-mismatched provenance file;
- provenance naming a different source template or blob;
- committed template bytes differing from the recorded SHA-256;
- calibration plan without a prerequisite path or hash;
- missing, modified, or substituted prerequisite record;
- missing, modified, or substituted Stage A archive / receipt / manifest;
- Stage A evidence from a different repository SHA, study, sequence, profile, condition, model, provider, or prompt;
- mutation of provenance or prerequisite after sequence start causing a freeze violation;
- intact Stage A and calibration registrations passing keylessly in explicit drill mode.

The existing `--stage-a-drill` escape remains keyless test infrastructure only. It must be visibly recorded and structurally impossible to use for a real live calibration registration.

## 6. Remediation D — CI failure-path hygiene

### 6.1 What the failed run exposed

Clean-checkout run `30673338573` failed during unit tests because three calibration-analysis tests exceeded five seconds. The later rehearsal, batch, and model-rehearsal steps were skipped.

The workflow nevertheless:

- built and uploaded approximately 687 MB of `m2-rehearsal-full-evidence` from partial unit-test artifacts because `failure()` was true;
- then failed the `model-rehearsal-report` upload because that skipped step had produced no files.

The routine compact profile itself worked: approximately 54 KB before Actions compression and about 18 KB uploaded.

### 6.2 Required workflow correction

Keep full evidence on genuine rehearsal failures and explicit manual dispatch, but do not package arbitrary partial unit-test artifact trees merely because an earlier unrelated step failed.

Use explicit step IDs and outcomes. For example:

```text
full evidence upload when:
- workflow_dispatch requested it; or
- m2:rehearse actually ran and failed / completed with diagnostic evidence
```

Requirements:

- An early typecheck, lint, or unit-test failure must upload only compact available diagnostics, not hundreds of megabytes of test-generated evidence trees.
- The model-rehearsal report upload must run only when the model-rehearsal step actually produced its required files; absence after a skipped producer must not create a second unrelated failure.
- The same rule applies to batch and Playwright reports: upload when their producer ran or when the path exists, without hiding a missing artifact after a producer claimed success.
- Preserve `if-no-files-found: error` when a producing step succeeded and the promised artifact is absent.
- Make the full-budget documentation consistent: the workflow comment and the script currently disagree on 2 GiB versus 4 GiB. Choose one registered budget and use it everywhere.
- Routine PR / main success runs must continue uploading only the compact profile with explicit retention.

### 6.3 Required tests / evidence

The final exact-head CI evidence must demonstrate:

1. A successful routine run uploads compact proof only.
2. The compact artifact remains below 50 MiB.
3. A simulated early unit-test failure does not trigger the full-evidence preparation path.
4. A genuine `m2:rehearse` failure does trigger bounded full diagnostics.
5. A manual `workflow_dispatch` with full evidence enabled triggers the explicit full profile.
6. Skipped producer steps do not create secondary artifact-upload failures.

Unit tests over the artifact-selection script and static workflow assertions are acceptable for cases that cannot be induced in the required merge-gate run.

## 7. Documentation updates

Update the Phase 4 implementation report, runbook, technical reference, Phase 4 README, and root README only where needed to reflect the final implementation.

At minimum, document:

- the final entropy algorithm and its true rounding guarantee;
- the exact production calibration-analysis preconditions;
- the semantic-context fields included at first divergence;
- mandatory registration at formal launch;
- launch-time Stage A revalidation and freeze behavior;
- the corrected CI compact / full failure-path logic and one consistent full-evidence budget.

Do not rewrite the original Advisor audit. This remediation document and the implementation report should preserve the chronology.

## 8. Required validation before stopping

The coding agent must obtain a new exact-head clean-checkout CI run with all required steps green, including:

```text
typecheck (app and gateway)
lint and formatting
documentation links
frozen-data validation
all unit and integration tests
gateway tests
model-bundle tests
production builds and secret scan
Playwright tests
100-run deterministic batch
keyless model rehearsal
affordance audit
Phase 2/3/4 orchestrator suites
complete keyless unattended rehearsal
compact artifact within budget
all fourteen deterministic golden hashes unchanged
```

Additional required focused evidence:

- entropy regression `[1785, 2031] → 997`;
- synthetic ten-run calibration analysis, 45 pairs, no timeout increase workaround;
- exact-study binding refusals;
- semantic first-divergence context fixture;
- missing-registration refusal before writes or spawns;
- launch-time Stage A revalidation and tamper refusals;
- early-CI-failure artifact-profile assertions.

## 9. Stop condition and merge gate

After implementation and green exact-head CI:

1. Update the PR description with the exact head SHA and workflow run ID.
2. State test-file and test counts from CI, not local estimates.
3. State compact and full profile measured sizes and retention periods.
4. Stop for the Project Advisor's targeted verification.

Do not merge PR #15. Do not execute Stage A. Do not register or run the live calibration study. Do not make a live model call.

A successful targeted verification of the four areas in this document will authorize the PR #15 merge decision. Green merged-`main` CI will then be the final gate before Stage A registration and live execution are separately authorized.