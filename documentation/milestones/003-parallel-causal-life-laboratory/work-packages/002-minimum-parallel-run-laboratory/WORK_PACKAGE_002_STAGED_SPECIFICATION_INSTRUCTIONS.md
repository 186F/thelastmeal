# Milestone 3 Work Package 2 — Staged Specification Instructions

**Date:** August 3, 2026  
**Status:** AUTHORITATIVE WORKING-PR INSTRUCTIONS  
**Work package:** Minimum Parallel-Run Laboratory Specification  
**Repository:** `186F/thelastmeal`  
**Branch:** `docs/m3-wp2-staged-specification`  
**Base SHA:** `6c1dcb8562c93e085dc9964a0a4c44febf8e37ba`

---

## 1. Purpose

This working PR will produce the versioned technical and evidence specification
for Work Package 2 of the Milestone 3 research program.

The specification must answer, with testable precision:

> How can the repository execute many isolated runs and multiple independent
> studies concurrently while preserving run identity, treatment identity,
> logical time, model-request attribution, replay, failure evidence, and final
> study integrity?

This work package is **specification only**. It does not authorize the parallel
laboratory's implementation, a cloud deployment, a worker system, a scheduler,
a queue, an inference broker, a storage service, a new experiment, a scenario,
a model call, or evidence generation.

The eventual specification must be implementation-ready in the following
limited sense: a later implementation team should not have to invent scientific
or evidence-governance rules while writing code. It may still have to select
technical mechanisms from explicitly unselected options.

---

## 2. Authority and precedence

Read and apply the following hierarchy:

1. The merged Milestone 3 research charter.
2. These staged Work Package 2 instructions.
3. Later explicit Advisor rulings posted on the working PR.
4. Existing technical references, Milestone 2 records, and source code as
   evidence of the current system—not as silent authorization to preserve every
   current implementation choice.

The governing charter is:

```text
documentation/milestones/003-parallel-causal-life-laboratory/
  MILESTONE_003_RESEARCH_CHARTER.md
```

The Milestone 2 closeout and canonical analysis remain immutable historical
records. This work may cite them but must not alter, reinterpret, repackage, or
adopt their evidence as Work Package 2 evidence.

If an instruction here conflicts with a later explicit Advisor ruling, the
later ruling governs. Do not resolve a material conflict silently.

---

## 3. Manual setup for CA2

Use a clean local checkout or a worktree dedicated to this branch.

Before every chunk:

```bash
git fetch origin
git checkout docs/m3-wp2-staged-specification
git pull --ff-only
git status --short
git rev-parse HEAD
git merge-base HEAD origin/main
git rev-list --left-right --count HEAD...@{upstream}
```

Required environment:

- Git
- GitHub CLI authenticated for `186F/thelastmeal`
- Node.js 22 or the version required by the repository
- Repository dependencies installed with `npm ci` if local documentation checks
  cannot otherwise run

No API key is required or authorized. Do not place a model-provider credential
in the environment for this work.

Before editing, stop and report if:

- the branch is not `docs/m3-wp2-staged-specification`;
- the merge base is not the declared base SHA unless the Advisor has explicitly
  rebased the work package;
- the worktree contains unexplained changes;
- the branch has unexpected upstream divergence;
- the merged Milestone 3 charter is missing;
- the post-merge `main` CI gate for the declared base is not successful;
- a governing file has changed unexpectedly; or
- the requested chunk would require a prohibited source, workflow, experiment,
  or evidence change.

Do not force-push at any stage.

---

## 4. Deliverables and final file scope

The completed PR is expected to contain these Work Package 2 files:

```text
documentation/milestones/003-parallel-causal-life-laboratory/
  work-packages/002-minimum-parallel-run-laboratory/
    README.md
    WORK_PACKAGE_002_MINIMUM_PARALLEL_RUN_LABORATORY_SPECIFICATION.md
    WORK_PACKAGE_002_CONFORMANCE_REQUIREMENTS.md
    WORK_PACKAGE_002_STAGED_SPECIFICATION_INSTRUCTIONS.md
```

The final integration chunk may also make minimal status and navigation changes
to:

```text
README.md
documentation/README.md
documentation/milestones/003-parallel-causal-life-laboratory/README.md
```

No other file may change in this PR.

In particular, do not modify:

- source files;
- test files;
- schemas;
- prompts;
- package or lock files;
- GitHub Actions workflows;
- experiment plans or registrations;
- evidence archives or inventories;
- Milestone 1 or Milestone 2 files;
- the merged Milestone 3 research charter, except for a narrowly authorized
  final navigation correction if the Advisor explicitly orders one; or
- the retained Work Package 1 process records.

---

## 5. Required document roles

### 5.1 Work-package README

The work-package `README.md` must remain concise and state:

- current status;
- purpose;
- current authorization boundary;
- authoritative specification documents;
- relationship to the Milestone 3 charter;
- explicit exclusions;
- reading order; and
- whether implementation has received separate authorization.

### 5.2 Main specification

`WORK_PACKAGE_002_MINIMUM_PARALLEL_RUN_LABORATORY_SPECIFICATION.md` is the
normative technical and evidence contract. It must distinguish clearly among:

- facts about the current repository;
- mandatory requirements for a future implementation;
- design rationale;
- unselected implementation options;
- open questions requiring a later ruling; and
- explicit non-goals.

Use the normative terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and
**MAY** deliberately. Every normative requirement must receive a stable,
unique requirement ID.

Use category prefixes materially equivalent to:

```text
WP2-SCOPE-###   scope and non-goals
WP2-ID-###      identity and lineage
WP2-ISO-###     isolation
WP2-LIFE-###    lifecycle and authority
WP2-SCHED-###   scheduling and concurrency provenance
WP2-TIME-###    time domains
WP2-MODEL-###   model-request accounting and budgets
WP2-EVID-###    evidence, replay, finalization, and preservation
WP2-FAIL-###    failure, cancellation, retry, and replacement
WP2-AGG-###     study aggregation and completion
WP2-SEC-###     secrets and security boundaries
WP2-HAND-###    implementation-handoff boundaries
```

Do not reuse an ID for a materially different meaning. If a requirement changes
later, report the changed ID and explain whether it requires a new version.

### 5.3 Conformance requirements

`WORK_PACKAGE_002_CONFORMANCE_REQUIREMENTS.md` must map every normative **MUST**
and **MUST NOT** from the main specification to:

- the requirement ID;
- the behavior or invariant being tested;
- the proposed keyless conformance-test class;
- required fixtures or fault injection;
- expected observable evidence;
- pass condition at a conceptual level;
- principal false-pass risk;
- whether the check is local, CI, or later registered-study evidence; and
- whether the check belongs to implementation acceptance or the later
  serial-versus-parallel parity study.

This document specifies tests. It does not implement them.

---

## 6. Governing scientific boundaries

The specification must preserve all of the following.

### 6.1 Initial concurrency scope

Work Package 2 covers:

1. isolated concurrent independent runs; and
2. isolated concurrent independent studies that may share infrastructure while
   retaining separate identity, configuration, budget, storage, treatment, and
   evidence boundaries.

It does not solve concurrent decision-making among causally coupled NPCs inside
one shared world. Shared-world concurrency may be described only as an explicit
out-of-scope dependency for later work.

### 6.2 No presumed behavioral neutrality

The specification may define how parallel execution would operate, but it must
not claim that serial and parallel execution are behaviorally interchangeable.
That question belongs to Work Package 3 and requires preregistered parity
evidence.

### 6.3 No implementation-stack selection

Do not select or commit to:

- a cloud provider;
- a container platform;
- a job queue;
- a broker;
- a scheduler;
- a database;
- an object store;
- a workflow framework;
- a browser/headless split;
- a worker count;
- a quota value;
- an autoscaling rule;
- a deployment topology; or
- a specific serialization or archive technology.

The specification may state the properties any selected mechanism must satisfy
and may compare clearly labeled unselected options.

### 6.4 Evidence before throughput

A fast system that loses attribution, isolation, failed-attempt history,
logical-time integrity, replay, or evidence completeness does not conform.
Throughput is a capability objective, not a substitute for scientific validity.

### 6.5 No silent current-system assumptions

Every assertion about what the repository currently does must identify the
supporting repository path and, where useful, the relevant symbol, command,
section, or artifact type.

Do not infer an existing guarantee from a file name or from an intended design.
Distinguish:

```text
Current fact
Current limitation
Required future invariant
Unselected option
Open question
```

### 6.6 No live or repository game-model calls

No chunk may launch a live provider, repository gateway, browser simulation,
formal experiment, or evidence-generating run. Normal keyless CI on the final
integration head is permitted. Local checks should remain documentation-only.

---

## 7. CI cadence

### Chunk 0

Chunk 0 is read-only and creates no commit.

### Chunks 1–7

Every commit for Chunks 1–7, including Advisor-requested remediation commits,
must include the exact marker:

```text
[skip ci]
```

A skipped or pending required check on an intermediate head is expected. It does
not authorize continuation or merge.

### Chunk 8

The first Chunk 8 integration commit and every later remediation commit must
omit all CI-skip markers. The exact latest PR head must complete the full
required CI workflow successfully before final Advisor clearance.

Do not edit workflows, path filters, branch protection, or required-check rules.

---

# 8. Chunk 0 — read-only orientation and current-system map

## Objective

Build a precise understanding of the current single-run, orchestration,
registration, gateway, evidence, replay, and finalization paths before drafting
the parallel-laboratory specification.

## Required reading

Read completely:

```text
documentation/milestones/003-parallel-causal-life-laboratory/
  MILESTONE_003_RESEARCH_CHARTER.md
  README.md

documentation/reference/TECHNICAL_REFERENCE.md

documentation/milestones/002-sparse-cognition/
  MILESTONE_002_CLOSEOUT_REPORT.md
  MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md
  MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md

documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md
```

Also inspect, without editing:

- `package.json` scripts;
- run-plan and registration code;
- unattended-orchestrator code;
- gateway request and response accounting;
- evidence-root creation and collision handling;
- strict finalization and replay verification;
- replacement and failure disposition handling;
- batch aggregation and analysis entry points; and
- CI commands relevant to those paths.

Locate the actual files and symbols rather than relying on guessed paths.

## Required dispatch

Post a PR comment titled:

```text
### Work Package 2 — Chunk 0 dispatch
```

Include:

1. Branch, base SHA, head SHA, merge base, and upstream divergence.
2. The successful post-merge `main` CI run ID, exact head, and conclusion.
3. A table with these columns:

```text
Capability
Current owner/file/symbol
Current behavior
Reusable contract
Known limitation or parallelism gap
Evidence for the statement
```

Cover at minimum:

- plan registration;
- run identity;
- output-root creation;
- orchestrator lifecycle;
- model-request accounting;
- budgets and interlocks;
- strict finalization;
- replay;
- evidence sealing;
- attempt failure and replacement;
- study aggregation; and
- CI rehearsal.

4. Proposed headings for all three Work Package 2 deliverables.
5. Proposed requirement-ID namespaces.
6. Any conflict or ambiguity found between charter language, current source,
   historical documentation, and these instructions.
7. Whether additional primary-source research is genuinely required before
   drafting; do not perform that research unless later authorized.
8. Confirmation that no file changed, no commit was created, no later chunk
   began, and zero repository game-model calls occurred.

## Stop condition

Stop after posting the dispatch. Do not begin Chunk 1 until the Advisor
explicitly approves Chunk 0.

---

# 9. Chunk 1 — document shell and normative framework

## Objective

Create the Work Package 2 documentation shell, complete heading structures, and
normative-writing conventions without prematurely deciding substantive
requirements.

## Authorized files

Create only:

```text
documentation/milestones/003-parallel-causal-life-laboratory/
  work-packages/002-minimum-parallel-run-laboratory/
    README.md
    WORK_PACKAGE_002_MINIMUM_PARALLEL_RUN_LABORATORY_SPECIFICATION.md
    WORK_PACKAGE_002_CONFORMANCE_REQUIREMENTS.md
```

Do not modify this instruction file.

## Main-specification skeleton

Include headings materially equivalent to:

```text
1. Status, authority, and version
2. Purpose and research-infrastructure boundary
3. Scope and explicit non-goals
4. Normative language and requirement IDs
5. Current-system baseline and gap map
6. Entity, identity, and lineage model
7. Isolation invariants
8. Run and attempt lifecycle
9. Scheduling, leasing, and authoritative commit
10. Concurrency-profile provenance
11. Time domains and logical-time integrity
12. Model-request accounting, budgets, and provider behavior
13. Evidence roots, replay, finalization, and sealing
14. Failure, cancellation, retry, resume, and replacement
15. Study aggregation and completion
16. Security and secret boundaries
17. Conformance model
18. Implementation handoff and unselected options
19. Work Package 3 dependency
20. Acceptance criteria
21. Open questions and later rulings
```

Every section should contain only a brief scope note and an assigned future
chunk marker.

## Conformance skeleton

Reserve:

- conformance principles;
- requirement-to-check matrix;
- fault-injection catalogue;
- keyless implementation-acceptance suite;
- evidence required from conformance runs;
- boundaries separating implementation conformance from Work Package 3 parity;
- unresolved conformance questions; and
- conformance acceptance criteria.

## Required status language

State clearly that:

- the specification is a working draft;
- Work Package 2 is specification-only;
- no implementation or experiment is authorized;
- Work Packages 3–8 remain unauthorized; and
- requirements are incomplete until their assigned chunks receive approval.

## Validation

Run:

```bash
npm.cmd run lint
node scripts/docs/checkLinks.mjs
git diff --check
git status --short
git diff --name-only HEAD^..HEAD
```

## Commit

Use exactly:

```text
docs: scaffold work package 2 specification [skip ci]
```

Update the PR body to state that Chunk 1 is complete and Chunk 2 is not
authorized. Post the common dispatch and stop.

---

# 10. Chunk 2 — scope, baseline, terminology, and non-goals

## Objective

Define what the minimum laboratory must and must not do, document the current
system accurately, and establish terminology that later chunks can use without
ambiguity.

## Complete in the main specification

- Status, authority, and version
- Purpose and research-infrastructure boundary
- Scope and explicit non-goals
- Normative language and requirement IDs
- Current-system baseline and gap map

## Required content

Define or reconcile at minimum:

- laboratory;
- study;
- experiment;
- condition;
- treatment;
- run;
- attempt;
- replacement;
- worker;
- lease;
- dispatch wave;
- authoritative commit;
- run evidence root;
- study evidence root;
- finalization;
- replay;
- aggregation; and
- concurrency profile.

Do not impose a new definition where the repository already has a stable,
versioned meaning without documenting the compatibility decision.

The scope must distinguish:

1. independent runs;
2. independent studies sharing infrastructure; and
3. causally coupled NPCs in one shared world, which remain out of scope.

The current-system map must identify what is reusable as a contract versus what
is merely a single-run implementation detail.

Do not add external sources unless the Advisor approved them after Chunk 0.

## Commit

Use exactly:

```text
docs: define work package 2 scope and baseline [skip ci]
```

Post the common dispatch and stop before Chunk 3.

---

# 11. Chunk 3 — identity, lineage, and isolation invariants

## Objective

Specify how every concurrent unit remains uniquely identifiable, attributable,
and isolated.

## Complete in the main specification

- Entity, identity, and lineage model
- Isolation invariants

## Required identity model

The specification must define the required relationships among, at minimum:

- specification version;
- study and study-plan identity;
- experiment and analysis version;
- condition and treatment identity;
- planned run identity;
- execution-attempt identity;
- replacement lineage;
- worker and lease identity;
- dispatch-wave identity;
- model-request identity;
- run evidence-root identity;
- sealed-package identity; and
- study-aggregation identity.

Require stable parent-child lineage and prohibit identity reuse across
materially different meanings.

## Required isolation boundaries

Address, without selecting a mechanism:

- mutable in-memory state;
- filesystem or object namespace;
- configuration and environment;
- random and stochastic-event state;
- event streams and clocks;
- gateway request records;
- token, cost, call, and failure budgets;
- logs and diagnostics;
- finalization state;
- evidence inventory and sealing;
- cancellation and cleanup; and
- secrets.

Shared immutable assets MAY be permitted only when content-addressed or
otherwise version-pinned and when sharing cannot merge mutable state or evidence
lineage.

Specify how collisions, duplicate identities, stale leases, and attempted
adoption of an existing output root must fail safely.

Do not select a directory layout, database key format, UUID library, or storage
service.

## Commit

Use exactly:

```text
docs: specify parallel-run identity and isolation [skip ci]
```

Post the common dispatch and stop before Chunk 4.

---

# 12. Chunk 4 — lifecycle, scheduling, concurrency provenance, and time

## Objective

Specify how a planned run becomes one authoritative finalized attempt while
allowing concurrent execution and preserving all scheduling and timing facts
needed for later parity analysis.

## Complete in the main specification

- Run and attempt lifecycle
- Scheduling, leasing, and authoritative commit
- Concurrency-profile provenance
- Time domains and logical-time integrity

## Required lifecycle treatment

Define a conceptual state machine that covers at minimum:

- registered;
- queued;
- leased or assigned;
- starting;
- running;
- finalizing;
- completed;
- failed;
- cancelled;
- invalid or excluded; and
- replaced, where applicable.

The specification must distinguish execution delivery from authoritative
acceptance. It must prevent two workers from independently finalizing two
results as the same authoritative attempt.

Address conceptually:

- lease acquisition and expiry;
- heartbeats or liveness evidence;
- duplicate delivery;
- worker crash;
- orchestrator crash;
- idempotent restart boundaries;
- stale worker output;
- cancellation races;
- authoritative finalization; and
- cleanup that cannot erase evidence.

Do not select lease durations, retry counts, worker counts, or algorithms.

## Required concurrency provenance

Record conceptually relevant fields including:

- execution architecture identity;
- worker count and worker identity;
- start-wave or dispatch policy;
- queue and lease policy version;
- logical commit policy;
- host or runner class where relevant;
- provider, project, model, and route identity;
- local queue conditions;
- upstream latency and rate-limit windows;
- fallback, timeout, supersession, and rejection behavior; and
- shared-resource contention or dependency policy.

## Required time model

Keep separate:

- logical simulation time;
- local queue time;
- dispatch and transport time;
- provider wall-clock latency;
- worker wall-clock runtime;
- finalization time; and
- study-level elapsed time.

Provider or queue latency MUST NOT silently affect simulated psychology,
world causality, or decision eligibility unless that effect is explicitly a
registered treatment.

## Commit

Use exactly:

```text
docs: specify parallel lifecycle scheduling and time [skip ci]
```

Post the common dispatch and stop before Chunk 5.

---

# 13. Chunk 5 — model traffic, budgets, provider behavior, and secrets

## Objective

Specify complete attribution and budget semantics for model traffic generated
by concurrently executing runs and studies.

## Complete in the main specification

- Model-request accounting, budgets, and provider behavior
- Security and secret boundaries

## Required request accounting

Define the conceptual request lifecycle and preserve distinctions among:

- request created or emitted;
- dispatch attempted;
- provider accepted;
- provider completed;
- local response received;
- response validated;
- response accepted by the simulation;
- response rejected;
- response timed out;
- response superseded;
- fallback used;
- provider or transport retry; and
- no-call resolution.

Every request and outcome must be attributable to the correct study, condition,
run, attempt, worker, decision or cognitive episode, model/provider/route, and
budget.

## Required budget treatment

Address:

- per-request accounting;
- per-run caps;
- per-study caps;
- acknowledged worst-case budgets;
- transport retries versus new model decisions;
- tokens and cost;
- local and provider latency;
- rate limits;
- correlated provider failures;
- fallback exposure;
- budget exhaustion;
- cancellation; and
- whether unused capacity may be shared without merging evidence or silently
  changing a registered treatment.

Do not select numeric budgets or a provider.

## Required secret boundary

No browser, run artifact, study aggregate, log, PR, or specification example may
contain a live secret. Shared infrastructure may hold a secret only behind a
versioned boundary that preserves request attribution and prevents one run from
accessing another run's credential material or raw provider session state.

Do not design a secret manager.

## Commit

Use exactly:

```text
docs: specify parallel model accounting and budgets [skip ci]
```

Post the common dispatch and stop before Chunk 6.

---

# 14. Chunk 6 — evidence, finalization, failures, replacements, and aggregation

## Objective

Specify how every attempt remains auditable from registration through sealed
run evidence and study-level aggregation, including unsuccessful paths.

## Complete in the main specification

- Evidence roots, replay, finalization, and sealing
- Failure, cancellation, retry, resume, and replacement
- Study aggregation and completion

## Required evidence model

Address at minimum:

- unique evidence root per attempt;
- creation and collision behavior;
- immutable registration and configuration references;
- canonical events and state;
- gateway request and response records;
- scheduling and concurrency provenance;
- timing domains;
- logs and diagnostics;
- finalization records;
- replay verification;
- inventory and hashes;
- sealing and verification;
- evidence-size and retention budgets; and
- references from study aggregation to source attempts.

A study aggregate must not replace, mutate, or conceal the run-level evidence
from which it was derived.

## Required failure model

Keep distinct:

- operational failure;
- provider failure;
- artifact invalidity;
- replay failure;
- study invalidity;
- exclusion;
- cancellation;
- behavioral failure or unfavorable outcome; and
- packaging or finalization failure.

Specify typed dispositions and require preservation of failed, interrupted,
invalid, excluded, cancelled, and replacement attempts.

Differentiate:

- transport retry;
- process restart;
- resume of the same attempt;
- a new attempt for the same planned run;
- a replacement run; and
- an unauthorized rerun seeking a preferred trajectory.

Replacement rules must be preregistered for confirmatory work, and a replacement
must not erase or renumber the original attempt.

## Required aggregation model

Address:

- study completeness;
- denominators and missingness;
- primary and replacement units;
- duplicate detection;
- invalid and excluded attempts;
- aggregation version;
- source-evidence references;
- partial-study reporting;
- deterministic rebuild of the aggregate where possible; and
- prevention of cherry-picked run inclusion.

A study may not be declared complete merely because the desired number of
successful runs exists while undispositioned scheduled units remain.

Do not select an archive format, storage system, or statistical method.

## Commit

Use exactly:

```text
docs: specify parallel evidence and failure handling [skip ci]
```

Post the common dispatch and stop before Chunk 7.

---

# 15. Chunk 7 — conformance requirements and implementation handoff

## Objective

Turn the normative specification into a complete, keyless, implementation-ready
conformance contract while preserving all unselected technical choices.

## Complete in the main specification

- Conformance model
- Implementation handoff and unselected options
- Work Package 3 dependency
- Acceptance criteria
- Open questions and later rulings

## Complete in the conformance document

Map every normative **MUST** and **MUST NOT** to a proposed check.

Include fault-injection classes materially covering:

- duplicate run identity;
- output-root collision;
- two workers claiming one unit;
- stale or expired lease;
- worker crash before evidence creation;
- worker crash during execution;
- worker crash during finalization;
- orchestrator crash and restart;
- duplicate dispatch;
- late response after timeout or cancellation;
- request misattribution;
- budget exhaustion;
- provider rate limiting;
- correlated provider failure;
- cancellation race;
- replay mismatch;
- evidence mutation after seal;
- incomplete inventory;
- missing or duplicate aggregate membership;
- replacement that erases the original attempt;
- cross-run mutable-state contamination; and
- cross-study evidence or budget contamination.

Specify a future keyless acceptance suite using deterministic or fake-provider
fixtures. Do not implement the suite.

## Implementation handoff

Identify every technical decision intentionally left open, with at least:

- required property;
- plausible option families;
- tradeoff;
- evidence needed to choose;
- whether the decision can affect behavior or only operations; and
- whether a change would require a new implementation, condition, or experiment
  version.

Do not rank an option as preferred unless the evidence already supports that
choice and the Advisor explicitly authorizes the decision.

## Work Package 3 boundary

State clearly that implementation conformance would not establish
serial-versus-parallel behavioral parity. Work Package 3 remains separately
registered and separately authorized.

## Commit

Use exactly:

```text
docs: define work package 2 conformance and handoff [skip ci]
```

Post the common dispatch and stop before Chunk 8.

---

# 16. Chunk 8 — integration, navigation, and final exact-head audit

## Objective

Produce the final coherent Work Package 2 documentation set and prepare—not
merge—the PR for final Advisor and Operator review.

## Required integration work

1. Re-read the main specification and conformance document as one contract.
2. Remove all drafting placeholders and incomplete-section language.
3. Resolve duplicate or inconsistent definitions.
4. Verify every normative **MUST** and **MUST NOT** has a unique ID.
5. Verify every such requirement appears in the conformance matrix.
6. Verify every current-system factual statement has repository support.
7. Verify facts, requirements, rationale, options, and open questions remain
   visibly distinct.
8. Confirm no implementation stack, numeric operating parameter, provider,
   worker count, or deployment topology was selected.
9. Update the work-package README to `SPECIFICATION ESTABLISHED` language while
   keeping implementation unauthorized.
10. Make minimal status/navigation updates to the root README,
    `documentation/README.md`, and the Milestone 3 README.
11. Replace the incremental PR body with a final review body containing:
    - base and final head;
    - exact file scope;
    - specification purpose;
    - normative requirement counts by category;
    - current-system baseline summary;
    - identity and isolation model;
    - lifecycle, scheduling, and time model;
    - model-request and budget model;
    - evidence, failure, replacement, and aggregation model;
    - conformance and fault-injection coverage;
    - unselected implementation decisions;
    - Work Package 3 boundary;
    - checks and exact-head CI;
    - zero-call confirmation; and
    - confirmation that implementation and Work Package 3 did not begin.

## Final file scope

The complete PR should contain exactly the seven files listed in Section 4.
No source, test, package, workflow, experiment, evidence, or historical
milestone file may appear in the diff.

## Validation

Run:

```bash
npm.cmd run lint
node scripts/docs/checkLinks.mjs
git diff --check
git status --short
git diff --name-only origin/main...HEAD
```

Also run read-only audits that verify:

- no unresolved `TBD`, `TODO`, `FIXME`, or working-draft marker remains in the
  active Work Package 2 documents;
- all requirement IDs are unique;
- every normative requirement is represented in the conformance matrix;
- no external source was added without approval;
- no live secret or credential-shaped value appears;
- the complete diff is documentation-only; and
- Work Package 3 language remains a future dependency rather than an implied
  authorization.

## Commit and CI

Use exactly:

```text
docs: finalize work package 2 specification
```

Do not use any CI-skip marker.

Push normally. The exact latest head must trigger and pass the complete required
CI workflow. Success on an earlier head is insufficient.

If CI fails, is cancelled, or does not start, do not edit source, tests,
workflows, or documentation again. Preserve the result, post the failure
dispatch, and stop for Advisor direction.

Keep the PR draft. Do not approve or merge it.

---

## 17. Common dispatch format for Chunks 1–8

Post one PR comment after each chunk using a title that identifies the work
package and chunk.

Include every field:

```text
Plain-language summary:
Chunk completed:
Branch:
Base SHA:
Previous head SHA:
New head SHA / commit:
Commit message:
CI skip marker present: yes/no
New workflow triggered: yes/no
Workflow status, run ID, and exact head, if any:
Files changed in this chunk:
Complete PR file list:
Specification sections completed or revised:
Requirement IDs added:
Requirement IDs revised or removed:
Current-system facts added and their repository support:
Normative requirements added:
Unselected options recorded:
Open questions or Advisor rulings needed:
External sources added or consulted:
Checks run and results:
Scope proof:
Known uncertainties:
Explicit confirmation that no later chunk was started:
Explicit confirmation of zero repository live-model or game-model calls:
Explicit confirmation that no source, test, dependency, workflow, prompt,
schema, experiment, registration, analysis, evidence, or Milestone 1/2 file
changed:
```

For Chunk 8, also include:

```text
Requirement counts by category:
Normative-to-conformance coverage result:
Placeholder/status scan:
Exact-head full CI result:
Confirmation that implementation did not begin:
Confirmation that Work Package 3 did not begin:
```

End every dispatch with an explicit stop statement.

---

## 18. Prohibited work throughout this PR

Do not:

- implement the parallel laboratory;
- create or modify workers, schedulers, queues, brokers, or storage;
- add code or tests;
- change CI;
- select a cloud or framework;
- set worker counts, lease durations, retry counts, thresholds, or budgets;
- start a gateway, browser, fake-provider rehearsal, or live provider;
- register or run an experiment;
- generate or package evidence;
- construct a new scenario;
- implement a cognitive architecture;
- begin serial-versus-parallel parity testing;
- alter Milestone 2;
- add a field-wide novelty claim; or
- infer authorization from green CI, completed drafting, elapsed time, or an
  apparently obvious next step.

---

## 19. Work Package 2 completion boundary

Work Package 2 is complete only when:

- Chunks 0–8 have each received explicit Advisor approval;
- the three Work Package 2 deliverables are complete and internally coherent;
- every normative requirement has a stable ID;
- every **MUST** and **MUST NOT** is mapped to conformance evidence;
- the complete diff remains within the seven authorized documentation files;
- the exact final head passes full CI;
- the Advisor clears the PR for readiness; and
- the Operator decides whether to merge.

Completion establishes a reviewed specification only. It does **not** authorize:

- implementation;
- deployment;
- Work Package 3;
- a serial-versus-parallel parity study;
- a provider or model call;
- evidence generation;
- a cognitive architecture; or
- a scenario.

---

## 20. Initial instruction to CA2

When taking over this PR, execute **Chunk 0 only**.

Do not create the specification files, edit the repository, commit, push, or
begin external research. Post the complete read-only orientation dispatch and
stop for Advisor review.

Your first dispatch must end with:

> **Work Package 2 Chunk 0 is complete. No specification drafting,
> implementation, experiment, or later-chunk work was started.**
