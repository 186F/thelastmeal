# Milestone 002 — Phase 3 Unattended Orchestrator Re-Audit

**Date:** July 30, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#13 — Milestone 2 Phase 3: repository-native unattended orchestrator (1.8.0)`  
**Re-audited implementation head:** `8feb38dae15f892dff04b4af535ca1c064113ca4`  
**Base:** `9cc1fac2026ae45d8ce72f92d53955aaf3e229f6`  
**Original audit:** [`MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md`](MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md)  
**Exact-head CI:** workflow run `30596291454`  
**Status:** **REQUEST CHANGES — SUBSTANTIAL REMEDIATION ACCEPTED, FORMAL-EVIDENCE GAPS REMAIN**  
**Scope:** Phase 3 only. No live model call is required. Do not merge PR #13 and do not begin Phase 4 until the focused remediation below is complete and re-audited.

---

# 1. Executive verdict

The coding agent made a serious, good-faith remediation of the original nine-blocker audit. The implementation at `8feb38d` is materially stronger than the first Phase 3 head.

The following improvements are real and should be preserved:

- `package.json` and `package-lock.json` now agree on release `1.8.0`;
- reviewed model and serving-route identities are carried in the plan;
- the live gateway exposes its nonsecret configured serving route;
- the orchestrator verifies the gateway treatment before clicking Start;
- evidentiary plans require a pinned repository SHA and study binding;
- a clean tracked worktree is required before evidentiary execution;
- exact plan bytes are archived and checked;
- freeze checks run before and after each attempt;
- completed executions receive per-file evidence seals;
- rejected resume and non-resume invocations are read-only with respect to the sequence root;
- a completed-sequence resume short-circuits before Vite or Chromium launch;
- browser state, traces, screenshots, DOM, and console errors are preserved on the ordinary success path so later finalization failures have browser forensics;
- the sequence has explicit `attempts-complete`, `validating`, `packaging`, `completed`, and `failed` states;
- planned gateway stops must fire and are recorded;
- unexpected gateway death invalidates an ordinary treatment attempt;
- fake-gateway configuration no longer reads `.env.gateway`;
- Vite, batch, and fake-gateway child environments are explicitly reduced;
- archive creation now uses a fresh temporary ZIP, extraction verification, nested-archive secret scanning, and sibling receipts;
- CI uploads the actual rehearsal evidence ZIP, receipt, and failure drill rather than summaries alone.

The exact-head clean-checkout workflow passed all required repository gates. It reports:

```text
66 Vitest files
605 Vitest tests
55 gateway tests
127 model-bundle tests
10 Playwright tests
all fourteen deterministic golden hashes unchanged
```

The remediated rehearsal also proves the central keyless happy path. In the exact CI run, the gateway-stop fingerprint recorded:

```text
emitted requests: 51
upstream attempted: 16
upstream completed: 16
```

The correct registered rehearsal claim is the invariant:

```text
emitted > attempted
attempted = completed
```

not any fixed fake-adapter call count.

Despite those gains, the implementation is not yet safe to merge as the authoritative version-1 formal runner. Several requirements from the original audit remain only partially implemented, and a few new edge cases arise from the remediation itself.

The most consequential remaining problems are:

1. the evidence archive is created from a `packaging`/`validating` snapshot and then the packaged sequence root is modified to say `completed`, immediately making the root inventory stale and leaving the archive without the final completion state;
2. the study declaration is hash-bound but is not semantically reconciled with the actual orchestrator plan, attempts, treatment, budgets, and execution settings;
3. no generic versioned treatment-threshold profile exists, so an artifact-valid but behaviorally invalid live observation can still become a completed execution;
4. a non-retryable failure can receive a replacement after process restart because the resume loop does not preserve the earlier hard-stop disposition;
5. the freeze is not rechecked around the post-sequence batch, evaluation, reporting, and packaging stages;
6. failed and interrupted attempts are not sealed, and completed-sequence resume does not verify the archive, receipt, inventory, or semantic validity of the completed evidence;
7. non-gateway helper processes such as keep-awake and ZIP utilities still inherit the parent environment, so the statement that only the live gateway child receives credentials is not yet true;
8. the cross-volume archive fallback is a direct non-atomic copy after deleting the prior destination;
9. post-browser failure stages remain collapsed into generic `error`, and the required finalization-stage failure drills were not added.

**Verdict:** request changes. The Phase 3 architecture should remain in scope; this is a focused evidence-governance remediation, not a rewrite and not an invitation to begin Phase 4.

---

# 2. Verification performed

## 2.1 Pull-request state

At re-audit:

```text
PR: #13
head: 8feb38dae15f892dff04b4af535ca1c064113ca4
base: 9cc1fac2026ae45d8ce72f92d53955aaf3e229f6
package: 1.8.0
state: open, mergeable
```

The remediation remains correctly scoped to Phase 3. It does not add the Milestone 2 per-decision condition, new prompts, policy patches, a policy compiler, a policy interpreter, a novelty broker, or canonical policy state.

## 2.2 Exact-head CI

Workflow run `30596291454` completed successfully. It passed:

- application and gateway type checks;
- lint and formatting;
- frozen-data validation;
- the complete unit and integration suite;
- gateway tests;
- formal model-bundle tests;
- application and gateway builds;
- distribution secret scan;
- Playwright end-to-end tests;
- the 100-runs-per-scenario deterministic batch;
- keyless Milestone 1 model rehearsal;
- affordance and interruption-contract audit;
- Phase 3 orchestrator tests;
- the complete keyless unattended-orchestrator rehearsal;
- the hardened evidence upload.

The uploaded `m2-orchestrator-rehearsal` artifact is no longer summary-only. GitHub reports:

```text
artifact id: 8780490523
artifact digest: sha256:199bc2c7c922dfbf60eac8013f7d9eccc92a4fe993850609609fef3106e5cfef
artifact size: 1,230,450,006 bytes
```

That successful full upload is an important improvement, though its size also exposes an operational scaling risk discussed in §13.4.

## 2.3 Audit method and limitation

This re-audit used:

- full structured inspection of PR #13 and the remediation diff;
- exact-head source inspection through the GitHub connector;
- exact-head GitHub Actions status and logs;
- workflow artifact metadata;
- comparison against the original audit’s explicit requirements.

The audit environment could not establish an independent local GitHub clone because external DNS was unavailable. I therefore did not rerun the TypeScript suite locally or download the 1.23 GB artifact. The hosted clean-checkout workflow did run the complete gate successfully. Findings below arise from source-level state-machine and evidence-lifecycle analysis, not from contradicting the green CI result.

---

# 3. Original audit disposition

| Original finding | Re-audit disposition |
| --- | --- |
| 1 — release metadata mismatch | **Resolved** |
| 2 — model/provider/study identity unbound | **Model and route verification substantially resolved; study-to-plan semantic binding remains incomplete** |
| 3 — frozen code/worktree not enforced | **Attempt-boundary enforcement resolved; post-sequence and study-file freeze windows remain** |
| 4 — resume mutates or trusts evidence | **Read-only refusal and completed-execution seals resolved; terminal evidence and archive verification remain incomplete** |
| 5 — completion before sealing | **Failure lifecycle added; final archive/state ordering is still internally inconsistent** |
| 6 — diagnostics incomplete | **Browser forensic preservation substantially resolved; typed finalization stages and required drills remain** |
| 7 — packaging not immutable/portable/reviewable | **Most packaging mechanics resolved; final-root mutation, cross-volume atomicity, and completion verification remain** |
| 8 — execution profiles/verdicts not enforced | **Timing and gateway lifecycle resolved; generic study-valid threshold gates and resume-safe retry governance remain** |
| 9 — API-key process boundary | **Primary app children resolved; helper-process inheritance and keep-awake cleanup remain** |

---

# 4. Accepted remediations

These areas are accepted and should not be redesigned merely because additional corrections are required.

## 4.1 Release metadata

`package.json`, the root `package-lock.json` version, and `packages[""]` now all declare `1.8.0`. The new regression test is appropriate.

## 4.2 Pre-Start gateway treatment verification

The plan now declares:

```text
modelId
servingProviderId
allowFallbacks = false
requireParameters = true
promptVersion
conditionId
experimentId
experimentVersion
```

The gateway exposes the configured nonsecret model and serving route, and `verifyGatewayTreatment` checks the model, route, prompt, condition, experiment, experiment version, and provider authority before Start. Execution verdicts record the verified model and route.

The OpenRouter adapter itself still hardcodes:

```text
only: [configured provider]
allow_fallbacks: false
require_parameters: true
```

so those routing-policy fields remain fixed by the frozen source SHA even though the gateway public view does not expose them.

## 4.3 Attempt-boundary freeze checks

Evidentiary plans now require a pinned repository SHA, an outside-repository output root, and a clean worktree. Exact plan bytes are copied into the sequence root, and `checkFreeze` runs before and after every attempt. A change during an attempt converts the observation to a preserved `freeze-violation`.

## 4.4 Read-only refused resume

State and identity are inspected before the sequence root is written. An existing sequence invoked without `--resume`, an identity-mismatched resume, and a nonempty stateless root are refused before evidence mutation.

## 4.5 Completed-execution seals

Each successfully completed execution receives a sorted per-file SHA-256 list and aggregate hash. A completed execution with deleted, altered, or added files is refused on resume.

## 4.6 Browser forensics

On the successful browser path, every attempt saves:

```text
attempt-trace.zip
final-screenshot.png
final-dom.html
console-log.json
diagnostics-manifest.json
```

Browser-stage failures preserve the corresponding failure artifacts and capture failures are explicitly recorded rather than silently swallowed.

## 4.7 Planned and unplanned gateway lifecycle

A planned gateway stop now records:

```text
fired
observed tick
wall-clock time
accepted responses at stop
gateway child exit outcome
```

A stop-planned attempt fails if the trigger never fires. A normal model attempt fails if its gateway child dies before the orchestrator intentionally stops it.

## 4.8 Basic packaging hardening

The packaging layer now:

- refuses source-tree symlinks;
- scans ordinary text files;
- extracts and scans nested ZIPs such as Playwright traces;
- creates a fresh staged ZIP rather than updating an existing archive in place;
- extracts the staged ZIP and checks its file set and inventoried bytes;
- uses forward-slash source paths;
- writes sibling `.sha256` and `.receipt.json` files;
- uploads the complete rehearsal archive and failure drill with `if-no-files-found: error`.

## 4.9 Primary non-gateway application children

Vite, the post-sequence batch, and fake-gateway children now use explicit reduced environments. Fake-mode gateway configuration neither reads `.env.gateway` nor carries OpenRouter credentials/model/route from a poisoned parent environment.

---

# 5. Blocking finding 1 — the final archive and the final sequence state describe different sequences

**Severity:** Critical  
**Affected areas:** archive truthfulness, inventory integrity, no-op resume, independent review

## 5.1 Current ordering

The current orchestrator does the following:

```text
state = validating
write sequence-state.json
run evaluation
write sequence-report.json / .md

state = packaging
write sequence-state.json
packageSequence(sequenceRoot, ...)

state.archivePath = ...
state.archiveSha256 = ...
state = completed
write sequence-state.json
```

`packageSequence` inventories and archives the sequence root while the root’s state is `packaging`. The report was written one transition earlier, while the state object was `validating`.

After the archive and inventory are complete, the orchestrator modifies `sequence-state.json` inside the already-packaged root to say `completed` and add the archive path/hash.

## 5.2 Consequences

This creates four separate inconsistencies:

1. **The archive’s `sequence-state.json` says `packaging`, not `completed`.**
2. **The archive’s sequence report says `validating`, not `completed`.**
3. **The working root’s `sha256-inventory.json` becomes stale immediately**, because the included `sequence-state.json` bytes change after inventory creation.
4. **The working root and its sealed archive no longer represent the same file tree.**

This directly contradicts the original audit requirement:

> Do not modify the already-packaged sequence root after computing the archive.

The existence of a sibling receipt does not cure the root/archive divergence. The receipt correctly proves the ZIP bytes, but the operational state subsequently claims a completion state that the ZIP and inventory do not contain.

## 5.3 Completed resume does not verify the archive

The completed-sequence no-op path calls only:

```text
verifySealedExecutions(sequenceRoot, state)
```

It does not verify that:

- `state.archivePath` still exists;
- the archive hashes to `state.archiveSha256`;
- the sibling `.sha256` file exists and agrees;
- the receipt exists and agrees on sequence ID, plan SHA, repository SHA, inventory aggregate, and archive hash;
- the archive extracts cleanly;
- the archive’s inventory verifies;
- the archive contains the final intended evidence manifest.

Deleting or replacing the archive and receipt therefore does not prevent a no-op resume from returning `completed`.

## 5.4 Required correction

Separate mutable operational control state from immutable packaged evidence. Several designs are acceptable. One clean approach is:

```text
<sequence-control-root>/sequence-state.json          mutable operational state
<sequence-evidence-root>/sequence-manifest.json      immutable final evidence facts
<sequence-evidence-root>/attempt-*                    immutable evidence
<archive>.zip                                         immutable package
<archive>.receipt.json                                external seal/completion receipt
```

At minimum:

1. No file included by the inventory may be modified after archive creation.
2. The archive must contain an immutable final evidence manifest and report describing the completed attempt set, treatment verdicts, plan/study hashes, and pre-archive gate results.
3. The sibling receipt must be the authoritative post-archive seal and may carry the archive hash without recursion.
4. Mutable operational state must live outside the packaged tree or be explicitly excluded from inventory/archive.
5. `sequence-state.json`, `sequence-report.*`, and `sha256-inventory.json` must never disagree about the lifecycle snapshot they describe.
6. A completed no-op resume must verify the archive, receipt, inventory, and final evidence manifest before returning success.
7. A receipt or archive mismatch must be a typed read-only resume refusal.
8. `m2:evaluate` and `m2:package` must not mutate the immutable completed evidence root. Regenerated derivatives should go to a separately versioned derived-output directory or a new publication package.

## 5.5 Required tests

Add tests proving:

- every inventoried working-root file still matches after sequence completion;
- the archive contains the intended final evidence state, not `validating` or `packaging` operational state;
- sequence report and evidence manifest have the final attempt verdicts;
- deleting the archive causes completed resume refusal;
- modifying the archive causes completed resume refusal;
- deleting or modifying either receipt causes refusal;
- a receipt whose plan SHA/repository SHA/inventory aggregate disagrees is refused;
- a no-op resume extracts or otherwise independently validates the archive before returning completed;
- running `m2:evaluate` against a completed sequence does not mutate sealed raw evidence;
- running `m2:package` does not leave the operational state pointing at an older archive.

---

# 6. Blocking finding 2 — the registered study is authenticated but not reconciled with the dataset being run

**Severity:** Critical  
**Affected areas:** pre-registration integrity, sample definition, treatment identity, study-local freeze

## 6.1 What is implemented

An evidentiary plan must carry:

```text
studyId
studyVersion
studyPlanPath
studyPlanSha256
studyConfigFingerprint
```

Before writes, the orchestrator loads the study file and confirms that its computed ID, version, byte hash, and configuration fingerprint equal the plan binding.

That proves the plan references an authentic registered study file. It does **not** prove that the orchestrator plan implements that study.

## 6.2 Missing semantic reconciliation

The Phase 2 study declaration contains materially binding fields:

```text
repositorySha
packageVersion
experimentId / experimentVersion
conditionIds
model
provider
promptVersions
scenarioIds
seeds
sampleSizeN
runOrderMethod
metricVersions
analysisScriptVersion
thresholds
exclusionRules
replacementPolicy
stopRule
liveCallBudget
executionSettings
outputRoot
```

The current orchestrator does not compare those fields to:

- current repository/package identity;
- `expectedTreatment`;
- actual attempt conditions;
- actual attempt scenarios and fixed seeds;
- number of primary planned attempts;
- attempt ordering/replicate structure;
- speed, timeout, concurrency, and call caps;
- orchestrator replacement policy and retryable failure classes;
- orchestrator live-call budget;
- output root;
- evaluator/metric versions;
- threshold profile.

An evidentiary plan can therefore bind perfectly to a real registered study while scheduling a materially different dataset.

## 6.3 Study evidence is not archived

The plan archives its own exact bytes, but it does not archive:

```text
the exact study declaration bytes
the study freeze record
```

The plan retains a path and hashes. That is reconstructable only while the referenced file and pinned repository remain available. An absolute study path outside the repository can change between attempts without the current `checkFreeze` detecting it.

## 6.4 Required correction

Add one shared study-to-sequence reconciliation function. Before any write, it should validate at least:

```text
study.repositorySha == plan.repositorySha == current HEAD
study.packageVersion == current package version
study.experimentId/version == planned experiment
study.model/provider/promptVersions == expectedTreatment
set(study.conditionIds) == intended condition set
set(study.scenarioIds/seeds) == planned scenario/seed set
study.sampleSizeN == registered count of primary observations
study.liveCallBudget == or safely bounds orchestrator liveCallBudget
study.executionSettings == effective speed/timeout/concurrency/call caps
study.replacementPolicy == orchestrator replacement limits
study.outputRoot == reviewed output location, after normalization
metric/analysis versions == installed evaluator versions
study thresholds == referenced attempt threshold profile
```

Where one study field cannot map one-to-one onto an orchestrator plan field, the plan schema must carry an explicit, versioned mapping rather than silently omitting the comparison.

Also:

- archive exact study declaration bytes into the evidence root;
- archive its freeze record;
- verify both before and after every attempt and before packaging;
- restrict study files for formal sequences to the pinned repository or to archived content whose hash is rechecked throughout the sequence.

## 6.5 Required tests

Add plan/study mismatch tests for:

- wrong repository SHA;
- wrong package version;
- wrong model or serving provider;
- wrong prompt/experiment/condition;
- wrong scenario or seed;
- `sampleSizeN` not matching the registered primary observations;
- wrong speed/caps;
- different live-call budget;
- different replacement policy;
- different threshold or metric version;
- changed external study file during a sequence;
- archived study bytes and freeze record reproducing the registered hashes.

---

# 7. Blocking finding 3 — artifact validity is still being mistaken for study validity

**Severity:** Critical  
**Affected areas:** live acceptance, low-coverage runs, threshold governance, replacement spend

## 7.1 Missing versioned threshold profile

The original audit required a generic versioned execution/threshold profile and at least these distinct concepts:

```text
artifact-valid
study-valid
failed-preserved
invalid-treatment
```

The remediation added:

- formal timing rules;
- planned gateway-stop enforcement;
- unexpected-gateway-death enforcement;
- a list of retryable failure strings.

It did not add a threshold profile, profile version, treatment-validity evaluation, or study-valid attempt status.

A live run can still:

- strict-finalize successfully;
- replay exactly;
- produce a fingerprint;
- have poor upstream completion or accepted-model coverage;
- be marked `execution.status = completed`.

That is the exact distinction Milestone 1 exposed: an artifact can be completely valid while failing the registered treatment threshold.

Phase 4 may define the M2-specific numeric thresholds, but Phase 3 must provide the generic mechanism—or must hard-refuse evidentiary/live operation until the mechanism exists.

## 7.2 Retryable failure classes are open strings

`retryableFailureClasses` accepts arbitrary nonempty strings. Nothing prevents a reviewed plan from listing:

```text
replay-mismatch
freeze-violation
treatment-mismatch
run-evidence-conflict
secret-scan-failure
```

as retryable.

The code comments state that integrity and treatment failures must halt, but the schema does not enforce that rule.

Use a closed, versioned failure taxonomy with an explicit allowed-retry subset. Hard-stop classes must be structurally impossible to register as retryable.

## 7.3 A non-retryable failure can be retried after resume

During one invocation, a non-retryable failure sets `sequenceFailed = true` and stops replacement spending.

On a later `--resume`, the loop sees only:

```text
no completed execution
executionsSoFar < maxExecutions
```

It does not inspect the terminal disposition of the previous failure before creating the next execution.

Therefore, with `maxReplacementAttempts > 0`, a non-retryable failure that correctly halted the first invocation can receive a replacement after restart.

The current failure drill does not expose this because it sets:

```text
maxReplacementAttempts = 0
```

## 7.4 Required correction

Introduce a versioned attempt profile, for example:

```text
profileVersion
artifact gates
expected gateway lifecycle
treatment metrics and thresholds
planned intervention requirements
hard-stop failure classes
retryable transient failure classes
replacement limit
stop rule
```

Persist separate terminal facts:

```text
artifactStatus
studyStatus
failureClass
replacementDisposition: permitted | forbidden | exhausted
thresholdProfileVersion
thresholdVerdicts
```

An attempt should become a valid primary observation only when both artifact and study gates pass.

On resume, inspect the existing attempt history before considering another execution. A previous `replacementDisposition = forbidden` must permanently halt that attempt under the same plan.

## 7.5 Required tests

Add tests proving:

- a strict-finalized run below a registered completion/coverage threshold is preserved but classified `invalid-treatment`, not completed primary evidence;
- a threshold profile is versioned and part of resume identity;
- a hard-stop failure cannot be listed as retryable;
- a non-retryable failure is not retried after resume even when replacement capacity remains;
- a registered transient failure may receive exactly the permitted replacement;
- a threshold failure is not mislabeled as artifact corruption;
- planned stop evidence is evaluated through the profile;
- a live/evidentiary plan is refused when no compatible threshold profile exists.

---

# 8. Blocking finding 4 — the freeze ends before the post-sequence evidence pipeline

**Severity:** High  
**Affected areas:** post-sequence batch, evaluator provenance, report generation, packaging code

`checkFreeze` runs before and after each execution. It does not run:

- immediately before the post-sequence deterministic batch;
- after that batch;
- before cross-run evaluation;
- after evaluation;
- before report generation;
- before packaging;
- after packaging and before the final completion transition.

This matters because the post-sequence batch is spawned after the last attempt and loads source files from the working tree. A source change after the final attempt can alter the batch or other post-sequence behavior while the sequence still reports the original SHA.

The external study declaration is also validated only once at invocation start and is not part of `checkFreeze`.

## Required correction

Run a complete freeze check:

```text
before and after every execution
before and after post-sequence batch
before and after evaluation/report generation
immediately before evidence snapshot/package construction
immediately after package verification and before final receipt/state transition
```

The full check should include:

```text
HEAD
clean tracked worktree
package and lockfile release versions
archived plan hash
archived study hash/fingerprint
nonsecret configuration fingerprint
installed metric/profile versions
```

A drift after attempts but before packaging must fail the sequence as `freeze-violation`; it may not package under the old SHA.

## Required tests

Add injected-change tests for:

- change after the final attempt but before batch;
- change during batch;
- change before evaluation;
- change before package;
- study-file change between attempts;
- lockfile/package mismatch introduced during a sequence;
- all such cases ending as preserved `freeze-violation`, never completed.

---

# 9. Blocking finding 5 — terminal evidence and no-op resume are only partially sealed

**Severity:** High  
**Affected areas:** failed-attempt preservation, crash recovery, sequence-level evidence, semantic revalidation

## 9.1 Only completed executions are sealed

The schema explicitly makes `seal` non-null only for completed executions. Failed and interrupted attempts are formal evidence too, particularly when replacement logic or stop rules are under review.

A failed attempt can be deleted or edited between invocations and the next resume will not notice. `markInterruptedExecutions` converts an in-progress execution to failed without sealing the files that survived the crash.

Seal every terminal execution—completed, failed, and interrupted—with a terminal-state-specific seal. On resume, verify all prior terminal executions before making any new write or spending a replacement.

## 9.2 Completed execution resume does not re-run semantic validation

The original audit required both:

```text
seal verification
appropriate deterministic or strict-finalized evidence validation
```

The current resume path verifies only byte equality with the recorded execution seal. It does not re-run:

- deterministic ledger validation/replay;
- strict-finalized bundle integrity and exact trace-to-ledger join;
- fingerprint schema validation and recomputation;
- condition/treatment manifest checks.

A seal proves that evidence is unchanged since completion. Re-running the validators proves it remains interpretable under the same installed evidence contracts. Both checks were requested.

## 9.3 Sequence-level files are not sealed

Execution seals cover attempt directories, not:

```text
archived plan
archived study
cost acknowledgement
process log
sequence evaluation
sequence report
inventory
archive receipt
```

Completed no-op resume currently ignores changes to those files, apart from identity values read from `sequence-state.json`.

## 9.4 Derived commands mutate the completed root

`m2:evaluate` writes `sequence-evaluation.json` directly into the sequence root. `m2:package` writes a new inventory into the same root. After formal completion, those operations alter the working evidence tree without updating the existing archive receipt or a sequence-level seal.

## Required correction

- Seal every terminal attempt.
- Verify all terminal attempt seals on resume.
- Re-run semantic validators for every completed execution before skipping it.
- Add a sequence-level evidence seal or final immutable evidence manifest covering all non-attempt evidence files.
- Verify archive and receipt as described in §5.
- Move regenerated evaluations and publication packages into separate versioned derived-output locations.
- A completed sequence root should be treated as immutable raw evidence.

## Required tests

Add tests for:

- modifying/deleting a failed attempt before resume;
- modifying/deleting an interrupted attempt before resume;
- a completed deterministic ledger that is seal-valid but fails semantic validation under the installed contract;
- a completed finalized model directory that is seal-valid but fails strict validation;
- fingerprint mismatch despite intact raw evidence;
- altered cost acknowledgement/process report/final evidence manifest;
- `m2:evaluate` leaving raw evidence bytes unchanged;
- completed resume verifying archive/receipt and all terminal evidence.

---

# 10. Blocking finding 6 — the API key can still enter non-gateway child processes

**Severity:** High  
**Affected areas:** keep-awake helper, ZIP utilities, Git helpers, Windows process termination, refusal cleanup

The child-environment remediation correctly handles Vite, batch, and fake gateway. It does not cover every child process created by the orchestrator.

## 10.1 Keep-awake inherits the full parent environment

`acquireKeepAwake` spawns one of:

```text
powershell
caffeinate
systemd-inhibit
```

without an `env` option. Node therefore gives the helper the full parent environment, including an exported `OPENROUTER_API_KEY`.

## 10.2 Packaging utilities inherit the full parent environment

`packageEvidence.ts` spawns:

```text
zip
unzip
tar
```

without an explicit reduced environment.

## 10.3 Other helpers inherit as well

The Git `execFileSync` calls and Windows `taskkill` helper processes also inherit the parent environment unless explicitly reduced.

The governing boundary is not merely “the process does not use the key.” It is:

> Only the authorized live gateway process receives the key.

## 10.4 Keep-awake can survive a refused invocation

The orchestrator acquires the keep-awake lease before `checkLiveInterlocks` and before the main `try/finally` that releases it.

If a live plan lacks the required acknowledgement, or if an error occurs before the protected scope begins, the helper may remain running in the current parent process.

The completed no-op path correctly occurs before acquisition; the first-launch refusal path does not.

## Required correction

- Export one shared nonsecret platform environment builder for all helper processes.
- Use it for keep-awake, ZIP/extraction utilities, Git invocations, Windows `taskkill`, and every future non-live-gateway spawn.
- Only `liveGatewayEnv` may pass live credential variables.
- Acquire a keep-awake lease only when a live attempt exists.
- Place acquisition and all later interlock/lock operations inside a cleanup scope that always releases the lease.
- Add an explicit process-boundary test helper that prints whether canary variables are visible, rather than testing only returned environment objects.

## Required tests

With canary credentials in the parent environment, prove the canary is absent inside:

```text
Vite
batch
fake gateway
keep-awake helper
zip/unzip/tar helper
Git helper
Windows taskkill path where testable
```

and visible only inside an explicitly authorized live-gateway test seam. Also prove a refused live launch leaves no keep-awake child running.

---

# 11. Blocking finding 7 — the archive replacement fallback is not atomic

**Severity:** High  
**Affected areas:** cross-volume filesystems, interrupted packaging, prior archive preservation

The packaging code creates its staged ZIP under `os.tmpdir()`, then:

```text
remove destination archive
try rename staged archive to destination
on rename failure: write destination directly from staged bytes
```

If the temp directory and destination are on different volumes, rename fails. The fallback is a direct write to the final destination after deleting the previous archive. A crash or disk error can therefore leave a partial final archive and destroy the previous valid one.

This does not satisfy the original requirement for a fresh archive followed by an atomic destination commit.

## Required correction

Create the staged archive in the destination directory or another known same-volume sibling path:

```text
.<archive-name>.<unique-token>.tmp
```

Then:

1. create the archive at the sibling temp path;
2. validate it fully;
3. fsync/close it where practical;
4. atomically rename it to a new versioned destination;
5. never delete a prior valid archive before the replacement is committed;
6. write the receipt only after the final path hashes correctly.

Formal archive names should generally be immutable/versioned rather than repeatedly overwritten.

## Required tests

Add tests for:

- forced rename failure;
- simulated cross-volume staging;
- interrupted copy/write;
- prior valid archive preserved on replacement failure;
- no partial final archive path after any packaging error;
- receipt never written for a partial or uncommitted archive.

---

# 12. Medium-high finding — finalization-stage failures are not typed or fully drilled

The saved browser forensics make post-browser failures diagnosable, which resolves the largest part of the original diagnostics defect.

However, `executeAttempt` still converts every non-`AttemptFailure` exception to:

```text
failureReason = error
```

A failure in any of these stages is not structurally distinguished:

```text
deterministic ledger validation
prepareRunDirectory
strict finalizeRunDirectory
Phase 2 evidence enrichment
fingerprint generation/write
final manifest treatment cross-check
execution sealing
```

The required failure-injection drills for those stages were not added. The current rehearsal proves browser timeout preservation, not finalization-stage preservation.

## Required correction

Track a current stage and wrap failures into a closed typed vocabulary, for example:

```text
deterministic-validation-failed
prepare-run-failed
strict-finalize-failed
evidence-enrichment-failed
fingerprint-failed
final-treatment-verification-failed
execution-seal-failed
```

Write the stage, error, and diagnostic artifact references into a structured attempt failure manifest.

Add injected drills for each post-browser stage and for diagnostic-capture failure itself. Each test should prove the browser forensics remain present and the exact failed stage is recorded.

---

# 13. Remaining medium findings

These do not independently block merge once the blockers above are correctly resolved, but they should be addressed or explicitly scheduled.

## 13.1 Process provenance is still best-effort

`ProcessManager.record` suppresses all process-log write failures, and `stopAll` suppresses stop failures. The final report may therefore imply complete process provenance even when recording or shutdown proof failed.

For evidentiary runs, record process-log health and final child reconciliation as explicit gates. If process evidence cannot be written, say so in the evidence rather than silently claiming completeness.

## 13.2 Browser provenance remains sequence-level

The report records one browser version and headed/headless mode for the invocation, not per execution. It does not bind Playwright version, context options, or launch flags into each execution seal or study identity.

Record those values per execution before Phase 4 live evidence.

## 13.3 Page reload/navigation is not explicitly detected

The before/after worktree checks invalidate a source change, but the browser driver does not explicitly record unexpected page reloads or navigations during an attempt. Add a navigation counter or load-generation token so an unintended reload cannot masquerade as an uninterrupted run.

## 13.4 Rehearsal trace size is an operational risk

The exact CI artifact is approximately **1.23 GB** for three accelerated 20× attempts plus the short failure drill. Formal 1× studies contain much longer polling periods and many more attempts.

Before live Stage A, add:

- free-disk preflight;
- estimated maximum evidence size;
- a configured evidence-size budget;
- bounded or chunked Playwright tracing that preserves required forensics without unbounded growth;
- package-size and nested-scan timeouts;
- a clear failure mode when disk space or evidence budget is insufficient.

Do not extrapolate the exact size linearly without measurement, but do not ignore the signal.

## 13.5 Documentation drift

At re-audit, the PR body still contains the pre-remediation values:

```text
65 files / 594 tests
emitted 51 / attempted 18 / completed 18
```

The exact remediated CI reports:

```text
66 files / 605 tests
emitted 51 / attempted 16 / completed 16
```

The implementation report correctly switched to invariants, but the PR description should be updated. The report also claims every attempt saves `attempt-trace.zip` and final-* artifacts; browser-stage failures currently save failure-* equivalents instead. Describe the artifact contract accurately.

---

# 14. Required remediation order

The coding agent should remediate in this order.

## A. Final evidence model

1. Separate mutable operational state from immutable packaged evidence.
2. Produce one immutable final evidence manifest/report before packaging.
3. Ensure no inventoried file changes after packaging.
4. Verify archive, receipt, inventory, and manifest on completed resume.
5. Move regenerated derivatives outside the sealed raw-evidence root.
6. Stage archives on the destination volume and commit atomically.

## B. Study and treatment governance

7. Archive exact study bytes and freeze record.
8. Semantically reconcile the study declaration with the orchestrator plan and effective attempts.
9. Recheck plan/study/configuration through the complete post-sequence pipeline.

## C. Attempt validity and replacement policy

10. Add a versioned generic threshold/execution profile.
11. Separate artifact-valid from study-valid status.
12. Close the retryable failure vocabulary and forbid hard-stop retries.
13. Persist replacement disposition so resume cannot revive a non-retryable attempt.

## D. Resume and evidence integrity

14. Seal all terminal attempts, including failed and interrupted attempts.
15. Re-run semantic evidence validation for completed executions on resume.
16. Add a sequence-level evidence seal.

## E. Process and diagnostics boundary

17. Sanitize every non-live-gateway child process environment.
18. Make keep-awake acquisition/release exception-safe and live-only.
19. Add typed post-browser failure stages and failure-injection drills.
20. Reconcile process-record and child-stop evidence.

## F. Operational readiness

21. Add disk/evidence-size preflight and bounded tracing.
22. Update the PR body and report wording.
23. Run the complete exact-head clean-checkout CI and stop for re-audit.

---

# 15. Required merge gate

Do not make a live model call during this remediation.

Before requesting re-audit, require:

```text
application typecheck
gateway typecheck
lint / formatting
frozen-data validation
full unit and integration suite
gateway suite
formal model-bundle suite
application and gateway builds
distribution secret scan
Playwright e2e
100-run deterministic batch
keyless model rehearsal
affordance / interruption audit
Phase 3 orchestrator suites
complete keyless unattended rehearsal
full rehearsal evidence upload with hard path enforcement
```

The new tests must specifically cover the blockers in §§5–12, not merely rerun the existing happy path.

All fourteen deterministic golden hashes must remain byte-identical.

---

# 16. Final directive

> Preserve the accepted Phase 3 architecture. Do not begin Phase 4. Correct the final evidence lifecycle, study-to-plan reconciliation, generic study-valid threshold mechanism, resume-safe replacement governance, post-sequence freeze checks, terminal evidence sealing, complete child-process secret boundary, atomic archive commit, and typed finalization failure evidence. Obtain green exact-head CI and stop for another focused re-audit. No live API call is authorized.
