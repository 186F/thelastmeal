# Milestone 002 — Phase 3 Unattended Orchestrator Audit

**Date:** July 30, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#13 — Milestone 2 Phase 3: repository-native unattended orchestrator (1.8.0)`  
**Audited implementation head:** `fb274f4d10259bb506644e04c9ba6566d728ac37`  
**Base:** `9cc1fac2026ae45d8ce72f92d53955aaf3e229f6`  
**Exact-head CI:** workflow run `30589165641`  
**Status:** **REQUEST CHANGES — NOT READY TO MERGE**  
**Scope:** Phase 3 only. The remediation requires no live model calls and must not introduce Phase 4 or Phase 5 capabilities.

---

# 1. Executive verdict

PR #13 is an ambitious and generally well-structured implementation of the repository-native unattended runner. The keyless happy path is real rather than mocked at the orchestration boundary: Vite, Chromium, gateway child processes, browser downloads, replay, model-run finalization, Phase 2 evidence enrichment, sequence state, and packaging are exercised together in CI.

Several important design choices are correct and should be preserved:

- one fresh gateway process for each model-backed attempt;
- one fresh browser context and page per attempt;
- actual operator controls and downloads rather than a privileged state bridge;
- strict fixed ports with refusal rather than fallback;
- Phase 2 strict-finalized evidence validation and exact trace-to-ledger joins;
- keyless gateway-stop rehearsal before live spend;
- preserved browser diagnostics for browser-stage failures;
- atomic sequence-state writes;
- explicit worst-case call-budget arithmetic;
- no canonical simulation-mechanics change and no change to any frozen golden hash.

However, the implementation is **not yet safe to use as the authoritative formal experiment runner**. The current code can:

1. run an evidentiary live sequence without binding the actual model or pinned serving provider to the reviewed plan;
2. execute from a dirty or mid-sequence-changing worktree while continuing to report the original commit SHA;
3. mutate an existing sequence before its resume identity is accepted;
4. skip completed attempts without revalidating their evidence;
5. record `status: completed` before secret scanning and ZIP creation succeed;
6. lose the required browser diagnostics when failure occurs during finalization rather than inside the browser driver;
7. package an ephemeral lock file, update an old ZIP in place, and fail to persist the archive hash in a durable seal;
8. mark a planned gateway-stop attempt complete even if the stop trigger never fired;
9. pass live credentials to non-gateway child processes through inherited environment variables;
10. publish release `1.8.0` while the lockfile still records `1.7.0`.

These are formal-evidence and experiment-governance defects, not stylistic preferences. They should be fixed before the orchestrator becomes a version-1 authority for unattended live studies.

**Verdict: request changes. Do not merge PR #13 and do not begin Phase 4.**

---

# 2. Verification performed

## 2.1 Pull-request surface

At the audited head:

```text
PR: #13
Head: fb274f4d10259bb506644e04c9ba6566d728ac37
Base: 9cc1fac2026ae45d8ce72f92d53955aaf3e229f6
Changed files: 28
Additions/deletions: +3,193 / -6
Package declared by package.json: 1.8.0
```

The diff is correctly scoped to Phase 3 infrastructure, documentation, plans, package metadata, CI, an automation selector contract, and tests. It does not add the M2 action condition, M2 prompts, policy patches, a compiler, an interpreter, a novelty broker, or canonical policy state.

## 2.2 CI state

Exact-head workflow run `30589165641` completed successfully. The required clean-checkout job passed:

- application typecheck;
- gateway typecheck;
- lint and formatting;
- frozen-data validation;
- unit and integration tests;
- gateway tests;
- formal model-bundle tests;
- application and gateway production builds;
- distribution secret scan;
- Playwright end-to-end tests;
- 100-runs-per-scenario deterministic batch;
- keyless formal model-run rehearsal;
- affordance and interruption-contract audit;
- Phase 3 orchestrator unit/integration tests;
- keyless unattended-orchestrator rehearsal;
- rehearsal-artifact upload.

The exact-head test total was:

```text
65 Vitest files
594 Vitest tests
55 gateway tests
127 model-bundle tests
10 Playwright tests
```

All fourteen deterministic golden hashes remained unchanged.

## 2.3 Independent CI-artifact inspection

I downloaded workflow artifact `8777924776`, digest:

```text
sha256:84f9bd5ac4be8f1d5a355ac750a95d5abb7f50ceba18a520aecd8f1e6b0a1885
```

The uploaded artifact contained only four summary files:

```text
m2-rehearsal/m2-rehearsal-report.json
m2-sequences/rehearsal/sequence-report.json
m2-sequences/rehearsal/sequence-report.md
m2-sequences/rehearsal/sequence-state.json
```

It did **not** contain the generated evidence ZIP, attempt directories, ledgers, model-run directories, fingerprints, process logs, heartbeat logs, or the failure-drill evidence.

The downloaded exact-CI report also recorded:

```text
gateway-stop drill:
  emitted 51
  attempted 16
  completed 16
```

The PR description and implementation report instead state `18 / 18`. The invariant `emitted > attempted` passed, but the hard-coded sample count is inaccurate for the exact audited CI run.

## 2.4 Audit limitation

The audit combines full GitHub static inspection, exact-head GitHub Actions logs, and independent inspection of the uploaded workflow artifact. The audit environment could not establish a separate local GitHub clone, so I did not independently rerun the TypeScript suite outside GitHub Actions. The hosted clean-checkout run did execute the complete repository gate.

---

# 3. Accepted implementation areas

The following architecture is accepted and should not be redesigned merely because other changes are required.

## 3.1 Real operator path

`browserDriver.ts` uses the real scenario selector, condition selector, speed control, Start button, ledger export, bundle export, and Replay Latest control. It does not expose canonical state or reducer mutation on `window`.

The shared automation contract and its Playwright selector test are appropriate safeguards against UI drift.

## 3.2 Browser isolation

A new Chromium context and page are created for every attempt. Cookies, local storage, page state, and service-worker state are therefore not reused across attempts.

## 3.3 Gateway isolation

A new gateway child process is created for every model-backed execution. Process-lifetime counters and budgets reset by construction.

## 3.4 Canonical evidence path

The model-backed closeout correctly reuses:

```text
prepareRunDirectory
→ strict finalizeRunDirectory
→ Phase 2 strict-finalized evidence loader
→ enriched behavior fingerprint
```

This is the correct evidence path. Do not fork or reimplement the finalizer.

## 3.5 Request/call distinction

The gateway-stop rehearsal uses the Phase 2 enriched fingerprint and preserves the distinction between engine-emitted requests and actual upstream calls.

## 3.6 Basic monitoring and browser-stage failure preservation

The heartbeat, run timeout, stall diagnosis, grace period, screenshot, DOM capture, console/page-error capture, and Playwright trace are good foundations for browser-stage failures.

## 3.7 Call-budget formula

`worstCaseStudyCalls` correctly includes all permitted replacement attempts and uses:

```text
min(maxCallsPerRun, maxTotalCalls)
```

for each fresh gateway process.

## 3.8 Scope discipline

No Phase 4 or Phase 5 cognitive capability has been smuggled into this PR. Preserve that discipline during remediation.

---

# 4. Blocking finding 1 — release metadata is internally inconsistent

**Severity:** High  
**Affected areas:** reproducibility, package provenance, release discipline

`package.json` declares:

```text
1.8.0
```

but `package-lock.json` still declares `1.7.0` in both the top-level version and `packages[""]` entry.

The lockfile was not included in the PR diff.

A formal sequence records `packageVersion` from `package.json`, while `npm ci` installs from a lockfile describing a different package release. This is avoidable provenance ambiguity.

## Required correction

Update both package files consistently:

```text
package.json      1.8.0
package-lock.json 1.8.0
```

Add a test or validation check that fails when the root package version and lockfile root versions disagree.

---

# 5. Blocking finding 2 — the reviewed plan does not bind the actual model or serving provider

**Severity:** Critical  
**Affected areas:** treatment identity, cost acknowledgment, resume identity, model substitution, provider pinning

The governing brief requires an evidentiary sequence to bind:

```text
model
provider
prompt versions
experiment versions
```

The current plan schema contains no expected model slug or pinned OpenRouter provider slug.

The sequence state records:

```text
externalProviderId = openrouter-mara-action-v1
upstreamPlatform = openrouter
```

Those values identify the application-level decision authority and routing platform. They do **not** identify:

```text
google/gemini-2.5-flash-lite
google-ai-studio
```

or any future M2 model/route pair.

The cost acknowledgment similarly records only call caps and says the model and provider are “pinned by gateway configuration.” It does not print or persist the actual nonsecret model and provider values, despite §19.14 requiring them.

A live gateway can therefore start with the wrong `.env.gateway` model or route. The run may still strict-finalize, because the finalizer proves consistency with the gateway’s own seed manifest—not consistency with the pre-reviewed orchestrator plan.

This is the most important remaining experiment-identity defect.

## Required correction

For every live or evidentiary plan, add exact reviewed fields such as:

```text
expectedModelId
expectedServingProviderId
allowFallbacks = false
requireParameters = true
expectedPromptVersion
expectedExperimentId
expectedExperimentVersion
expectedConditionId
```

The exact names may differ, but the semantics may not.

Before clicking Start:

1. query the gateway’s nonsecret provider-configuration endpoint;
2. verify the returned model, serving-provider route, condition, experiment, prompt, and provider authority against the plan;
3. refuse before any run begins on mismatch;
4. write the verified values into sequence state and cost acknowledgment;
5. include them in resume identity;
6. verify every final manifest against the same planned values.

The gateway’s public configuration currently exposes a model ID but not the pinned OpenRouter serving-provider slug. Extend the nonsecret view so the orchestrator can verify the route without reading `.env.gateway`.

## Study-registry binding

An evidentiary orchestrator plan must also reference and validate the pre-registered Phase 2 study declaration. At minimum bind:

```text
studyId
studyVersion
study-plan path or content
study-plan SHA-256
study configuration fingerprint
```

An `evidentiary: true` plan must not be runnable as an unregistered standalone dataset.

## Required tests

Add tests proving:

- wrong model is refused before Start;
- wrong serving provider is refused before Start;
- wrong prompt/condition/experiment is refused before Start;
- the actual verified model/provider are written to cost acknowledgment and state;
- resume refuses a model/provider/study-plan change;
- a final manifest that disagrees with the planned model/provider is rejected;
- an evidentiary plan without a validated study registration is refused.

---

# 6. Blocking finding 3 — the frozen code and worktree are not enforced throughout a sequence

**Severity:** Critical  
**Affected areas:** causal comparability, release freeze, Vite hot reload, multi-run studies

The orchestrator computes `git rev-parse HEAD` once before the sequence starts. It does not:

- require a clean tracked worktree;
- require `repositorySha` for an evidentiary plan;
- archive the exact plan bytes inside the sequence evidence;
- recheck SHA and worktree cleanliness before each attempt;
- recheck them after each attempt;
- recheck before post-sequence evaluation and packaging.

The plan schema even allows an evidentiary plan with no pinned `repositorySha`.

Because the orchestrator uses a Vite development server, tracked source edits can be hot-reloaded while the sequence is running. A later attempt may therefore execute different code while sequence state continues to report the original commit SHA.

The brief explicitly requires frozen SHA/configuration validation for each planned attempt.

## Required correction

For evidentiary sequences:

1. require `repositorySha` in the schema;
2. refuse a dirty tracked worktree before any output is created;
3. archive the exact reviewed plan bytes into the sequence root and verify its SHA;
4. archive or reference the validated study declaration and its freeze artifacts;
5. recheck HEAD, tracked-worktree cleanliness, package version, plan hash, and nonsecret configuration before every execution;
6. recheck them immediately after every execution and before packaging;
7. if a change occurs during an attempt, preserve that attempt but invalidate it as `freeze-violation`;
8. require evidentiary output roots to resolve outside the tracked repository.

A production-built immutable web bundle would be stronger than a live-reloading dev server. If Vite dev serving is retained, the before/after freeze checks are mandatory and any page reload or navigation during a running attempt must be detected and treated as an attempt failure.

## Required tests

Add tests for:

- evidentiary plan missing `repositorySha`;
- dirty tracked file before launch;
- staged tracked change before launch;
- tracked source change between attempts;
- tracked source change during an attempt;
- package-version or lockfile-version change during a sequence;
- evidentiary output root inside the repository;
- archived plan bytes reproducing `planSha256`.

---

# 7. Blocking finding 4 — resume and idempotency mutate or trust evidence before proving it

**Severity:** Critical  
**Affected areas:** immutable evidence, refused resume, completed-attempt integrity, sequence-root contamination

## 7.1 Existing sequence is mutated before identity acceptance

On every invocation, the orchestrator:

1. creates the sequence root;
2. acquires the lock;
3. writes `cost-acknowledgement.json`;
4. then reads sequence state;
5. then checks whether `--resume` was supplied;
6. then checks resume identity.

A refused non-resume invocation or identity-mismatched resume can therefore overwrite an existing sequence file before being rejected.

A rejected resume must be observationally read-only.

## 7.2 Completed attempts are skipped without evidence verification

`completedExecution` causes an attempt to be skipped solely because sequence state says it was completed.

The orchestrator does not revalidate that the attempt’s:

- ledger still validates;
- finalized bundle still passes bundle integrity;
- trace-to-ledger join still holds;
- fingerprint still exists and validates;
- fingerprint still matches the evidence;
- artifact files have not been deleted or changed.

`evaluateFromState` silently skips a completed execution whose fingerprint file is missing. A sequence may therefore retain `status: completed`, package successfully, and omit a previously completed observation from analysis.

## 7.3 A nonempty root without state can be adopted

If an output root exists and contains files but has no `sequence-state.json`, the orchestrator may begin writing a new sequence into that preexisting directory.

## Required correction

- Perform all state and identity checks before writing any evidence file.
- Make the live-cost acknowledgment create-once and immutable; on resume, verify it rather than rewrite it.
- Refuse a nonempty new sequence root unless the contents are an explicitly supported empty initialization shape.
- Write a per-execution immutable seal before marking an execution completed. The seal should hash all raw and derived execution files needed to prove that completion.
- On resume, verify every completed execution seal and re-run the appropriate deterministic or strict-finalized evidence validation before skipping it.
- Missing or altered evidence must cause a typed resume refusal, not a silent skip or automatic rerun.
- `evaluateFromState` must fail if a completed execution lacks its expected fingerprint or other required derived evidence.
- A no-op resume of a completed sequence should not start Vite, launch Chromium, append process events, or change raw evidence. It may verify seals and regenerate explicitly derived reports into separately versioned outputs.

## Required tests

Add byte-hash tests proving:

- an identity-refused resume changes no file in the sequence root;
- invoking without `--resume` against an existing sequence changes no file;
- a completed sequence no-op resume does not spawn Vite or Chromium;
- deleting a completed fingerprint causes resume refusal;
- modifying a deterministic ledger causes resume refusal;
- modifying a strict-finalized run file causes resume refusal;
- a nonempty root without state is refused;
- missing fingerprint is never silently omitted from sequence evaluation.

---

# 8. Blocking finding 5 — sequence completion is recorded before final evidence sealing succeeds

**Severity:** Critical  
**Affected areas:** state truthfulness, secret-scan failure, ZIP failure, post-sequence failures

The orchestrator currently:

1. evaluates the sequence;
2. sets `state.status = completed`;
3. writes the completed state;
4. writes the report;
5. then secret-scans and packages the sequence.

If any of the following fails:

```text
cross-run evaluation
report writing
secret scan
inventory creation
ZIP creation
ZIP hashing
```

sequence state may remain `completed` or `in-progress` even though the formal output pipeline failed.

There is no outer sequence-level catch that records a typed sequence failure after state creation. Preflight failures after state creation can likewise leave a stale `in-progress` sequence.

## Required correction

Introduce an explicit sequence-finalization lifecycle, for example:

```text
in-progress
attempts-complete
validating-sequence
packaging
completed
failed
```

Exact names may differ.

Requirements:

- `completed` may be written only after every required gate and archive operation succeeds.
- Any error after state creation must update the sequence state with a typed `sequenceFailureReason`, failed stage, timestamp, and last successful transition.
- A secret-scan failure must result in `failed`, never `completed`.
- A packaging failure must result in `failed`, never `completed`.
- Package result metadata must be durably recorded.
- Re-running package generation must operate from verified immutable evidence and must not mutate raw attempt evidence.

Because an archive cannot contain its own hash without recursion, write a sibling archive receipt such as:

```text
<archive>.sha256
<archive>.receipt.json
```

The receipt should name:

```text
sequence ID
plan SHA
repository SHA
archive filename
archive SHA-256
inventory aggregate
packaging implementation version
createdAtUtc
```

Do not modify the already-packaged sequence root after computing the archive.

## Required tests

Induce and verify:

- secret-scan failure;
- inventory-write failure;
- ZIP-command failure;
- report-write failure;
- evaluation failure;
- Vite preflight failure after state initialization;
- archive-receipt generation;
- no path leaves `status: completed` without a valid archive and receipt.

---

# 9. Blocking finding 6 — “every failed attempt has complete diagnostics” is not true

**Severity:** High  
**Affected areas:** finalization failures, forensic completeness, claims in PR/report

Browser-stage failures generally receive:

```text
failure-screenshot.png
failure-dom.html
failure.json
failure-trace.zip
```

But a successful browser phase stops tracing without saving a trace and closes the browser context before model preparation, strict finalization, or fingerprint enrichment occurs.

If finalization then fails, `executeAttempt` writes only:

```text
failure-message.txt
```

It can no longer capture the required screenshot, DOM, browser trace, or browser console/page errors. The PR description and implementation report claim every thrown stage receives full diagnostics, which is not accurate.

Successful console/page errors are returned by the browser driver but not persisted or evaluated by the orchestrator.

The failure drill checks only three artifacts and does not prove the complete failure contract.

## Required correction

At minimum:

- save an attempt trace for every attempt, not only browser-stage failures;
- save final browser DOM and screenshot before closing every attempt;
- persist console errors and page errors for every attempt;
- write a diagnostic manifest listing which required artifacts were captured and any capture failure;
- preserve gateway log and a bounded Vite/process-log tail in each failed attempt;
- on finalization failure, reference the saved browser-state artifacts and write the finalizer error and stage;
- do not claim diagnostic completeness when capture itself failed—record that failure explicitly.

The browser context may remain open until finalization completes, or the browser phase may always save the necessary artifacts before it returns. Either design is acceptable if the resulting evidence is complete.

## Required tests

Add drills for:

- deterministic ledger validation failure after browser completion;
- `prepareRunDirectory` failure;
- strict finalizer failure;
- Phase 2 enrichment failure;
- fingerprint write failure;
- raw Playwright selector/download failure;
- diagnostic-capture failure itself.

Every case must preserve the required artifact set or an explicit diagnostic-capture-failure record.

---

# 10. Blocking finding 7 — packaging is not yet immutable, portable, or independently reviewable

**Severity:** High  
**Affected areas:** archive reproducibility, stale entries, transient lock state, CI evidence review

## 10.1 The active sequence lock is packaged

`sequence.lock` is created inside the sequence root and remains held while `packageSequence` inventories and zips that root.

The archive therefore includes an ephemeral process PID and lock state that is not research evidence and changes across invocations.

Keep the lock outside the packaged root or explicitly exclude it and all temporary files from both inventory and archive.

## 10.2 Existing POSIX ZIPs are updated in place

On non-Windows platforms the code runs:

```text
zip -r -q <zipPath> .
```

If `<zipPath>` already exists, ZIP updates the archive. Entries removed from the source tree may remain as stale archive entries.

Create a fresh temporary archive, validate it, then atomically rename it to the destination. Never update an existing formal archive in place.

## 10.3 Archive hash is not durably recorded

`packageSequence` returns `zipSha256`, but the orchestrator retains only `zipPath`. The sequence report and state do not contain a durable archive receipt, and CI does not upload one.

## 10.4 The CI artifact is not the evidence package

The exact-head CI upload contains only four small summary files. It omits the actual evidence ZIP and attempt-level evidence, so the Phase 3 proof cannot be independently audited from CI.

The upload also uses:

```text
if-no-files-found: ignore
```

A path regression can therefore leave the evidence-upload step green while uploading nothing useful.

## 10.5 Nested ZIP contents are not secret-scanned

The secret scanner intentionally ignores binary extensions. A Playwright trace ZIP can contain HTML, logs, URLs, and other text, yet its entries are not inspected before being embedded in the outer evidence ZIP.

## 10.6 Standalone packaging accepts unverified roots

`m2:package` can package any supplied directory without requiring a valid completed sequence state or revalidating attempt seals.

## Required correction

- Move the writer lock outside the packaged root.
- Reject symlinks and path traversal in the evidence tree.
- Create a fresh archive in a temporary path and atomically rename it.
- Validate central-directory entry names use portable forward slashes and contain no absolute or parent-traversal paths.
- Re-open and verify the archive against the inventory before declaring success.
- Write a sibling archive receipt containing the ZIP SHA-256.
- Recursively inspect bounded text entries inside nested ZIP artifacts such as Playwright traces, or establish an equally strong tested exclusion/sanitization boundary.
- Make `m2:package` require a completed, identity-valid, seal-valid sequence.
- Upload the actual rehearsal evidence ZIP, archive receipt, inventory, full report, and failure-drill evidence in CI.
- Use `if-no-files-found: error` for required evidence.

## Required tests

Add tests proving:

- `sequence.lock` and temp files are absent from the inventory and archive;
- recreating an archive cannot retain a stale deleted entry;
- archive entry paths contain no backslashes;
- archive extraction succeeds in a clean temporary directory;
- every inventory item matches extracted bytes;
- ZIP hash and receipt verify;
- nested trace content is secret-scanned;
- a missing CI evidence path would fail the workflow;
- standalone package refuses incomplete or failed sequence roots.

---

# 11. Blocking finding 8 — formal execution profiles and attempt verdicts are not enforced

**Severity:** High  
**Affected areas:** live-run comparability, planned gateway stop, unexpected provider loss, replacement spend, threshold governance

## 11.1 Formal timing values are not encoded

For an evidentiary plan, the schema currently enforces only `speed = 1`.

It accepts arbitrary values for:

```text
heartbeatIntervalMs
stallTimeoutMs
stallGraceMs
runTimeoutMs
```

The implementation report explicitly defers numeric enforcement to Phase 4.

The governing contract already specifies:

```text
heartbeat: at least every 60 seconds
stall diagnosis: 120 seconds without tick movement
normal live timeout: 75 minutes
gateway-stop live timeout: 90 minutes
```

A single global `runTimeoutMs` cannot represent both normal and gateway-stop attempts in the same plan.

## 11.2 A planned gateway stop is not a required observed event

The browser driver invokes the stop callback when it observes the configured tick, but the result does not record:

```text
whether the stop fired
actual observed stop tick
wall-clock stop time
accepted response count at stop
child exit outcome
```

If a run reaches terminal state before the configured trigger, it can still be marked completed without performing the planned intervention.

## 11.3 Unexpected gateway death can masquerade as a valid normal run

The simulation is correctly resilient to gateway loss. That does not mean an unplanned gateway death belongs in a normal treatment run.

A normal model attempt can potentially continue through fallback, strict-finalize, and be marked completed even though the gateway child died unexpectedly. That is an operationally valid artifact but an invalid treatment observation unless a pre-registered threshold profile says otherwise.

## 11.4 “Completed” currently means artifact-valid, not study-valid

The state machine records completion after replay/finalization/fingerprint success. It does not apply a registered attempt-threshold profile before completion, despite the governing R1 path including an explicit threshold verdict.

## 11.5 Replacement policy retries every failure class

The plan has one global replacement count. The orchestrator automatically retries any failed attempt until the count is exhausted, including integrity failures and deterministic implementation defects that should halt rather than spend another model run.

## Required correction

Add a versioned execution/threshold profile model.

For evidentiary attempts, require:

- exact timing profile;
- per-attempt normal versus gateway-stop timeout;
- planned stop predicate and required stop evidence;
- expected gateway-lifecycle behavior;
- artifact-validity gates;
- treatment-validity thresholds;
- permitted replacement failure classes;
- stop rules.

Distinguish at least:

```text
artifact-valid
study-valid
failed-preserved
invalid-treatment
```

Exact status names may differ.

A planned gateway-stop attempt must fail its treatment gate if the stop did not fire. A normal attempt must not silently accept unplanned gateway termination.

Replay mismatch, evidence contradiction, wrong condition/model/provider, dirty-worktree violation, and secret findings should never be automatically retried as transient upstream failures.

Phase 4 may add the M2-specific participation thresholds, but Phase 3 must provide the generic versioned gate and replacement-policy mechanism—or hard-refuse evidentiary/live operation until that mechanism exists.

## Required tests

Add tests for:

- evidentiary heartbeat/stall values outside the allowed profile;
- normal and gateway-stop timeout distinction;
- planned stop tick never reached;
- planned stop fires and is recorded exactly once;
- unexpected gateway death in a normal attempt;
- no accepted model response before a required stop;
- integrity failure is not retried;
- registered transient upstream failure may receive one replacement;
- threshold failure is preserved and classified without being mistaken for artifact corruption.

---

# 12. Blocking finding 9 — the API-key process boundary is not actually enforced

**Severity:** High  
**Affected areas:** secret minimization, Vite environment, fake rehearsal isolation, batch child

The requirement is stronger than “the orchestrator never calls `readFileSync('.env.gateway')`.” The API key must remain inside the gateway process only.

The implementation spreads the parent process environment into:

- Vite;
- fake gateway processes;
- live gateway processes;
- post-sequence batch processes.

If `OPENROUTER_API_KEY` is present in the operator shell environment, the key is therefore copied into non-gateway child environments.

Additionally, `gateway/main.ts --fake` still calls `loadGatewayConfig('fake')`, and `loadGatewayConfig` always loads `.env.gateway` and reads OpenRouter fields. The fake adapter does not use the key, but the fake process still reads it. This contradicts the report’s claim that a developer’s local `.env.gateway` can never enter the rehearsal process.

The evidence secret scanner cannot repair an overbroad process boundary after the fact.

## Required correction

Create explicit child-environment builders:

```text
vite environment: allowlisted nonsecret variables only
batch environment: allowlisted nonsecret variables only
fake gateway environment: explicit fake settings; all live credential/model/route vars removed or blanked; no .env.gateway load
live gateway environment: only the gateway receives live credential variables or permission to load .env.gateway
```

Do not use a blanket `{ ...process.env }` for non-gateway children in formal orchestration.

For fake mode, either:

- make gateway configuration skip `.env.gateway` entirely; or
- launch with an environment/root configuration that makes file loading impossible and test that boundary.

## Required tests

Add poisoned-environment tests:

1. set canary API-key values in the parent environment;
2. create a canary `.env.gateway`;
3. run the fake gateway, Vite, and batch paths;
4. prove only the explicitly authorized live gateway path can observe the secret;
5. prove logs, reports, process state, browser state, and evidence contain no canary.

Also recursively secret-scan nested Playwright trace archives as required in Finding 7.

---

# 13. Medium findings and prudent corrections

These items are not independent reasons to reject the PR once the blockers above are correctly resolved, but they should be addressed in the same remediation where practical.

## 13.1 Browser and process provenance is incomplete

The report records Vite and gateway PIDs/exits but not the Chromium process PID or per-attempt browser provenance. One sequence-level browser version is regenerated on resume and is not bound into sequence identity.

Record per-execution:

```text
browser version
Playwright version
headless/headed mode
launch arguments
context options
browser process identity when available
```

Do not let a no-op resume overwrite the browser provenance of prior executions.

## 13.2 Process-record failures are silently swallowed

`ProcessManager.record` suppresses all process-log IO failures, and `stopAll` suppresses stop failures. Formal evidence should not claim complete process provenance if the record failed or a child could not be proven stopped.

For evidentiary runs, make process-record persistence and final child-exit reconciliation explicit gates.

## 13.3 Lock replacement is not fully race-safe

When a stale lock is detected, the code replaces it with a non-exclusive write. Two concurrent processes can theoretically race to replace the same stale lock.

Use a robust atomic lock protocol with a unique holder token and place the lock outside the packaged evidence root.

## 13.4 The uploaded rehearsal artifact is insufficient for independent review

Even after fixing the formal archive path, CI should expose the complete rehearsal archive and failure drill. Summary-only artifacts are useful dashboards, not the evidence itself.

## 13.5 Documentation uses a brittle exact fake-call count

The exact audited CI artifact reports:

```text
emitted 51 / attempted 16 / completed 16
```

The PR body and implementation report state `18 / 18`.

Use the exact audited run when describing a specific workflow, or state only the invariant the rehearsal actually pre-registers:

```text
emitted > attempted
attempted = completed
```

Do not present a timing-sensitive fake-adapter count as a fixed implementation constant.

## 13.6 `m2:pilot` phase citation is inaccurate

The implementation sequence places the live pilot after the Phase 6 adversarial audit, in Phase 7. The current CLI/report calls it “Phase 6.” Correct the wording.

---

# 14. Required remediation sequence

The coding agent should remediate in this order:

## A. Release and identity

1. Synchronize `package-lock.json` to `1.8.0`.
2. Add reviewed model/provider/study identities to the plan and sequence identity.
3. Verify gateway public configuration against the plan before Start.
4. Complete the cost acknowledgment with actual nonsecret model/provider and worst-case call total.

## B. Freeze and sequence-root discipline

5. Require pinned SHA and clean tracked worktree for evidentiary plans.
6. Archive exact plan/study bytes and freeze artifacts.
7. Revalidate freeze identity before and after every attempt.
8. Require an empty, external output root for a new evidentiary sequence.

## C. Resume and attempt seals

9. Make refused resume/non-resume paths read-only.
10. Make cost acknowledgment immutable.
11. Seal every completed execution.
12. Revalidate completed execution seals and evidence on resume.
13. Make missing completed fingerprints fatal rather than silently skipped.
14. Short-circuit a completed-sequence no-op resume before Vite/Chromium launch.

## D. Failure semantics and diagnostics

15. Add sequence-level failure recording and finalization stages.
16. Set sequence `completed` only after archive creation and receipt verification.
17. Preserve browser trace/DOM/screenshot/console data for finalizer-stage failures.
18. Add a required diagnostic manifest.

## E. Formal attempt gates

19. Add versioned execution/threshold profiles.
20. Enforce formal heartbeat/stall/timeout values.
21. Prove and record planned gateway-stop execution.
22. Detect unplanned gateway death.
23. Restrict replacements to pre-registered retryable failure classes.

## F. Secret and packaging boundary

24. Allowlist child environments; do not propagate secrets to Vite/batch/fake.
25. Prevent fake gateways from reading `.env.gateway`.
26. Move/exclude locks and temporary files.
27. Produce a new temporary ZIP and atomically seal it.
28. Persist and verify a sibling archive receipt.
29. Recursively scan nested trace archives.
30. Upload the complete CI rehearsal archive and failure drill with hard path checks.

---

# 15. Exact-head merge gate

After remediation, require a new exact-head clean-checkout CI run covering all existing gates plus these additions.

## 15.1 Identity and freeze tests

```text
package/lock version agreement
model mismatch refusal
serving-provider mismatch refusal
study-plan validation and hash binding
dirty-worktree refusal
per-attempt freeze recheck
mid-attempt source-change invalidation
external output-root enforcement
```

## 15.2 Resume and evidence-integrity tests

```text
refused resume is byte-read-only
no-op completed resume starts no Vite/browser
completed deterministic evidence tamper refusal
completed finalized-run tamper refusal
missing fingerprint refusal
nonempty root without state refusal
immutable cost acknowledgement
per-execution seal verification
```

## 15.3 Failure-state and diagnostic drills

```text
preflight failure recorded
browser failure diagnostics
ledger-validation failure diagnostics
prepare-run failure diagnostics
strict-finalization failure diagnostics
enrichment failure diagnostics
secret-scan failure → sequence failed
ZIP failure → sequence failed
no completed state without archive receipt
```

## 15.4 Formal execution tests

```text
normal versus gateway-stop timeout profiles
formal heartbeat/stall bounds
planned stop fires and is recorded
planned stop not reached → invalid treatment
unexpected gateway death → invalid treatment
integrity failure is not automatically retried
registered transient failure replacement works
```

## 15.5 Secret and package tests

```text
poisoned parent environment
poisoned .env.gateway under fake mode
non-gateway children cannot observe key
nested Playwright trace scan
fresh ZIP contains no stale entries
no lock/temp/symlink entries
portable forward-slash paths
clean extraction + inventory verification
archive SHA receipt verification
CI uploads complete evidence with if-no-files-found:error
```

Then rerun:

```text
application and gateway typechecks
lint and formatting
frozen-data validation
all unit/integration tests
gateway tests
model-bundle tests
both builds
distribution secret scan
Playwright
100-run deterministic batch
keyless model rehearsal
affordance audit
Phase 3 logic suites
complete keyless unattended rehearsal
complete failure drills
```

No live API call is required for this remediation or re-audit.

---

# 16. Final directive

> PR #13 is **not authorized to merge** at `fb274f4d10259bb506644e04c9ba6566d728ac37`.
>
> Preserve the accepted browser-driving, gateway-isolation, Phase 2 finalization, replay, and deterministic-evaluation architecture. Remediate the formal identity/freeze boundary, resume immutability, sequence completion semantics, diagnostic completeness, packaging/sealing, timing and threshold gates, secret-process boundary, and package-lock version.
>
> Obtain green exact-head CI and stop for re-audit. Do not begin Phase 4 and do not make any live model call while addressing this audit.
