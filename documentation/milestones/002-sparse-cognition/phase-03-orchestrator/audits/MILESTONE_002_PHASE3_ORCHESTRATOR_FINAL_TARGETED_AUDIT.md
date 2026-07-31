# Milestone 002 — Phase 3 Unattended Orchestrator — Final Targeted Audit

**Date:** July 31, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#13 — Milestone 2 Phase 3: repository-native unattended orchestrator (1.8.0)`  
**Audited implementation head:** `2c45e171ea66163ac39f2ba1cd2405c482ff16dc`  
**Exact-head CI:** workflow run `30607035098`  
**Status:** **REQUEST CHANGES — THREE FINAL PHASE 3 MERGE BLOCKERS**  
**Scope:** Phase 3 only. Do not merge PR #13 and do not begin Phase 4 until the three corrections below are complete and receive green exact-head CI. No live API call is required or authorized.

---

# 1. Finality and governance ruling

This document is the Project Advisor’s **final Phase 3 audit revision before transition to Phase 4**.

The remaining Phase 3 merge blockers are limited to:

1. post-spawn child-process errors being treated as terminal exits;
2. incomplete authentication of the inventory aggregate;
3. packaging-recovery verification occurring before the single-writer lock is acquired.

All other Phase 3 architecture and remediation areas are accepted, subject only to avoiding regressions while correcting these three issues.

After one focused remediation and a new green exact-head CI run, the Advisor will perform **targeted verification of these three items only**. A broad Phase 3 re-audit will not be reopened unless the remediation materially changes an already accepted subsystem or introduces a visible regression.

If the three corrections pass targeted verification, PR #13 should merge. Green merged-`main` CI will then close Phase 3 and formally unlock Phase 4.

---

# 2. Current verification state

The audited head is:

```text
2c45e171ea66163ac39f2ba1cd2405c482ff16dc
```

PR #13 remains open and mergeable. Exact-head workflow run `30607035098` passed the complete clean-checkout workflow, including:

```text
76 Vitest files
747 Vitest tests
169 Phase 3 tests
55 gateway tests
127 formal model-bundle tests
10 Playwright tests
100 deterministic runs per scenario
keyless Milestone 1 model rehearsal
affordance and interruption-contract audit
complete unattended-orchestrator rehearsal
packaging-recovery rehearsal and evidence upload
```

All fourteen deterministic golden hashes remain byte-identical.

The focused remediation successfully established:

- signal-aware numeric-versus-signal exit handling;
- a reduced nonsecret environment for the Chromium operating-system process;
- byte- and field-level verification of the archived study freeze record;
- comprehensive reconciliation of immutable manifest facts against mutable control state;
- a real packaging-only recovery path exercised across all seven post-inventory failure points;
- authenticated control-state recording of the inventory aggregate before the inventory file is written;
- preservation and explicit supersession of committed but unreceipted archives;
- no-process-launch recovery after a late packaging failure.

Those systems are accepted. The issues below are narrower defects inside their final contracts.

---

# 3. Final blocker 1 — post-spawn `error` is not proof of process termination

## 3.1 Finding

`ProcessManager` now correctly distinguishes numeric exits from signal exits. However, after a child has successfully spawned, it still treats every child-process `error` event as terminal:

```ts
child.on('error', () => {
  terminal = { outcome: 'spawn-error', code: null, signal: null };
  resolve('spawn-error');
});
```

That is not a safe liveness rule.

After successful spawn, an `error` event may describe an operation failure rather than operating-system process termination—for example, a failed kill, failed IPC operation, or abort-related error. A later exit event may or may not follow. The process must not be declared dead merely because an operation emitted an error.

The current regression test exposes the defect directly: it emits `error` on a deliberately long-running child, asserts that the manager considers the child terminated, and then manually kills the still-running process.

## 3.2 Risk

This can produce the contradictory state:

```text
process manager: terminal, spawn-error, no running child
operating system: child may still be alive
```

Consequences include:

- an orphaned Vite or gateway process;
- a false-green process-provenance gate;
- `stop()` returning before the child has actually ended;
- incorrect gateway lifecycle classification;
- port conflicts or credential-bearing live-gateway remnants after an apparent shutdown.

## 3.3 Required correction

After a process has successfully spawned:

1. Establish terminal state only from a genuine `exit` event, or from a narrowly defined `close` fallback that proves the child ended and cannot later produce a contradictory exit result.
2. Treat post-spawn `error` events as **process-operation diagnostics**, not terminal proof.
3. Record those diagnostics explicitly, for example:

```text
processErrorCount
lastProcessError
per-child processErrors
```

4. Keep a child in `runningChildren` until an actual terminal event occurs.
5. Make `stop()` continue waiting for actual termination when a kill operation emits an error. If termination cannot be established within the shutdown contract, process provenance must fail rather than report success.
6. Preserve the current immediate refusal for a command that never successfully spawned and has no PID.
7. Ensure gateway-death classification consumes only genuine terminal state.

## 3.4 Required tests

Add or revise tests proving:

```text
natural exit 0
nonzero numeric exit
SIGTERM exit
SIGKILL exit
unspawnable command with no PID
post-spawn error while the child remains alive
failed kill/error followed by a later real exit
post-spawn error remains visible in process provenance
runningChildren retains the child after a nonterminal error
actual exit removes it from runningChildren
unexpected gateway death is classified only after genuine termination
```

The corrected post-spawn-error test must demonstrate:

```text
emit error while child is alive
→ hasExited() remains false
→ child remains in runningChildren
→ process error is recorded
→ actual SIGTERM/SIGKILL
→ exit event establishes terminal state
```

---

# 4. Final blocker 2 — inventory aggregate must be recomputed from authenticated entries

## 4.1 Finding

The packaging pipeline now records `inventoryAggregateSha256` in control state before writing `sha256-inventory.json`. This is the correct architectural direction.

Recovery currently verifies:

```text
state.inventoryAggregateSha256
    == inventory.aggregateSha256
```

and separately checks that each evidence file matches the hash listed in `inventory.files`.

It does **not** recompute the aggregate from the inventory entries and require the recomputed value to equal `inventory.aggregateSha256`.

The intended aggregate is:

```text
SHA-256(
  inventory.files
    .map(file => `${file.name}:${file.sha256}`)
    .join("\n")
)
```

Without recomputation, the aggregate field is not cryptographically bound to the entry list.

## 4.2 Concrete bypass

An attacker or accidental mutation can:

1. alter an inventoried non-attempt file such as `vite.log`, `process-log.jsonl`, or `sequence-report.json`;
2. replace that file’s hash in `inventory.files` with the altered file’s new hash;
3. leave `inventory.aggregateSha256` unchanged;
4. preserve equality with the control-state aggregate;
5. pass tree verification because the changed file now matches the changed entry;
6. recover and receipt an archive containing altered evidence.

The existing adversarial test changes both the file-entry hash and the aggregate field. It catches an obvious complete rewrite, but not this aggregate-preserving entry rewrite.

## 4.3 Required correction

Create one shared strict inventory parser and validator used everywhere inventory evidence is consumed.

The validator must:

1. schema-validate the inventory object;
2. require a nonempty, correctly formatted SHA-256 for every entry and aggregate;
3. reject duplicate paths;
4. reject absolute paths, parent traversal, dot segments, backslashes, non-normalized paths, and platform-dependent forms;
5. require deterministic ordering or canonicalize and reject a noncanonical stored order;
6. recompute the aggregate from the exact validated entries;
7. require the recomputed aggregate to equal `inventory.aggregateSha256`;
8. only then compare the authenticated aggregate with `state.inventoryAggregateSha256`;
9. only then compare the evidence tree against the entry hashes.

Use the same validator in:

```text
readInventory
verifyTreeAgainstInventory
verifyCompletedSequence
m2:package
packaging-ready recovery
archive extraction verification
any receipt or inventory reconciliation path
```

Recording an exact `inventoryFileSha256` in control state is an acceptable additional defense, but it does not replace recomputing and validating the semantic aggregate from the entries.

## 4.4 Required tests

Add the missed regression:

```text
modify an inventoried evidence file
update only that file’s inventory.files hash
leave inventory.aggregateSha256 unchanged
attempt packaging recovery
→ refusal before archive creation or recovery-state mutation
```

Also test:

```text
duplicate path
unsorted or noncanonical entry order
absolute path
parent traversal
backslash path
malformed SHA-256
aggregate that does not recompute
valid canonical inventory control case
```

The same malformed inventory must be refused consistently by completed resume, standalone packaging, packaging recovery, and extraction verification.

---

# 5. Final blocker 3 — packaging recovery must lock before authoritative verification

## 5.1 Finding

`resumePackagingReady` currently performs its expensive read-only verification before acquiring the single-writer lock.

Although the evidence root is immutable, the control state remains mutable. Verifying against an unlocked state object and acquiring the lock later creates a stale-state race.

## 5.2 Race scenario

Two recovery invocations can:

1. read the same failed control state;
2. both complete verification before either holds the lock;
3. allow invocation A to acquire the lock, package, mark the sequence completed, and release the lock;
4. allow delayed invocation B to acquire the now-free lock while still holding the stale pre-completion state object;
5. create another archive and overwrite control state from stale checkpoint and supersession data.

This does not alter the immutable evidence root, but it defeats the control plane’s single-writer guarantee and can produce unnecessary archives or stale operational metadata.

## 5.3 Required correction

For packaging recovery:

1. Perform only immutable identity/path prechecks before locking.
2. Acquire the control-root writer lock before authoritative recovery verification.
3. Re-read `sequence-state.json` after lock acquisition.
4. Re-run resume identity and resumability checks against the re-read state.
5. Re-read and strictly authenticate the inventory under the same lock.
6. Reconcile the immutable manifest against the newly read state.
7. Re-run terminal seals and semantic evidence validation under that state.
8. If the sequence became `completed` while this invocation waited, run complete no-op verification and return without another package transaction.
9. Otherwise execute packaging recovery while retaining the lock through receipt creation and the final control-state write.
10. Never write a stale in-memory state object after acquiring the lock.

Lock creation and release occur in the control root, not the immutable evidence root, so this ordering does not compromise evidence immutability.

## 5.4 Required tests

Add a race-oriented test or deterministic lock seam proving:

```text
invocation B reads failed state
invocation A completes recovery and writes completed state
invocation B acquires the lock afterward
invocation B re-reads completed state
→ performs completed verification
→ returns no-op
→ creates no additional archive
→ does not overwrite checkpoints, supersededArchives, archive identity, or timestamps from stale state
```

Also prove that inventory or state changes made while a recovery invocation is waiting for the lock are observed and refused after lock acquisition.

---

# 6. Accepted Phase 3 areas

The coding agent should preserve the following accepted work rather than redesign it:

- repository-native DOM-driven unattended operation;
- fresh gateway process and browser context isolation;
- fixed-port and cost interlocks;
- treatment identity and serving-route binding;
- registered-study reconciliation;
- separate artifact-valid and study-valid verdicts;
- versioned attempt profiles;
- closed failure taxonomy;
- replacement dispositions persisted across resume;
- exact replay and strict-finalization pipeline;
- Phase 2 enriched behavioral fingerprints;
- terminal execution seals;
- semantic revalidation of completed evidence;
- immutable evidence root and separate mutable control root;
- versioned atomic archives and receipt-last lifecycle;
- packaging-only recovery as the correct recovery architecture;
- reduced environments for Vite, batch, fake gateway, helpers, keep-awake, Git, taskkill, and Chromium;
- study-freeze-record field and byte verification;
- immutable-manifest-to-control-state reconciliation;
- full-pipeline freeze checkpoints;
- typed post-browser finalization failures;
- browser diagnostics and provenance;
- planned gateway-stop and unexpected gateway-death evidence;
- no-op completed resume;
- keyless rehearsal and full CI evidence upload.

These areas will not be reopened in the final targeted verification unless the last remediation changes or regresses them.

---

# 7. Deferred but non-blocking prerequisites for Phase 4 live work

The following are intentionally deferred and do not independently block PR #13:

1. **Formal attempt profile and registered study:** Phase 4 must register these before evidentiary or live execution becomes possible. The current hard refusal is correct.
2. **Bounded or chunked Playwright tracing:** this must be implemented and validated before the first 1× live Stage A run. The accelerated CI evidence is already extremely large; disabling source embedding does not bound snapshot/event growth.
3. **Exact observation-cell multiplicities for later multi-condition studies:** the current set-based study reconciliation is sufficient for the initial single-cell R2 variance study, but later formal multi-condition designs should bind exact condition × scenario × seed × replicate cells or directly bind the reviewed orchestrator plan hash.

These items belong to Phase 4 planning and live-readiness gates, not to this final Phase 3 merge correction.

---

# 8. Final remediation and merge gate

The coding agent should make one final focused remediation containing only:

1. nonterminal handling and provenance for post-spawn process errors;
2. strict inventory schema validation and aggregate recomputation;
3. lock-before-verification with state and inventory re-read for packaging recovery.

No live model call is needed or authorized.

After remediation, require a new exact-head clean-checkout CI run covering the existing full gate:

```text
type checks
lint and frozen-data validation
complete unit and integration suite
gateway suite
formal model-bundle suite
production builds and secret scan
Playwright
100-run deterministic batch
keyless Milestone 1 model rehearsal
affordance and interruption-contract audit
Phase 3 unit/integration suite
complete unattended-orchestrator rehearsal
hard-path evidence upload
```

The final targeted verification will check only:

- post-spawn errors remain nonterminal until genuine exit;
- inventory entries, aggregate, control-state seal, tree, archive, and receipt form one authenticated chain;
- packaging recovery holds the lock while operating on freshly re-read state and inventory, and a delayed competing invocation becomes a verified no-op.

**Merge authorization is withheld at head `2c45e171ea66163ac39f2ba1cd2405c482ff16dc`.**

Assuming those three corrections are sound and exact-head CI is green, PR #13 should be authorized to merge without another broad audit. Green merged-`main` CI will close Phase 3 and unlock Phase 4.
