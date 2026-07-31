# Milestone 2 Phase 4 — Per-Decision Comparator Audit

**Date:** 2026-07-31  
**Repository:** `186F/thelastmeal`  
**Pull request:** #15 — Milestone 2 Phase 4: the M2 per-decision comparator (`1.9.0`)  
**Audited implementation head:** `f7517a91a51cb98a4e198d0b6d34d6cae87112bf`  
**Verdict:** **REQUEST CHANGES — DO NOT MERGE; DO NOT EXECUTE STAGE A**  
**Live model calls during implementation/audit:** **Zero**

## 1. Executive ruling

PR #15 is a strong implementation of the M2 per-decision comparator itself. The condition identity, prompt, revised diagnostic-output semantics, gateway pairing, finalization path, formal attempt profile, keyless treatment exercise, trace rotation, and evidence forecasting are credible and substantially match the governing Phase 4 directive.

It is not yet safe to merge or use for live data collection because four gaps remain at the study-governance and operations layer:

1. The registered ten-run calibration study declares analyses that no installed analysis program currently produces.
2. The required Stage A acceptance is documented as a prerequisite for calibration, but is not mechanically enforced.
3. `m2:register` can stamp arbitrary, unreviewed template files while making them appear pinned to the repository SHA.
4. Routine CI now uploads approximately 2.7 GB of rehearsal evidence on every PR and `main` run, without compact/full artifact profiles or explicit retention limits.

These findings do not require redesign of the comparator architecture. They require one focused remediation round before merge. No live API call is needed or authorized.

## 2. Audit basis

This audit was conducted against:

- PR #15 at exact head `f7517a91a51cb98a4e198d0b6d34d6cae87112bf`;
- the [Milestone 2 implementation brief](../../MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md);
- the [authoritative scope ruling](../../MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md);
- the [Phase 4 implementation report](../MILESTONE_002_PHASE4_PER_DECISION_REPORT.md);
- the implementation and tests changed by PR #15;
- exact-head CI run `30658269313`.

The exact-head CI run passed its complete clean-checkout workflow, including:

```text
81 Vitest files / 814 tests
76 gateway tests
127 model-bundle tests
215 M2 orchestrator tests
10 Playwright tests
100 deterministic runs per scenario
all fourteen deterministic golden hashes unchanged
keyless model rehearsal
keyless M2-condition rehearsal
affordance and interruption-contract audit
production and gateway builds
secret scan
```

The green CI result establishes that the implementation is internally coherent under the tests currently present. The findings below concern missing contracts and missing adversarial checks that the present suite does not yet encode.

---

# 3. Finding 1 — Critical: the calibration study declares analyses that do not exist

## 3.1 Registered claim

The tracked calibration study template:

```text
experiments/m2/templates/m2-calibration-variance-a-001.study.template.json
```

correctly registers the outputs required by the governing R2 ruling, including:

- all pairwise behavioral-fingerprint similarities and distances;
- median, p10, p25, p75, and p90 composite similarity;
- tick and semantic context of first divergence;
- action-category entropy;
- action-mode entropy;
- transition entropy;
- task, commitment, meal, treatment, and violation outcome frequencies;
- upstream calls attempted and completed;
- accepted-model coverage;
- latency distribution;
- token distribution;
- rationale-normalization frequency;
- returned-model and serving-provider consistency.

The template currently declares:

```text
analysisScriptVersion = behavior-similarity-1.0.0
```

That version identifies the pairwise similarity metric, not a ten-run calibration-analysis program capable of producing the registered outputs.

## 3.2 Current implementation

The existing sequence evaluator:

```text
scripts/experiments/m2/evaluateSequence.ts
```

produces only:

```text
sequenceId
completed execution IDs
pairwise left/right execution IDs
pairing type
Mara composite similarity in basis points
skipped pairs
```

It does not currently produce:

- percentile summaries;
- entropy statistics;
- first-divergence tick or semantic context;
- outcome distributions;
- operational coverage summaries;
- latency or token distributions;
- rationale-normalization frequency;
- model or serving-provider consistency.

The study reconciler also explicitly treats the primary and secondary metric-name arrays as prose with no machine-checkable producer. Consequently, a registered study may promise outputs that the installed analysis surface cannot generate.

## 3.3 Why this blocks live collection

The calibration study is intended to establish the empirical yardstick for later comparisons: how behaviorally different Mara is from herself under an identical observable configuration. Collecting the ten live runs before the complete analysis contract exists would create avoidable ambiguity after observing the data:

- percentile definitions could be chosen post hoc;
- entropy definitions or logarithm bases could be selected after seeing results;
- first-divergence matching could be weakened or changed after trajectories are known;
- operational inclusion and exclusion choices could be altered after failures are visible.

The study must bind a real, versioned analyzer before any live observation is collected.

## 3.4 Required remediation

Implement a dedicated versioned calibration analyzer, for example:

```text
m2-calibration-variance-analysis-1.0.0
```

The exact identifier may differ, but it must be a distinct installed analysis contract rather than an alias for the pairwise similarity metric.

The analyzer must deterministically emit both machine-readable JSON and a human-readable Markdown report containing every registered R2 output.

At minimum, implement and document:

### A. Pairwise similarity matrix

For all ten valid primary observations:

- every unique pair;
- similarity and distance;
- versioned pairing classification;
- any pair excluded from a specific matched-decision analysis and the reason.

### B. Distribution summaries

For Mara's composite similarity:

```text
median
p10
p25
p75
p90
minimum
maximum
pair count
```

Define the quantile algorithm exactly. Do not rely on an unspecified library default.

### C. First-divergence analysis

Direct ordinal matching is valid only while both runs share the same relevant semantic decision context. The analyzer must enforce the governing matched-decision rule by comparing, at minimum:

- semantic world context;
- relevant beliefs and memories;
- current activity state;
- offered-affordance descriptors;
- hard-dependency fingerprint.

The report must identify:

```text
first comparable decision
first selected-affordance divergence
logical tick
left and right request IDs
semantic context fingerprints
left and right selected affordances
whether later ordinal matching remains valid
```

After first behavioral divergence, do not continue treating later decision ordinal `n` as naturally paired merely because both runs contain an `n`th request.

### D. Entropy metrics

Produce:

- action-category entropy;
- action-mode entropy;
- transition entropy.

Document:

```text
input population
counting unit
logarithm base
zero-count treatment
rounding rule
aggregation level
```

Use deterministic integer or explicitly controlled decimal arithmetic consistent with the repository's existing evidence discipline.

### E. Outcome distributions

For each outcome family, report per-run facts and aggregate frequencies:

```text
task
commitment
meal
treatment
violation
```

Describe commitment outcomes as the mechanical terminal status produced under frozen VS001 rules; do not present them as validated moral blame.

### F. Operational metrics

From validated strict-finalized evidence, report per run and in aggregate:

```text
external requests emitted
upstream calls attempted
upstream calls completed
accepted model responses
accepted-model coverage
failure categories
latency distribution
token distribution
rationale-normalization frequency
returned model IDs
serving provider IDs
route-consistency verdict
```

### G. Registration and producer binding

The calibration study must bind the new analysis version. Registration must refuse when:

- the declared analysis version is not installed;
- a registered primary or secondary metric has no installed producer;
- the installed analysis version differs from the study declaration.

A useful implementation is a closed analysis registry mapping study metric IDs to producer versions and output contracts.

## 3.5 Required tests

Add tests over a deterministic synthetic ten-run fixture that cover:

- all 45 unique pairs;
- exact quantile boundaries;
- repeated values and ties;
- action-category, mode, and transition entropy;
- divergence before any action difference;
- divergence caused by offered-affordance changes;
- divergence caused by belief or memory changes;
- post-divergence ordinal matching refusal;
- outcome frequencies;
- accepted-model coverage;
- latency and token distributions;
- rationale-normalization frequency;
- returned-model and provider inconsistency;
- exclusion of failed, replacement-failed, deterministic, or otherwise non-primary observations;
- deterministic byte-identical output across repeated analysis runs;
- refusal when a study declares an unimplemented metric or analysis version.

---

# 4. Finding 2 — High: Stage A does not mechanically gate the calibration study

## 4.1 Governing requirement

The authoritative ruling establishes this sequence:

```text
Stage A
1. Scenario A — deterministic baseline — gateway off
2. Scenario A — M2 per-decision — live gateway

Both must pass before the R2 calibration study begins.
```

The calibration study is not merely scheduled after Stage A for convenience. Stage A is an acceptance gate proving that the exact final candidate can execute both the deterministic control path and the live M2 treatment through the unattended evidence pipeline.

## 4.2 Current implementation

The Stage A and calibration plans correctly describe their order in prose. The Phase 4 report explicitly states that sequencing is currently enforced operationally through the runbook and registrations.

However:

- `m2:register` can register the calibration templates before Stage A has run;
- `m2:orchestrate` can launch the registered calibration plan without a Stage A result;
- the calibration study freeze contains no authenticated Stage A prerequisite;
- the calibration plan contains no Stage A manifest, receipt, archive hash, or verdict binding.

The calibration plan's description says it executes only after Stage A, but no program enforces that statement.

## 4.3 Why this blocks live collection

A scientific stop condition must survive operator error and process restart. The repository's design has consistently converted important prose requirements into typed, hash-bound gates. Stage A should not be the exception.

Without a mechanical prerequisite, the ten-run study could begin:

- before the baseline control passes;
- after a Stage A model run fails its treatment threshold;
- on a repository SHA different from the Stage A SHA;
- after shared runtime, gateway, finalization, tracing, or evaluation code changes;
- from an unverifiable or incomplete Stage A archive.

## 4.4 Required remediation

Introduce a versioned, cryptographically bound Stage A prerequisite record for calibration registration and launch.

The exact schema may differ, but it must carry at least:

```text
prerequisite schema version
Stage A study ID and version
Stage A sequence ID
repository SHA
package version
experiment ID and version
attempt-profile ID and version
baseline execution ID
model execution ID
baseline condition and gateway mode
model condition
prompt version
model ID
serving provider ID
sequence-manifest path and SHA-256
evidence archive path and SHA-256
receipt path and SHA-256
artifact-valid verdicts
study-valid verdicts
strict-finalization verdict
replay verdicts
treatment-threshold verdicts
secret-scan verdict
inventory aggregate
```

Calibration registration must verify rather than trust this record:

1. Load the immutable Stage A sequence manifest.
2. Reconcile it with the Stage A control state.
3. Verify execution seals and semantic evidence.
4. Verify the inventory.
5. Verify the archive, digest sidecar, and receipt.
6. Prove the deterministic attempt ran gateway-off.
7. Prove the M2 live attempt used the registered condition, prompt, model, route, and provider.
8. Prove both observations are artifact-valid and study-valid.
9. Prove strict finalization and replay passed.
10. Prove the Stage A repository SHA equals the calibration repository SHA.

The prerequisite must then enter:

- the registered calibration study bytes;
- the study freeze projection;
- the plan/configuration fingerprint;
- the sequence resume identity;
- every freeze checkpoint.

If any source, prompt, condition, treatment, attempt profile, analyzer, tracing contract, finalization code, or other shared implementation changes after Stage A, the SHA changes and calibration registration must require Stage A to run again.

## 4.5 Required tests

Add keyless prerequisite drills covering:

- intact Stage A evidence allows calibration registration;
- missing baseline attempt refuses;
- missing live attempt refuses;
- a failed or invalid-treatment Stage A attempt refuses;
- wrong gateway mode for the baseline refuses;
- wrong M2 condition, prompt, model, route, or provider refuses;
- replay mismatch refuses;
- strict-finalization failure refuses;
- modified archive, sidecar, receipt, inventory, manifest, or control state refuses;
- a Stage A SHA different from calibration HEAD refuses;
- a source change after Stage A forces a new Stage A sequence;
- an intact prerequisite remains stable through registration, launch, resume, and packaging.

---

# 5. Finding 3 — High: formal registration accepts arbitrary, unreviewed templates

## 5.1 Intended contract

The registration ritual is described as taking the reviewed tracked templates and substituting only the self-referential repository and study pins immediately before execution.

That is the correct conceptual solution to the impossibility of a tracked file containing the SHA of the commit that introduces it.

## 5.2 Current implementation

The current `m2:register` interface accepts arbitrary paths:

```text
--study-template <path>
--plan-template <path>
--out <path-outside-repo>
```

The implementation verifies:

- the worktree is clean;
- the output directory is outside the repository;
- expected sentinels exist;
- the stamped study validates;
- the stamped plan parses.

It does not prove that the supplied input files are:

- one of the approved Phase 4 template pairs;
- inside the repository;
- tracked by Git;
- byte-identical to the file stored at the pinned HEAD;
- paired with the intended companion template.

A schema-valid file copied outside the repository can therefore be edited and stamped with the current repository SHA. The resulting registered study would appear SHA-pinned even though its design was never part of that commit.

## 5.3 Required remediation

Replace arbitrary-path formal registration with a closed registration registry.

A suitable shape is:

```text
stage-a
  registration ID
  study ID/version
  tracked study-template path
  tracked plan-template path
  expected sequence ID
  expected attempt-profile binding
  optional prerequisite policy

calibration-variance-a
  registration ID
  study ID/version
  tracked study-template path
  tracked plan-template path
  expected sequence ID
  expected attempt-profile binding
  Stage A prerequisite required
```

The CLI should select a registration by ID, for example:

```text
npm run m2:register -- --registration stage-a --out <outside-repo>
npm run m2:register -- --registration calibration-variance-a --stage-a <verified-root> --out <outside-repo>
```

The exact command syntax may differ. The critical property is that the caller cannot substitute arbitrary design files.

For every source template, registration must:

1. Require a repository-relative path from the closed registry.
2. Prove the file is tracked at HEAD.
3. Load the committed bytes with:

   ```text
   git show HEAD:<registered-path>
   ```

4. Require the working-tree bytes to equal the committed bytes.
5. Require the expected study/plan pairing.
6. Reject any outside, untracked, modified, or substituted source.
7. Record in provenance:

   ```text
   registered source path
   Git blob ID
   source SHA-256
   registration ID and version
   companion template path/blob/hash
   ```

8. Bind those facts into the study freeze and plan fingerprint.

Registration output should be transactional:

- construct all files in a temporary sibling directory;
- validate study, freeze record, plan, registration provenance, and prerequisite;
- atomically rename the completed set into the requested create-once destination;
- leave no partial registered inputs after a failure.

## 5.4 Required tests

Add refusal tests for:

- an outside copy of an approved template;
- an untracked file inside the repository;
- a modified working-tree copy of the correct template;
- a schema-valid but unregistered study;
- a schema-valid but unregistered plan;
- Stage A study paired with the calibration plan;
- calibration study paired with the Stage A plan;
- a source whose working-tree bytes differ from `git show HEAD:path`;
- a tampered registration registry entry;
- a partial-output failure leaving no committed registration directory;
- a valid registered pair producing provenance with exact paths, blob IDs, and hashes.

---

# 6. Finding 4 — High: routine CI artifact storage is approximately 2.7 GB per run

## 6.1 Exact-head observation

Exact-head CI run `30658269313` uploaded:

```text
artifact: m2-orchestrator-rehearsal
size: 2,696,214,551 bytes
approximately: 2.51 GiB
retention: default 90 days
```

The prior Phase 3-era artifact was approximately 1.87 GiB. PR #15 adds another complete M2-condition rehearsal archive while retaining the prior full rehearsal archive, packaging-recovery archives, raw failure evidence, and other overlapping files.

The workflow currently uploads the complete set on:

- every pull request;
- every push to `main`;
- manual dispatch.

No explicit `retention-days` value is set.

## 6.2 Important distinction

The new trace rotation and evidence forecasting are valid formal-evidence mechanisms. They prevent one indefinitely open Playwright trace and permit early failure when a live sequence would exceed its registered evidence budget.

They do not reduce aggregate routine CI storage because the retention policy remains:

```text
retain-all-chunks
```

and the workflow uploads several complete or overlapping archives.

This finding does **not** authorize deletion of formal experimental evidence. It concerns duplicating multi-gigabyte keyless rehearsal packages into GitHub Actions on every routine CI run.

## 6.3 Required remediation

Introduce two explicit CI artifact profiles.

### A. Routine compact profile

Use on normal PR and `main` CI runs.

The full rehearsal should still execute and verify its complete local evidence on the runner. Upload only compact proof such as:

```text
m2 rehearsal report
sequence manifest
sequence report JSON and Markdown
control state
SHA-256 inventory
archive digest sidecar
archive receipt
trace manifest and size forecast
failure manifest
bounded context-log summary
treatment and threshold verdicts
registration/provenance report
test summaries
```

Do not upload the full sealed evidence ZIPs or all Playwright traces in the routine profile.

Register a hard budget, initially:

```text
compact artifact <= 50 MiB
retention = 14 to 30 days
```

The exact final budget may differ if justified by measured compact output, but it must be explicit and enforced before upload.

### B. Explicit full-evidence profile

Upload full archives and traces only when one of the following is true:

- a manual `workflow_dispatch` input requests full evidence;
- a designated audit-ready run requests it;
- a failing run requires complete browser diagnostics;
- a release or experimental milestone is being sealed.

Register:

```text
full upload size budget
retention = 7 days by default
no duplicate nested copies of the same evidence
```

A full upload must report exactly which archives and traces are unique and why each is retained.

### C. Workflow requirements

Add:

- explicit `retention-days` to every Actions artifact upload;
- a machine-readable artifact-size report;
- a pre-upload size-budget gate;
- separate compact and full artifact names;
- a manual-dispatch input controlling the full profile;
- tests or a script-level fixture proving the compact include set does not contain full trace or evidence ZIP payloads;
- documentation explaining that formal live evidence is retained locally and backed up independently rather than relying on expiring Actions artifacts.

## 6.4 Acceptance targets

At minimum:

```text
Routine compact upload: <= 50 MiB
Routine retention: 14–30 days
Full keyless rehearsal upload: explicit/manual only
Full retention: 7 days
Formal live evidence: local sealed package + independent durable backup
```

---

# 7. Accepted implementation areas

The following areas are accepted and should not be redesigned unless the remediation directly exposes a regression.

## 7.1 M2 condition and identity

The condition ID is the sole client-selectable key. Experiment ID/version, provider ID, prompt version, target NPC, scenario coverage, upstream platform, and diagnostic contract are resolved from a closed condition registry.

The required identities are correctly represented:

```text
sparse-cognition-policy-001 v1.0.0
mara-model-per-decision-m2-v1
openrouter-mara-action-m2-v1
mara-action-selection-m2-1.0.0
```

## 7.2 Engine authority

Mara alone uses the M2 external deferred provider. Jonas and Rin remain deterministic. The model selects among engine-generated affordances; it does not create actions, mutate state, or bypass the acceptance gate.

## 7.3 Gateway pairing and treatment verification

One gateway process serves one registered model-backed condition pairing. Public provider configuration, browser pinning, request envelopes, run bundles, finalizer identity checks, and orchestrator treatment verification derive from that pairing.

## 7.4 Revised diagnostic-output contract

Under M2:

- selected affordance ID and reason code remain structural;
- rationale is optional and locally normalized;
- confidence is optional, self-reported, and diagnostic only;
- neither rationale nor confidence can reject an otherwise structurally valid choice;
- Milestone 1's strict output contract remains unchanged.

The implementation decision to use a fixed 600-character trace bound is acceptable because normalization, rather than the exact bound, is the governing treatment change. The bound remains tied to the prompt version.

## 7.5 Formal attempt profile

The formal profile correctly records:

- artifact validity separately from study validity;
- at least 90% upstream completion;
- at least one attempted upstream call;
- no budget-exhausted failures for ordinary primary runs;
- the planned gateway-stop exemption;
- one identical replacement for eligible transient operational failures;
- the registered stop rule.

## 7.6 Stage A and calibration configurations

The plan contents themselves match the authorized design:

```text
Stage A
- Scenario A deterministic baseline, gateway off
- Scenario A M2 per-decision, live gateway

Calibration
- m2-calibration-variance-a-001
- Scenario A
- seed 1001
- n = 10 valid primary runs
- speed = 1x
- pinned model, provider, prompt, repository SHA
```

The blocker is mechanical sequencing and complete analysis—not the configured attempts.

## 7.7 Tracing and forecasting

Chunked Playwright tracing, trace manifests, heartbeat counters, per-attempt forecasting, sequence-level forecasting, and early `evidence-budget-exceeded` failure are accepted as formal-evidence mechanisms.

## 7.8 Frozen surfaces and scope

No Phase 5 policy compiler, interpreter, novelty broker, policy lifecycle, or policy-patch condition was implemented. No new scenario, NPC, dialogue, reflection, memory system, or simulation-mechanics repair entered scope.

All fourteen deterministic golden hashes remain unchanged.

---

# 8. Required remediation sequence

Implement the correction in this order:

1. Add the versioned calibration analyzer and producer registry.
2. Add authenticated Stage A prerequisite evidence and bind it into calibration registration, freeze, launch, resume, and packaging.
3. Replace arbitrary formal-template paths with the closed Git-authenticated registration registry and transactional output.
4. Split routine compact and explicit full CI artifact profiles; set retention and size budgets.
5. Update the Phase 4 report, runbook, technical reference, and status pages to describe the final behavior.
6. Run the complete exact-head clean-checkout CI workflow.
7. Stop for targeted re-audit. Do not merge or make a live model call.

# 9. Required final verification evidence

The remediation PR head must demonstrate:

```text
all existing tests green
all fourteen deterministic golden hashes unchanged
complete keyless M2-condition rehearsal green
keyless Stage A registration and prerequisite drill green
keyless ten-run calibration-analysis fixture green
all registered calibration metrics produced
arbitrary-template substitution refused
Git blob and source-hash provenance recorded
transactional registration proven
compact Actions artifact within its registered size budget
full artifact profile disabled during ordinary PR CI
explicit artifact retention values present
zero live model calls
```

# 10. Merge and live-run ruling

At audited head:

```text
MERGE: NOT AUTHORIZED
STAGE A LIVE EXECUTION: NOT AUTHORIZED
CALIBRATION LIVE EXECUTION: NOT AUTHORIZED
PHASE 5: NOT AUTHORIZED
```

After the four findings are remediated and exact-head CI passes, perform a focused re-audit of only:

1. calibration-analysis completeness;
2. Stage A prerequisite binding;
3. Git-authenticated registration;
4. CI artifact profiles, budgets, and retention.

The accepted comparator, gateway, finalization, tracing, and frozen-baseline areas do not require another broad audit unless the remediation modifies or regresses them.
