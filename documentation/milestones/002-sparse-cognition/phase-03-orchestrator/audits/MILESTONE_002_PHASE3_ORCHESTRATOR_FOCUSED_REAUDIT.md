# Milestone 002 — Phase 3 Unattended Orchestrator — Focused Re-Audit

**Date:** July 31, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#13 — Milestone 2 Phase 3: repository-native unattended orchestrator (1.8.0)`  
**Audited implementation head:** `37b716d816757f42a890436dfc044de378d484c5`  
**Base:** `9cc1fac2026ae45d8ce72f92d53955aaf3e229f6`  
**Exact-head CI:** workflow run `30601194249`  
**Status:** **REQUEST CHANGES — FOUR FOCUSED ISSUES REMAIN**  
**Scope:** Phase 3 only. Do not merge PR #13 and do not begin Phase 4 until the corrections below are complete and receive green exact-head CI. No live API call is required or authorized.

---

# 1. Executive verdict

The second remediation is substantial, coherent, and generally well designed. PR #13 is now much closer to a production-quality formal-evidence runner.

The exact implementation head audited here is:

```text
37b716d816757f42a890436dfc044de378d484c5
```

PR #13 remains open and mergeable. Exact-head CI run `30601194249` passed the complete clean-checkout workflow, including:

```text
73 Vitest files
694 Vitest tests
55 gateway tests
127 model-bundle tests
10 Playwright tests
100 deterministic runs per scenario
keyless Milestone 1 model rehearsal
affordance and interruption-contract audit
Phase 3 orchestrator tests
complete keyless unattended-orchestrator rehearsal
full evidence upload
```

All fourteen deterministic golden hashes remain byte-identical.

The following major areas are accepted and should be preserved:

- mutable operational control state is separated from immutable evidence;
- the archive carries a final evidence manifest rather than an in-flight operational state;
- completed-sequence resume verifies terminal seals, the inventory, archive, receipt, extraction, and semantic evidence;
- study declarations are semantically reconciled with the plan rather than merely authenticated by hash;
- artifact validity and study validity are represented separately;
- attempt profiles and failure classes are versioned;
- hard-stop failure classes are structurally impossible to register as retryable;
- non-retryable replacement dispositions survive process restart;
- terminal completed, failed, and interrupted attempts are sealed;
- post-browser failures carry typed stages;
- the freeze now spans the post-sequence batch, evaluation, reporting, packaging, and pre-receipt stages;
- formal and live operation are safely hard-refused until Phase 4 registers a reviewed formal attempt profile.

Four focused issues remain. Three are high or critical evidence-integrity defects; the fourth concerns two advertised verification guarantees that are currently weaker than claimed.

**Verdict:** request changes. Preserve the accepted architecture and make one focused remediation. This is not a request for another redesign.

---

# 2. Verification performed

This focused re-audit used:

- PR #13 metadata and the exact remediation diff from audit commit `20caab0` to implementation head `37b716d`;
- exact-head source inspection;
- exact-head GitHub Actions status, job list, and full workflow logs;
- the coding agent’s re-audit response;
- comparison against the prior comprehensive re-audit’s explicit requirements.

The exact-head workflow completed successfully. Its unattended rehearsal reported:

```text
sequence completed: 3/3 executions
gateway-stop: emitted 51 > attempted 16 = completed 16
completed root immutable against inventory
archive, sidecar, and receipt verified
completed resume verified as a no-op
forbidden-disposition failure drill preserved and sealed
failed-drill resume refused
m2:evaluate wrote only to the derived directory
```

The workflow uploaded a complete evidence artifact of approximately 1.23 GB. The exact count is timing-dependent and should continue to be reported through the registered invariant rather than treated as a fixed constant.

---

# 3. Accepted remediation areas

## 3.1 Final evidence architecture

The split between:

```text
<sequence-root>          immutable evidence
<sequence-root>.control  mutable operational state
```

is the correct architecture.

The evidence root now contains an immutable `sequence-manifest.json` and final reports before inventory and packaging. The post-archive `completed` transition touches only the control root. Versioned archive names and destination-volume staging eliminate the former cross-volume copy fallback.

## 3.2 Study reconciliation

The new versioned study-to-plan mapping is a serious improvement. It checks repository and package identity, treatment, condition/scenario/seed sets, sample size, ordering, budgets, pacing and caps, replacement policy, output location, metric versions, analysis version, and attempt-profile binding.

## 3.3 Artifact-valid versus study-valid

The attempt-profile layer now captures a distinction that Milestone 1 proved was necessary:

```text
artifact-valid
study-valid
invalid-treatment
```

An artifact-valid run that misses registered treatment thresholds is preserved without becoming primary evidence.

## 3.4 Closed failure taxonomy and resume-safe dispositions

The failure taxonomy is now closed and versioned. Retryable classes are a strict subset. Hard-stop failures cannot be named as retryable by a plan, and the recorded replacement disposition prevents a non-retryable failure from being revived after restart.

## 3.5 Terminal evidence and semantic revalidation

Completed, failed, and interrupted attempts receive terminal seals. Completed attempts are semantically revalidated through ledger validation or strict-finalized evidence loading, fingerprint recomputation, and treatment cross-checks.

## 3.6 Full-pipeline freeze checks

The freeze now covers attempt boundaries and post-sequence checkpoints. The injected drift matrix demonstrates the intended control flow.

## 3.7 Finalization typing and child-boundary work

Post-browser failures now carry typed finalization stages, and the primary helper environment boundary has been substantially expanded. The finalization injection drills and process-provenance health model are accepted.

---

# 4. Blocking finding 1 — signal-terminated processes are mistaken for running processes

**Severity:** High  
**Affected areas:** process provenance, unexpected gateway death, formal sequence completion

## 4.1 Current behavior

`ProcessManager` records an exit outcome such as:

```text
signal:SIGTERM
```

but its `exitCode()` accessor stores only the numeric exit code.

When a child exits by signal, Node provides:

```text
exitCode = null
signal = SIGTERM or SIGKILL
```

The process log therefore records a terminal signal while the accessor continues to return `null`.

The health calculation uses `exitCode() === null` to decide whether a process is still running. The unexpected-gateway-death check uses the same accessor.

## 4.2 Consequences

This creates two opposite errors.

### False unreconciled-child failure

A Vite or gateway process that definitely exited by signal can be reported as a still-running child. A formal sequence may then fail:

```text
process-evidence-incomplete
```

although the child is terminal and its signal is already in the log.

### Missed unexpected gateway death

A gateway killed unexpectedly by `SIGTERM` or `SIGKILL` can evade:

```text
gateway-died-unexpectedly
```

because its numeric exit code remains null.

## 4.3 Required correction

Replace the ambiguous terminal accessor with explicit process state, for example:

```text
hasExited(): boolean
terminalOutcome(): string | null
numericExitCode(): number | null
exitSignal(): string | null
```

Requirements:

- `runningChildren` must be based on `hasExited()`, never on the numeric exit code alone;
- unexpected gateway-death detection must use terminal state;
- the implementation must distinguish:
  - still running;
  - planned gateway stop completed;
  - orchestrator-initiated normal shutdown;
  - unexpected terminal exit;
- process reports should retain the exact numeric code or signal.

## 4.4 Required tests

Add tests for:

```text
natural exit code 0
nonzero numeric exit
SIGTERM exit
SIGKILL exit
spawn error
signal-terminated Vite not reported as running
externally signal-terminated gateway classified gateway-died-unexpectedly
planned signal termination not classified as unexpected death
```

---

# 5. Blocking finding 2 — Chromium still inherits the parent credential environment

**Severity:** High  
**Affected areas:** secret minimization, browser-process boundary, accuracy of the PR’s security claim

## 5.1 What has been fixed

The remediation correctly sanitizes environments for:

```text
Vite
batch
fake gateway
keep-awake
zip/unzip/tar
git
taskkill
```

## 5.2 Remaining hole

Chromium is launched without an explicit environment:

```ts
chromium.launch({ headless: !options.headed })
```

The Chromium operating-system process therefore inherits the orchestrator’s full parent environment. An operator-exported:

```text
OPENROUTER_API_KEY
OPENAI_API_KEY
```

can enter the browser process.

Page JavaScript does not ordinarily receive those variables, but the governing requirement is stricter:

> Only the authorized live gateway process receives the credential.

Chromium is another process and currently violates that boundary.

## 5.3 Required correction

Add a browser-specific environment builder based on the nonsecret helper environment.

For headed operation, explicitly restore only required display/session variables where applicable, for example:

```text
DISPLAY
XAUTHORITY
WAYLAND_DISPLAY
DBUS_SESSION_BUS_ADDRESS
```

Do not spread `process.env` into Chromium.

Launch Chromium with the reduced environment.

## 5.4 Required tests

Add a launch seam, wrapper executable, or equivalent spawned-observation test proving that a browser child under a poisoned parent environment cannot observe:

```text
OPENROUTER_API_KEY
OPENAI_API_KEY
```

The child-boundary suite must explicitly enumerate Chromium. The existing list of helper processes must not be treated as exhaustive.

---

# 6. Blocking finding 3 — late packaging failures can strand a completed dataset permanently

**Severity:** Critical  
**Affected areas:** resume after packaging failure, preservation of paid completed runs, evidence immutability

## 6.1 Current lifecycle

`packageSequence` writes `sha256-inventory.json` into the evidence root before several operations that can still fail:

```text
ZIP creation
archive-size validation
archive extraction verification
atomic rename
post-package freeze check
.sha256 sidecar write
receipt write
```

If any later stage fails, the inventory remains in the evidence root.

The sequence is not `completed`, so a later `--resume` takes the ordinary non-completed path. That path can:

```text
start Vite and Chromium
append process-log.jsonl
append or rewrite vite.log
rerun evaluation
rewrite sequence-report.json
rewrite sequence-report.md
rewrite sequence-manifest.json
```

Those writes alter files already covered by the surviving inventory.

When packaging runs again, `packageSequence` sees the existing inventory and correctly verifies the root against it. The verification then fails because the ordinary resume path changed inventoried files.

## 6.2 Consequence

A transient packaging-stage failure can permanently strand a sequence after all primary and replacement runs have already completed.

This is the worst point at which to lose resumability: the model spend and operator time have already been incurred, and the only incomplete work is evidence publication.

## 6.3 Required correction

Introduce an explicit **packaging-ready recovery path**.

Once a valid inventory exists:

- treat the evidence root as immutable;
- verify it against the inventory before any write;
- do not start Vite or Chromium;
- do not append to the evidence-root process log;
- do not rerun or rewrite evaluation, report, or manifest;
- re-run only the appropriate freeze verification and packaging transaction;
- create the next versioned archive;
- write its sidecar and receipt;
- update only control-root operational state.

A different acceptable design is to build the inventory and archive from a staged immutable snapshot, so a failed package transaction leaves no inventory in the working evidence root.

Whichever design is chosen, a failed packaging transaction must remain recoverable without rerunning a completed attempt or modifying inventoried evidence.

## 6.4 Required tests

Inject failures after inventory creation at each of these points:

```text
ZIP creation
archive-size rejection
extraction verification
atomic archive commit
post-package freeze check
sidecar write
receipt write
```

For each case prove:

- sequence state records failure;
- all completed attempt evidence remains intact;
- resume starts no Vite, Chromium, or gateway process;
- resume changes no inventoried byte;
- resume creates a valid versioned archive and receipt;
- prior incomplete or unreceipted archive material is handled explicitly;
- completed state is written only after verification succeeds.

---

# 7. Blocking finding 4 — two advertised integrity checks are weaker than claimed

**Severity:** Medium-high  
**Affected areas:** study freeze, completed manifest authority, control-state tampering

## 7.1 The archived study freeze record is not re-hashed

The PR and report state that every freeze checkpoint verifies:

```text
archived study bytes
archived study freeze record
external registered study file
```

The implementation hashes the archived study and external study files. For:

```text
study.freeze.archived.json
```

it checks only that the file exists.

Its contents can change without triggering a freeze violation.

### Required correction

Bind the exact freeze-record bytes or SHA-256 into `FreezeIdentity`.

At every checkpoint:

- verify its exact bytes or hash;
- parse the record;
- verify:
  - study ID;
  - study version;
  - plan SHA-256;
  - configuration fingerprint.

Add tamper tests for every field and for byte-level changes that preserve valid JSON.

## 7.2 Completed verification does not reconcile the immutable manifest with control state

`verifyCompletedSequence` parses `sequence-manifest.json`, but currently checks only that:

```text
manifest.sequenceId == state.sequenceId
manifest.attemptSetComplete == true
```

It does not require the immutable manifest and mutable control state to agree on:

```text
identity fields
all execution IDs
all planned attempts
terminal statuses
failure classes and stages
artifact statuses
study statuses
replacement dispositions
threshold verdicts
run IDs
seal aggregates
```

### Concrete failure shape

A control-state edit could remove an earlier failed replacement execution while leaving the later completed execution intact.

Then:

- the plan still has one completed execution for the attempt;
- the evidence root and archive remain unchanged;
- the removed failed execution is no longer iterated by state-based seal verification;
- the no-op completed resume can succeed without reconciling the immutable manifest’s full execution history.

### Required correction

Treat the immutable manifest as authoritative.

Completed verification must compare the manifest and control state exactly for all materially relevant fields, including:

```text
plan/repository/package/experiment/treatment/study/profile identities
planned attempt coverage
execution count and IDs
attempt IDs
terminal status
failure reason and stage
artifact and study status
replacement disposition
threshold verdicts
run ID
seal aggregate
navigation count
browser provenance
```

A missing, extra, reordered where order is meaningful, or changed execution must cause a typed read-only resume refusal.

Add tests for:

```text
removed failed execution in control state
extra execution in control state
changed failure class
changed disposition
changed threshold verdict
changed seal aggregate
changed run ID
changed identity field
```

---

# 8. Deferred items that remain appropriately blocked

The following do not independently block Phase 3 because every formal or live plan is still rejected by:

```text
formal-attempt-profile-required
```

They remain mandatory before Stage A live execution.

## 8.1 Exact observation-cell multiplicity

Study reconciliation currently compares condition, scenario, and seed sets plus total `n`. For a multi-condition formal design, the registry should bind exact observation cells and replicate multiplicities, or bind the exact orchestrator plan hash directly.

The current implementation is sufficient for the initial single-cell R2 variance study but should not be assumed sufficient for the later formal 24-run design.

## 8.2 Genuinely bounded tracing

Disabling source embedding reduces trace size but does not bound snapshot and polling-event growth.

The exact CI rehearsal artifact remains approximately 1.23 GB for three accelerated attempts. Before the first 1× Stage A live run, add and validate genuinely bounded or chunked tracing, evidence-size forecasting, and explicit retention behavior.

---

# 9. Required remediation order

The coding agent should proceed in this order.

## A. Process terminal-state correctness

1. Replace numeric-exit-code-as-liveness with explicit terminal state.
2. Correct process-provenance health.
3. Correct unexpected gateway-death detection.
4. Add signal-based process tests.

## B. Complete credential boundary

5. Add a reduced Chromium environment.
6. Preserve only explicitly required display/session variables for headed mode.
7. Add a real child-observation test for Chromium.

## C. Packaging recovery

8. Add an immutable packaging-ready resume state or staged-snapshot model.
9. Ensure late packaging failures do not rerun attempts or mutate inventoried evidence.
10. Add failure injection and successful-resume tests for every late packaging stage.

## D. Final integrity reconciliation

11. Hash and parse the archived study freeze record at every checkpoint.
12. Make the immutable sequence manifest authoritative over completed control state.
13. Add manifest/state divergence tests.

## E. Verification

14. Run the complete exact-head clean-checkout workflow.
15. Stop for targeted re-audit.

---

# 10. Merge gate

Do not make a live model call during this remediation.

Before requesting verification, require:

```text
application typecheck
gateway typecheck
lint and formatting
frozen-data validation
full unit and integration suite
gateway suite
formal model-bundle suite
application and gateway builds
distribution secret scan
Playwright e2e
100-run deterministic batch
keyless model rehearsal
affordance and interruption audit
Phase 3 orchestrator tests
complete keyless unattended rehearsal
full evidence upload with hard path enforcement
```

The new tests must specifically exercise the four findings above.

All fourteen deterministic golden hashes must remain byte-identical.

---

# 11. Final directive

> Preserve the accepted Phase 3 architecture. Do not begin Phase 4. Correct signal-aware process terminal state, sanitize the Chromium process environment, add an immutable packaging-only recovery path for late packaging failures, hash and validate the archived study freeze record, and reconcile completed control state exactly against the immutable sequence manifest. Obtain green exact-head CI and stop for targeted re-audit. No live API call is authorized.
