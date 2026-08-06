# Work Package 2 — Minimum Parallel-Run Laboratory Specification

**Status: WORKING DRAFT — CHUNK 4 LIFECYCLE, SCHEDULING, CONCURRENCY PROVENANCE, AND TIME.** This is a working specification package, and Work Package 2 is specification-only. No implementation, experiment, model call, evidence generation, or Work Package 3 activity is authorized. Work Packages 3–8 remain unauthorized. Implementation requires a later, separate Operator authorization and applicable Advisor review. Requirements remain incomplete until their assigned chunks receive approval.

## 1. Status, authority, and version

### 1.1 Document status

This document is a working specification. It states an execution and evidence contract that a later, separately authorized implementation would have to satisfy. It is not a description of an established, implemented, deployed, or operated system, and no statement in it asserts that the repository already provides the laboratory it specifies. Sections 6 through 21 hold no substantive content at this head, so the contract is incomplete and cannot be treated as a settled technical baseline.

Approval of a drafting chunk records that the drafted material meets its assigned instructions. It does not make this document, or the pull request carrying it, eligible for merge, and it does not confer authority to proceed to any later activity.

### 1.2 Governing authority and evidentiary precedence

Three governing authorities and one evidentiary source bear on this document. The three authorities are stated as three distinct roles rather than as one descending order, because the third does not sit uniformly beneath the second. Repository evidence is not a fourth authority: it establishes fact rather than granting authority over the future contract, and it is therefore stated separately below rather than placed in the list.

The three governing authorities are:

1. The Milestone 3 research charter as merged to `main`, at [`documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md`](../../MILESTONE_003_RESEARCH_CHARTER.md), is the highest authority. It governs research direction, claim boundaries, sequencing, and governance, and nothing else named here may contradict it.
2. The staged Work Package 2 instructions at [`WORK_PACKAGE_002_STAGED_SPECIFICATION_INSTRUCTIONS.md`](./WORK_PACKAGE_002_STAGED_SPECIFICATION_INSTRUCTIONS.md) govern this document by default. They define document roles, chunk boundaries, file scope, scientific boundaries, and prohibited work.
3. A later explicit Advisor ruling posted on draft pull request #19 supersedes the staged instructions to the extent of an identified conflict, and only to that extent. The staged instructions continue to govern everywhere such a ruling does not reach.

The evidentiary source is repository evidence — current source, the technical reference, and the Milestone 1 and Milestone 2 records — which establishes what the repository currently does and nothing beyond that. It governs nothing in this document. It is evidence of current fact only, and it is never authorization to preserve a current implementation choice in the future contract.

A material conflict among the governing authorities is recorded and escalated rather than resolved silently inside this document. Section 5 records the conflicts identified so far.

### 1.3 What approval of drafting does not authorize

Authorization to draft this specification is authorization to write a document. It does not authorize implementation of the laboratory, deployment of any component, construction of a scenario or world, implementation of a candidate cognitive architecture, registration or execution of an experiment, any model-provider or repository game-model call, generation or packaging of evidence, or any Work Package 3 activity. Work Packages 3 through 8 remain unauthorized. Each of them requires separate Operator authorization and applicable Advisor review, consistent with charter Sections 13 and 14.10.

### 1.4 Specification version and working heads

No released Work Package 2 specification version exists. The version field of this specification is deliberately unassigned, and there is no Work Package 2 specification version for any artifact, plan, registration, or record to cite at this time.

Intermediate working states of this document are identified only by their exact Git commit on the working branch. A commit identifier is a drafting reference, not a specification version, and citing one does not make the material it names established.

The first established specification version is assigned only after the complete normative contract, the complete requirement-to-conformance mapping, the final integration audit, and a successful full continuous-integration run on the exact final head, all of which belong to the final integration chunk defined in the staged instructions. Until then every requirement in this document remains provisional.

### 1.5 Separation of specification identity from other identities

Specification identity and specification version are distinct from, and never substituted for, the package version, the world or scenario identity and version, the condition identity, the treatment identity, the experiment identity and version, the metric identity and version, the analysis identity and version, the evidence-packaging version, and the identity of any evidence root, inventory, or sealed package.

A change to this specification does not create, revise, retire, or revalidate any of those identities, and a change to any of them does not create or revise a specification version. This separation preserves charter Section 14.2's rule that one versioned object never carries two materially different meanings, and it preserves charter Section 14.1's requirement that Milestone 3 work use identities distinct from Milestone 2's.

## 2. Purpose and research-infrastructure boundary

### 2.1 What this specification is

This specification is an implementation-neutral execution and evidence contract. Its subject is the infrastructure that plans, admits, executes, attributes, finalizes, preserves, and aggregates evidence for independent runs of simulated life. Its purpose is to make it possible for a later implementation team to build concurrent execution without inventing scientific or evidence-governance rules, while leaving every technical mechanism explicitly unselected.

The contract covers two concurrency problems:

1. **Isolated concurrent independent runs.** Multiple independent runs execute at the same time, each retaining its own identity, registered configuration, mutable state, stochastic-event state, budgets, timing records, and replay lineage, together with the failure history and the separate run evidence root of each of its own execution attempts.
2. **Isolated concurrent independent studies sharing infrastructure.** Multiple registered studies execute at the same time on shared infrastructure while retaining separate study identity, registered configuration, mutable state, budget scope, treatment, storage namespace, and evidence lineage. Sharing a host, a process pool, a network path, or a credential boundary never merges any of those.

Charter Section 10.1 names the second problem "independent experiments". This document uses "independent studies" for the same problem, because the repository's registered unit of evidence collection is a study declaration. Section 3.1 records that reconciliation.

### 2.2 Why the contract is written before any implementation

Charter Section 10 treats concurrency as a scientific requirement of a comparative, long-horizon research program, and simultaneously as something that can alter a treatment. Charter Section 10.3 therefore requires every future study to version and record a concurrency profile, and charter Section 14.5 requires that logical simulation time, provider wall-clock time, and local queue time remain distinct. Those obligations constrain the infrastructure before any code exists, which is why the contract is specified first and separately from any implementation authorization.

### 2.3 What infrastructure conformance does not establish

Conformance with this specification would be an infrastructure property only. It would not establish behavioral quality, believability, semantic correctness, or observer value; it would not establish the scientific validity of any study executed on the infrastructure; it would not establish that serial and parallel execution are behaviorally interchangeable; and it would not establish that any candidate cognitive architecture works. Charter Section 8.5 states directly that throughput does not establish scientific validity and that parallel execution is not presumed behaviorally neutral. Serial-versus-parallel parity is the subject of Work Package 3, which requires preregistered parity evidence and remains unauthorized.

## 3. Scope and explicit non-goals

### 3.1 Terminology and compatibility decisions

The terms below carry exactly the meanings given here throughout this specification and the accompanying conformance document. Where the repository already has a stable meaning, this specification preserves it and records the compatibility decision; where Milestone 2 terminology is insufficient or internally inconsistent for a concurrent laboratory, the decision is stated explicitly rather than applied silently.

| Term | Meaning in this specification | Compatibility decision |
| --- | --- | --- |
| **Laboratory** | The complete set of components that plans, admits, executes, attributes, finalizes, preserves, and aggregates evidence for independent runs and studies, together with the rules that bind them. | New term at the specification level. The repository has no component of this name, so no existing versioned meaning is displaced. |
| **Study** | A preregistered unit of evidence collection bound to one registered declaration with a stable identity and version. | Compatible with `src/shared/studyRegistry.ts::studyDeclarationSchema` and its `studyId`/`studyVersion` pair. No redefinition. |
| **Experiment** | The versioned identity of the design family that a study instantiates. | Compatible with the `experimentId` and `experimentVersion` fields of `src/shared/studyRegistry.ts::studyDeclarationSchema` and of `scripts/experiments/m2/sequenceState.ts::sequenceStateSchema`. Charter Section 10.1's "independent experiments" concurrency problem is called "independent studies" here, because the repository's registered unit is the study; the two names denote the same problem. |
| **Condition** | A registered arm of an experiment that fixes which authority decides what, identified by a condition identifier. | Compatible with the `conditionIds` field of `src/shared/studyRegistry.ts::studyDeclarationSchema` and with `scripts/experiments/m2/planSchema.ts::ORCHESTRATABLE_CONDITION_IDS`. No redefinition. |
| **Treatment** | The registered set of identity-bearing values whose change would change what a study tests, including condition, model identity, serving provider and route, prompt version, and any registered authority allocation. | Compatible with `scripts/experiments/m2/planSchema.ts::expectedTreatmentSchema` and `scripts/experiments/m2/registrationRegistry.ts::RegistrationTreatmentPins`. Charter Section 14.2 governs when a change requires a new registered treatment, condition, or experiment version. |
| **Independent run** | The isolated planned unit of one simulated world executed under one registered configuration, and the unit of isolated concurrent execution that WP2-SCOPE-001 and WP2-SCOPE-003 govern. It is not one physical execution: it is the isolated planned unit whether it has zero, one, or several execution attempts. An independent run is declared as a planned run and may be realized through zero or more execution attempts. A planned run has zero execution attempts if and only if no execution-attempt identity was ever admitted for it, and a planned run cancelled or rejected before any attempt admission remains visible as an independent run with zero execution attempts and no authoritative accepted outcome. Every admitted execution attempt is separately preserved, and every one has its own run evidence root. An independent run produces at most one authoritative accepted outcome, reached only if some execution attempt's result is accepted and then fixed at that single attempt's authoritative commit. | New term at the specification level, consistent with charter Section 10.1's statement that "Independent runs are separate simulated worlds with no shared mutable state". The repository already uses the bare word *run* in a distinct sense — the model-backed browser run, whose `runId` is minted by `src/app/modelGatewayClient.ts::ModelGatewayClient` in `newRun`, carried on the wire by `src/sim/decisions/externalSchemas.ts::externalDecisionRequestEnvelopeSchema`, and used by `gateway/server.ts::createGateway` to key its per-run budget and idempotency state. That meaning is stable and is preserved here, not redefined. This specification does not use the bare word *run* as a defined term: it writes *independent run* for the concurrency unit defined here, *planned run* and *execution attempt* for the planning and execution senses, and *model-backed browser run* — or *model run* — for the repository's `runId` sense; where the bare word appears in Section 5 it is ordinary description of a cited repository mechanism rather than a use of a defined term, and WP2-SCOPE-005 binds only those qualified forms. |
| **Planned run** | One unit of intended evidence declared before execution — the declared form of exactly one independent run — and the unit a study's registered sample size counts. | Corresponds to the repository's *planned attempt* (`scripts/experiments/m2/planSchema.ts::plannedAttemptSchema`, field `attemptId`). This specification uses "planned run" because the repository word "attempt" also names physical executions. The repository identifier `attemptId` keeps its current meaning and is not redefined. |
| **Execution attempt** | One admitted physical execution of one planned run, whose identity begins at admission, which is distinct from start, running, and completion and may precede all execution activity, producing its own evidence in its own run evidence root and receiving exactly one terminal disposition. An admitted execution attempt that is cancelled or fails before execution activity begins remains a recorded execution attempt. Several execution attempts may belong to one planned run, and therefore to one independent run, and a planned run has zero execution attempts if and only if no execution-attempt identity was ever admitted for it. | Corresponds to the repository's *execution* (`scripts/experiments/m2/sequenceState.ts::attemptExecutionSchema`, field `executionId`, minted by `nextExecutionId`). Section 5.14 records the conflict between this implemented distinction and the Milestone 2 brief's wording. |
| **Process restart** | Restarting the operating-system process or processes that host part of the laboratory. | New term. A process restart is not itself a resume, a retry, a new execution attempt, or a replacement, and it does not by itself change any unit's disposition. |
| **Resume** | Re-entering an existing, identity-matched unit of work after an interruption, without continuing an interrupted execution attempt in place and without erasing what that attempt produced. | Compatible with `scripts/experiments/m2/sequenceState.ts::assertResumeIdentity`, `assertResumable`, and `markInterruptedExecutions`, reached through the `--resume` option of `npm run m2:orchestrate`. The current mechanism operates at sequence granularity; this specification's term is granularity-neutral. |
| **Transport or delivery retry** | Repeating the delivery of one already-identified request over a transport, without creating a new logical request, a new decision, a new execution attempt, or a new planned run. | New term. The nearest current mechanism is the gateway's idempotent replay of an identical request envelope in `gateway/server.ts::createGateway`, which answers a repeated `requestId` from a recorded result. The repository has no general transport-retry vocabulary. |
| **Registered replacement** | An additional execution attempt for the same planned run, and therefore for the same independent run, permitted only by a preregistered replacement policy, that never erases, renumbers, overwrites, or conceals the original attempt or its evidence. | Compatible with the `replacementPolicy` object of `scripts/experiments/m2/planSchema.ts::orchestratorPlanSchema` and with `scripts/experiments/m2/failureTaxonomy.ts::assessReplacementDisposition`. |
| **Laboratory worker** | A future execution agent that carries out execution attempts and holds identity distinct from the units it executes. This specification always writes the term in this qualified form and never as the bare word *worker*. | New term at the laboratory level, and a deliberate collision with an existing repository word. The repository already uses *worker* for the browser simulation Web Worker: `src/worker/simWorker.ts`, whose module comment names it the dedicated simulation Web Worker; its message contract `src/shared/workerProtocol.ts`, versioned by `PROTOCOL_VERSION` in `src/shared/versions.ts`; its lifecycle owner `src/app/workerClient.ts::WorkerClient`, which constructs it from `../worker/simWorker.ts`; and its readiness field `workerStatus` (`worker-status`) in `src/shared/automationContract.ts::AUTOMATION_FIELDS`, which `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt` waits for before every browser attempt. That meaning is stable and versioned; this specification preserves it and does not redefine it. The two are distinct: a simulation Web Worker is a thread inside one execution attempt, whereas a laboratory worker would carry out whole execution attempts. This specification therefore always qualifies the word — *laboratory worker* for the term defined here, *simulation Web Worker* for the repository's existing meaning — and WP2-SCOPE-005 binds only the qualified form. Naming the term selects no process, container, host, or scaling model. |
| **Lease** | A future time-bounded, revocable claim by exactly one laboratory worker on exactly one unit of work. | New term. The nearest current mechanism is the single-writer control-root lock in `scripts/experiments/m2/orchestrate.ts::acquireSequenceLock`, which is a lock over one named root rather than a lease. Naming the term selects no lease mechanism, duration, or renewal rule. |
| **Dispatch wave** | A future identified group of admitted execution attempts assigned for release together under one scheduling decision, whose record identifies every admitted member attempt whether that attempt is ultimately released, cancelled before release, or never begins execution activity. | New term. The repository has no counterpart. Naming the term selects no scheduling policy, batching rule, or size. |
| **Authoritative commit** | The point, if reached, at which exactly one execution attempt's result becomes the authoritative recorded outcome of its planned run, and therefore the one authoritative accepted outcome of the independent run that planned run declares. It is reached at most once for a planned run, and it is not reached at all where that planned run has no execution attempt or where no attempt's result is accepted. | New term. The nearest current behavior is the combination of strict finalization and the persisted state transition performed by one single-writer orchestrator process (`scripts/experiments/m2/orchestrate.ts::orchestrateSequence` with `scripts/experiments/m2/sequenceState.ts::writeSequenceState`). That is not a multi-writer commit rule. |
| **Run evidence root** | The namespace holding exactly one execution attempt's evidence, immutable once that attempt reaches a terminal state. An independent run realized through several execution attempts therefore has one run evidence root per attempt, never one shared root. | Corresponds to the per-execution attempt directory recorded in the `dir` field of `scripts/experiments/m2/sequenceState.ts::attemptExecutionSchema`. The repository authenticates per-attempt immutability with the per-execution seal and establishes whole-tree finality at sequence granularity; Section 5.9 records that layering. |
| **Study evidence root** | The namespace holding all evidence for one study, including every execution attempt's run evidence root, the root inventory, and the sealed package. | Corresponds to the repository's sequence root together with its inventory file (`scripts/experiments/m2/packageEvidence.ts::INVENTORY_FILE_NAME`, written by `packageSequence`). Current sequence roots hold one sequence and the packager consults no study registration, so the current mechanism is sequence-root sealing rather than a seal over all the evidence roots registered to a study. |
| **Finalization** | The typed, strict completion of one execution attempt's evidence: strict validation of every applicable evidence source, reconciliation among those sources where more than one of them applies, derived-artifact production, and a completion record written last. Reconciliation holds between sources, so it arises only for an attempt with more than one applicable source; a single-source attempt satisfies the meaning through strict validation of that one source, and the meaning accommodates a single-source and a multi-source attempt alike. | Both repository finalization paths satisfy the meaning, over different numbers of applicable sources. `scripts/experiments/m2/runFinalizer.ts::finalizeModelAttempt` finalizes a multi-source attempt: it stages the browser artifacts into the gateway run directory and strict-finalizes it through `scripts/model/finalize.ts::finalizeRunDirectory`, which validates, treats a contradiction between present sources as fatal, stages the derived files, and writes `bundle-manifest.json` last as the completion record whose absence signals an interrupted commit. `scripts/experiments/m2/runFinalizer.ts::finalizeDeterministicAttempt` finalizes a single-source attempt: its module comment records that a deterministic attempt has no gateway run directory by design, so its one applicable evidence source is the exported canonical ledger; validating that ledger through `src/sim/replay/validateLedger.ts::validateLedgerFile` under the typed `deterministic-validation` stage is the whole of its evidence validation, and no reconciliation between sources arises for it, because it has only one; the `behavior-fingerprint.json` it writes into the attempt directory under the typed `fingerprint` stage is its derived output. The fourth element is where the two differ: the deterministic finalizer writes no completion record into the attempt directory, and what marks its completion is instead the `completed` execution status and the execution seal that `scripts/experiments/m2/orchestrate.ts` writes after it returns, which the model path receives in addition to its manifest. Section 5.7 records that the two paths therefore follow different finalization contracts. |
| **UI replay** | The operator-surface replay verification performed inside the running application, whose verdict is read from the user interface. | Names the operator surface of the repository's single reducer-replay mechanism: the in-browser replay gate driven by `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt`, whose failure class is `replay-mismatch` and whose control reaches `src/sim/runtime/host.ts::replay`. The row below names the same mechanism's out-of-browser invocation. |
| **Reducer/ledger replay** | The independent reconstruction of final canonical state by folding the reducer over the recorded authoritative event ledger, compared by hash. | Names the out-of-browser invocation of the repository's single reducer-replay mechanism: `src/sim/replay/replay.ts::replayLedger` as invoked by `src/sim/replay/validateLedger.ts::validateLedgerFile` over an exported ledger file, for example in `scripts/experiments/m2/runFinalizer.ts`, `scripts/experiments/m2/sequenceVerification.ts`, and `scripts/model/finalize.ts`. The UI replay named above is the same mechanism invoked over the live in-memory run: `src/ui/controls.ts` wires `btn-replay-live` to `client.replay('live')`, which travels through `src/app/workerClient.ts::WorkerClient` and `src/worker/commandProcessor.ts` to `src/sim/runtime/host.ts::replay`, which itself calls `replayLedger` and `canonicalLedgerHash` and compares the world-state hash and the canonical ledger hash. The two differ by invocation surface and input, not by mechanism. This specification always qualifies which replay it means and does not treat them as mechanically independent proofs. |
| **Sealing** | Recording an authenticated content digest over a defined set of evidence files at a defined boundary that the record itself identifies. | The repository has two distinct sealing layers and no third layer above them: the per-execution seal in `scripts/experiments/m2/sequenceState.ts::sealExecution`, which authenticates one execution attempt's directory, and the sequence-root inventory, archive, sidecar, and receipt written by `scripts/experiments/m2/packageEvidence.ts::packageSequence`, which authenticates one whole sequence root. Neither attests completeness and integrity over the evidence roots registered to a study: `packageSequence` seals the one root it is given and consults no study registration, so it is not by itself a study-level seal, although for a study registered to place all its evidence in that root the two boundaries coincide. A study-level sealing boundary would be a distinct, later layer, and study aggregation is distinct from all of them. This specification always names the layer. |
| **Aggregation** | The derived, versioned combination of evidence from multiple execution attempts into a study-level result, written outside the immutable evidence it reads. | Compatible with `scripts/evaluation/calibrationVariance.ts::writeCalibrationAnalysis` as the production `m2:analyze` command invokes it: the write is create-once, refused by `writeCalibrationReport` in the same file with `calibration-analysis-output-exists` when the destination already exists, and `scripts/experiments/m2/cli.ts` defaults that destination to a versioned subdirectory of the sequence root's `.derived` sibling, outside the immutable evidence root. The location is the caller's choice rather than a property of the module, which writes wherever it is directed. `scripts/experiments/m2/evaluateSequence.ts::evaluateFromState` matches the derived-and-regenerable part of this meaning but not the write-location part: its default output path is `join(sequenceRoot, 'sequence-evaluation.json')`, and `scripts/experiments/m2/orchestrate.ts` invokes it without an `outputPath` before packaging, so the orchestration-time evaluation is inventoried by `scripts/experiments/m2/packageEvidence.ts::packageSequence` and sealed into the evidence package; the module comment of `scripts/experiments/m2/evaluateSequence.ts` records that it becomes part of the sealed evidence. A regenerated evaluation reaches a versioned derived-output directory only for a completed root: the `m2:evaluate` command in `scripts/experiments/m2/cli.ts` sends its output to a timestamped subdirectory of the sequence root's `.derived` sibling when the recorded sequence status is `completed`, and writes it back into the sequence root itself otherwise. Section 5.11 records this divergence; the term defined here requires the write-outside-the-evidence-root behavior and does not adopt the orchestration-time write location. |
| **Concurrency profile** | The versioned record of the execution architecture and contention conditions under which evidence was produced, as conceptually defined in charter Section 10.3. | New term at the specification level. The repository records no such profile today. |

Two further distinctions apply throughout. First, *decision authority* — which authority is entitled to select an action — is distinct from *serving provider identity* and from *route identity*, which describe who served a request and by what path. Second, a *current mechanism* described in Section 5 is evidence about the repository as it stands; it is never a requirement of this specification, and a requirement of this specification is never a description of current behavior.

### 3.2 Concurrency problems in scope

**WP2-SCOPE-001.** A conforming laboratory **MUST** support the concurrent execution of independent runs, where each concurrently executing independent run retains its own identity, registered configuration, mutable state, stochastic-event state, budgets, timing records, and replay lineage, together with the failure history and the separate run evidence root of every one of its own execution attempts.

**WP2-SCOPE-002.** A conforming laboratory **MUST** support the concurrent execution of independent studies on shared infrastructure, where each concurrently executing study retains its own study identity, registered configuration, mutable state, budget scope, treatment, storage namespace, and evidence lineage.

**WP2-SCOPE-003.** A conforming laboratory **MUST NOT** merge the identity, registered configuration, mutable state, budget scope, treatment, storage namespace, or evidence lineage of two studies, or of two independent runs, as a consequence of their sharing infrastructure.

### 3.3 The concurrency problem that remains out of scope

Charter Section 10.1 distinguishes three concurrency problems. The first two are in scope above. The third — concurrent decision-making among causally coupled non-player characters inside one shared simulated world — remains out of scope for Work Package 2. Coupled characters share mutable world state, perception, communication, and movement dependencies, and safe parallelism for them depends on those dependencies and on the boundaries at which consequences become authoritative. That problem is not solved by isolating independent runs or independent studies, and it is recorded here only as an out-of-scope dependency for later, separately authorized work.

**WP2-SCOPE-004.** This specification **MUST NOT** be cited as defining, requiring, permitting, or authorizing concurrent decision-making among causally coupled non-player characters inside one shared simulated world.

### 3.4 Terminology discipline

The terminology in Section 3.1 exists to make the later contract auditable. The following requirements make that discipline testable.

**WP2-SCOPE-005.** The normative prose and the reporting governed by this specification **MUST** use the terms defined in Section 3.1 with the meanings assigned there, a stable machine-readable field name that predates those definitions — `runId`, `attemptId`, and `workerStatus` or `worker-status` among them — being permitted in place of a defined term only where an explicit mapping from that name to its Section 3.1 meaning is retained alongside it.

**Rationale.** This requirement binds what this specification and the reports written under it say. It does not purport to rename an upstream-owned raw artifact: a field name written by a component this specification does not govern remains that component's own, and renaming it would break the stable, versioned meanings Section 3.1 preserves rather than clarify them. The mappings for the field names above are retained in Section 3.1 itself — `runId` to the model-backed browser run, `attemptId` to the planned run, and `workerStatus` or `worker-status` to the simulation Web Worker's readiness field.

**WP2-SCOPE-006.** A planned run, an execution attempt, a process restart, a resume, a transport or delivery retry, and a registered replacement **MUST NOT** be recorded, reported, or counted as interchangeable events.

**WP2-SCOPE-007.** Where a laboratory provides a UI replay surface, that UI replay and the reducer/ledger replay **MUST** be recorded and reported as separately identified verifications with separately identified verdicts.

**Rationale.** This requirement is conditional by construction. It governs how two replay verifications are kept apart where both surfaces exist, and it neither requires, presumes, nor recommends a user interface, a browser, or any other particular replay surface; a laboratory with no UI replay surface satisfies it vacuously. The implementation-neutral obligation to verify replay at all, and the form that verification takes, belong to the evidence chunk that the staged instructions assign, not to this section.

**WP2-SCOPE-008.** Per-execution sealing, inventory and archive sealing of a whole evidence root, any study-level sealing boundary — a seal attesting completeness and integrity over all evidence roots registered to one study, whether that study registers one such root or many — and study aggregation **MUST** be recorded and reported as distinct operations with distinct evidence, each seal identifying the exact evidence boundary it authenticates.

**WP2-SCOPE-009.** Decision authority, serving provider identity, and route identity **MUST** remain three separately identified properties of a model request, each recorded separately and never conflated with another, wherever each of them is recorded.

**Rationale.** This requirement fixes that the three identities stay distinct; it does not fix where they are written. It does not require that all three be fields on the request itself, and it selects no artifact, schema, record placement, or join key. Which record carries each identity, and how those records are joined to a study, a planned run, an execution attempt, a laboratory worker, and a budget scope, is specified by the model-accounting chunk that the staged instructions assign.

**WP2-SCOPE-010.** A statement describing a current repository mechanism **MUST NOT** be presented anywhere in this specification package as a requirement, guarantee, or approved design of the future laboratory.

### 3.5 Explicit non-goals

The following are explicit non-goals of Work Package 2. They bound what completion of this specification would mean.

**WP2-SCOPE-011.** A conformance result under this specification **MUST NOT** be reported as evidence of serial-versus-parallel behavioral parity, neutrality, or interchangeability.

**WP2-SCOPE-012.** A conformance result under this specification **MUST NOT** be reported as evidence of behavioral quality, believability, semantic correctness, observer value, the scientific validity of any study, or the success of any candidate cognitive architecture.

**WP2-SCOPE-013.** A conforming laboratory **MUST NOT** trade isolation, request and outcome attribution, preservation of failed or interrupted attempts, logical-time integrity, replay verification, or evidence completeness for execution throughput.

**WP2-SCOPE-014.** Approval, completion, or merge of this specification package **MUST NOT** be treated as authorization to implement, deploy, or operate the laboratory, to construct a scenario or cognitive architecture, to register or execute a study, to make a model-provider call, to generate evidence, or to begin Work Package 3.

**WP2-SCOPE-015.** This specification **MUST NOT** select a cloud provider, container platform, job queue, broker, scheduler, database, object store, workflow framework, browser or headless split, serialization or archive technology, deployment topology, or any numeric operating parameter such as a laboratory-worker count, lease duration, retry count, quota, budget, or threshold.

**WP2-SCOPE-016.** Milestone 2 study, condition, treatment, experiment, metric, analysis, packaging, and evidence identities **MUST NOT** be reused, repurposed, or extended as Work Package 2 or Milestone 3 identities.

## 4. Normative language and requirement IDs

### 4.1 Normative vocabulary

The normative terms are reserved for deliberate use as follows:

| Term | Meaning in the completed specification |
| --- | --- |
| **MUST** | A mandatory condition for conformance. |
| **MUST NOT** | A prohibited condition or behavior for conformance. |
| **SHOULD** | A strong recommendation from which a documented, justified divergence may be possible. |
| **SHOULD NOT** | A strong discouragement from which a documented, justified divergence may be possible. |
| **MAY** | An explicitly permitted option. |

### 4.2 Requirement-ID namespaces

The following requirement-ID namespaces are reserved.

| Reserved namespace | Future requirement category |
| --- | --- |
| `WP2-SCOPE-###` | Scope and non-goals |
| `WP2-ID-###` | Identity and lineage |
| `WP2-ISO-###` | Isolation |
| `WP2-LIFE-###` | Lifecycle and authority |
| `WP2-SCHED-###` | Scheduling and concurrency provenance |
| `WP2-TIME-###` | Time domains |
| `WP2-MODEL-###` | Model-request accounting and budgets |
| `WP2-EVID-###` | Evidence, replay, finalization, and preservation |
| `WP2-FAIL-###` | Failure, cancellation, retry, and replacement |
| `WP2-AGG-###` | Study aggregation and completion |
| `WP2-SEC-###` | Secrets and security boundaries |
| `WP2-HAND-###` | Implementation-handoff boundaries |

Later approved drafting will assign every normative requirement a stable, unique ID from the applicable namespace. An ID will not be reused for a materially different meaning. Every **MUST** and **MUST NOT** requirement in this specification, including the ones Section 3 has already assigned, will receive a corresponding entry in the conformance document; a requirement that governs this specification package rather than an implementation may receive a document-audit check there.

Section 3 assigns the `WP2-SCOPE-###` requirements introduced so far. The remaining eleven namespaces hold no assigned identifier at this head; their requirements are drafted in their assigned chunks. Identifiers are zero-padded and allocated sequentially within a namespace, and an identifier is never reassigned once it has appeared in an approved chunk.

### 4.3 Statement classification

Readers and auditors have to be able to tell, from the text alone, what kind of claim a sentence makes. Seven classifications are kept visibly distinct throughout this document, each introduced by a bold lead-in where it is not already obvious from the surrounding structure.

| Classification | Lead-in | What it asserts |
| --- | --- | --- |
| Current fact | **Current fact.** | Something the repository demonstrably does at the cited head, supported by a full repository-relative path plus the relevant symbol, command, document section, or artifact type. |
| Current limitation | **Current limitation.** | Something the repository demonstrably does not do, or does only under conditions that would not hold under concurrency, with the same standard of support. |
| Required future invariant | A normative sentence carrying one requirement ID | A condition a future implementation would have to satisfy for conformance. |
| Design rationale | **Rationale.** | Why a requirement or boundary is stated as it is. Rationale never adds an obligation. |
| Unselected option | **Unselected option.** | A technical choice deliberately left open, described neutrally alongside its alternatives. |
| Open question | **Open question.** | A question that a later explicit ruling has to settle. |
| Explicit non-goal | Stated as a non-goal, with a requirement ID where it is testable | Something this specification deliberately does not do or does not establish. |

Four rules govern these classifications. A current limitation records what is absent; it does not by itself establish that any particular future mechanism is required, and a required invariant is created only where an assigned chunk states it and the conformance document can test it. An unselected option is described neutrally and is never phrased as preferred, recommended, or expected. An open question stays open: no other section resolves it implicitly, and any resolution arrives as an explicit ruling recorded where the question is recorded. Status, authority, purpose, and version declarations, such as those in Sections 1 and 2, are not forced into implementation-requirement form; every substantive **MUST** or **MUST NOT** requirement, wherever it appears, carries exactly one unique identifier.

## 5. Current-system baseline and gap map

### 5.1 How this section was built and how to read it

Every statement below was verified against the repository source or the authoritative historical record at the working head of this document. The orientation map produced during the read-only orientation chunk was used to decide what to inspect; it is not cited as support for any statement here, and its compact basename references were replaced by full repository-relative paths plus the relevant symbol, command, document section, or artifact type.

Statements are classified as **Current fact** or **Current limitation**. A current fact records what the repository demonstrably does; a current limitation records what the repository demonstrably does not do, or does only under an assumption that concurrency would remove. Every statement of either class cites the full repository-relative path and the relevant symbol, command, document section, or artifact type, and every statement closes with an explicit note of what it proves and what it does not prove. Per Section 4.3, a limitation records an absence and establishes no future mechanism; per WP2-SCOPE-010, nothing in this section is a requirement of this specification.

Numeric values appearing in this section describe observed current behavior. None of them is selected, endorsed, or carried forward as a parameter of the future contract, and Section 3.5 prohibits such a selection.

Where Milestone 2 evidence identities are relevant, this section cites [`documentation/milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md`](../../../002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md) rather than restating archive hashes, as charter Section 14.9 requires.

### 5.2 Study declaration and formal registration

**Current fact.** `src/shared/studyRegistry.ts` defines a general study registry at version `study-registry-1.0.0`. Its `studyDeclarationSchema` requires, among other fields, a study identifier and version, a status drawn from a closed set, a research question and hypothesis, a repository SHA, a package version, an experiment identifier and version, condition identifiers, model and provider, prompt versions, scenarios, seeds, sample size, primary and secondary metrics, metric versions, an analysis-script version, exclusion rules, a replacement policy, a stop rule, a live-call budget, an output root, and an evidence-retention policy. `studyFreezeProjection` in the same file produces the nonsecret configuration projection that binds a dataset to one frozen configuration. This proves that a versioned, schema-validated study declaration is an existing repository contract; it does not prove that more than one such study can execute at the same time.

**Current fact.** `scripts/experiments/m2/studyRegistry.ts::validateStudyFile`, reached through the `npm run study:validate` script declared in `package.json`, validates a declaration and derives two freeze artifacts: a SHA-256 over the exact study-file bytes and a configuration fingerprint over the canonical serialization of the freeze projection. This proves that byte-exact and configuration-level study identity already exist as computable values; it does not prove that either value is reserved, registered, or compared against any other study, because `validateStudyFile` derives both from the single file it is given and consults no registry.

**Current fact.** Formal registration is closed. `scripts/experiments/m2/registrationRegistry.ts::REGISTRATION_REGISTRY` contains exactly two entries, `stage-a` and `calibration-variance-a`, each pinning a study identifier and version, committed study and plan template paths, an expected sequence identifier, an attempt profile, and treatment pins through `RegistrationTreatmentPins`. `scripts/experiments/m2/register.ts::registerFromRegistry`, reached through `npm run m2:register`, reads the committed template bytes and blob identifiers from Git, stamps exact identities, builds everything in a staging sibling, and atomically renames it into a create-once destination that is refused if it already exists. `scripts/experiments/m2/registrationPreflight.ts::verifyPlanRegistration` re-derives and re-verifies that binding before launch and refuses an evidentiary or live plan that does not carry an authenticated registration. This proves that Git-authenticated, create-once, pre-launch-verified registration exists; it does not prove that registration is safe under concurrent invocation.

**Current limitation.** `scripts/experiments/m2/registrationRegistry.ts::REGISTRATION_REGISTRY` is closed to the two Milestone 2 registrations. There is no general multi-study registration graph, no registration identity for a Milestone 3 study, and no mechanism by which a new registration is admitted without editing that source file, which `scripts/experiments/m2/register.ts::registerFromRegistry` reads as its only source of registrable entries. This proves that admitting an additional study today is a source change rather than a data operation; it does not establish that a future laboratory must hold registrations in any particular store, nor that a source-level registry would be unsafe under concurrency for the two entries it does hold.

**Current limitation.** `scripts/experiments/m2/register.ts::registerFromRegistry` derives its staging directory by appending `.staging` to the resolved output path and removes any existing staging directory before building into it. Two registrations targeting the same output path would therefore share and destroy the same staging sibling. No registration lock, lease, or reservation exists. This proves that registration safety currently rests on the operator never running two registrations against one output path at the same time; it does not prove that any registration has ever collided, and it establishes no requirement for a lock, a lease, or a per-invocation staging name in the future contract.

### 5.3 Sequence, planned-attempt, physical-execution, model-run, and decision-request identities

**Current fact.** `scripts/experiments/m2/planSchema.ts::orchestratorPlanSchema`, at plan schema version `m2-orchestrator-plan-1.1.0`, carries a `sequenceId`, an optional `study` binding validated by `studyBindingSchema`, an attempt-profile binding, an optional `expectedTreatment`, a replacement policy, and an array of planned attempts validated by `plannedAttemptSchema`. Its refinement rejects a plan containing two attempts with the same `attemptId`, reporting `duplicate-attempt-id`. This proves that planned-attempt identifiers are unique inside one plan; it does not prove uniqueness across plans, sequences, or studies, and no registry enforces such uniqueness.

**Current fact.** `scripts/experiments/m2/sequenceState.ts` separates the planned identifier from the physical one. `attemptExecutionSchema` records both an `executionId` and the `attemptId` it belongs to, and `nextExecutionId` mints identifiers of the form `<attemptId>-e<N>` by counting the executions already recorded for that planned attempt. Each execution receives its own directory, recorded in the schema's `dir` field. This proves that the repository already distinguishes a planned unit from a physical execution of it; it does not prove that an `executionId` is unique beyond one sequence state file, because `nextExecutionId` derives the `-e<N>` suffix by counting the executions recorded in that single state object and consults nothing outside it.

**Current fact.** Sequence identity is bound by `scripts/experiments/m2/sequenceState.ts::sequenceStateSchema` at state version `m2-sequence-state-2.2.0`, and `RESUME_IDENTITY_FIELDS` in the same file lists exactly nineteen fields that `assertResumeIdentity` compares before a resume proceeds: plan hash, repository SHA, package version, experiment identifier and version, prompt version, external provider identifier, upstream platform, expected model identifier, expected serving provider identifier, study identifier and version, study-plan hash, threshold-profile identifier and version, registration identifier, registration-provenance hash, Stage A prerequisite hash, and configuration fingerprint. This proves that exact identity agreement is a precondition of continuing existing work; it does not prove that the compared set covers what a concurrent laboratory would have to hold constant, since `RESUME_IDENTITY_FIELDS` names no scheduling architecture, contention condition, or executing agent.

**Current fact.** A model-backed browser run receives a separate run identifier. `src/app/modelGatewayClient.ts::ModelGatewayClient` mints it in `newRun` using the injected `makeRunId` function, which defaults to a random UUID, and the class comments record it as noncanonical. That identifier is what the gateway keys its per-run state by and what the finalized run directory is named after. This proves that a model-backed browser run carries its own gateway-scoped run identifier that names its finalized run directory; it does not prove that the identifier is canonical, that it is a permitted evidence join key, or that it is minted under any registry, because the same class comments record it as noncanonical and the default minting function is a random UUID.

**Current fact.** Decision-request identifiers are engine-owned and replayable. `src/sim/runtime/engine.ts`, in its `decideForNpc` function, increments a per-run decision counter and formats the identifier as `dec-` followed by a four-digit zero-padded counter value before emitting `DecisionRequested`. This proves that request identity is deterministic within a run; it does not prove that a decision-request identifier distinguishes requests outside one run, because the counter restarts per run, so the same identifier recurs across runs and a request is identifiable only in combination with a run identifier.

**Current limitation.** Of the identities named in Section 3.1, no laboratory-worker identifier, lease identifier, dispatch-wave identifier, or study-aggregation identifier exists anywhere in the repository, and the execution-scoped identities that do exist — those of planned attempts, executions, evidence roots, and sealed packages — are scoped to one plan or one root rather than made globally unique. A planned-run identifier exists — `attemptId` in `scripts/experiments/m2/planSchema.ts::plannedAttemptSchema` — but `orchestratorPlanSchema` enforces its uniqueness only inside one plan, and no registry reserves it across plans, sequences, or studies. An execution attempt is identified only by the `executionId` that `scripts/experiments/m2/sequenceState.ts::nextExecutionId` derives as `<attemptId>-e<N>` from the executions recorded in one sequence state. A run evidence root and a study evidence root are identified only by filesystem location: the per-execution `dir` field of `scripts/experiments/m2/sequenceState.ts::attemptExecutionSchema`, relative to one sequence root, and that sequence root itself, resolved from the plan's `outputRoot` and named in state by `sequenceId`. A sealed package is identified only by the versioned archive name `<sequenceId>-evidence-NNN.zip` that `scripts/experiments/m2/packageEvidence.ts::nextArchivePath` selects. None of these carries an identifier independent of its path, and none spans more than one sequence. Replacement lineage is implicit: a replacement execution is recognizable only because it shares an `attemptId` with an earlier execution and carries a higher `-e<N>` suffix. This proves that the repository mints no identifier for an executing agent, a claim on a unit of work, a scheduling group, or a study-level aggregate, and that the identifiers enumerated here are unique only within the plan, state file, or root that mints them; it does not prove that any of them has ever collided, and it does not establish which identities the future contract has to mint.

### 5.4 Output-root creation, control-root separation, and locking

**Current fact.** `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` resolves one sequence root from the plan's `outputRoot`. For an evidentiary plan it refuses a root that resolves inside the tracked repository, raising `evidentiary-output-root-inside-repository`. This proves that immutable evidence is kept outside the tracked tree for evidentiary work; it does not prove that two plans cannot resolve to the same root, because the refusal tests only whether the resolved path falls inside the repository, never whether another plan already claims it.

**Current fact.** Mutable operational state is separated from evidence. `scripts/experiments/m2/sequenceState.ts::controlRoot` places the control root at the sequence root's path with a `.control` suffix, and `stateFilePath` and `writeSequenceState` keep the sequence state there, written atomically through a temporary file and a same-volume rename. The module comment records the rationale: once the sequence archive is created, no inventoried evidence file changes again. This proves that operational state can advance without mutating sealed evidence, and that a state write is atomic against a crash; it does not prove that the control root is safe against a second writer, since the atomicity is a rename on one volume rather than a claim on the root.

**Current fact.** `scripts/experiments/m2/orchestrate.ts::acquireSequenceLock` creates an exclusive lock file inside the control root using an exclusive-create flag, records a process identifier and a random token as its contents, tests the recorded holder's liveness by sending signal zero to that process identifier through `process.kill`, refuses when the holder is still alive with `sequence-locked`, reclaims the lock when the holder is gone, and releases the lock file only while its contents still match its own token. The exclusion it provides is cooperative and bounded twice over. It reaches only the invocations that call that function: `acquireSequenceLock` is module-private to `scripts/experiments/m2/orchestrate.ts` and is taken by `orchestrateSequence` and `resumePackagingReady` alone, so a standalone or otherwise noncooperating writer of the same sequence root is not stopped by it — the `m2:package` command in `scripts/experiments/m2/cli.ts` reaches `scripts/experiments/m2/packageEvidence.ts::packageSequence` on a resolved root without taking the lock at all. It is also bounded to one host's process namespace: a process identifier is meaningful only inside the operating-system instance that assigned it, and the liveness test evaluates it locally. The random token records which invocation currently owns the lock, so that a release deletes no other invocation's lock file; it is not a fencing generation, because no writer presents it to the filesystem or to any other store and no later write validates it. The lock file carries no host identity and no lease generation. This proves that one named sequence root has at most one live writer among the cooperating orchestrator invocations that call that function inside the process namespace of the host holding that lock file; it does not prove exclusion of a standalone or noncooperating writer that reaches the root without calling it, it does not prove same-root exclusion across hosts, because a second host reaching the same root over shared or synchronized storage would evaluate the recorded process identifier in its own process namespace rather than the holder's, and it proves nothing about coordination across different roots.

**Current fact.** `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` refuses to continue an existing sequence without the resume option, raising `sequence-already-exists`, and refuses a resume with no recorded state, raising `resume-without-state`. Where no state exists, it refuses a root that already contains files, raising `sequence-root-not-empty` and stating that it will not adopt it. This proves that continuing or adopting existing work is a refusal by default rather than a silent merge; it does not prove that the refusals are collision detection, because each is a test of one already-resolved root's own contents, evaluated before any lock is taken.

**Current limitation.** In that same branch of `scripts/experiments/m2/orchestrate.ts::orchestrateSequence`, a pre-existing but empty root is accepted, because the refusal is conditioned on `readdirSync(sequenceRoot).length > 0`. An existing empty directory is therefore adopted silently. This proves that emptiness, not provenance, is what the current gate checks; it does not prove that such an adoption has ever caused harm, and per Section 1.2 it is not authorization to preserve the behavior in the future contract.

**Current limitation.** There is no global reservation of sequence identifiers or output roots, and no registry that would detect two plans resolving to the same root before either writes. The only ownership record in the repository is the lock file that `scripts/experiments/m2/orchestrate.ts::acquireSequenceLock` creates inside the control root of one already-resolved sequence root, and it is created after that root has been chosen rather than as part of choosing it. This proves that ownership is asserted per root and only after resolution; it does not prove that two plans have ever resolved to one root, and it establishes no requirement for a reservation service, a registry, or a fencing token.

### 5.5 Serial orchestration and fixed process and port assumptions

**Current fact.** Orchestration is deliberately serial. `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` iterates the plan's attempts with a sequential `for` loop and awaits each execution through `executeAttempt` before considering the next, retrying a failed planned attempt in an inner loop bounded by the plan's replacement policy. A non-permitted disposition breaks out of both loops and fails the whole sequence. This proves that the current execution order is exactly one attempt at a time inside one orchestrator process; it does not prove that any component beneath the loop requires serialization, and it is not evidence that a concurrent loop would preserve the guarantees the serial loop currently provides.

**Current fact.** The unattended orchestration path runs on single-instance, fixed-port infrastructure. `scripts/experiments/m2/viteDriver.ts` exports `AUTOMATION_VITE_PORT` as 5199 and `AUTOMATION_GATEWAY_PORT` as 8799 and starts one development server per sequence with strict-port enforcement, refusing to reuse an occupied port with `preflight-port-occupied`. `scripts/experiments/m2/gatewayDriver.ts::startGateway` performs the same refusal for the gateway port. `executeAttempt` in `scripts/experiments/m2/orchestrate.ts` starts a fresh gateway child process per model-backed attempt on that same fixed port, and `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt` creates a fresh browser context per attempt. This proves strong per-attempt isolation within one serial sequence; it does not prove that the isolation extends past one sequence on one host, because both port values are module-level constants with no per-sequence namespacing, so a second concurrent sequence on the same host is refused at the port preflight rather than isolated.

**Current fact.** Child-process provenance is recorded to durable evidence. `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` constructs `scripts/experiments/m2/processManager.ts::ProcessManager` with an append-only JSONL process-record file inside the sequence root, and that manager records each spawn, each failed spawn, each genuine exit with its numeric code or terminating signal, and each unconfirmed stop, while its `health()` accessor counts record-write failures, stop failures, and post-spawn process-operation errors so that incomplete provenance is reported rather than implied. This proves that child-process identity and terminal state are recorded facts within one sequence; it does not prove anything about attributing processes across concurrently executing sequences, because the record file, and the manager that owns it, are scoped to a single sequence root.

**Current fact.** Attempt execution is bounded by declared watchdogs. `scripts/experiments/m2/planSchema.ts::orchestratorPlanSchema` requires a `timeouts` object carrying a wall-clock run timeout, a stall timeout, a stall grace, and a heartbeat interval, and `FORMAL_TIMING` in the same file constrains two of those four in an evidentiary plan by equality — the run timeout and the stall timeout — caps the heartbeat interval through `maxHeartbeatIntervalMs`, and does not constrain the stall grace at all. The monitor loop in `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt` converts an exceeded wall clock into the `run-timeout` failure class and an unchanging simulation tick past the stall timeout and its grace into the `simulation-stall` failure class, both members of `scripts/experiments/m2/failureTaxonomy.ts::RETRYABLE_ELIGIBLE_FAILURE_CLASSES`. This proves that a single attempt cannot hang unbounded; it does not prove that any bound exists over a group of attempts, because every one of these bounds is evaluated per attempt inside one process tree.

**Current limitation.** The whole of the repository's concurrency control is the exclusive per-root lock created by `scripts/experiments/m2/orchestrate.ts::acquireSequenceLock` together with the sequential `for (const attempt of plan.attempts)` loop inside `scripts/experiments/m2/orchestrate.ts::orchestrateSequence`, which awaits each `executeAttempt` before considering the next. No module under `scripts/experiments/m2/` provides a scheduler, a queue, a laboratory-worker pool, a work-unit lease, a dispatch wave, an authoritative duplicate-commit rule, stale-laboratory-worker handling, cross-claimant liveness arbitration, or a cancellation lifecycle. Two nearby mechanisms use the same words in a different sense and are not counterexamples: `scripts/experiments/m2/keepAwake.ts::acquireKeepAwake` holds a sleep-inhibition lease over the host for the orchestrator's lifetime rather than a claim on a unit of work, and `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt` appends `heartbeat.jsonl` at the plan's heartbeat interval as a per-attempt stall watchdog inside one process rather than as liveness arbitration between competing claimants. This proves that nothing in the repository decides which of several claimants may execute a unit of work; it does not prove that any particular scheduling, leasing, or cancellation design is required, which Section 4.3 reserves to the assigned chunks.

**Current limitation.** Values that resemble concurrency controls do not provide support for concurrent independent runs. The gateway's `maxConcurrency` setting, read in `gateway/config.ts::loadGatewayConfig` and enforced in `gateway/server.ts::createGateway`, bounds in-flight requests inside one gateway process, while `src/app/modelGatewayClient.ts::ModelGatewayClient` dispatches single-flight behind a synchronous pumping latch. The `concurrency` block in `.github/workflows/ci.yml` cancels superseded workflow runs for one Git reference. None of these establishes support for concurrently executing independent runs. This proves that each of the three bounds something other than concurrently executing independent runs — in-flight requests inside one gateway process, dispatch inside one browser client, and superseded workflow runs for one Git reference; it does not prove that these mechanisms would be unusable in a concurrent laboratory, only that their presence is not evidence of one.

### 5.6 Model-request accounting, idempotency, and budget scope

**Current fact.** The engine owns the logical request and its canonical lifecycle. `src/sim/runtime/engine.ts` emits `DecisionRequested` carrying the request identifier, the deciding provider identifier, the state version, the world revision, an expiry tick, a hard-dependency fingerprint, and the offered affordances, and records resolutions of accepted, expired, and superseded through its resolved-request registry. This proves that decision authority and request resolution are engine-owned facts recorded in the authoritative ledger; it does not prove that those facts carry attribution above the run, because `DecisionRequested` names the deciding provider but no study, planned run, execution attempt, or executing agent.

**Current fact.** The browser client archives the exact prospective envelope for each request before making any dispatch decision. `src/app/modelGatewayClient.ts::ModelGatewayClient` captures a deep copy in its request archive at request-handling time, keeps the first-seen serialization for duplicate comparison, marks the archive poisoned on a differing duplicate, and records queue and dispatch timing in a slim client trace explicitly documented as noncanonical diagnostics that are never a join key. This proves that a request's exact prospective bytes survive even when no dispatch ever happens, and that a contradictory duplicate is detected rather than absorbed; it does not prove that the archive attributes a request beyond its run, because both the archive and the trace are per-client structures cleared by `newRun` and the trace is recorded as noncanonical.

**Current fact.** The gateway revalidates and re-derives before dispatching. `gateway/server.ts::createGateway` rejects an envelope whose provider, target character, condition, or prompt version differs from the served condition contract with `unregistered-request`, and rejects an envelope whose recomputed context hash differs from the declared one with `context-hash-mismatch`. It then applies per-run idempotency: a repeated request identifier with a matching context hash is answered from the recorded result with an idempotent-replay header, while a repeated identifier with a differing context hash is refused as `idempotency-conflict`. This proves that envelope acceptance is re-derived at the gateway rather than trusted from the client, and that a repeated request identifier is resolved by an explicit typed rule; it does not prove that the rule holds beyond one gateway process, because the recorded results it answers from are held in that process's own per-run map.

**Current fact.** Budget enforcement is layered and typed. `gateway/server.ts::createGateway` refuses with `budget-exhausted` when the per-run call count reaches the configured per-run cap, when the process-wide total reaches its cap, or when in-flight dispatches reach the configured concurrency cap. `scripts/experiments/m2/planSchema.ts::worstCaseStudyCalls` computes a conservative worst case across every planned live attempt and every permitted replacement, and `parsePlan` refuses a plan whose worst case exceeds the acknowledged live-call budget. `scripts/experiments/m2/orchestrate.ts::checkLiveAcknowledgement`, reached through `acquireKeepAwakeForPlan`, is a read-only gate that refuses any plan containing a live attempt unless both the `M2_LIVE_RUNS` environment variable is set to 1 and the acknowledge-live-cost option is present, raising `live-plan-not-acknowledged`. Separately, `scripts/experiments/m2/orchestrate.ts::recordLiveAcknowledgement` writes the acknowledgement record `cost-acknowledgement.json` into the sequence root create-once, verifies an existing file byte for byte on resume, and refuses a differing one with `cost-acknowledgement-immutable`. This proves that a live plan is refused before launch unless its worst case fits an acknowledged budget, and that the acknowledgement itself is preserved immutably; it does not prove that spend is bounded across processes, hosts, or studies, because the per-run, total, and concurrency caps are enforced inside one gateway process and the plan-level check is arithmetic over one plan.

**Current fact.** The gateway records substantial per-request evidence. The `writeTrace` helper inside `gateway/server.ts::createGateway` records the run and request identifiers, the character and scenario, the logical requested tick, the deciding provider identifier, the prompt version, the returned model identifier, the context hash, truncation counts, offered affordances, upstream response identifier, response or failure identifier, the selected affordance and reason code, token counts, latency in milliseconds, the concurrent in-flight count, and the gateway outcome, with engine outcome fields left for later joining. Router metadata, including the upstream serving provider identifier, is written separately by the `writeRouterMetadata` method of `gateway/tracing/modelTraceWriter.ts::ModelTraceWriter`, the trace writer that `gateway/server.ts::createGateway` receives and calls. This proves that one model request leaves a typed record of its logical identity, its outcome, its token counts, and its latency; it does not prove that the record is sufficient for a concurrent laboratory, because the engine outcome fields are written null for a later join and the row carries no identity above the run.

**Current limitation.** Per-run budget and idempotency state is process-local and bounded. `gateway/server.ts::createGateway` holds it in an in-memory map keyed by run identifier and deletes the oldest-inserted entry once the map exceeds sixty-four entries. `scripts/experiments/m2/gatewayDriver.ts` starts a fresh gateway child per model-backed attempt, so both counters reset by construction at every attempt boundary. There is no durable, shared, or atomic reservation of calls, tokens, or cost across processes, laboratory workers, or studies. This proves that the current accounting boundary is one gateway process for the life of one attempt; it does not prove that the counters have ever been wrong for a serial sequence, and it establishes no requirement for any particular durable or shared accounting mechanism.

**Current limitation.** Default call caps are declared independently in three places and no single module is the authority: `src/app/modelGatewayClient.ts::ModelGatewayClient` defaults its per-run cap to 80, `gateway/config.ts::loadGatewayConfig` defaults the per-run cap to 80 and exports `DEFAULT_MAX_TOTAL_CALLS` as 400, and `scripts/experiments/m2/gatewayDriver.ts::startGateway` passes 120 for both the per-run and total caps when a planned attempt declares neither. This proves that the effective default cap depends on which entry point started the run rather than on one authoritative declaration; it does not prove that any evidentiary run used an unintended cap, because `scripts/experiments/m2/planSchema.ts::orchestratorPlanSchema` requires a live attempt to declare both caps explicitly.

**Current limitation.** Wire artifacts do not carry the attribution a concurrent laboratory would need. The envelope validated by `src/sim/decisions/externalSchemas.ts::externalDecisionRequestEnvelopeSchema` identifies a run, a request, a condition, and a prompt version, the trace row written by `gateway/server.ts::createGateway` through its `writeTrace` helper identifies a run, a request, a prompt version, and a model, and the envelope carries above-run design-family attribution as well — `experimentId` and `experimentVersion`, both required by that schema and paired exactly with the condition by its refinement — but neither artifact carries a study identifier, registration identifier, planned-run identifier, execution identifier, laboratory-worker identifier, budget-scope identifier, route identifier, or provider project identifier; route evidence exists only in the separately written router-metadata sidecar, and only when the adapter reports it. Distinct causes collapse into one `budget-exhausted` failure code. There is no explicit provider-accepted stage separate from provider-completed, no monetary cost field, and no local-queue-time field in the gateway record; the client's queue and dispatch timestamps are recorded as noncanonical diagnostics. This proves that no wire artifact can today be joined to a study, a planned run, an execution attempt, or a budget scope without an external mapping, the one above-run identity on the wire being the design family rather than the registered study or any unit of work; it does not prove that the missing fields belong on the envelope rather than elsewhere, which the model-accounting and time chunks decide.

**Current limitation.** The word "provider" names three different things, carried by three distinct field names in three distinct artifacts, and no record joins them. `providerId` names the decision authority: `src/sim/runtime/engine.ts` puts the deciding provider's identifier on `DecisionRequested`, and the same field name carries the same meaning on the gateway trace row declared by `src/shared/modelArtifacts.ts::modelTraceEntrySchema` and written by the `writeTrace` helper inside `gateway/server.ts::createGateway`. `servingProviderId` names the configured route: `gateway/config.ts::publicConfig` derives it from the pinned OpenRouter provider slug for a live OpenRouter route, reports `local` for the fake adapter, and yields null for the `openai` adapter kind, exposing it as nonsecret configuration; `scripts/experiments/m2/planSchema.ts::expectedTreatmentSchema` and `scripts/experiments/m2/registrationRegistry.ts::RegistrationTreatmentPins` carry the same field as a registered treatment pin, and `scripts/experiments/m2/sequenceState.ts` records it as `expectedServingProviderId`, one of the nineteen `RESUME_IDENTITY_FIELDS`. `upstreamProviderId` names the observed serving provider: `src/shared/modelArtifacts.ts::routerTraceEntrySchema` declares it nullable, and `gateway/tracing/modelTraceWriter.ts::ModelTraceWriter`, through its `writeRouterMetadata` method, writes it into a per-request routing sidecar, leaving it null where the router metadata named no selected endpoint. This proves that the three questions — who was entitled to decide, what route was configured, and who actually served the call — are asked by three separate fields written to three separate artifacts, so no single recorded value spans them; it does not prove that the attribution is sufficient for a concurrent laboratory, because no complete joined attribution record binds decision authority, configured route, observed serving provider, study, planned run, execution attempt, laboratory worker, and budget scope together, and WP2-SCOPE-009 rather than this observation is what makes their separation testable.

### 5.7 Strict finalization

**Current fact.** Finalization is typed and per attempt. `scripts/experiments/m2/runFinalizer.ts` exposes `finalizeDeterministicAttempt` and `finalizeModelAttempt`, and its `guardStage` helper converts any unexpected throw inside a named stage into a closed-taxonomy failure class carrying that stage name, so a post-browser failure is never a generic error. This proves that finalization failures are classified by the stage that produced them rather than left untyped; it does not prove that the two exposed entry points share a contract, since `guardStage` types the failures of two differently shaped pipelines.

**Current fact.** `scripts/model/prepareRun.ts::prepareRunDirectory` runs the complete ledger validator before touching the filesystem, refuses a ledger that fails validation, refuses a mismatched bundle handoff, and refuses a ledger filename that would be invisible to the finalizer's selection pattern. This proves that the read-only refusals precede every write on the model finalization path; it does not prove that the destination is protected while those checks run, because the function holds no claim over the run directory it is about to populate.

**Current fact.** `scripts/model/finalize.ts::finalizeRunDirectory` is strict by default: status `completed` is written only when every strict criterion holds, an absent optional evidence source exits nonzero and writes nothing unless degraded mode is requested, and contradictions between present sources are fatal in both modes. Derived files are computed first and staged in a sibling same-volume directory named by `stagingDirFor`, and the commit order deletes the bundle manifest first, renames the derived files into place with bounded retries, and writes the bundle manifest last, so an interrupted commit leaves the unambiguous not-finalized signal of a missing manifest. This proves that partial finalization is detectable from the evidence alone, without consulting any external record; it does not prove that the commit is safe against a second finalizer, because its ordering guards against interruption rather than against a competing writer.

**Current limitation.** Deterministic and model attempts follow different finalization contracts, so there is no single finalization interface an implementation could target uniformly. `scripts/experiments/m2/runFinalizer.ts::finalizeDeterministicAttempt` validates the exported ledger and writes `behavior-fingerprint.json` and nothing else, while `scripts/experiments/m2/runFinalizer.ts::finalizeModelAttempt` additionally stages the browser artifacts into the gateway run directory, strict-finalizes it through `scripts/model/finalize.ts::finalizeRunDirectory`, loads it back through the trace-to-ledger evidence layer, and writes an enriched fingerprint. This proves that a caller has to know an attempt's condition kind before it can finalize it; it does not prove that a uniform interface is required, and Section 3.1 records how each path satisfies the finalization term over a different number of applicable evidence sources and where the two differ on the completion record.

**Current limitation.** Neither `scripts/model/prepareRun.ts::prepareRunDirectory` nor `scripts/model/finalize.ts::finalizeRunDirectory` holds a lease or fence over its destination. The staging directory produced by `stagingDirFor` is derived from the run identifier alone, so two processes finalizing the same run identifier in the same parent directory would contend for the same staging path. The current single-writer, serial orchestrator prevents that situation rather than the finalizer itself. This proves that the finalizer's safety is a property of how it is currently invoked rather than of the module; it does not prove that a contention has occurred, and it establishes no requirement for a lease, a fence, or a per-invocation staging name.

### 5.8 UI replay and reducer/ledger replay

**Current fact.** Two separately recorded replay verifications exist, both folding the same reducer through `src/sim/replay/replay.ts::replayLedger` without consulting any decision provider. `scripts/experiments/m2/browserDriver.ts::runBrowserAttempt` clicks the replay control in the running application, waits for a verdict, and fails the attempt with `replay-verdict-timeout` or `replay-mismatch` if the verdict does not arrive or does not report a match; that control reaches `src/sim/runtime/host.ts::replay`, which folds the reducer over the live run's own recorded events and compares the world-state hash and the canonical ledger hash. Separately, `src/sim/replay/validateLedger.ts::validateLedgerFile` folds the same reducer over an exported ledger file, compares the recomputed world-state hash to the recorded one, checks the hash carried in the terminal scenario event, and recomputes the canonical ledger hash. This proves that the reducer-replay check is recorded twice, over two different inputs and from two different surfaces, and that a mismatch on either surface is a typed failure; it does not prove that the two are mechanically independent proofs, because a defect inside `replayLedger` would affect both.

**Current fact.** Completed work is revalidated semantically, not merely by file hash. `scripts/experiments/m2/sequenceVerification.ts::revalidateCompletedExecutions` recomputes each completed execution's behavior fingerprint and compares it byte for byte, requires a model attempt's run directory to still load as a strict-finalized run, and re-verifies the final manifest's treatment. `verifyCompletedSequence` additionally proves the whole root still matches its inventory and that the archive, sidecar, and receipt agree. This proves that completed evidence is rechecked by meaning and not only by file digest before work continues; it does not prove that the recheck spans more than the one sequence root it is given, because both functions take a single sequence root and its state.

**Current limitation.** Both replay verifications are scoped to one execution. There is no dispatch-wave, study, or cross-run replay lineage, no commit-order provenance across concurrent runs, and no serial-versus-parallel comparison of any kind. The two proofs also share the reducer-replay implementation `src/sim/replay/replay.ts::replayLedger`, reached from the browser driver's verdict through `src/sim/runtime/host.ts::replay` on one side and from `src/sim/replay/validateLedger.ts::validateLedgerFile` on the other, so their agreement is evidence about the recorded events rather than about the reducer; Section 3.1 records that they differ by invocation surface and input, not by mechanism. This proves that no current record ties a replay verdict to anything larger than one execution; it does not prove what lineage or independence a future replay verification has to carry, which the evidence chunk decides.

### 5.9 Per-execution and sequence-root evidence sealing

**Current fact.** Every terminal execution is sealed. `scripts/experiments/m2/sequenceState.ts::sealExecution` walks the execution directory where that directory exists, records a SHA-256 for each file it finds and an aggregate over the sorted path-and-hash lines, and writes the seal together with the terminal status; where the directory is absent the walk is skipped, and an absent directory and one holding no file alike yield an authenticated empty set — an aggregate over zero path-and-hash lines, with an empty file list. `verifySealedExecutions` recomputes and compares every terminal seal before a resume proceeds and reports missing, altered, and added files by name. `markInterruptedExecutions` converts an execution left in progress by a crash into a failed, sealed, preserved execution rather than continuing it in place. This proves that every terminal execution, successful or failed, carries an authenticated digest over exactly the evidence its own directory then held, and that the digest establishes authenticated immutability for that execution attempt from that point forward; it does not prove that the seal covers anything outside that directory, that the sealed file set is non-empty, or anything about evidence produced by a concurrently executing sibling, and finality over the whole root is established later and separately at sequence level.

**Current fact.** Sequence-root sealing is a separate, later transaction. `scripts/experiments/m2/packageEvidence.ts`, at packaging version `m2-evidence-packaging-2.1.0`, runs a secret scan, writes or verifies the root inventory named by `INVENTORY_FILE_NAME`, stages a fresh archive as a dot-prefixed temporary sibling of the destination through `stagedArchivePath`, verifies extraction against the inventory, commits by atomic rename to a versioned destination selected by `nextArchivePath`, never deleting or overwriting a prior archive, and only then writes the sidecar hash and receipt. `readInventory` presence is treated by `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` as proof that the root is final, diverting a resume to a packaging-only recovery path. This proves that sequence-root sealing is a distinct, later, crash-safe transaction over a whole root, and that a prior archive is never destroyed by a subsequent one; it does not by itself prove the completeness of any study, because `packageSequence` seals exactly the root it is given and consults no study registration to learn which evidence roots that study registered, although the root it seals may hold all the evidence of a specifically registered one-sequence study, in which case the two boundaries coincide without the packager establishing that they do.

**Current fact.** A sequence that fails before packaging is never packaged. `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` writes the sequence report and manifest for such a sequence, records it as failed, and preserves it, while only a sequence whose attempt set succeeded enters `runPostSequencePipeline` and reaches evaluation, packaging, and completion. The one exception is narrow and explicit: a failure inside the packaging transaction itself is recorded as status `failed` after the root inventory already exists, and a later resume is diverted to `scripts/experiments/m2/orchestrate.ts::resumePackagingReady`. That function first returns a verified no-op for a root already recorded `completed` whose every planned attempt has a completed execution, creating no additional archive; only otherwise does it restrict the statuses it will act on to `packaging` and `failed`, refusing any other with `packaging-recovery-unexpected-status`. That two-status restriction governs the archive-committing path, which refuses to proceed unless every planned attempt has a completed execution, re-verifies the sealed root read-only against its authenticated inventory, and only then commits the next versioned archive and records `completed`. The standalone `m2:package` command in `scripts/experiments/m2/cli.ts` has no such path and refuses any root whose recorded status is not `completed`, raising `package-requires-completed-sequence`. This proves that per-execution seals and sequence-root sealing are different guarantees reached on different paths, and that reaching the second one after a failure requires a complete, inventory-verified root; it does not prove that a failed sequence is unpackageable in general, since the packaging-recovery path exists precisely to complete one.

**Current limitation.** There is no wave-level or multi-sequence seal, and no seal that attests completeness and integrity over the evidence roots registered to a study. The two sealing mechanisms that exist are bounded by construction: `scripts/experiments/m2/sequenceState.ts::sealExecution` walks one execution directory, and `scripts/experiments/m2/packageEvidence.ts::packageSequence` inventories and archives one sequence root, reading no study registration that would tell it which roots a study's evidence comprises. This proves that the largest boundary the repository authenticates is one sequence root, and that no mechanism consults a study's registration to decide what a study-level seal would have to cover; it does not prove that a study whose registered evidence lies wholly inside one sealed sequence root is unsealed in fact, it does not prove that a larger boundary is required, and it names no aggregation, wave, or study identity that such a seal would have to carry.

**Current limitation.** Packaging version `m2-evidence-packaging-2.1.0` has a confirmed archive-format defect. [`documentation/milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md`](../../../002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md), Appendix A, independently verifies that on the observed Windows path this version produced an archive named with a `.zip` suffix that is a POSIX tar file rather than a standards-conforming ZIP, because the packager's crash-safe staged filename defeats suffix-based format inference in the archiving helper. The appendix also records that the evidence bytes and the cryptographic receipt remained intact and verified. This contradicts the portable-ZIP contract stated in [`documentation/milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](../../../002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md), Section 25.5, which requires portable ZIP entries verified by a clean extraction test. The historical package remains immutable, and charter Section 14.9 requires that a corrected packaging version preserve rather than replace it. This proves that a stated packaging contract and the artifact it produced diverged without the receipt detecting it, because the receipt written by `scripts/experiments/m2/packageEvidence.ts::packageSequence` attests a SHA-256 over the committed archive file rather than its container format; it does not prove that any evidence was lost, which the same appendix expressly excludes, and it does not settle whether a future packaging version must be independently format-verified.

**Current limitation.** `scripts/experiments/m2/packageEvidence.ts::nextArchivePath` selects the first unused versioned name by testing existence, so the selection and the later commit are separate steps. Under the current single-writer lock this cannot race; a standalone repackaging invocation outside that lock would not have the same protection. This proves that archive-name selection is protected by the surrounding lock rather than by the selection itself; it does not prove that a collision has occurred, and it establishes no requirement for an atomic name reservation in the future contract.

### 5.10 Failure disposition and registered replacement

**Current fact.** The failure vocabulary is closed and partitioned. `scripts/experiments/m2/failureTaxonomy.ts`, at taxonomy version `m2-failure-taxonomy-1.0.0`, defines `RETRYABLE_ELIGIBLE_FAILURE_CLASSES` for transient operational classes and `HARD_STOP_FAILURE_CLASSES` for integrity, treatment, evidence, and finalization-stage classes, and `scripts/experiments/m2/planSchema.ts::orchestratorPlanSchema` builds the plan's registrable retryable set from the eligible list alone, so a hard-stop class cannot be registered as retryable. This proves that the classes a plan may treat as transient are fixed in source and cannot be widened by a plan; it does not prove that the closed set covers the failures a concurrent laboratory would meet, and the final limitation of this subsection records which such classes are absent.

**Current fact.** Disposition is assessed once and persisted. `scripts/experiments/m2/failureTaxonomy.ts::assessReplacementDisposition` returns `forbidden` for a hard-stop or unregistered class and otherwise returns `permitted` or `exhausted` against the registered capacity, and `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` stores that value on the execution record. `scripts/experiments/m2/sequenceState.ts::assertResumable` then refuses a resume based on the recorded disposition rather than re-deriving capacity. This proves that a failure's consequence is decided once, written down, and honored afterwards rather than recomputed from changing inputs; it does not prove that the decision is safe against a competing claimant, because the assessment and the write are performed by the one process holding the per-root lock.

**Current fact.** Artifact validity and study validity are recorded separately. `scripts/experiments/m2/sequenceState.ts::attemptExecutionSchema` carries an `artifactStatus` field distinguishing a valid from an invalid evidence pipeline and a `studyStatus` field distinguishing a study-valid run from one that is artifact-valid but missed the registered treatment thresholds. Failed and interrupted executions are preserved and sealed rather than deleted, overwritten, or continued in place. This proves that a pipeline verdict and a scientific verdict are separate recorded values, and that every terminal execution preserves and authenticates all the evidence it actually produced, an interruption that preceded any evidence creation yielding the explicit empty-set seal Section 5.9 records rather than an unsealed or discarded execution; it does not prove that either verdict is attributable above the execution, because both fields live on one execution record inside one sequence state.

**Current limitation.** Replacement lineage is implicit rather than recorded: `scripts/experiments/m2/sequenceState.ts::attemptExecutionSchema` carries no predecessor-execution field, so nothing states that a given execution replaced a specific earlier one, only that both share a planned attempt identifier and that one carries a higher `-e<N>` suffix. This proves that replacement lineage today has to be inferred from identifier shape and ordering rather than read; it does not prove that the inference has ever been wrong for a serial sequence, and it establishes no required lineage representation.

**Current limitation.** There is no vocabulary or disposition for a transport or delivery retry, a laboratory-worker restart, a cancellation, a lease expiry, stale laboratory-worker output, containment of sibling units, or a partially dispositioned wave. `scripts/experiments/m2/failureTaxonomy.ts`, at taxonomy version `m2-failure-taxonomy-1.0.0`, holds the complete class set, and `assessReplacementDisposition` returns only `permitted`, `forbidden`, or `exhausted`; neither admits any of those cases. A non-permitted disposition halts every remaining planned attempt in the serial loop, which is a coherent policy for one serial sequence but says nothing about how concurrent siblings would be treated. This proves that the current taxonomy has no name for a failure whose cause is another executing unit; it does not prove which such names a future contract needs, which the failure chunk assigns.

### 5.11 Aggregation and analysis boundaries

**Current fact.** Sequence-level evaluation is derived and honest about incomparability. `scripts/experiments/m2/evaluateSequence.ts::evaluateFromState` loads the behavior fingerprint of every completed execution in one sequence root, fails rather than silently omitting a completed execution whose fingerprint is missing, compares every comparable pair, and lists non-comparable pairs as skipped. Its own module comment records that during orchestration the evaluation is written into the sequence root before packaging, becoming part of the sealed evidence, and that a regenerated evaluation goes to a versioned derived-output directory instead; the default value of the function's `outputPath` parameter is `join(sequenceRoot, 'sequence-evaluation.json')`, and `scripts/experiments/m2/orchestrate.ts` calls it without that argument. This proves that a derived result can be honest about which observations it could not compare, and that the orchestration-time evaluation is sealed rather than kept outside the evidence; it does not prove that the write location suits a study-level aggregate, and Section 3.1 records that the term *aggregation* does not adopt it.

**Current fact.** The production analyzer verifies before it analyzes and is bound to one exact design. `scripts/evaluation/calibrationVariance.ts::analyzeRegisteredCalibration` performs full sequence verification, `assertRegisteredCalibrationDesign` compares the recorded state, plan, and study against the closed registry entry for `calibration-variance-a` and refuses on any disagreement, including a registered sample size other than ten or a plan that does not contain exactly ten attempts, `mapRegisteredPrimaries` refuses unless exactly ten primary observations are mapped, and `writeCalibrationAnalysis` writes derived output create-once through `writeCalibrationReport` in the same file, which refuses an already-existing destination with `calibration-analysis-output-exists`. The destination itself is whatever the caller names: the `m2:analyze` command in `scripts/experiments/m2/cli.ts` defaults it to a versioned subdirectory of the sequence root's `.derived` sibling, outside the immutable evidence root, and accepts an `--out` directory instead. This proves that verify-then-analyze, typed exclusions, one-primary mapping, and versioned create-once derived analysis are existing contracts; it does not prove that any of them generalizes beyond the one registered design, because `assertRegisteredCalibrationDesign` refuses anything that is not the `calibration-variance-a` entry.

**Current fact.** The deterministic batch is serial and writes to a shared repository-level location. `src/sim/batch.ts::runFullBatch` iterates every scenario sequentially, replays each ledger, and repeats runs to confirm hash stability, and `scripts/batch/run.ts`, reached through `npm run batch`, writes its ledgers, traces, and reports into an `artifacts` directory resolved from the current working directory. This proves that hash stability across repeated deterministic runs is already exercised as a gate; it does not prove that the batch is safe to run twice at once, because its output location is derived from the working directory alone and carries no run or study namespace.

**Current limitation.** No general multi-sequence or multi-study aggregator exists. There is no aggregation identity, no ledger of source evidence roots, no partial-study lifecycle, no denominator or missingness model beyond one sequence, and no detection of scheduled units that remain undispositioned. `scripts/experiments/m2/evaluateSequence.ts::evaluateFromState` reads exactly one root, and `scripts/evaluation/calibrationVariance.ts::assertRegisteredCalibrationDesign` is bound to one Milestone 2 calibration design. Neither is a general completion authority. This proves that no component in the repository can declare a result complete across more than one sequence root; it does not prove what a completion authority would have to check, and the aggregation chunk rather than this observation defines that.

**Current limitation.** The shared `artifacts` output location used by `scripts/batch/run.ts` is not namespaced per run or per study, so concurrent invocations in one working directory would overwrite one another's derived output. This proves that the deterministic batch's output location depends on where it was started rather than on what it produced; it does not prove that any evidentiary artifact is affected, because that location is an `artifacts` directory under the working directory rather than a sequence evidence root.

### 5.12 Continuous integration and keyless rehearsal

**Current fact.** One clean-checkout job carries the required gates. `.github/workflows/ci.yml` defines a single `checks` job that installs dependencies cleanly and then runs typecheck, gateway typecheck, lint, the documentation link check, frozen-data validation, the unit and integration suites, gateway tests, model-bundle tests, production and gateway builds, a distribution secret scan, browser end-to-end tests, the full deterministic batch, the keyless model rehearsal, the affordance audit, the Milestone 2 orchestrator tests, and the keyless unattended-orchestrator rehearsal. A compact proof artifact is always prepared, and heavier rehearsal evidence uploads only on failure or explicit dispatch. This proves that the full evidence path is exercised on a clean checkout of the exact commit before any merge; it does not prove that any gate exercises concurrency, because the job declares one runner and runs its steps in sequence.

**Current fact.** The rehearsals are keyless by construction. `scripts/experiments/m2/rehearse.ts`, reached through `npm run m2:rehearse`, drives real Chromium against a fresh fake-adapter gateway child on the fixed automation ports, and `gateway/config.ts::loadGatewayConfig` refuses to read the credential file at all in fake mode and blanks credential fields regardless of the process environment. This proves that strict finalization, replay, sealing, failure handling, and recovery are exercised without any credential; it does not prove that a live path behaves identically, because the fake adapter answers from local logic rather than from a network provider.

**Current limitation.** The workflow job and both rehearsals are sequential, write to fixed repository-level artifact roots that are not namespaced per run, and contain no isolation, scheduling, wave, or parity gate: `scripts/model/rehearse.ts` defaults its output root to `artifacts/model-rehearsal` and clears it at start under `--ci`, and `scripts/experiments/m2/rehearse.ts::runM2Rehearsal` clears and rewrites both `artifacts/m2-sequences` and `artifacts/m2-rehearsal` at start. The fixed-port constraint belongs to the unattended-orchestrator rehearsal alone: `scripts/experiments/m2/viteDriver.ts` pins `AUTOMATION_VITE_PORT` and `AUTOMATION_GATEWAY_PORT`, `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` refuses to start when either port is occupied, and `executeAttempt` in the same file launches the gateway child on that gateway port. The keyless model rehearsal does not use them: `scripts/model/rehearse.ts::rehearsalGatewayConfig` sets `port: 0` and the harness starts `gateway/server.ts::createGateway` in its own process, connecting to the loopback port the operating system assigns and `gateway.start()` returns. The workflow's `concurrency` block cancels superseded workflow runs for one Git reference and is unrelated to simulation concurrency. This proves that each rehearsal's output location is fixed rather than derived per run, and that only one of the two is port-bound; it does not prove that either constraint would block a concurrent laboratory, since both are properties of how the rehearsals are configured rather than of the modules they exercise.

### 5.13 Reusable contracts versus single-sequence implementation details

The distinction below separates what a future contract could adopt from what exists only because the current laboratory executes one sequence at a time in one process tree. Nothing in the right-hand column is criticized; it is recorded so that a later chunk does not mistake an implementation convenience for a governing rule.

| Area | Reusable as a contract | Single-sequence implementation detail |
| --- | --- | --- |
| Registration | Versioned study schema, byte-exact plan hash and configuration fingerprint, Git-authenticated template provenance, create-once transactional output, pre-launch re-verification | The two-entry closed registry in `scripts/experiments/m2/registrationRegistry.ts`, the Milestone 2 template paths, the Stage A prerequisite chain, and the `.staging` sibling naming in `scripts/experiments/m2/register.ts` |
| Identity | Separate planned, physical-execution, model-run, and decision-request identities; exact identity agreement before continuing work; per-execution directory scoping | The `<attemptId>-e<N>` string form, the nineteen-field resume list, and the random run identifier minted by `src/app/modelGatewayClient.ts::ModelGatewayClient` |
| Roots and locking | Evidence and mutable control state in separate roots, read-only collision preflight before any write, refusal to adopt an unknown root, atomic state writes | The `.control` suffix convention, the process-identifier lock file in `scripts/experiments/m2/orchestrate.ts::acquireSequenceLock`, and the acceptance of an existing empty root |
| Execution | Read-only gates before any write, fresh isolation per attempt, recorded process provenance, bounded watchdogs, idempotent resume, cleanup that cannot erase evidence | The serial attempt loop, the fixed ports 5199 and 8799, one development server and one browser per sequence |
| Model traffic | Engine-owned logical request identity, exact validated envelopes, per-run idempotency keyed by request identity with context-hash equality, typed budget refusal, separate client, gateway, provider, and engine verdicts, joins by identity rather than wall clock | The in-memory run-budget map with oldest-entry eviction, the per-attempt gateway process reset, and the three independently declared default call caps |
| Finalization | Full ledger validation before staging, strict validation of every applicable evidence source with exact reconciliation among them where more than one applies, strict-by-default completion, contradiction as fatal, same-volume staging, completion record written last | The separate deterministic and model contracts and the run-identifier-derived staging path in `scripts/model/finalize.ts::stagingDirFor` |
| Replay | Two separately recorded proofs over different inputs, the live run and the exported evidence, kept separately identified; semantic revalidation of completed evidence rather than file-hash comparison alone | The operator-surface control the browser driver clicks and its textual verdict format |
| Sealing | Per-execution seal over the evidence a terminal execution actually produced, failed and interrupted executions included, control and evidence separation, authenticated whole-tree inventory at the root boundary, immutable versioned archive, receipt written last, read-only verification of a completed root | Packaging version `m2-evidence-packaging-2.1.0` and its archive-format defect, the staged temporary-file naming, and the existence-test archive-name selection |
| Failure and replacement | Closed failure taxonomy partitioned into retryable-eligible and hard-stop classes, artifact validity separate from study validity, preserved and sealed failed evidence, preregistered replacement capacity, persisted disposition consulted on resume | The halting of all remaining serial attempts on a non-permitted disposition and the implicit replacement lineage under one planned attempt identifier |
| Aggregation | Verify before analyze, deterministic rebuild from immutable facts, explicit design and completeness gates, typed exclusions, one-primary mapping, versioned create-once derived output written outside the evidence root | The binding of `scripts/evaluation/calibrationVariance.ts` to one Milestone 2 calibration design, the single-root scope of `scripts/experiments/m2/evaluateSequence.ts`, and its orchestration-time write of `sequence-evaluation.json` into the sequence root it reads |
| Continuous integration | A keyless single-run and evidence-path baseline exercising finalization, replay, sealing, failure, and recovery with fake adapters | The single sequential job, the fixed ports, and the shared artifact roots |

### 5.14 Ambiguities carried forward

The nine items below record what Section 5 leaves unsettled, together with the decisions this chunk has already taken about them. None of them states a requirement of the future contract, which Section 4.3 reserves to the assigned chunks. Items 1 and 2 each resolve a disagreement between an earlier Milestone 2 document and the merged implementation in favor of the current behavior — item 1 through the terminology decision Section 3.1 records — and item 7 settles how the layered replay and sealing meanings are named and reported while carrying its granularity, lineage, and identity residue forward. The rest are absences or limitations recorded above; this section does not settle their future treatment, which belongs to later assigned chunks, and item 3 leaves the isolation chunk only a narrow scope question.

1. **Planned attempt versus physical execution.** [`documentation/milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](../../../002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md), Sections 19.11 and 24.1, states that a replacement creates a new attempt identifier and that every attempt receives a distinct attempt identifier and immutable directory. The merged implementation instead keeps the planned `attemptId` stable and mints a new `executionId` per physical execution in `scripts/experiments/m2/sequenceState.ts::nextExecutionId`. Section 3.1 adopts the implemented distinction under the names *planned run* and *execution attempt* and records that decision explicitly.
2. **Stale resume-identity count.** [`documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md`](../../../../operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md), Section 5, states that resume identity-checks sixteen fields. `scripts/experiments/m2/sequenceState.ts::RESUME_IDENTITY_FIELDS` contains nineteen. The source is the current behavior; the operator document has not been updated, and this specification does not modify it.
3. **Acceptance of a pre-existing empty root.** `scripts/experiments/m2/orchestrate.ts::orchestrateSequence` refuses to adopt an unknown non-empty root but accepts an existing empty one, as Section 5.4 records. The staged instructions already direct the isolation chunk to specify how an attempted adoption of an existing output root must fail safely, so the future requirement drafted there resolves the difference; what that chunk still has to decide is the narrow scope question of whether a pre-existing empty directory counts as an existing output root for that requirement.
4. **Milestone 2 packaging-version archive-format defect.** Recorded in Section 5.9 above from Appendix A of the Milestone 2 closeout report. The historical package remains immutable. Whether and how a future packaging version is required to be independently format-verified is a later question, not one this section answers.
5. **Process-local gateway budget and idempotency state.** Recorded in Section 5.6 above. That this state is process-local and evictable is a limitation; it establishes no requirement for any particular durable, shared, or atomic accounting mechanism.
6. **Parallel-looking values that are not parallel-run support.** Recorded in Section 5.5 above for the gateway concurrency setting, the single-flight client, and the workflow concurrency block. None of them is evidence that concurrent independent runs are supported.
7. **Layered replay and sealing meanings.** Recorded in Sections 5.8 and 5.9 above. The naming and reporting question is settled in this chunk: Section 3.1 assigns distinct names, WP2-SCOPE-007 requires UI replay and reducer/ledger replay to be recorded and reported as separately identified verifications with separately identified verdicts wherever a UI replay surface exists, and WP2-SCOPE-008 requires per-execution sealing, whole-evidence-root inventory and archive sealing, any study-level sealing boundary attesting completeness and integrity over all the evidence roots registered to one study, whether one or many, and study aggregation to be recorded and reported as distinct operations with distinct evidence, each seal identifying the boundary it authenticates. What is carried forward is the granularity, lineage, and identity model for those layers — whether immutability and sealing bind per execution attempt or only at sequence or study granularity, whether replay verification acquires dispatch-wave, study, or cross-run lineage, and what identifiers each layer carries — which the staged instructions assign to the identity and lineage chunk and to the evidence chunk. This section settles none of that residue.
8. **Incomplete request, provider, and time attribution.** Recorded in Section 5.6 above. The missing study, planned-run, execution, laboratory-worker, and budget-scope attribution, the absence of a provider-accepted stage and a cost field, and the absence of any record joining decision authority, configured route, and observed serving provider to those identities are open gaps whose resolution belongs to the model-accounting and time chunks.
9. **Absence of a general multi-root completion and aggregation authority.** Recorded in Section 5.11 above. No current component can declare a multi-sequence or multi-study result complete, and no aggregation identity exists. The aggregation chunk addresses the requirement; this section only records the absence.

None of the nine items is an **Open question** in the Section 4.3 sense. Item 3 in particular is a current limitation, not an unresolved conflict of authority: under the evidentiary source stated in Section 1.2 the current implementation's behavior is repository evidence of what the repository does, which is not authorization to preserve that choice in the future contract, and the staged instructions already bind the isolation chunk to state the required invariant and its conformance boundary. This section therefore leaves nothing awaiting an explicit ruling, and Section 21 remains where an open question and any later ruling would be recorded.

## 6. Entity, identity, and lineage model

### 6.1 What this section establishes

This section defines the conceptual entities that a conforming laboratory identifies, the lineage relationships among them, and the requirements that keep those identities and relationships auditable while many independent runs and many independent studies execute at the same time. It is implementation-neutral: it names roles, relationships, and properties, and it selects no identifier format, no registry, no store, no schema, and no naming convention. Sections 6.3 through 6.8 hold the entity register, Sections 6.9 through 6.16 hold the normative requirements, Section 6.17 records options deliberately left unselected, and Section 6.18 records what is assigned to later chunks.

Every substantive statement here is a Required future invariant carrying exactly one `WP2-ID-###` identifier, a Design rationale introduced by a **Rationale.** lead-in, or an Unselected option introduced by an **Unselected option.** lead-in, in the Section 4.3 sense, or else a register entry of Sections 6.3 through 6.8, whose normative force flows through WP2-ID-027 rather than through an identifier of its own. Those register entries supply the normative entity-model definitions that WP2-ID-027 incorporates and makes binding, so their individual table cells carry no separate requirement identifier, as Section 6.2 records, and Section 6.18 states this section's boundaries rather than an obligation of its own. Nothing in this section is a Current fact or a Current limitation; those belong to Section 5, and WP2-SCOPE-010 keeps a current mechanism from being read as a requirement. Every defined term used here carries the meaning Section 3.1 assigns it, as WP2-SCOPE-005 requires.

**Rationale.** Section 1.1 states, in the present tense and of the head at which it is read, that Sections 6 through 21 hold no substantive content, and Section 4.2 states in the same form that the remaining eleven namespaces hold no assigned identifier at this head. Neither sentence is accurate at the head this chunk produces: Sections 6 and 7 now hold substantive content, and identifiers are now assigned in the `WP2-ID-###` and `WP2-ISO-###` namespaces, which leaves nine of the reserved namespaces unassigned rather than eleven. This chunk revises no part of Sections 1 through 5 other than the three Section 3.1 terminology rows a later Advisor ruling authorized, and neither sentence is among them, so neither sentence can be corrected here; both are recorded as inconsistencies this document now carries with itself, in the way Section 5.14 records a carried item, and both are left to the final integration chunk that the staged instructions assign, whose required work includes removing incomplete-section language. The consequence Section 1.1 draws is unaffected and holds on independent grounds: Sections 8 through 21 and the conformance document still hold no substantive content, and Section 1.4 records that no established specification version exists, so the contract remains incomplete and cannot be treated as a settled technical baseline.

### 6.2 How the entity register is read

Each register entry states the same eight attributes in the same order. The register supplies normative entity-model definitions, which WP2-ID-027 in Section 6.16 incorporates and makes binding clause by clause, except for the specific question an entry expressly assigns to a later section.

| Attribute | What the entry states |
| --- | --- |
| Identity scope | The domain within which the identity distinguishes one instance of the entity from every other instance of that entity. |
| Issuing or governing authority | The role answerable for assigning the identity and for recording it. |
| Required parent or source references | The identities that the entity's own record has to name. |
| Cardinality | The counts that hold between this entity and the entities it references or is referenced by. |
| Version required | Whether a reference to an instance of the entity is incomplete without a version. |
| Identity begins to exist | The point from which the identity exists and can be referenced. |
| Exists without physical execution | Whether an instance can exist when no execution attempt has run. |
| Reuse and supersession | What may and may not be done with the identity after it has been assigned. |

**Rationale.** An authority named in the register is a role — the party or process answerable for assigning and recording an identity — and never a component, service, registry, database, or store. Naming a role selects no mechanism, and WP2-SCOPE-015 prohibits such a selection throughout this document. The register states the model, and WP2-ID-027 in Section 6.16 is what makes every non-deferred clause of each entry binding without giving any individual table cell a requirement identifier of its own; the requirements of Sections 6.9 through 6.16 state the obligations that hold across entries, and WP2-ID-002 is what makes each entry's required references testable record by record. A cell that assigns a question to a later section states a boundary rather than an answer, consistent with Section 4.3's rule that a required invariant is created only where an assigned chunk states it.

### 6.3 Governing and registered-design identities

**Specification identity and established specification version.**

| Attribute | Statement |
| --- | --- |
| Identity scope | This specification package, distinguished from every other document of Milestone 3; an established version is distinguished from every other established version of this same package. |
| Issuing or governing authority | The Work Package 2 governance process described in Section 1.4, operating under the authorities Section 1.2 records. |
| Required parent or source references | None inside the laboratory. An established version records the exact drafting head from which it was established. |
| Cardinality | One specification identity carries zero or more established versions over time. Zero or more studies cite one established version. |
| Version required | Yes. A citation of this specification is complete only with an established version, and Section 1.4 records that none exists at this head. |
| Identity begins to exist | The specification identity exists with this document; an established version exists only at the assignment Section 1.4 describes. |
| Exists without physical execution | Yes, entirely. Neither the specification identity nor an established version depends on any execution. |
| Reuse and supersession | An established version is never revised in place; a change produces a later established version. Section 1.5 prohibits substituting this identity or version for any other identity in this register. |

**Study identity and version.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every study the laboratory admits, including every study executing concurrently with it. |
| Issuing or governing authority | The registration authority that admits a preregistered study declaration. |
| Required parent or source references | The experiment identity and version the study instantiates, and the condition and treatment identities of its registered design. |
| Cardinality | One study is the child of exactly one experiment version. One study is the parent of zero or more planned runs and of exactly one study evidence root. |
| Version required | Yes. |
| Identity begins to exist | At registration, before any planned run of the study is dispatched. |
| Exists without physical execution | Yes. A registered study that never dispatches an execution attempt retains its identity and version. |
| Reuse and supersession | Never reused for a materially different registered design. Charter Section 14.2 governs which design changes require a new registered treatment, condition, or experiment version, WP2-ID-005 prohibits one study identity and version from carrying two materially different meanings, and WP2-SCOPE-016 prohibits reusing a Milestone 2 study identity here. |

**Study-plan and registration identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every registration the laboratory admits, including registrations admitted concurrently. |
| Issuing or governing authority | The registration authority. |
| Required parent or source references | Exactly one study identity and version, the condition and treatment identities of the registered design it binds, every concurrency-profile identity the study registers, and the planned runs the registration declares. |
| Cardinality | One registration binds exactly one study identity and version. It declares the planned runs it registers, and the study's registered sample size counts those planned runs. |
| Version required | Yes. A registration is established once, and a material change to what it binds produces a later registration identity or version rather than an edit. |
| Identity begins to exist | When the registration is admitted, which charter Section 14.3 requires to precede execution. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused. A superseded registration retains its identity and is named explicitly by the registration that supersedes it. |

**Experiment identity and version.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every design family the laboratory admits. |
| Issuing or governing authority | The research-design governance described in charter Section 14.2. |
| Required parent or source references | None inside the laboratory. An experiment version is the parent of the condition identities it declares. |
| Cardinality | One experiment version declares the condition identities of its registered arms and is the parent of zero or more studies. |
| Version required | Yes. |
| Identity begins to exist | When the design family and its version are established, before any study registers against them. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused for a materially different design family. Charter Section 14.2 governs which changes require a new experiment version, and WP2-SCOPE-016 prohibits reusing a Milestone 2 experiment identity here. |

**Analysis identity and version.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every analysis the laboratory admits. |
| Issuing or governing authority | The research-design governance described in charter Sections 14.2 and 14.7. |
| Required parent or source references | The metric identities and versions the analysis computes and the classes of evidence it consumes. |
| Cardinality | One analysis version is referenced by zero or more study registrations and produces zero or more study aggregations. |
| Version required | Yes. |
| Identity begins to exist | When the analysis and its version are established. Charter Section 14.3 lists the analysis identity among what a registration identifies where applicable, so an analysis relied on for a confirmatory claim is established before the execution its registration governs; an analysis that no registration references, including one charter Section 14.3 requires to be labeled exploratory, begins to exist when it is established. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused for a materially different analysis rule. Charter Section 14.2 requires an analysis-rule change to receive a new analysis version and prohibits silently altering a registered result. |

**World or scenario identity and version.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every registered world or scenario definition the laboratory admits. |
| Issuing or governing authority | The research-design governance described in charter Section 14.2, which requires a change to worlds, affordances, or semantic contracts to receive a new registered treatment, condition, or experiment version as appropriate. |
| Required parent or source references | None inside the laboratory. It is referenced by the study registration and by each planned run that instantiates it. |
| Cardinality | One world or scenario version is instantiated by zero or more planned runs. |
| Version required | Yes. |
| Identity begins to exist | When the world or scenario definition and its version are established. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused for materially different authoritative mechanics, affordances, semantic contracts, or starting state; charter Section 14.2 requires such a change to receive a new registered treatment, condition, or experiment version as appropriate, and WP2-ID-005 prohibits one world or scenario version from carrying two materially different meanings. This identity names a definition, and the identity of one executed instance of that definition is a planned-run identity; the two are never substituted for one another. |

**Rationale.** Charter Section 14.8 makes the deterministic engine final authority over objective world state, legal affordances, and committed consequences, and it denies model prose the standing to prove that an event occurred. That is authority over what is true inside an executed world, and it is a different thing from the governance that establishes, records, and versions a world or scenario definition, which charter Section 14.2 governs and which this entry names as the issuing authority. The engine is named here only in describing what charter Section 14.8 settles, because Section 6.2 keeps every authority in this register a role rather than a component.

**Condition identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every condition of one experiment version, recorded together with that experiment identity and version. |
| Issuing or governing authority | The research-design governance described in charter Section 14.2. |
| Required parent or source references | Exactly one experiment identity and version. |
| Cardinality | One condition belongs to exactly one experiment version and is referenced by zero or more studies and by zero or more planned runs. |
| Version required | No. A condition identity is not independently versioned; it is qualified by the experiment identity and version that declares it. |
| Identity begins to exist | When the experiment version declaring it is established. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused for a materially different registered arm. Charter Section 14.2 governs whether such a change requires a new condition identity or a new experiment version. |

**Treatment identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every registered treatment the laboratory admits, recorded together with the experiment version and condition it belongs to. |
| Issuing or governing authority | The research-design governance described in charter Section 14.2. |
| Required parent or source references | The condition identity it realizes, and the identity-bearing values Section 3.1 lists for a treatment, including model identity, serving provider and route identity, prompt version, and any registered authority allocation. |
| Cardinality | One treatment realizes exactly one condition and is referenced by zero or more registrations and by every planned run registered under it. |
| Version required | No separate version. The treatment identity itself changes when its registered composition changes. |
| Identity begins to exist | When the registered design fixing its values is established, before execution. |
| Exists without physical execution | Yes. |
| Reuse and supersession | Never reused for a different set of identity-bearing values. Charter Section 14.2 requires a change to model identity or version, serving provider or route, prompts, model authority, fallback behavior, worlds, affordances, semantic contracts, or cognitive treatments to receive a new registered treatment, condition, or experiment version, unless the preregistered design explicitly treats the difference as a condition. |

### 6.4 Planning, execution, and replacement identities

**Planned-run identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every planned run the laboratory admits, across all studies, all registrations, and all concurrent execution. |
| Issuing or governing authority | The registration authority that admits the study plan declaring the planned run. |
| Required parent or source references | Exactly one study identity and version, the condition and treatment identities under which it is planned, and the world or scenario identity and version it instantiates. |
| Cardinality | One planned run is the child of exactly one study, declares exactly one independent run, and is the parent of zero or more execution attempts. |
| Version required | No. A material change to what a planned run declares produces a different planned run, and charter Section 14.2 governs whether it also requires a new registration. |
| Identity begins to exist | When the planned run is declared in an admitted study plan, before and independently of any physical execution. |
| Exists without physical execution | Yes. A planned run for which no execution attempt was ever admitted remains a recorded planned run with zero execution attempts and no authoritative accepted outcome; a planned run all of whose admitted execution attempts were cancelled or failed before execution activity began retains those recorded attempts instead, and still carries no authoritative accepted outcome. |
| Reuse and supersession | Never reused. Cancellation, rejection, exclusion, supersession, failure, or completion never frees the identity, and a later planned run never takes it. |

**Execution-attempt identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every execution attempt the laboratory admits, across all studies, all planned runs, and all laboratory workers executing at the same time. |
| Issuing or governing authority | The laboratory authority that admits an execution attempt for its planned run. |
| Required parent or source references | Exactly one planned-run identity, exactly one laboratory-worker identity, and, where the attempt was in fact admitted or carried out under one, the dispatch-wave identity it belongs to and the identity of every lease under which it was admitted or carried out. An attempt that belongs to no dispatch wave names none, and an attempt admitted under no lease names none. |
| Cardinality | One execution attempt has exactly one planned-run parent, exactly one run evidence root, and zero or more model requests. One planned run has zero or more execution attempts. |
| Version required | No. A repeated execution of the same planned run is a further execution attempt with its own identity rather than a version of an earlier one. |
| Identity begins to exist | When a specific physical execution attempt is admitted for its planned run, which may precede the start of any execution activity by that attempt. |
| Exists without physical execution | Yes, in the narrow sense that the identity exists from admission, so it may precede the start of any execution activity and remains recorded where the admitted attempt is cancelled or fails before that activity begins; an execution-attempt identity is created only by admitting a specific physical execution attempt of a planned run, so a planned run has zero execution attempts exactly where no such identity was ever admitted for it. |
| Reuse and supersession | Never reused. A failed, interrupted, excluded, or superseded execution attempt keeps its identity, its terminal disposition, and the evidence it actually produced, consistent with charter Section 14.4. |

**Rationale.** Admission is the act that creates an execution-attempt identity, and admission is not successful launch, running, or completion: an attempt that is admitted and then cancelled, or that fails before any execution activity begins, keeps the identity its admission created together with the disposition it in fact reached, consistent with charter Section 14.4's requirement that failed, interrupted, invalid, excluded, and replacement attempts remain recorded evidence with typed dispositions. Section 3.1's execution-attempt entry states the same admission model for the defined term, and WP2-ID-007 states the zero-attempt rule that model implies: a planned run has zero execution attempts if and only if no execution-attempt identity was ever admitted for it. Lifecycle states and transitions, including what may occur between admission and the start of execution activity, are assigned to Section 8.

**Explicit replacement lineage.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every admitted registered replacement, identified by the replacing and replaced execution attempts it relates within the planned run they share. |
| Issuing or governing authority | The authority that admits a replacement under the study's preregistered replacement policy. |
| Required parent or source references | Exactly one replacing execution-attempt identity, exactly one replaced execution-attempt identity, the planned-run identity both share, and the registered replacement policy under which the replacement was admitted. |
| Cardinality | One replacement lineage record relates exactly one replacing execution attempt to exactly one replaced execution attempt. One planned run carries zero or more replacement lineage records. |
| Version required | No. |
| Identity begins to exist | When the replacement is admitted, which is the same act that admits the replacing execution attempt for the planned run the two attempts share; the replacing execution-attempt identity this record is required to name therefore exists from that admission, which the execution-attempt entry above permits to precede the start of any execution activity by that attempt. |
| Exists without physical execution | Yes, in the narrow sense that the record may exist while the replacing execution attempt it names, admitted by the same act that admitted the replacement, has not yet begun execution activity; it never exists without a replaced execution attempt, whose identity was admitted for the same planned run before the replacement was admitted. |
| Reuse and supersession | Never rewritten to name a different predecessor. A material error in a recorded replacement lineage is corrected under WP2-ID-025 and WP2-ID-026. |

### 6.5 Execution-agency identities

**Laboratory-worker identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every laboratory worker the laboratory operates, concurrently and over time. |
| Issuing or governing authority | The laboratory authority that admits a laboratory worker into service. |
| Required parent or source references | None from the study lineage. The execution host or environment a laboratory worker occupies is recorded as an attribute of the laboratory worker rather than as its identity. |
| Cardinality | One laboratory worker carries out zero or more execution attempts, and one execution attempt is carried out under exactly one laboratory-worker identity. |
| Version required | No. Whether the composition of an execution agent is recorded as versioned provenance is part of the concurrency profile, whose contents are assigned to Section 10. |
| Identity begins to exist | When the laboratory worker is admitted into service, before any unit of work is assigned to it. |
| Exists without physical execution | Yes. A laboratory worker that never carries out an execution attempt retains its identity. |
| Reuse and supersession | Never reassigned to a different execution agent. Whether a restarted execution agent retains its identity or receives a new one is a lifecycle question assigned to Section 8; Section 3.1 already records that a process restart is not itself a resume, a retry, a new execution attempt, or a replacement. |

**Lease identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every lease the laboratory issues, where it uses leases at all. |
| Issuing or governing authority | The laboratory authority that issues claims on units of work. |
| Required parent or source references | Exactly one laboratory-worker identity as holder and exactly one planned-run identity as subject. |
| Cardinality | One lease names exactly one laboratory worker and exactly one planned run. One planned run is the subject of zero or more leases over time. Whether more than one lease over one planned run may be valid at one instant, and how that is decided, is assigned to Section 9. |
| Version required | No. |
| Identity begins to exist | When the lease is issued. |
| Exists without physical execution | Yes. A lease may be issued and then expire, be revoked, or be released without any execution attempt having been launched under it. |
| Reuse and supersession | Never reissued. A lease keeps its identity after it ends, whether it expired, was released, was revoked, or was superseded, so that what was carried out under it remains attributable. For an expired, revoked, or superseded lease, WP2-ISO-021 requires in addition that the evidence actually produced under it remain attributable to the laboratory worker, the lease, and the execution attempt that produced it, and preservable for later disposition. |

**Rationale.** The subject of a lease is stated here as the planned run over which the claim is made, because that is the unit whose authoritative outcome a claim can decide and the unit this register already gives an identity. *Unit of work*, the phrase Section 3.1's lease row uses for the same subject, is read that way wherever this specification names the subject of a claim; it introduces no entity beyond the ones Sections 6.3 through 6.8 register, and it is a reading convenience rather than a further defined term of Section 3.1. Whether a laboratory issues leases at all, and the acquisition, duration, renewal, expiry, and arbitration rules if it does, are assigned to Section 9.

**Dispatch-wave identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every dispatch wave the laboratory forms, across all scheduling decisions and regardless of whether any admitted member attempt is ultimately released. |
| Issuing or governing authority | The laboratory scheduling authority. |
| Required parent or source references | None from the study lineage. A dispatch wave names every admitted execution attempt assigned to or grouped for release under its scheduling decision, whether that attempt is ultimately released, cancelled before release, or never begins execution activity. |
| Cardinality | One dispatch wave names zero or more admitted execution attempts, and one execution attempt belongs to at most one dispatch wave. |
| Version required | No. |
| Identity begins to exist | When the scheduling decision that defines the wave is recorded. |
| Exists without physical execution | Yes. The execution attempts a dispatch wave names are admitted execution attempts, and a wave every one of whose member attempts is cancelled after admission and before release, and before any execution activity begins, retains its identity and continues to name every one of those member attempts. |
| Reuse and supersession | Never reused. A dispatch-wave identity never substitutes for the identity of a study, a planned run, or an execution attempt, and never becomes a join key between them. |

### 6.6 Model-request identity

**Model-request identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | One logical model request, distinguished from every other model request across all concurrently executing studies and execution attempts once its recorded identity carries the lineage WP2-ID-016 requires; WP2-ID-022 governs whether a locally scoped request identifier may form part of that identity. |
| Issuing or governing authority | The authority that owns the decision the model request serves, which Section 3.1 and WP2-SCOPE-009 keep distinct from serving provider identity and from route identity. |
| Required parent or source references | Exactly one execution-attempt identity, the planned-run and study identities above it, and the deciding episode or decision the request serves. |
| Cardinality | One execution attempt originates zero or more model requests, and one model request belongs to exactly one execution attempt. |
| Version required | No. |
| Identity begins to exist | When the logical request is originated, which precedes any dispatch of it. |
| Exists without physical execution | No. A model request arises only inside an execution attempt, although it may exist without any dispatch to a provider ever occurring. |
| Reuse and supersession | Never reused. A transport or delivery retry repeats the delivery of one already-identified request and keeps that identity, as Section 3.1 defines; a new logical request receives a new identity. |

### 6.7 Evidence and derived-result identities

**Run-evidence-root identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every run evidence root in the laboratory, across all studies and all concurrent execution. |
| Issuing or governing authority | The laboratory authority that creates or reserves the root for its execution attempt. |
| Required parent or source references | Exactly one execution-attempt identity, and through it the planned-run and study identities. |
| Cardinality | One run evidence root belongs to exactly one execution attempt, and one execution attempt has exactly one run evidence root. |
| Version required | No. |
| Identity begins to exist | When the root is created or reserved under the identity of the execution attempt it belongs to, as part of that attempt's admission; the root's identity may therefore exist before any execution activity begins. |
| Exists without physical execution | Yes, in the narrow sense that the root of an admitted execution attempt exists from its creation or reservation, which may precede any execution activity, and it remains that attempt's root where the admitted attempt is cancelled or fails before that activity begins; a run evidence root belongs to an execution attempt, so a planned run for which no execution-attempt identity was ever admitted has none. |
| Reuse and supersession | Never adopted by, transferred to, or shared with another execution attempt. Section 3.1 records that the root is immutable once its attempt reaches a terminal state; its storage location is an attribute rather than its identity under WP2-ID-018. |

**Study-evidence-root identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every study evidence root in the laboratory. |
| Issuing or governing authority | The laboratory authority that creates or reserves the root for its study. |
| Required parent or source references | Exactly one study identity and version. |
| Cardinality | One study evidence root belongs to exactly one study and contains or references the run evidence root of every execution attempt belonging to that study, together with zero or more sealed packages. |
| Version required | No. |
| Identity begins to exist | When the root is created or reserved under the study's registration. |
| Exists without physical execution | Yes. A study evidence root may exist before any execution attempt of that study has run. |
| Reuse and supersession | Never adopted by or transferred to another study. It is an identity-bearing logical namespace or registered set under WP2-ID-019, and its storage location is an attribute rather than its identity. |

**Sealed-package identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every sealed package the laboratory produces. |
| Issuing or governing authority | The laboratory authority that performs the sealing operation. |
| Required parent or source references | The identity of the evidence boundary it seals, the inventory it authenticates, and the versioned packaging and sealing rules it applied. |
| Cardinality | One sealed package seals exactly one identified evidence boundary. One boundary is sealed by zero or more sealed packages over time; charter Section 14.9 requires an original package to remain preserved when a packaging defect is corrected in a later version, and the sealing contract is assigned to Section 13. |
| Version required | Yes for the packaging and sealing rules the package identifies, which charter Section 14.9 requires to be versioned. The package identity itself is not separately versioned. |
| Identity begins to exist | When the sealing operation commits. |
| Exists without physical execution | Yes. The identity comes into existence with the sealing operation, and a boundary whose inventory holds no evidence produced by an execution attempt can still be sealed. |
| Reuse and supersession | Never reused and never rewritten. A later package over the same boundary is a distinct sealed package that identifies its own boundary and inventory, as WP2-ID-020 and WP2-SCOPE-008 require. |

**Study-aggregation identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every study aggregation the laboratory produces. |
| Issuing or governing authority | The analysis authority governed by charter Sections 14.2 and 14.7. |
| Required parent or source references | Exactly one study identity and version, exactly one analysis identity and version, and the exact set of source evidence from which the aggregation derives, named by identity. |
| Cardinality | One study aggregation names exactly one study and exactly one analysis version. One study carries zero or more study aggregations. |
| Version required | No separate version. The aggregation names the analysis version it applied, and a different analysis version produces a distinct study aggregation rather than a revision of an existing one. |
| Identity begins to exist | When the aggregation is produced and recorded. |
| Exists without physical execution | No. Section 3.1 defines an aggregation as the derived combination of evidence from multiple execution attempts into a study-level result, so a study aggregation derives from a non-empty set of evidence that execution attempts produced, and none exists for a study whose planned runs produced no execution attempt. The row above states that the identity begins to exist when the aggregation is produced and recorded, so no aggregation identity is reserved ahead of the evidence it names; what makes a study aggregation complete is assigned to Section 15, and a study-level record of a study that produced no evidence would be a distinct record assigned there rather than a study aggregation. |
| Reuse and supersession | Never reused and never rewritten in place. Section 3.1 records that aggregation is written outside the immutable evidence it reads, and charter Section 14.9 requires derived analysis to record its source identities. |

### 6.8 Concurrency-profile identity reference

**Concurrency-profile identity.**

| Attribute | Statement |
| --- | --- |
| Identity scope | Every concurrency profile the laboratory records. |
| Issuing or governing authority | The registration authority, under the obligation charter Section 10.3 places on every future study to version and record a concurrency profile. |
| Required parent or source references | The study registration that adopts the profile. How a profile references dispatch waves, laboratory workers, execution attempts, or contention conditions is assigned to Section 10. |
| Cardinality | One study registers at least one concurrency profile. Every further cardinality is assigned to Section 10. |
| Version required | Yes, as charter Section 10.3 requires. |
| Identity begins to exist | At registration, because charter Section 14.3 lists the execution and concurrency profile among what a registration identifies. |
| Exists without physical execution | Yes, for the same reason. |
| Reuse and supersession | WP2-ID-005 and charter Section 14.2 apply, and charter Section 14.5 prohibits a registered study from silently changing its execution architecture midstream. Profile contents, fields, and comparison rules are assigned to Section 10. |

**Rationale.** This entry is a reference only. The contents of the concurrency profile are assigned to Section 10, and the entry is present here so that Section 6's graph names the identity rather than leaving a silent gap where a later section will attach.

### 6.9 General identity requirements

**WP2-ID-001.** Every entity instance a conforming laboratory creates from the register in Sections 6.3 through 6.8 **MUST** carry an explicitly recorded identity that is not derived solely from a storage path or location, a wall-clock timestamp, an execution or record ordering, or a locally scoped identifier whose scope is narrower than the identity scope the register states for that entity.

**WP2-ID-002.** A conforming laboratory **MUST** record, with the identity record of every entity instance it creates, each parent or source reference that the register entry for that entity states as required.

**WP2-ID-003.** Every identity a conforming laboratory assigns **MUST** distinguish its instance from every other instance of the same entity throughout the identity scope the register states for that entity, including across every study and every execution attempt running at the same time.

**WP2-ID-004.** Where the register states that a version is required for an entity, every reference to an instance of that entity **MUST** carry that instance's version together with its identity.

**WP2-ID-005.** A conforming laboratory **MUST NOT** use one recorded identity, or one recorded identity-and-version pair, to carry two materially different meanings.

**Rationale.** WP2-ID-005 restates charter Section 14.2's rule inside this contract so that a conformance check can be written against it. It is not a prohibition on correcting an error: WP2-ID-025 and WP2-ID-026 state how a material identity error is corrected without breaking it. WP2-SCOPE-016 separately prohibits reusing a Milestone 2 identity as a Work Package 2 or Milestone 3 identity, and Section 1.5 separately prohibits substituting the specification identity or version for any other identity here.

### 6.10 Planned runs and execution attempts

**WP2-ID-006.** A planned-run identity **MUST** exist and be recorded before, and independently of, any physical execution of that planned run.

**WP2-ID-007.** A conforming laboratory **MUST** represent one planned run as the parent of zero or more execution attempts, so that a planned run has zero execution attempts if and only if no execution-attempt identity was ever admitted for it, and a planned run cancelled or rejected before any attempt admission remains a recorded planned run carrying a complete identity, zero execution attempts, and no authoritative accepted outcome.

**WP2-ID-008.** Every execution attempt **MUST** name exactly one planned-run parent in its own identity record.

**WP2-ID-009.** A planned run **MUST NOT** acquire more than one authoritative accepted outcome.

**Rationale.** WP2-ID-009 bounds the count without presuming that the count is ever reached. Section 3.1 defines the authoritative commit as the point, if reached, at which exactly one execution attempt's result becomes the authoritative recorded outcome of its planned run, and it records that the point is not reached at all where a planned run has no execution attempt or where no attempt's result is accepted. A planned run with zero authoritative accepted outcomes therefore conforms. How an authoritative commit is reached, and how competing claimants are arbitrated, is assigned to Section 9.

### 6.11 Replacement lineage

**WP2-ID-010.** A registered replacement **MUST** be recorded as an additional execution attempt of the same planned run, and therefore of the same independent run, rather than as a new planned run, a new independent run, a new study, or a modification of the execution attempt it replaces.

**WP2-ID-011.** The lineage record of a registered replacement **MUST** name explicitly the specific execution attempt that it replaces.

**WP2-ID-012.** A conforming laboratory **MUST NOT** establish which execution attempt a registered replacement replaces from an identifier suffix, a record or execution ordering, a storage path, a timestamp, or physical proximity alone.

**Rationale.** WP2-ID-012 does not prohibit an identifier from carrying a suffix, a record set from being ordered, or a timestamp from being recorded; it prohibits treating any of those, by itself, as the statement of which attempt was replaced. WP2-ID-011 requires that statement to be made. Charter Section 14.4 requires replacement rules to be preregistered and prohibits a replacement from erasing the original attempt, and Section 3.1 records that a registered replacement never erases, renumbers, overwrites, or conceals the original attempt or its evidence. WP2-SCOPE-006 separately prohibits recording a replacement interchangeably with a process restart, a resume, or a transport or delivery retry.

### 6.12 Laboratory-worker, lease, and dispatch-wave distinctions

**WP2-ID-013.** Where a conforming laboratory assigns laboratory-worker, lease, or dispatch-wave identities, each of them **MUST** be recorded as an identity distinct from planned-run identity and from execution-attempt identity.

**WP2-ID-014.** A laboratory-worker identity, a lease identity, or a dispatch-wave identity **MUST NOT** be recorded, reported, or joined as though it were the identity of a planned run or of an execution attempt.

**WP2-ID-015.** Assigning, reassigning, or changing the laboratory worker, the lease, the dispatch wave, or the execution host of an execution attempt **MUST NOT** by itself change the identity of that attempt's planned run or the registered treatment that planned run carries.

**Rationale.** WP2-ID-015 governs what an assignment does by itself. It does not deny that execution architecture can matter scientifically: charter Section 10.3 treats a deliberately varied concurrency profile as a registered experimental parameter rather than hidden infrastructure, and charter Section 14.2 requires an execution-architecture or concurrency-profile change within one registered study to have been declared as a condition of the preregistered design. Where that is so, the difference is carried by the registered treatment and the recorded concurrency profile rather than arising as an unrecorded consequence of assignment. The contents of that profile are assigned to Section 10.

### 6.13 Model-request attribution

**WP2-ID-016.** Every model request **MUST** be attributable, through explicitly recorded lineage, to the study, the planned run, the execution attempt, and the deciding episode or decision that it serves.

**Rationale.** This requirement fixes what a model request has to be attributable to. It does not fix which record carries each identity, and it does not require that any of them be a field on the request itself. WP2-SCOPE-009 separately requires decision authority, serving provider identity, and route identity to remain three separately identified properties wherever each is recorded. Record placement, join keys, provider-behavior records, and budget attribution mechanics are assigned to Section 12; WP2-ISO-015 states only the isolation property that request and response records have to satisfy.

### 6.14 Evidence-root, sealed-package, and aggregation identity

**WP2-ID-017.** Every run evidence root **MUST** belong to exactly one execution attempt.

**WP2-ID-018.** A conforming laboratory **MUST NOT** treat a filesystem path, an object-store key, or any other storage location as the sole identity of a run evidence root or of a study evidence root.

**WP2-ID-019.** A study evidence root **MUST** be an identity-bearing logical namespace or registered set capable of containing or referencing all evidence belonging to its study.

**WP2-ID-020.** Every sealed package **MUST** identify the evidence boundary it seals and the inventory it authenticates.

**WP2-ID-021.** Every study aggregation **MUST** identify the study, the analysis version, and the exact set of source evidence from which it derives.

**Rationale.** WP2-ID-018 makes a storage location an attribute of an evidence root rather than its identity, which is what allows a root to be moved, replicated, or referenced from more than one record without becoming a different root and without two roots at different locations being assumed distinct on that basis alone. WP2-ID-020 gives WP2-SCOPE-008's reporting obligation its identity counterpart: the requirement that per-execution sealing, whole-evidence-root sealing, any study-level sealing boundary, and study aggregation be distinct operations is only auditable if each seal names the boundary it authenticates. Evidence formats, inventory contents, sealing procedure, and verification are assigned to Section 13, and what makes a study aggregation complete is assigned to Section 15.

### 6.15 Identifier scoping and explicitly recorded lineage

**WP2-ID-022.** A locally scoped identifier **MUST** form part of a recorded identity only where the complete persisted namespace in which that identity is recorded makes it unambiguous across every study and every execution attempt that may run concurrently.

**WP2-ID-023.** Every lineage relationship this section requires **MUST** be recorded explicitly at the time it is established, so that it can be read from the record rather than reconstructed from wall-clock ordering, storage paths, identifier names, or directory layout.

**Rationale.** WP2-ID-022 permits a locally scoped identifier and states the condition on its use: what has to be unambiguous is the complete recorded identity, not the local fragment considered alone. A locally scoped identifier qualified by the lineage WP2-ID-002 requires can satisfy it; the same fragment recorded without that qualification cannot. WP2-ID-023 is what makes WP2-ID-011, WP2-ID-016, and WP2-ID-021 auditable, because a lineage that has to be inferred cannot be checked against the record that was supposed to state it.

### 6.16 Reuse, supersession, correction, and register conformance

**WP2-ID-024.** Cancellation, failure, exclusion, supersession, or completion of an identity-bearing entity instance governed by the register in Sections 6.3 through 6.8 **MUST NOT** free that instance's identity for reuse.

**WP2-ID-025.** Correction of a material identity error **MUST** be recorded as a new identity, or as a new version, that explicitly names the identity or version it supersedes.

**WP2-ID-026.** A conforming laboratory **MUST NOT** correct a material identity error by changing the meaning of an already-recorded identity or version in place.

**Rationale.** These three requirements keep the record readable backwards. Charter Section 14.4 requires failed, interrupted, invalid, excluded, and replacement attempts to remain recorded evidence with typed dispositions, and charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed; an identity that could be freed and reissued, or silently redefined, would defeat both. What counts as a material error, and the disposition vocabulary that records one, are assigned to Section 14.

**WP2-ID-027.** Every identity record for an entity of the register in Sections 6.3 through 6.8 that a conforming laboratory creates, admits, references, or relies upon **MUST** conform, whichever governing role established the identity, to every clause of the applicable register entry's stated identity scope, issuing or governing authority, required parent or source references, cardinality, version requirement, point at which the identity begins to exist, rule on existence without physical execution, and reuse and supersession rule, except only the specific question or clause that the entry expressly assigns to a later section, an exemption that reaches no other clause of that attribute or entry.

**Rationale.** The register entries of Sections 6.3 through 6.8 supply normative entity-model definitions, and WP2-ID-027 is the single requirement that incorporates them and makes every non-deferred register clause binding. Several of those entries register identities that a governing role outside the execution laboratory establishes — the specification identity and its established version, the experiment, the analysis, the world or scenario, the condition, and the treatment among them — and the requirement reaches such an identity once the laboratory admits it, references it, or relies upon it, so that the entry's issuing authority, required references, cardinality, existence rules, and entity-specific reuse and supersession rules bind that record as they bind a record of an identity the laboratory itself creates. The deferral exemption is clause-specific: where a cell states binding clauses alongside one question it expressly assigns to a later section, only that question is exempt, and every other clause of that attribute and of the entry remains binding. The individual table cells therefore carry no separate requirement identifier of their own, and no second obligation is created in any cell; a cell that expressly assigns a question to a later section states a boundary rather than an answer, consistent with Section 4.3's rule that a required invariant is created only where an assigned chunk states it. WP2-ID-001 through WP2-ID-004 continue to state the identity, uniqueness, and version properties in their own terms, and WP2-ID-002 remains what makes each entry's required references testable record by record. What WP2-ID-027 adds is that a later implementation can no longer diverge from a register decision — an issuing authority, a cardinality, an identity-existence rule, or an entity-specific reuse or supersession rule among them — without violating a mapped requirement.

### 6.17 Options deliberately left unselected

**Unselected option.** Identifier form. An identity this section requires may be carried by a randomly generated value, a content-derived digest, a hierarchical composite of its parent identities, an authority-issued sequence, or another form entirely. This specification selects none of them and states only the properties any selection has to satisfy, in WP2-ID-001, WP2-ID-003, and WP2-ID-022.

**Unselected option.** Issuance and reservation mechanism. The role that issues an identity may be discharged by a declaration in source, a registration file, a service, a database, a filesystem or object-store transaction, or another mechanism. The register names the authority as a role; WP2-SCOPE-015 prohibits selecting the mechanism, and Section 7.20 records the related storage and transaction options.

**Unselected option.** Lineage record placement. A required lineage reference may be recorded inline on the child record, in a separate lineage record, in an index, or in more than one of those. WP2-ID-023 requires only that it be explicit and readable from the record, and Section 12 rather than this section decides where model-request lineage is written.

**Unselected option.** Namespace disambiguation strategy. Uniqueness within a stated identity scope may be achieved by a globally unique value, by composition from parent identities, by an authority-enforced reservation, or by another strategy. WP2-ID-003 and WP2-ID-022 state the property; no strategy is preferred here.

### 6.18 Boundaries assigned to later chunks

This section defines what exists, what it references, and what may never be conflated with what. It deliberately defines none of the following, each of which the staged instructions assign elsewhere: the lifecycle states and transitions of a planned run, an execution attempt, or a laboratory worker, which belong to Section 8; scheduling policy, dispatch policy, lease acquisition, duration, renewal, expiry, and the mechanics by which an authoritative commit is reached, which belong to Section 9; the contents, fields, and comparison rules of a concurrency profile, which belong to Section 10; the separation of logical simulation time, provider wall-clock time, and local queue time beyond the isolation boundary Section 7 states, which belongs to Section 11; the placement of model-request records, the joins among them, and budget accounting algorithms, which belong to Section 12; evidence formats, inventory contents, packaging, and sealing procedure, which belong to Section 13; the failure and disposition taxonomy, which belongs to Section 14; the rules that make a study aggregation complete, which belong to Section 15; and the conformance checks for every requirement stated here, which belong to Section 17 and to the conformance document.

## 7. Isolation invariants

### 7.1 The three isolation levels

Isolation is required at three levels, and this section states each requirement against the levels it binds.

| Level | What it separates |
| --- | --- |
| Level 1 — study isolation | Two independent studies, whether or not they share infrastructure. |
| Level 2 — independent-run isolation | Two independent runs, including two independent runs belonging to one study. |
| Level 3 — execution-attempt isolation | Two execution attempts of one planned run. |

A requirement stated to hold at all three isolation levels holds separately and independently at each of them, and is not satisfied by holding at one or two of them. A requirement that binds only some of the three names the levels it binds.

*Isolation unit* is used in this section as a collective shorthand for whichever of a study, an independent run, and an execution attempt the applicable isolation level distinguishes. It introduces no entity beyond the three that Section 3.1 defines and Section 6 registers, and it is a reading convenience rather than a defined term of Section 3.1.

Section 3.2 already states two separate obligations. WP2-SCOPE-001 requires the concurrent execution of independent runs, each retaining its own identity, registered configuration, mutable state, stochastic-event state, budgets, timing records, and replay lineage together with the failure history and separate run evidence root of every one of its own execution attempts. WP2-SCOPE-002 requires the concurrent execution of independent studies on shared infrastructure, each retaining its own study identity, registered configuration, mutable state, budget scope, treatment, storage namespace, and evidence lineage. WP2-SCOPE-003 prohibits the identity, registered configuration, mutable state, budget scope, treatment, storage namespace, or evidence lineage of two studies, or of two independent runs, from being merged as a consequence of their sharing infrastructure. This section states the invariants that make those separations checkable boundary by boundary. Every substantive statement here is a Required future invariant carrying exactly one `WP2-ISO-###` identifier, a Design rationale, or an Unselected option, in the Section 4.3 sense.

### 7.2 General isolation requirements

**WP2-ISO-001.** Sharing a host, a process, a process pool, a network path, a storage service, a credential boundary, or any other physical or logical infrastructure among isolation units **MUST NOT** merge their identities, their registered treatments, their mutable state, their evidence, or their budget attribution, at any of the three isolation levels.

**WP2-ISO-002.** Mutable records that carry, control, or are attributable to an isolation unit's identity, registered treatment, mutable state, model requests, budget accounting, operations, or evidence, and that are held in a service shared by more than one isolation unit, **MUST** be authoritatively partitioned by the study, planned-run, and execution-attempt lineage that applies to each record, so that every such record resolves to exactly one owning isolation unit.

**WP2-ISO-003.** An independent run or an execution attempt **MUST NOT** read, overwrite, finalize, cancel, clean up, or adopt the mutable state of another independent run or of another execution attempt.

**WP2-ISO-004.** An independent run or an execution attempt **MUST NOT** read, overwrite, finalize, seal, cancel, clean up, adopt, or record as its own the evidence of another independent run or of another execution attempt; reading an asset shared under WP2-ISO-008, and the identity and provenance verification WP2-ISO-026 and WP2-ISO-029 require before an existing location is acted on, are not reads this requirement prohibits.

**WP2-ISO-005.** Two execution attempts of one planned run **MUST NOT** continue one another in place.

**Rationale.** WP2-ISO-003 and WP2-ISO-004 bind an executing isolation unit acting on its own behalf, and both of them prohibit reading, so that neither an independent run nor an execution attempt can condition what it does on a sibling's mutable state or on evidence a sibling produced. A separately identified operation that is not one of the units whose evidence it reads — a study aggregation under WP2-ID-021, a study-level seal under WP2-SCOPE-008, or a verification pass over completed evidence — lies outside WP2-ISO-004, which binds only an independent run or an execution attempt. Section 6.7 registers the sealed package under the laboratory authority that performs the sealing operation and the study aggregation under the analysis authority governed by charter Sections 14.2 and 14.7, so each of those is an operation acting under its own identity and lineage rather than a unit acting on its own behalf; WP2-ISO-022 bounds what it may attest, and what it may write and when it may declare a result are assigned to Sections 13 and 15. WP2-ISO-005 is the isolation counterpart of Section 3.1's definitions: a resume re-enters an identity-matched unit of work without continuing an interrupted execution attempt in place and without erasing what that attempt produced, and a process restart is not itself a resume, a retry, a new execution attempt, or a replacement. Lifecycle states and transitions are assigned to Section 8.

**Rationale.** WP2-ISO-002 governs the unit-scoped records of a shared service — those that carry, control, or are attributable to an isolation unit's identity, registered treatment, mutable state, model requests, budget accounting, operations, or evidence — and requires each of them to resolve to exactly one owning isolation unit. It does not require a genuinely infrastructure-global mutable record to be assigned artificially to one isolation unit. Laboratory-worker state and dispatch-wave state belong to entities that Section 6.5 registers without study-lineage parents, and Section 7.11 already keeps a diagnostic attributable to such an entity without inventing an isolation unit for it; scheduler health, provider-wide operational state, and records of that kind likewise belong to no study, no planned run, and no execution attempt. What such a record may never do is carry hidden unit-owned mutable state, merge the evidence lineage of two isolation units, or act as an implicit cross-unit identity join: a record that does any of those carries, controls, or is attributable to what this requirement scopes, so this requirement reaches it, and WP2-ISO-001 separately prohibits shared infrastructure from merging identities, registered treatments, mutable state, evidence, or budget attribution. The provenance of shared infrastructure and of contention is assigned to Section 10.

### 7.3 Mutable in-memory state

**WP2-ISO-006.** Mutable in-memory state that carries an isolation unit's identity, registered configuration, registered treatment, simulated-world state, stochastic-event state, budget accounting, request records, or evidence **MUST NOT** be shared between isolation units, or carried over from one isolation unit to another, at any of the three isolation levels.

**Rationale.** What this prohibits is the state carried across a boundary, not the reuse of the thing that carried it. A process, a container, a thread, a connection pool, or a loaded code module that holds none of the listed state is outside the requirement, and reusing one is neither required nor prohibited here. Shared immutable assets are governed separately by WP2-ISO-008.

### 7.4 Filesystem and object namespace

**WP2-ISO-007.** Every isolation unit **MUST** write its mutable state and its evidence into a storage namespace bound to its own recorded identity and disjoint from the namespace into which any other isolation unit at the same isolation level writes; a record the unit contributes to a service shared with other isolation units is governed by WP2-ISO-002 instead.

**Rationale.** The requirement compares units at the same isolation level, so containment across levels — a study evidence root that contains or references the run evidence roots of the execution attempts belonging to that study — is not prohibited by it. The closing clause keeps it from prohibiting a shared registry, index, or state service whose unit-scoped records WP2-ISO-002 already partitions by lineage; what it governs is the namespace a unit writes into as its own. It selects no storage class, directory layout, key format, nesting rule, or naming convention; Section 7.20 records those as unselected, and WP2-ID-018 keeps the resulting location from becoming the root's identity.

### 7.5 Shared immutable assets

**WP2-ISO-008.** An asset that contributes to an isolation unit's registered treatment, its registered configuration, its simulated-world state, its stochastic inputs, or its evidence **MUST** be shared between isolation units only where it is content-addressed or otherwise version-pinned, remains read-only for the whole duration of its use by every sharing isolation unit, and is recorded in each sharing unit's evidence by its exact identity or content digest.

**Rationale.** The staged instructions permit a shared immutable asset only where it is content-addressed or otherwise version-pinned and where the sharing cannot merge mutable state or evidence lineage. WP2-ISO-008 states those conditions and adds two that make the sharing checkable afterwards: the asset stays read-only for the whole duration of every sharing unit's use of it, so that no sharing unit can change what another one read; and each sharing unit's evidence names the exact identity or digest it read, so that what was read can be reconstructed and compared rather than assumed. Sharing under this requirement licenses no merging of mutable state or evidence lineage, which WP2-ISO-001, WP2-ISO-004, and WP2-ISO-006 continue to prohibit.

### 7.6 Configuration and environment

**WP2-ISO-009.** Every configuration value that contributes to an isolation unit's registered treatment **MUST** be resolved from that unit's own registered configuration and recorded with that unit's evidence.

**WP2-ISO-010.** A process-wide, host-wide, session-wide, or otherwise ambient configuration or environment value **MUST NOT** determine a treatment-bearing property of an isolation unit unless that value is recorded against the unit for which it took effect.

**Rationale.** Together these keep an ambient default from becoming an unrecorded part of what a study tested. They do not prohibit ambient configuration as such — an operational value that carries no treatment-bearing property is outside them — and they select no configuration mechanism, file format, or precedence rule. Charter Section 14.2 governs when a change to a treatment-bearing value requires a new registered treatment, condition, or experiment version.

### 7.7 Random and stochastic-event state

**WP2-ISO-011.** Mutable random-generator state, and any other mutable stochastic-event state, **MUST NOT** be shared between, inherited by, or carried over into isolation units at any of the three isolation levels.

**WP2-ISO-012.** Where a registered design deliberately pairs stochastic inputs across isolation units, including a common-random-number design, the immutable stochastic-input identity scheme, the registered derivation rule, the master inputs or other immutable sources needed to reproduce the pairing, and the rule for branch-conditional events or missing counterparts **MUST** be fixed by that registered design before execution, and every realized paired input explicitly identified in the evidence of every isolation unit that consumes it and recorded with event-level lineage sufficient to establish which stochastic events correspond across those units or that a counterpart is absent.

**Rationale.** WP2-ISO-011 prohibits accidental sharing of mutable generator state. It does not prohibit a deliberate paired-randomness or common-random-number design, which WP2-ISO-012 permits on the conditions it states, because such a design supplies registered immutable inputs and a registered immutable rule rather than a shared mutable generator. Two ways of satisfying WP2-ISO-012 are equally permitted: preregistering each individual paired input directly, and deriving individual event values deterministically at execution time under an identity scheme and a derivation rule that were themselves registered and immutable before execution. Hidden shared mutable generator state remains prohibited in either case, because WP2-ISO-011 continues to reach it. In either case the registered identity scheme, the registered derivation rule, the immutable sources, and the recorded event-level lineage are together what let a pairing be reconstructed and checked after execution rather than assumed. Charter Section 11.3 requires a future design to define which stochastic events correspond across branches, how corresponding events receive stable noise identities, how branch-conditional events are represented where no counterpart exists, and how paired replication proceeds; charter Section 14.6 states that a shared seed alone does not establish stochastic correspondence, and charter Section 11.3 names event-keyed hashing as one possible technique rather than a selected one. This section selects none, and it does not decide which events correspond, which charter Section 11.3 records as a substantive modeling commitment belonging to a registered design.

### 7.8 Event streams and logical clocks

**WP2-ISO-013.** The logical clock and the authoritative event stream of one independent simulated world **MUST** remain isolated from the logical clock and the authoritative event stream of every other independent simulated world.

**WP2-ISO-014.** Wall-clock order **MUST NOT** be used as an implicit causal relation, ordering guarantee, or identity join between isolation units.

**Rationale.** WP2-ISO-014 prohibits an implicit use, not the recording of wall-clock time: charter Section 10.5 requires future evidence to distinguish logical simulation time, provider wall-clock time, and local queue time, and charter Section 14.5 requires the three to remain distinct, all of which presupposes that wall-clock time is recorded. What is prohibited is treating temporal adjacency as though it established a causal relation or an identity correspondence that WP2-ID-023 requires to be recorded explicitly. WP2-ISO-013 is likewise consistent with a registered causal fork: charter Section 11.2 requires each descendant branch to evolve with separate branch state and evidence after the fork while preserving its own replay lineage back to the common ancestor, and that ancestor is a serialized recorded state from which each branch's own logical clock and event stream proceed rather than a live stream shared between branches. The time-domain rules beyond this isolation boundary are assigned to Section 11.

### 7.9 Model-request and response records

**WP2-ISO-015.** Idempotency state, request and response records, and budget state held by any component that serves model requests for more than one isolation unit **MUST** be keyed so that two model requests originating in different execution attempts remain distinct records even where the locally scoped request identifiers they carry are equal.

**Rationale.** Section 5.3 records that the repository's current engine-owned decision-request identifier restarts its counter for each model-backed browser run, so the same identifier recurs across model-backed browser runs and identifies a request only in combination with the `runId` of the model-backed browser run it belongs to. This requirement closes that case for the future contract: equality of a locally scoped request identifier is never by itself sufficient to make two records the same record, to answer one unit's request from another unit's recorded result, or to charge one unit's call to another unit's budget. It does not prohibit a locally scoped request identifier, which WP2-ID-022 permits under its stated condition, and it does not require any particular component: a laboratory that serves model requests separately for every execution attempt satisfies it as readily as one that serves many. Where these records live, which idempotency rule applies to a genuine repeat of one request, and how budgets are reserved and refused are assigned to Section 12.

### 7.10 Token, cost, call, and failure budgets

**WP2-ISO-016.** Token, cost, call, and failure accounting **MUST** be attributed to the study, the planned run, and the execution attempt that incurred it, and kept distinguishable from the accounting of every other isolation unit at each of the three isolation levels.

**Rationale.** This requirement governs attribution, not ceilings. A shared or hierarchical budget ceiling — a study-level live-call budget spanning many planned runs, for example — is not prohibited by it, provided every charge retains its own attribution. Budget algorithms, reservation, exhaustion behavior, and refusal typing are assigned to Section 12, and WP2-SCOPE-015 prohibits this specification from selecting any numeric operating parameter, including a quota, a budget, or a threshold.

### 7.11 Logs and diagnostics

**WP2-ISO-017.** Every log or diagnostic record a conforming laboratory retains **MUST** carry explicit attribution to each entity of the Section 6 register whose activity it describes, naming every isolation unit whose activity it describes and, where the entity whose activity it describes is not an isolation unit, naming that laboratory worker, lease, dispatch wave, or other registered entity.

**WP2-ISO-018.** A log or diagnostic record **MUST NOT** overwrite another isolation unit's record, be written into a shared stream without per-record attribution, or be admitted as evidence of an isolation unit other than one whose activity it describes.

**Rationale.** The attribution target is the entity the record describes rather than an isolation unit in every case, because Section 6.5 registers entities that exist and act without any isolation unit's activity to describe: a laboratory worker admitted into service before it carries out an execution attempt, a lease issued and then ended with no execution attempt launched under it, and a dispatch wave whose members are all cancelled before release. Naming the described entity keeps such diagnostics retainable and attributable without inventing an isolation unit for them, while WP2-ID-013 and WP2-ID-014 continue to require those identities to be recorded as distinct identities and prohibit reporting or joining any of them as though it were the identity of a planned run or of an execution attempt. A shared log stream is permitted where each record carries its own attribution, so these requirements select no destination, transport, format, or retention rule. Whether a diagnostic record is evidence at all, and what evidentiary weight it carries, is assigned to Section 13; Section 3.1's separation of decision authority from serving provider identity and route identity continues to apply wherever those are recorded, under WP2-SCOPE-009.

### 7.12 Finalization and authoritative-commit state

**WP2-ISO-019.** A conforming laboratory **MUST** keep the finalization state of each execution attempt separate from the finalization state of every other execution attempt, including another execution attempt of the same planned run, and, where a planned run reaches an authoritative outcome, record that outcome on the planned run by identifying the one accepted execution attempt rather than by representing it as mutable finalization state shared among attempts.

**Rationale.** The single authoritative accepted outcome that WP2-ID-009 bounds is a property of the planned run, reached at most once and possibly never, which is why WP2-ISO-019 places the record of it on the planned run and asks of that record that it name the one execution attempt whose result was accepted rather than be represented as mutable finalization state shared among execution attempts. Keeping that record distinct from per-attempt finalization state is what leaves every attempt's own finalization state intact and separately readable, and it calls for no attempt-local flag asserting that the attempt became authoritative. Section 3.1 defines what finalization comprises for one attempt, the mechanics of reaching an authoritative commit are assigned to Section 9, and the evidence contract for finalization is assigned to Section 13.

### 7.13 Lease authority and superseded output

**WP2-ISO-020.** A laboratory worker whose lease over a unit of work has expired, been revoked, or been superseded **MUST NOT** mutate that unit's authoritative state or cause its own output to become that unit's authoritative outcome.

**WP2-ISO-021.** Evidence actually produced under an expired, revoked, or superseded lease **MUST** remain attributable to the laboratory worker, the lease, and the execution attempt that produced it, and preservable for later disposition.

**Rationale.** These two requirements bind a laboratory that uses leases; a laboratory that issues none satisfies them vacuously, and neither of them requires a lease mechanism to exist. Together they separate authority from evidence: losing a claim removes the power to make an outcome authoritative, and it does not license destroying, orphaning, or silently discarding what was already produced, which charter Section 14.4 requires to remain recorded evidence with a typed disposition and charter Section 14.9 requires not to be concealed. Lease acquisition, duration, renewal, expiry, and arbitration between competing claimants are assigned to Section 9, and the disposition vocabulary for superseded output is assigned to Section 14.

### 7.14 Evidence inventories and sealing

**WP2-ISO-022.** An evidence inventory or a seal **MUST NOT** include, claim, or attest evidence that lies outside the boundary which that inventory or seal itself identifies.

**Rationale.** This is the isolation counterpart of WP2-SCOPE-008 and WP2-ID-020: those require the sealing layers to be distinct operations and each seal to name its boundary, and this one prohibits a seal from reaching past the boundary it named. It states no sealing procedure, digest algorithm, inventory contents, or verification rule. Sections 6.14 and 7.21 assign inventory contents, sealing procedure, and verification to Section 13, and under Section 4.3 a required invariant is created only where the assigned chunk states it, so this section settles none of them. WP2-SCOPE-015 separately prohibits this specification from selecting a serialization or archive technology, so none is selected here or in Section 13.

### 7.15 Cancellation and cleanup

**WP2-ISO-023.** A cancellation or cleanup operation **MUST** act only within the namespace, the mutable state, and the in-flight work of the isolation unit that owns it and of the isolation units that unit's explicitly recorded lineage places below it, and not within those of any other isolation unit — a sibling study, a sibling independent run, or an execution attempt of a different planned run among them.

**WP2-ISO-024.** A cancellation or cleanup operation **MUST NOT** delete, truncate, overwrite, or render unverifiable the evidence of a sibling isolation unit, of an earlier execution attempt, or of any unit that has already reached a terminal state.

**Rationale.** Charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed, and charter Section 14.4 requires failed, interrupted, invalid, excluded, and replacement attempts to remain recorded evidence; a cleanup that reached beyond its owner would defeat both silently. A cancellation issued at study level acts on that study and on the planned runs and execution attempts that its explicitly recorded lineage places below it, which WP2-ID-002 and WP2-ID-023 require to be readable from the record rather than reconstructed; what WP2-ISO-023 prohibits is reaching into a unit that lineage does not place below the cancelling unit, such as a sibling study, a sibling independent run, or an execution attempt of a different planned run. WP2-ISO-024 continues to bind the operation inside its own lineage, so reaching an earlier execution attempt or a unit already in a terminal state never licenses destroying what that unit produced. The cancellation lifecycle, its typed dispositions, and the containment of sibling units after a failure are assigned to Sections 8 and 14.

### 7.16 Secrets

**WP2-ISO-025.** Secret material made available to one isolation unit **MUST NOT** become available to another study, another independent run, another execution attempt, or another provider session as a consequence of a shared process, a shared credential store, a shared connection, or any other shared infrastructure.

**Rationale.** This states the isolation boundary for secrets and nothing else. Secret custody, injection, rotation, redaction, scanning of evidence, and the security boundary in general are assigned to Section 16, and Section 7.20 records the custody mechanisms left unselected.

### 7.17 Identity, namespace, and output-root collisions

**WP2-ISO-026.** A location that a conforming laboratory did not itself create or reserve under the exact evidence-root identity it expects, and whose provenance it has not verified, **MUST** be treated as an existing-root collision, whether that location is empty or non-empty.

**WP2-ISO-027.** A conforming laboratory **MUST NOT** adopt as the evidence root of any isolation unit, or write evidence into, a location that WP2-ISO-026 makes an existing-root collision.

**WP2-ISO-028.** A location created by the same authenticated creation or reservation transaction that bound it to the evidence-root identity a conforming laboratory expects **MUST NOT** be treated as an existing-root collision under WP2-ISO-026.

**WP2-ISO-029.** A resume or a recovery operation **MUST** verify the exact identity and the provenance of an existing location before acting on that location or on the evidence it holds.

**Rationale.** These four requirements answer the narrow scope question that Section 5.14 item 3 leaves to this chunk — whether a pre-existing empty directory counts as an existing output root for the safe-failure requirement. It does. Emptiness describes a location's current contents and is not evidence of its provenance: an empty location may have been created by another study, by an interrupted unit that had not yet written anything, by an unrelated process, or by an operator, and adopting it silently would bind an evidence root to a namespace whose ownership is unknown, which WP2-ISO-007 prohibits and which WP2-ID-018 prevents the location itself from settling. WP2-ISO-028 keeps the rule from refusing the ordinary case, in which the laboratory created the location itself under the identity it expects and has an authenticated record of doing so; WP2-ISO-029 keeps resume and recovery available on the same terms, by verification rather than by assumption. Section 5.14 is not revised by this chunk, and this rationale records where its item 3 is answered. Charter Section 14.9 requires evidence collision and adoption to be treated as explicit failures rather than concealed. What counts as an authenticated creation or reservation transaction is a mechanism this specification does not select; Section 7.20 records that.

### 7.18 Safe, typed, evidence-preserving refusal

**WP2-ISO-030.** A conforming laboratory **MUST** refuse the operation rather than proceed on each of the following seven conditions, taken separately: a duplicate identity within the identity scope the Section 6 register states for that entity; a namespace collision; an attempt to adopt a location that WP2-ISO-026 makes an existing-root collision; a conflict over the ownership of an evidence root; an attempted exercise of authority under an expired, revoked, or superseded lease; an attribution of a record to a study, an independent run, or an execution attempt other than the one whose lineage that record carries; and any operation that cannot demonstrate its own owning lineage before it mutates state or evidence.

**WP2-ISO-031.** Every refusal that WP2-ISO-030 requires **MUST** be recorded as a distinguishable refusal that identifies each of the seven conditions the refused operation met and records such owning lineage as that operation demonstrated, stating that none was demonstrated where the operation demonstrated none rather than asserting or reconstructing one.

**WP2-ISO-032.** A refusal that WP2-ISO-030 requires **MUST NOT** delete, overwrite, truncate, or render unverifiable any evidence that existed before the refused operation or that the refused operation had already produced.

**Rationale.** *Typed* here means distinguishable and recorded: the refusal can be told apart from a refusal of a different condition and from an untyped error, and it names every condition it met, because one operation can meet more than one — an attempt to adopt a location that WP2-ISO-026 makes an existing-root collision and that another study also claims as its own evidence root meets both the third and the fourth condition of WP2-ISO-030. A refusal under the seventh condition is by definition the refusal of an operation whose owning lineage was not demonstrated, so what WP2-ISO-031 requires of that record is that the absence be stated, not that an undemonstrated lineage be supplied; WP2-ID-023 requires the lineage relationships Section 6 states to be read from the record rather than reconstructed from ordering, storage paths, identifier names, or layout. This section defines no failure-class taxonomy, no disposition vocabulary, no retry or replacement rule, and no error-code set; the failure and disposition model is assigned to Section 14, and how a refusal is exercised in a conformance check is assigned to Section 17 and the conformance document. Whether the refused unit may later be replaced remains governed by the study's preregistered replacement policy, in the sense Section 3.1 gives *registered replacement*.

### 7.19 Throughput and resource sharing

**WP2-ISO-033.** Sharing a host, a process, a pool, a connection, a credential boundary, a storage service, or any other resource among isolation units, and any measure taken to increase execution throughput, **MUST NOT** be used to relax, suspend, defer, or make conditional any requirement of this section.

**Rationale.** WP2-SCOPE-013 already prohibits trading isolation, request and outcome attribution, preservation of failed or interrupted attempts, logical-time integrity, replay verification, or evidence completeness for execution throughput. WP2-ISO-033 applies that prohibition to the requirements of this section specifically, so that a conformance check can be written against a laboratory that satisfies each isolation requirement in a low-contention configuration and relaxes it under load. Charter Section 8.5 records that throughput does not establish scientific validity and that parallel execution is not presumed behaviorally neutral, and Section 2.3 records that infrastructure conformance would establish neither.

### 7.20 Options deliberately left unselected

**Unselected option.** Namespace realization. The namespace WP2-ISO-007 requires may be realized as a directory tree, an object-store prefix, a database schema, a tenant, or another arrangement. The property required of any of them is stated in WP2-ISO-007 and WP2-ID-018; no storage class, layout, key format, or naming convention is selected.

**Unselected option.** Partitioning mechanism in a shared mutable service. The authoritative partitioning WP2-ISO-002 requires may be realized by separate stores, per-unit keys, row-level ownership, tenancy, or another mechanism. No database, object store, or storage service is selected.

**Unselected option.** Creation or reservation transaction. The authenticated creation or reservation transaction WP2-ISO-028 refers to may be realized by an exclusive-create filesystem operation, a conditional object-store write, a database insertion, an authority-issued reservation, or another mechanism. The property required is that the transaction bind the location to the expected evidence-root identity in a way the laboratory can later authenticate.

**Unselected option.** Claim mechanism. Where a laboratory claims units of work at all, the claim may be realized by a lock, a lease, a fencing token, an ownership record, or another mechanism. The property required by this section is stated in WP2-ISO-020 and WP2-ISO-021; lease algorithms, durations, and renewal are assigned to Section 9, and WP2-SCOPE-015 prohibits this specification from selecting a lease duration or any other numeric operating parameter.

**Unselected option.** Stochastic-input identity scheme. The event-level lineage WP2-ISO-012 requires may be realized by event-keyed hashing, by registered per-event noise tables, or by another scheme. Charter Section 11.3 names event-keyed hashing as one possible technique rather than a selected one, and this section selects none.

**Unselected option.** Log destination and transport. The attribution WP2-ISO-017 and WP2-ISO-018 require may be carried in a per-unit stream, a shared stream with per-record attribution, a structured record store, or another arrangement. No destination, transport, format, or retention rule is selected.

**Unselected option.** Secret custody. The boundary WP2-ISO-025 requires may be realized by per-unit credential issuance, an external secret manager, process-scoped injection, or another mechanism. No provider, manager, or deployment topology is selected, and the wider security boundary is assigned to Section 16.

### 7.21 Boundaries assigned to later chunks

This section states isolation boundaries and the refusals that protect them. It deliberately defines none of the following: lifecycle states and transitions, including the cancellation lifecycle, which belong to Section 8; queueing, dispatch, and lease algorithms and authoritative-commit mechanics, which belong to Section 9; concurrency-profile contents, which belong to Section 10; the time-domain rules beyond the boundary WP2-ISO-013 and WP2-ISO-014 state, which belong to Section 11; model-request record placement and budget algorithms, which belong to Section 12; evidence formats, inventory contents, packaging, sealing procedure, and verification, which belong to Section 13; the failure and disposition taxonomy behind the typed refusals WP2-ISO-031 requires, which belongs to Section 14; study-aggregation completion, which belongs to Section 15; secret handling beyond the isolation boundary WP2-ISO-025 states, which belongs to Section 16; and the conformance checks, fault injections, and pass conditions for every requirement stated here, which belong to Section 17 and to the conformance document.

## 8. Run and attempt lifecycle

### 8.1 What this section establishes

This section defines two connected lifecycle models — one for the planned run and one for the execution attempt — together with the transition, authority, provenance, restart, resume, replacement, and cancellation requirements that keep those models auditable while many independent runs and many independent studies execute at the same time. The two models are connected but separate. A planned run and an execution attempt are distinct entities in the Section 6 register, they reach their states for different reasons and under different authorities, and neither this section nor a conforming laboratory represents them as one state machine or as one enumeration. This section is implementation-neutral: it names states, dispositions, transitions, authorities, and recorded facts, and it selects no state store, encoding, transition mechanism, scheduler, recovery procedure, or numeric operating parameter.

Section 8.2 states how the two lifecycle models are read and carries the requirement that makes them binding. Section 8.3 establishes the lifecycle vocabulary this specification makes controlling for Sections 8 through 21. Section 8.4 separates the five scalar status dimensions and the lineage-relation collection. Sections 8.5 and 8.6 hold the planned-run and execution-attempt models. Sections 8.7 through 8.14 hold the remaining requirements. Section 8.15 records options deliberately left unselected, and Section 8.16 records what is assigned to later chunks.

Every substantive statement here is a Required future invariant carrying exactly one `WP2-LIFE-###` identifier, a Design rationale introduced by a **Rationale.** lead-in, or an Unselected option introduced by an **Unselected option.** lead-in, in the Section 4.3 sense, or else the vocabulary definitions of Section 8.3 and the status-dimension and collection table of Section 8.4, whose normative force flows through WP2-LIFE-002, WP2-LIFE-003, and WP2-LIFE-004 rather than through an identifier of their own, an entry of the two lifecycle models in Sections 8.5 and 8.6, whose normative force flows through WP2-LIFE-001 rather than through an identifier of its own, the lineage-relation collection block of Section 8.6, whose normative force flows through WP2-LIFE-032 rather than through an identifier of its own, or a boundary statement in Section 8.16. The model entries supply the normative lifecycle definitions that WP2-LIFE-001 incorporates and makes binding clause by clause, and the lineage-relation collection block supplies the relation-record definitions that WP2-LIFE-032 incorporates and makes binding in the same way, so their individual table cells carry no separate requirement identifier. Nothing in this section is a Current fact or a Current limitation; those belong to Section 5, and WP2-SCOPE-010 keeps a current mechanism from being read as a requirement. Every defined term used here carries the meaning Section 3.1 assigns it, as WP2-SCOPE-005 requires.

**Rationale.** Section 1.1 states, in the present tense and of the head at which it is read, that Sections 6 through 21 hold no substantive content; Section 4.2 states in the same form that the remaining eleven namespaces hold no assigned identifier at this head; and the rationale of Section 6.1 records that the identifiers assigned there leave nine of the reserved namespaces unassigned rather than eleven. None of the three is accurate at the head this chunk produces: Sections 8 through 11 now hold substantive content, identifiers are now assigned in the `WP2-LIFE-###`, `WP2-SCHED-###`, and `WP2-TIME-###` namespaces as well, and six of the reserved namespaces rather than nine remain unassigned. This chunk revises no part of Sections 1 through 7, so none of the three sentences can be corrected here; all three are recorded as inconsistencies this document now carries with itself, in the way Section 5.14 records a carried item and the rationale of Section 6.1 records its own, and all three are left to the final integration chunk that the staged instructions assign, whose required work includes removing incomplete-section language. The operative conclusions those passages draw are unaffected and hold on independent grounds: Sections 12 through 21 and the conformance document still hold no substantive content, and Section 1.4 records that no established specification version exists, so the contract remains incomplete and cannot be treated as a settled technical baseline.

### 8.2 How the two lifecycle models are read

Each entry of the two models states the same eight facts in the same order. The lineage-relation collection block of Section 8.6 is not an entry of either model; it states its own facts, and WP2-LIFE-032 rather than WP2-LIFE-001 makes them binding. The models supply normative lifecycle definitions, which WP2-LIFE-001 incorporates and makes binding clause by clause, except for the specific question an entry expressly assigns to a later section. Entry into a dimension's initial value is recorded in the same way, with no prior value and no prior transition record or current revision to name, and an entry's minimum-transition-provenance clause states what that initial recording names.

| Fact | What the entry states |
| --- | --- |
| Owning entity | The entity whose status the state or disposition is, and therefore the entity whose record carries it. |
| Entry condition | The condition whose occurrence entitles the recording authority to record entry into the state or disposition. |
| Permitted predecessor classes | The values within the same status dimension from which entry is permitted. |
| Permitted successor classes | The values within the same status dimension to which a later transition is permitted. |
| Terminal | Whether the model permits any successor within that status dimension. |
| Authority permitted to record the transition | The role entitled to record entry into the state or disposition. |
| Effect on the authoritative outcome | What entry into the state or disposition does, and does not, do to the authoritative-outcome state of the applicable planned run. |
| Minimum transition provenance | The facts the transition record has to name, in addition to whatever WP2-LIFE-013 requires of every transition. |

**WP2-LIFE-001.** Every planned run and every execution attempt that a conforming laboratory registers, admits, records, references, or relies upon **MUST** conform, in every status dimension the applicable model governs, to every clause of the applicable model entry in Sections 8.5 and 8.6 — its owning entity, entry condition, permitted predecessor classes, permitted successor classes, terminality, authority permitted to record the transition, effect on the authoritative outcome, and minimum transition provenance — except only the specific question or clause that the entry expressly assigns to a later section, an exemption that reaches no other clause of that fact or entry.

**Rationale.** An authority named in a model entry is a role — the party or process answerable for recording a transition — and never a component, service, scheduler, or store, exactly as Section 6.2 keeps every authority in the entity register a role. Naming a role selects no mechanism, and WP2-SCOPE-015 prohibits such a selection throughout this document. WP2-LIFE-001 is what makes each entry's clauses binding without giving any individual table cell a requirement identifier of its own; the requirements of Sections 8.7 through 8.14 state the obligations that hold across entries. A cell that assigns a question to a later section states a boundary rather than an answer, consistent with Section 4.3's rule that a required invariant is created only where an assigned chunk states it. The two models are stated separately because the entities are separate: a planned run's operational position, its authoritative-outcome state, and its study disposition are properties of a declared unit of intended evidence, whereas an execution attempt's operational position, finalization state, evidence validity, study disposition, and lineage relations are properties of one admitted physical execution, and Section 6.4 already registers the two as distinct identities with distinct authorities and cardinalities.

### 8.3 Controlling lifecycle vocabulary

The terms below carry exactly the meanings given here throughout Sections 8 through 21 and the reporting governed by this specification, wherever they name a lifecycle event or recorded value of a planned run or an execution attempt. They refine, and never displace, the Section 3.1 definitions: *process restart*, *resume*, *transport or delivery retry*, *registered replacement*, *finalization*, and *authoritative commit* keep the meanings Section 3.1 assigns them; *admission* keeps the meaning Section 3.1's execution-attempt entry and the Section 6.4 register entry state; and the terms below name the lifecycle events and roles those definitions presuppose. An occurrence of one of these words in Sections 1 through 7, or in a sense outside that lifecycle use — the release of a lease or of assignment authority, or the admission of a study, a registration, a replacement, or a laboratory worker into service among them — is ordinary description rather than a use of a term defined here, and the expressly declared pair Start and launch names one event with two spellings.

- **Admission** is the act by which the applicable laboratory authority creates an execution-attempt identity for one specific physical execution of one planned run, as Section 3.1 and the Section 6.4 register entry state. It is the first event of an execution attempt's lifecycle.
- **Release** is the act by which the scheduling authority records that an admitted execution attempt may begin execution activity, whether or not the laboratory groups releases into dispatch waves.
- **Start**, equivalently **launch**, is the first execution activity carried out under an execution attempt by its owning laboratory worker.
- **Execution activity** is work carried out under an execution attempt's identity that advances the simulated world of its planned run, consumes that attempt's registered budget, or produces evidence other than the attempt's own admission, assignment, and transition records.
- **Transition** is a recorded change of one entity's recorded value within one status dimension, from a prior value to a next value.
- **Current revision** is, for one entity and one status dimension, the accepted transition record of that entity within that dimension to which the boundary WP2-LIFE-034 requires has accepted no successor — or, where no transition has yet been accepted, the recorded initial value of that dimension — in each case read as the latest accepted correction record instead, where one or more correction records recorded under WP2-LIFE-017 supersede that record or one another; WP2-LIFE-034 governs how the next transition in that dimension proceeds from it.
- **Recording authority** is the role that the applicable model entry names as entitled to record a given transition.
- **Terminal** describes a value from which the applicable model permits no successor within its status dimension. Terminality bounds further transitions and nothing else: identity, transition history, disposition, and produced evidence all remain preserved.
- **Orchestrator restart** is a restart of the process or processes carrying out the laboratory's scheduling, admission, arbitration, and record-keeping roles, as distinct from a restart of an execution agent. It is a process restart in the Section 3.1 sense, named separately here because Section 8.10 states recovery obligations that attach to it specifically.

**WP2-LIFE-002.** The normative prose of Sections 8 through 21 and the reporting governed by this specification **MUST** use the terms defined in Section 8.3 and the state and disposition names of the models in Sections 8.5 and 8.6, wherever they name a lifecycle event or recorded value of a planned run or an execution attempt, with the meanings assigned there, each naming a distinct event or recorded value rather than a synonym for another.

**Rationale.** Sections 3 through 7 were drafted before these lifecycle events were named, and they use *launched*, *release*, and *start* in ordinary description. This section establishes the controlling meanings for Sections 8 through 21 without revising those earlier sections, whose reconciliation belongs to the final integration chunk the staged instructions assign. WP2-SCOPE-006 already prohibits recording a planned run, an execution attempt, a process restart, a resume, a transport or delivery retry, and a registered replacement as interchangeable events; WP2-LIFE-002 extends the same discipline to the finer lifecycle events those six presuppose, so that a later conformance check can tell an admission from a release, a release from a start, and a start from a finalization.

### 8.4 The five scalar status dimensions and the lineage-relation collection

Five scalar status dimensions and one append-only lineage-relation collection are kept separate throughout, and between them they preserve six conceptual separations: operational position, finalization, the authoritative outcome, evidence validity, study disposition, and replacement or supersession lineage. A laboratory records each scalar dimension for the entity it belongs to, and the recorded value of no one of them is supplied by reading another, even where an entry condition in Sections 8.5 and 8.6, or a coherence rule WP2-LIFE-033 states, makes two of them move on one triggering fact. The lineage separation is carried by a collection rather than by a sixth scalar dimension because one execution attempt may participate in several replacement relations and in one or more supersessions of its own output at the same time, and Section 8.3 defines a transition as a change from one prior value to one next value, which the accumulation of coexisting relation records is not; the collection belongs to the execution attempt, its contents are supplied by reading no scalar value, and no scalar value is supplied by reading it.

| Status dimension or collection | What it records | Whose status or record it is | Where its values or record types are stated |
| --- | --- | --- | --- |
| Operational lifecycle state | Where the entity stands in its own execution or scheduling progression. | The planned run, and separately the execution attempt. | Sections 8.5 and 8.6. |
| Attempt finalization state | Where the execution attempt stands in the finalization Section 3.1 defines for it — not started, in progress, or its typed terminal result. | The execution attempt. | Section 8.6. |
| Planned-run authoritative-outcome state | Whether the planned run has an authoritative accepted outcome and, if so, which execution attempt it names. | The planned run. | Section 8.5. |
| Artifact or evidence validity | Whether the evidence an execution attempt produced has been determined valid against the applicable evidence rules. | The execution attempt. | Section 8.6; the determination vocabulary and the evidence rules are assigned to Sections 13 and 14. |
| Study validity or exclusion | Whether the unit counts toward the study's registered result under the study's registered validity and exclusion rules. | The planned run, and separately the execution attempt. | Sections 8.5 and 8.6; the disposition vocabulary is assigned to Section 14 and the study-level consequences to Section 15. |
| Replacement or supersession lineage — an append-only relation collection rather than a scalar status dimension | The explicit replacement relations an execution attempt bears to other execution attempts of the same planned run, and the recorded supersession of its own output, held as zero or more separately identified relation records that may coexist. | The execution attempt. | Section 8.6, in the lineage-relation collection block — over the replacement-lineage entity Section 6.4 registers for a replacement relation record, and over the supersession relation record Section 8.6 establishes for a supersession of the attempt's own output. |

**WP2-LIFE-003.** A conforming laboratory **MUST** record each of the five scalar status dimensions of Section 8.4 as a separately recorded status of the entity to which that dimension belongs, and the lineage-relation collection of Section 8.4 as a separately recorded, append-only collection of relation records of the execution attempt.

**WP2-LIFE-004.** A conforming laboratory **MUST NOT** represent two or more of the five scalar status dimensions as one combined value, infer the recorded value of one of them from the recorded value of another, represent the lineage-relation collection or any relation record in it as a value of a scalar status dimension, or infer the contents of that collection from any scalar status value or any scalar status value from the contents of that collection.

**Rationale.** Collapsing these dimensions is what makes a concurrent laboratory unauditable: a single status word that means at once "the process ended", "the evidence validated", "this result is the authoritative one", and "this unit counts toward the study" cannot distinguish an attempt that finished cleanly but lost an acceptance race from one that was excluded by a registered rule, and it cannot represent a planned run that holds three terminal attempts and no authoritative outcome at all. Charter Section 14.4 requires operational failure, artifact invalidity, study invalidity, and behaviorally unfavorable outcomes to remain distinct, and Section 5.10 records that the repository already keeps a pipeline verdict and a scientific verdict as two separate recorded values. WP2-LIFE-004 prohibits inference between dimensions rather than the recording of a rule that relates them: a registered rule that decides a study disposition from an evidence-validity determination is permitted, and what it produces is a further recorded determination with its own provenance rather than a value read off another dimension. The lineage facts are an append-only collection for the same auditability reason: an attempt that participates in two replacement relations and one supersession of its output holds three simultaneous recorded relations, and forcing them through one scalar current value would either discard all but one of them or manufacture same-value transitions that Section 8.3's definition of a transition does not describe.

**Rationale.** The conceptual states the staged instructions name for this section are accounted for across the two models, their five scalar dimensions, and the lineage-relation collection rather than in one enumeration, as follows. *Registered* and *queued or eligible* are the planned-run operational values Registered and Schedulable, joined at the attempt level by Admitted and Released. *Leased or assigned* is not a separate operational value: it is the assignment and the assignment-authority grant that the Admitted entry's entry condition requires and that Section 9 governs, because a grant may be renewed, revoked, or superseded many times while an attempt stays in one operational value, and representing the two as one value would flatten facts that vary independently. *Starting*, *running*, and *finalizing* are the attempt operational values of the same names. *Completed* and *failed* are the attempt operational values Completed and Failed, each read together with the separate finalization value the attempt holds. *Cancelled* is the attempt operational value Cancelled and, at the planned run and at the study, the value Planned run cancelled and the study-scope cancellation WP2-LIFE-027 records. *Invalid or excluded* is not one value but two dimensions: the evidence-validity dimension records whether an attempt's evidence was determined valid, and the study-validity dimension records separately, at both planned-run and attempt scope, whether the unit counts toward the study's registered result. *Replaced or superseded* is the lineage-relation collection: a replacement relation record names an explicit relation between two attempts of one planned run rather than a status of either attempt in isolation, and a supersession relation record names the one attempt whose output was superseded together with what superseded it, where that is named.

### 8.5 The planned-run lifecycle model

The planned run carries three of the five scalar status dimensions. Its values are as follows.

| State or disposition | Status dimension | Terminal in its dimension |
| --- | --- | --- |
| **Registered** | Operational lifecycle | No |
| **Schedulable** | Operational lifecycle | No |
| **Attempted** | Operational lifecycle | No |
| **Planned run cancelled** | Operational lifecycle | Yes |
| **Closed to further attempts** | Operational lifecycle | Yes |
| **No authoritative outcome recorded** | Authoritative outcome | No |
| **Authoritatively accepted** | Authoritative outcome | Yes |
| **Planned-run study disposition undetermined** | Study validity or exclusion | No |
| **Planned-run study disposition recorded** | Study validity or exclusion | Yes |

**Registered.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The registration declaring the planned run is admitted, as the Section 6.3 study-plan and registration entry and the Section 6.4 planned-run entry state. |
| Permitted predecessor classes | None. This is the initial operational value of every planned run. |
| Permitted successor classes | Schedulable; Planned run cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The registration authority that admits the registration. |
| Effect on the authoritative outcome | None. A registered planned run has no authoritative outcome, and WP2-LIFE-005 keeps it validly represented without one. |
| Minimum transition provenance | The planned-run identity; the study identity and version; the registration identity and version; the condition and treatment identities; the world or scenario identity and version; the registered concurrency-profile identity and version WP2-SCHED-036 requires it to identify; and the recording authority. |

**Schedulable.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The scheduling authority records that the planned run is eligible for scheduling under the registered, versioned scheduling policy its study identifies. |
| Permitted predecessor classes | Registered; Attempted, where every execution attempt admitted for the planned run has reached a terminal operational value and the applicable registered authority permits a further attempt. |
| Permitted successor classes | Attempted; Planned run cancelled; Closed to further attempts. |
| Terminal | No. |
| Authority permitted to record the transition | The laboratory scheduling authority. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The planned-run identity; the identity and version of the scheduling policy applied; the prior and next values; the recording authority; the reason or triggering fact; and the time-domain facts Section 11 makes applicable. |

**Attempted.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | An execution attempt of the planned run is admitted. Where the planned run already holds this value, the admission of a further execution attempt permitted by the registered scheduling policy identified under WP2-SCHED-009 records no further transition in this dimension, and that admission's provenance is carried by the attempt's own Admitted transition under Section 8.6. |
| Permitted predecessor classes | Schedulable. |
| Permitted successor classes | Schedulable; Closed to further attempts; Planned run cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The laboratory authority that admits execution attempts. |
| Effect on the authoritative outcome | None by itself. An authoritative outcome is reached only through the acceptance operation Section 9 governs, and WP2-LIFE-006 keeps successful finalization from producing one on its own. |
| Minimum transition provenance | The planned-run identity; the admitted execution-attempt identity; that attempt's owning laboratory-worker identity and run-evidence-root identity; the identity of the assignment-authority grant WP2-SCHED-013 requires; the dispatch-wave identity where the attempt belongs to one; the recording authority; the reason or triggering fact; and the time-domain facts Section 11 makes applicable. |

**Planned run cancelled.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | A cancellation recorded under WP2-LIFE-027 and issued at planned-run scope, or issued at the scope of the study whose recorded lineage places this planned run below it, takes effect on this planned run. |
| Permitted predecessor classes | Registered; Schedulable; Attempted. |
| Permitted successor classes | None. |
| Terminal | Yes. WP2-LIFE-012 keeps the planned run's identity, recorded execution attempts, transition history, and evidence preserved after it. |
| Authority permitted to record the transition | The authority that the study's registered cancellation policy names for cancellation at the scope from which the cancellation was issued. |
| Effect on the authoritative outcome | The planned run reaches no authoritative outcome after this value is recorded. Where an authoritative outcome was already recorded, the cancellation neither removes nor revises it, and a race between the two operations is resolved under WP2-SCHED-031 and recorded under WP2-SCHED-032. |
| Minimum transition provenance | The planned-run identity; the study identity and version; the identity of the cancellation record, the scope at which it was issued, and its issuing authority; the reason; each execution attempt of this planned run whose recorded status the cancellation changed; the recording authority; and the time-domain facts Section 11 makes applicable. |

**Closed to further attempts.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The applicable registered authority records that no further execution attempt of this planned run may be admitted. The rules that decide when a further attempt may or must be admitted, including replacement eligibility and sample-size treatment, are assigned to Section 14, and the study-level consequences of closure are assigned to Section 15. |
| Permitted predecessor classes | Schedulable; Attempted. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The laboratory authority that admits execution attempts, acting under the study's registered replacement or continuation policy. |
| Effect on the authoritative outcome | None by itself. A planned run may be closed to further attempts with an authoritative outcome or without one. |
| Minimum transition provenance | The planned-run identity; the identity and version of the registered policy under which closure was recorded; the reason; every execution attempt admitted for the planned run together with its terminal operational value and finalization state; the recording authority; and the time-domain facts Section 11 makes applicable. |

**No authoritative outcome recorded.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The registration declaring the planned run is admitted. This is the initial value of every planned run's authoritative-outcome dimension. |
| Permitted predecessor classes | None. |
| Permitted successor classes | Authoritatively accepted. |
| Terminal | No, and it may nevertheless hold permanently. WP2-LIFE-008 keeps a planned run that never leaves it validly represented. |
| Authority permitted to record the transition | The registration authority records the initial value. No authority changes it except through the acceptance operation Section 9 governs. |
| Effect on the authoritative outcome | While this value holds, the planned run has no authoritative accepted outcome. |
| Minimum transition provenance | The planned-run identity and the registration that declared it. |

**Authoritatively accepted.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The acceptance operation that Section 9 governs completes successfully for exactly one execution attempt of this planned run, whose recorded operational lifecycle state is Completed and whose recorded finalization state is Finalization succeeded. |
| Permitted predecessor classes | No authoritative outcome recorded. |
| Permitted successor classes | None. |
| Terminal | Yes. WP2-ID-009 prohibits a planned run from acquiring more than one authoritative accepted outcome, and WP2-ID-026 prohibits changing the meaning of an already-recorded identity or version in place; a material error is corrected under WP2-ID-025. |
| Authority permitted to record the transition | The authority that the registered, versioned authoritative-commit policy names. |
| Effect on the authoritative outcome | This value is the authoritative outcome, and WP2-LIFE-007 requires it to name exactly one accepted execution attempt. |
| Minimum transition provenance | The planned-run identity; the accepted execution-attempt identity; that attempt's recorded operational lifecycle state and recorded finalization state; the identity and version of the authoritative-commit policy applied; the current authoritative-commit authority or authority record under that registered authoritative-commit policy; the accepted attempt's complete assignment-authority history relevant to the production and finalization of its result; the verification facts WP2-SCHED-026 requires; the recording authority; and the time-domain facts Section 11 makes applicable. |

**Planned-run study disposition undetermined.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The registration declaring the planned run is admitted. This is the initial value of every planned run's study-validity dimension. |
| Permitted predecessor classes | None. |
| Permitted successor classes | Planned-run study disposition recorded. |
| Terminal | No, and it may hold for as long as the study's registered rules leave the question open. |
| Authority permitted to record the transition | The registration authority records the initial value. |
| Effect on the authoritative outcome | None. Study validity and exclusion never by themselves determine, remove, or revise an authoritative outcome. |
| Minimum transition provenance | The planned-run identity and the study identity and version. |

**Planned-run study disposition recorded.**

| Fact | Statement |
| --- | --- |
| Owning entity | The planned run. |
| Entry condition | The study or analysis authority records this planned run's disposition against the study's registered validity and exclusion rules. |
| Permitted predecessor classes | Planned-run study disposition undetermined. |
| Permitted successor classes | None. A later determination is recorded as a further determination that names the one it supersedes, consistent with WP2-LIFE-016; a correction to this record is made under WP2-LIFE-017. |
| Terminal | Yes. |
| Authority permitted to record the transition | The study or analysis authority governed by charter Sections 14.2 and 14.7. |
| Effect on the authoritative outcome | None. Recording that a planned run is excluded from a study result neither removes nor revises the authoritative outcome that planned run reached. |
| Minimum transition provenance | The planned-run identity; the study identity and version; the identity and version of the registered validity or exclusion rule applied; the evidence the determination rested on; the recording authority; and the reason. The vocabulary of dispositions is assigned to Section 14 and the study-level consequences to Section 15. |

### 8.6 The execution-attempt lifecycle model

The execution attempt carries four of the five scalar status dimensions, and it alone carries the lineage-relation collection. Its scalar values are as follows.

| State or disposition | Status dimension | Terminal in its dimension |
| --- | --- | --- |
| **Admitted** | Operational lifecycle | No |
| **Released** | Operational lifecycle | No |
| **Starting** | Operational lifecycle | No |
| **Running** | Operational lifecycle | No |
| **Finalizing** | Operational lifecycle | No |
| **Completed** | Operational lifecycle | Yes |
| **Failed** | Operational lifecycle | Yes |
| **Cancelled** | Operational lifecycle | Yes |
| **Finalization not started** | Attempt finalization | No |
| **Finalization in progress** | Attempt finalization | No |
| **Finalization succeeded** | Attempt finalization | Yes |
| **Finalization failed** | Attempt finalization | Yes |
| **Evidence validity undetermined** | Artifact or evidence validity | No |
| **Evidence validity determined** | Artifact or evidence validity | Yes |
| **Attempt study disposition undetermined** | Study validity or exclusion | No |
| **Attempt study disposition recorded** | Study validity or exclusion | Yes |

**Admitted.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The laboratory authority admits one specific physical execution of one planned run, creating the execution-attempt identity and its one run evidence root, naming as its owner exactly one laboratory worker already admitted into service, and recording the assignment-authority grant WP2-SCHED-013 requires — the identity, the root, the owner relation, the initial recordings of the attempt's status dimensions, the attempt's initial lineage-relation-collection state, and that grant all becoming authoritative records of one admitted execution attempt, or none of them doing so, at the all-or-none admission boundary WP2-SCHED-013 states. |
| Permitted predecessor classes | None. Admission is the first event of an execution attempt's lifecycle. |
| Permitted successor classes | Released; Failed; Cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The laboratory authority that admits execution attempts. |
| Effect on the authoritative outcome | None. WP2-LIFE-010 keeps admission from being recorded, reported, or counted as release, start, running, completion, finalization, or authoritative acceptance. |
| Minimum transition provenance | The execution-attempt identity; the planned-run identity; the study identity and version; the owning laboratory-worker identity; the run-evidence-root identity; the assignment-authority grant identity; the dispatch-wave identity where the attempt belongs to one; the registered concurrency-profile identity and version WP2-SCHED-036 requires it to identify; the recording authority; the reason or triggering fact; and the time-domain facts Section 11 makes applicable. |

**Released.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The scheduling authority records that the admitted attempt may begin execution activity. A laboratory that decides admission and release at one point records both events, each with its own provenance; one recorded event never stands for both, and WP2-SCHED-001 keeps the two distinct. |
| Permitted predecessor classes | Admitted. |
| Permitted successor classes | Starting; Failed; Cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The laboratory scheduling authority. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The execution-attempt identity; the dispatch-wave identity where release was decided as part of a wave; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the recording authority; the reason or triggering fact; and the local-queue-time facts Section 11 makes applicable. |

**Starting.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The owning laboratory worker begins execution activity under the attempt, before the simulated world of its planned run has begun to advance. |
| Permitted predecessor classes | Released. |
| Permitted successor classes | Running; Failed; Cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The owning laboratory worker. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The execution-attempt identity; the owning laboratory-worker identity; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the execution-environment and host or runner identity the observed concurrency provenance records under Section 10; the recording authority; and the laboratory-worker wall-clock runtime start boundary Section 11 makes applicable. |

**Running.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The simulated world of the attempt's planned run begins to advance under the engine authority that charter Section 14.8 makes final over objective world state, legal affordances, and committed consequences. |
| Permitted predecessor classes | Starting. |
| Permitted successor classes | Finalizing; Failed; Cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The owning laboratory worker, on the engine-owned facts charter Section 14.8 makes authoritative. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The execution-attempt identity; the owning laboratory-worker identity; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the recording authority; and the logical-simulation-time and laboratory-worker wall-clock runtime facts Section 11 makes applicable. |

**Finalizing.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | Execution activity under the attempt has ended and the finalization Section 3.1 defines has begun for it. Entry into this value and the attempt's finalization-dimension transition into Finalization in progress are two separately recorded transitions sharing one triggering fact or event identity, and the two become current together or not at all, as WP2-LIFE-033 requires. |
| Permitted predecessor classes | Running. |
| Permitted successor classes | Completed; Failed; Cancelled. |
| Terminal | No. |
| Authority permitted to record the transition | The finalizing authority the laboratory names for finalization of an execution attempt. |
| Effect on the authoritative outcome | None by itself, under WP2-LIFE-006. |
| Minimum transition provenance | The execution-attempt identity; the run-evidence-root identity; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the triggering fact or event identity its recording shares with the attempt's finalization-dimension transition into Finalization in progress; the recording authority; and the finalization-time facts Section 11 makes applicable. |

**Completed.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | Finalization of the attempt concluded with every applicable strict criterion holding, so that a Finalization succeeded result is separately recorded for the attempt. Entry into this value names that result and is accepted together with it as one compound outcome, as WP2-LIFE-033 requires, and neither record is inferred from the other. |
| Permitted predecessor classes | Finalizing. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The finalizing authority. |
| Effect on the authoritative outcome | A completed attempt becomes eligible for consideration by the acceptance operation Section 9 governs, and nothing more; WP2-LIFE-006 and WP2-SCHED-025 keep completion from making the attempt authoritative by itself. |
| Minimum transition provenance | The execution-attempt identity; the run-evidence-root identity; the identity of the attempt's recorded Finalization succeeded result this transition names; the identity and version of the finalization rules applied; the recording authority; and the finalization-time facts Section 11 makes applicable. The evidence contract for finalization is assigned to Section 13. |

**Failed.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The attempt meets a condition that the applicable authority records as a terminal operational failure of that attempt. Where the prior operational value is Finalizing, this transition and the generic Finalization failed result form the compound outcome WP2-LIFE-033 requires, accepted together or not at all. |
| Permitted predecessor classes | Admitted; Released; Starting; Running; Finalizing. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The admitting or scheduling authority for a failure recorded before start; the owning laboratory worker, or the authority that observed the failure, for a failure recorded during execution activity; the finalizing authority for a failure recorded during finalization. |
| Effect on the authoritative outcome | None. A failed attempt is not the authoritative outcome of its planned run, and its failure does not by itself change that planned run's authoritative-outcome state; WP2-SCHED-025 separately bars consideration of any attempt whose recorded operational lifecycle state is not Completed or whose recorded finalization state is not Finalization succeeded. |
| Minimum transition provenance | The execution-attempt identity; the prior operational value; the reason or triggering fact; the observing authority and the recording authority; the evidence the attempt had produced; and the time-domain facts Section 11 makes applicable. The failure-class vocabulary and the typed dispositions are assigned to Section 14. |

**Cancelled.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | A cancellation recorded under WP2-LIFE-027 reaches this execution attempt, whether it was issued at study, planned-run, or execution-attempt scope. Where the prior operational value is Finalizing, this transition and the generic Finalization failed result form the compound outcome WP2-LIFE-033 requires, accepted together or not at all. |
| Permitted predecessor classes | Admitted; Released; Starting; Running; Finalizing. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The authority that the study's registered cancellation policy names for cancellation at the scope from which the cancellation was issued. |
| Effect on the authoritative outcome | None by itself. A cancelled attempt is not the authoritative outcome of its planned run, WP2-SCHED-026 requires the acceptance operation to verify the cancellation state of the study, planned run, and attempt, and a race between cancellation and acceptance is resolved under WP2-SCHED-031 and recorded under WP2-SCHED-032. |
| Minimum transition provenance | The execution-attempt identity; the identity of the cancellation record, the scope at which it was issued, and its issuing authority; the reason; the prior operational value; the recording authority; the evidence the attempt had produced before cancellation; and the time-domain facts Section 11 makes applicable. |

**Finalization not started.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The attempt is admitted. This is the initial value of every execution attempt's finalization dimension. |
| Permitted predecessor classes | None. |
| Permitted successor classes | Finalization in progress; Finalization failed, in the departure case the Finalization failed entry states. |
| Terminal | No, and it holds permanently for an attempt whose finalization never begins. |
| Authority permitted to record the transition | The admitting authority records the initial value. |
| Effect on the authoritative outcome | None. An attempt holding this value is not eligible for authoritative acceptance under WP2-SCHED-025. |
| Minimum transition provenance | The execution-attempt identity and the planned-run identity. |

**Finalization in progress.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The finalization Section 3.1 defines has begun for this attempt. Entry into this value and the attempt's operational transition into Finalizing are two separately recorded transitions sharing one triggering fact or event identity, and the two become current together or not at all, as WP2-LIFE-033 requires. |
| Permitted predecessor classes | Finalization not started. |
| Permitted successor classes | Finalization succeeded; Finalization failed. |
| Terminal | No. |
| Authority permitted to record the transition | The finalizing authority. |
| Effect on the authoritative outcome | None. An attempt holding this value is not eligible for authoritative acceptance under WP2-SCHED-025. |
| Minimum transition provenance | The execution-attempt identity; the run-evidence-root identity; the triggering fact or event identity its recording shares with the attempt's operational transition into Finalizing; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the recording authority; and the finalization-time facts Section 11 makes applicable. |

**Finalization succeeded.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The finalization Section 3.1 defines concluded for this attempt with every applicable strict criterion holding. This result becomes current only as one member of the compound outcome WP2-LIFE-033 requires, together with the Completed transition that names it, and a success recording whose pair is not accepted is preserved under WP2-LIFE-035, or under WP2-LIFE-030 where it is refused, rather than as a current result of this dimension. |
| Permitted predecessor classes | Finalization in progress. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The finalizing authority. |
| Effect on the authoritative outcome | Necessary and not sufficient. WP2-SCHED-025 permits only an attempt holding this value and the operational value Completed to be considered for authoritative acceptance, and WP2-LIFE-006 prohibits treating the value as itself making the attempt authoritative. |
| Minimum transition provenance | The execution-attempt identity; the run-evidence-root identity; each evidence source validated and its verdict; the identity and version of the finalization rules applied; the current assignment-authority grant identity and the identity of the authority event establishing its currentness at this recording; the recording authority; and the finalization-time facts Section 11 makes applicable. |

**Finalization failed.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | Finalization was attempted for this attempt and at least one applicable strict criterion did not hold, or finalization could not be completed. This result becomes current only as one member of the compound outcome WP2-LIFE-033 requires, together with the operational transition into Failed or Cancelled by which the attempt leaves Finalizing, and a failure recording whose pair is not accepted is preserved under WP2-LIFE-035, or under WP2-LIFE-030 where it is refused, rather than as a current result of this dimension. An attempt whose operational value leaves Finalizing through Failed or Cancelled receives this value as the other member of that compound outcome, accepted together with that operational transition or not at all, finalization interrupted by such a departure being finalization that could not be completed. |
| Permitted predecessor classes | Finalization in progress; Finalization not started, where the attempt's operational value leaves Finalizing through Failed or Cancelled before the paired recording of Finalization in progress was accepted. |
| Permitted successor classes | None. |
| Terminal | Yes. |
| Authority permitted to record the transition | The finalizing authority; or, where the attempt's operational value leaves Finalizing through Failed or Cancelled, the authority the applicable Section 8.6 entry names as permitted to record that operational transition. |
| Effect on the authoritative outcome | None. An attempt holding this value is not eligible for authoritative acceptance under WP2-SCHED-025. |
| Minimum transition provenance | The execution-attempt identity; the stage at which finalization did not complete; the reason; the evidence preserved; the recording authority; where this value follows the attempt's operational departure from Finalizing through Failed or Cancelled, the identity of that operational transition record; and the finalization-time facts Section 11 makes applicable. The failure classes are assigned to Section 14 and the evidence contract to Section 13. |

**Evidence validity undetermined.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt, for the evidence held in its run evidence root. |
| Entry condition | The attempt is admitted. This is the initial value of every execution attempt's evidence-validity dimension. |
| Permitted predecessor classes | None. |
| Permitted successor classes | Evidence validity determined. |
| Terminal | No, and it may hold permanently where no determination is ever made. |
| Authority permitted to record the transition | The admitting authority records the initial value. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The execution-attempt identity and the run-evidence-root identity. |

**Evidence validity determined.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt, for the evidence held in its run evidence root. |
| Entry condition | The authority the laboratory names for evidence validation records a determination of whether that evidence is valid against the applicable evidence rules. The determination vocabulary and the evidence rules themselves are assigned to Sections 13 and 14. |
| Permitted predecessor classes | Evidence validity undetermined. |
| Permitted successor classes | None. A later determination is recorded as a further determination that names the one it supersedes, consistent with WP2-LIFE-016; a correction to this record is made under WP2-LIFE-017. |
| Terminal | Yes. |
| Authority permitted to record the transition | The evidence-validation authority. |
| Effect on the authoritative outcome | None by itself. |
| Minimum transition provenance | The execution-attempt identity; the run-evidence-root identity; the identity and version of the evidence rules applied; the determination recorded; the evidence the determination rested on; the recording authority; and the time-domain facts Section 11 makes applicable. |

**Attempt study disposition undetermined.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The attempt is admitted. This is the initial value of every execution attempt's study-validity dimension. |
| Permitted predecessor classes | None. |
| Permitted successor classes | Attempt study disposition recorded. |
| Terminal | No, and it may hold for as long as the study's registered rules leave the question open. |
| Authority permitted to record the transition | The admitting authority records the initial value. |
| Effect on the authoritative outcome | None. |
| Minimum transition provenance | The execution-attempt identity, the planned-run identity, and the study identity and version. |

**Attempt study disposition recorded.**

| Fact | Statement |
| --- | --- |
| Owning entity | The execution attempt. |
| Entry condition | The study or analysis authority records this attempt's disposition against the study's registered validity and exclusion rules. |
| Permitted predecessor classes | Attempt study disposition undetermined. |
| Permitted successor classes | None. A later determination is recorded as a further determination that names the one it supersedes, consistent with WP2-LIFE-016; a correction to this record is made under WP2-LIFE-017. |
| Terminal | Yes. |
| Authority permitted to record the transition | The study or analysis authority governed by charter Sections 14.2 and 14.7. |
| Effect on the authoritative outcome | None. Recording that an attempt is excluded from a study result neither removes nor revises an authoritative outcome that names it. |
| Minimum transition provenance | The execution-attempt identity; the planned-run identity; the study identity and version; the identity and version of the registered validity or exclusion rule applied; the evidence the determination rested on; the recording authority; and the reason. The vocabulary of dispositions is assigned to Section 14 and the study-level consequences to Section 15. |

**The lineage-relation collection.**

The execution attempt carries one append-only lineage-relation collection in addition to its four scalar status dimensions. The collection holds no record when the execution attempt's identity is created, and the only record it may hold on completion of that attempt's admission is one appended by the same act as that admission, as the Section 6.4 replacement-lineage entry states for the replacing attempt of a registered replacement; thereafter it holds zero or more separately identified replacement relation records and supersession relation records at the same time — several replacement relations, several supersessions, a replacement recorded after a supersession, and a supersession recorded after a replacement all coexist as distinct records rather than as successive values of one status. Appending a relation record is not a transition of any scalar status dimension and is never recorded or reported as a same-value lifecycle transition; it does not by itself alter the attempt's operational lifecycle state, finalization state, evidence validity, study disposition, or produced evidence, and it does not by itself alter the authoritative-outcome state of any planned run. A relation record, once recorded, is never removed from the collection, rewritten, or renumbered; a material error in one is corrected under the correction rule its record type states below. Every relation record names which of the two record types it is. The collection holds records of exactly two types, whose facts are as follows.

| Fact | Replacement relation record | Supersession relation record |
| --- | --- | --- |
| Record type and identity rule | The replacement-lineage record of the Section 6.4 register, which WP2-ID-027 continues to bind clause by clause; each record is separately identified by the replacing and replaced execution attempts it relates within the planned run they share, and its identity is never reused. | An identity-bearing record this section establishes, in the same pattern as the individually attributable authority events WP2-SCHED-016 requires; its identity scope is every supersession of an execution attempt's output the laboratory records, across all studies, all planned runs, and all concurrent execution, each record separately identified within that scope, its identity never reused for another supersession, and neither its identity nor the identity of what superseded the attempt established from a record or execution ordering, a storage path, a timestamp, or physical proximity alone. |
| Participants | Exactly one replacing and exactly one replaced execution-attempt identity of the same planned run, this attempt standing as either participant; the relation is recorded on both participants. | The execution attempt whose output was superseded and, where one is named, the execution attempt or authority that superseded it. |
| The planned run | The planned-run identity both participants share. | The planned-run identity of the superseded attempt. |
| Governing policy identity and version | The identity and version of the registered replacement policy under which the replacement was admitted. | The identity and version of the registered authoritative-commit policy, or of the registered policy under which the relevant assignment-authority grant was issued as the Section 9.6 record model states, under which the supersession was recorded. |
| Recording authority | The authority that admits a replacement under the study's preregistered replacement policy. | The authority that the registered authoritative-commit policy, or the registered policy under which the relevant assignment-authority grant was issued, names. |
| Reason | The reason for the replacement. Replacement eligibility and sample-size treatment are assigned to Section 14. | The reason for the supersession — that the attempt's output was produced under an expired, revoked, or superseded assignment authority, or that another execution attempt of the same planned run reached the authoritative outcome. |
| Applicable time-domain facts | The time-domain facts Section 11 makes applicable. | The time-domain facts Section 11 makes applicable. |
| Evidence named | No evidence reference is required of a replacement relation record. | The evidence the superseded attempt produced. |
| Correction or supersession of the record itself | Never rewritten to name a different predecessor. A material error is corrected under WP2-ID-025 and WP2-ID-026, the correction record also satisfying WP2-LIFE-017. | A material error is corrected under WP2-LIFE-017, by a correction record that explicitly names and supersedes the erroneous record. |
| Effect on scalar dimensions and the authoritative outcome | None by itself. WP2-LIFE-026 keeps the admission of a replacement from changing the replaced attempt's recorded operational lifecycle state, terminal disposition, or evidence, and WP2-ID-009 continues to bound the planned run at no more than one authoritative accepted outcome. | None by itself. A superseded attempt is not the authoritative outcome of its planned run, WP2-SCHED-021 keeps a stale holder from mutating the planned run's authoritative-outcome state or any execution attempt's recorded status, and WP2-SCHED-029 requires the superseded attempt to be preserved with a distinguishable non-authoritative result. The disposition vocabulary for superseded output is assigned to Section 14. |

**WP2-LIFE-032.** Every replacement relation record and every supersession relation record that a conforming laboratory creates, admits, records, references, or relies upon **MUST** conform to every clause of the lineage-relation collection block in Section 8.6 — its membership of the collection under the block's initial-state, append-only, two-record-type, and non-transition rules and, for the applicable record type, the record type named, the identity rule and scope, participants, planned run, governing policy identity and version, recording authority, reason, applicable time-domain facts, evidence named, correction rule, and absence of effect on any scalar status dimension, on produced evidence, or on the authoritative outcome that the block states — except only the specific question or clause that the block expressly assigns to a later section, an exemption that reaches no other clause of the block.

**Rationale.** The sixteen scalar values divide as one operational progression of eight values per attempt and the three other scalar dimensions' own progressions — four finalization values, two evidence-validity values, and two study-disposition values — which advance independently of the operational progression except where WP2-LIFE-033 requires two dimensions to move coherently on one triggering fact or to be accepted as one compound outcome, a coherence recorded explicitly on each dimension rather than read off either; the lineage-relation collection stands apart from all of them, accumulating separately identified relation records with no progression of its own. That is why an attempt cancelled before release holds a terminal operational value, Finalization not started, Evidence validity undetermined, Attempt study disposition undetermined, and, unless its admission was itself the admission of a registered replacement, an empty lineage-relation collection all at once, and why no one of those recorded facts is supplied by reading another. The model also fixes what an authority may record: a laboratory worker records the beginning of its own execution activity, a finalizing authority records the outcome of finalization, the authority that records an attempt's operational departure from Finalizing records the interrupted finalization result that departure entails, a scheduling authority records release, and only the authority the registered authoritative-commit policy names records an authoritative acceptance. The Section 6.4 register already assigns the corresponding identities and their issuing authorities, and WP2-ID-014 continues to prohibit reporting or joining a laboratory-worker, lease, or dispatch-wave identity as though it were the identity of a planned run or an execution attempt.

### 8.7 Planned runs, attempts, and the authoritative outcome

**WP2-LIFE-005.** A planned run **MUST** remain a validly represented planned run of its study from the admission of the registration declaring it and for the whole of its lifecycle, whether or not any execution attempt has been admitted, released, started, finalized, or accepted for it.

**WP2-LIFE-006.** A conforming laboratory **MUST NOT** treat the successful finalization of an execution attempt as, by itself, making that attempt's result the authoritative accepted outcome of its planned run.

**WP2-LIFE-007.** The authoritative-outcome state of a planned run, where the value Authoritatively accepted is recorded at all, **MUST** name exactly one execution attempt of that planned run whose recorded finalization state is Finalization succeeded.

**WP2-LIFE-008.** A planned run for which the value Authoritatively accepted is never recorded **MUST** remain a validly represented planned run carrying its complete identity, every execution attempt admitted for it, and every one of their recorded dispositions.

**WP2-LIFE-033.** A conforming laboratory **MUST** keep each execution attempt's operational lifecycle dimension and its finalization dimension explicitly coherent, coordinating at one coherence decision that is atomic, or safe against competing operations and partial outcomes to an equivalent degree, the per-dimension acceptances the boundary WP2-LIFE-034 requires into all-or-none compound outcomes — recording entry into the operational value Finalizing and entry into Finalization in progress as two separately recorded transitions that share one triggering fact or event identity and become current together or not at all, resolving the finalization of an attempt that has entered Finalizing, every terminal finalization result and every operational departure from Finalizing alike, only by accepting exactly one coherent compound outcome, either the operational value Completed together with the Finalization succeeded result the Completed transition names, or the operational value Failed or Cancelled together with the generic Finalization failed result, allowing no accepted Finalization succeeded result to coexist with the operational value Failed or Cancelled, and preserving every member of a competing pair that is not accepted, a success recording losing to a failure or cancellation pair and a failure or cancellation operation losing to the completion pair alike, under WP2-LIFE-035, or under WP2-LIFE-030 where it is refused, as a distinguishable rejected or refused operation that supplies a current value in neither dimension — with the required coherence recorded explicitly in each dimension's own transition records and neither dimension's value inferred from the other's.

**Rationale.** The first four requirements state, in lifecycle terms, what Section 6 states in identity terms. WP2-ID-006 and WP2-ID-007 already establish that a planned-run identity exists before and independently of physical execution and that a planned run has zero execution attempts exactly where none was ever admitted; WP2-ID-009 bounds the authoritative accepted outcome at no more than one. What Section 8 adds is that none of the planned run's lifecycle values, and no absence of one, makes the planned run invalid or unrepresentable. Separating finalization from acceptance is the invariant that a concurrent laboratory most easily loses: with one nonterminal execution attempt at a time per planned run and one writer, "finished successfully" and "is the authoritative result" coincide, and Section 5.5 records that the repository's current orchestration is exactly that arrangement. With several attempts of one planned run able to finalize successfully, they cannot coincide, and Section 9 states the acceptance operation that decides between them. WP2-LIFE-033 keeps the separation truthful while both dimensions move, by coordinating the per-dimension acceptances WP2-LIFE-034 requires into all-or-none compound outcomes: entry into Finalizing and entry into Finalization in progress become current together or not at all, so finalization that has begun is never current against a finalization value that says it has not started and neither half of the entry pair stands current alone; an attempt is Completed only where the Finalization succeeded result its completion asserts is separately recorded, named by the Completed transition, and accepted with it as one compound outcome; an attempt that leaves Finalizing through Failed or Cancelled receives the generic Finalization failed result as the other member of that departure's compound outcome, whose entry condition already covers finalization that could not be completed, without this section defining the failure taxonomy assigned to Section 14; and a success recording, or a failure or cancellation operation, whose pair is not accepted is preserved under WP2-LIFE-035 as a rejected operation current in neither dimension, so that no accepted Finalization succeeded result ever coexists with operational Failed or Cancelled and every finalization resolution stands as exactly one coherent terminal pair. The coordinated coherence decision is a property of where the compound acceptance is decided and what makes it final, in the same sense as the boundary WP2-LIFE-034 requires, and it selects no transaction, lock, store, or consensus primitive, which WP2-SCOPE-015 prohibits selecting. The coherence WP2-LIFE-033 requires is recorded in each dimension's own transition records: WP2-LIFE-004 continues to prohibit supplying one dimension's value by reading another's, and a paired recording under one triggering fact or event identity, like the compound acceptance that coordinates two such recordings, is a recorded rule relating the dimensions, in exactly the sense the WP2-LIFE-004 rationale permits, rather than an inference between them.

### 8.8 Admission, pre-start status, and terminal identity

**WP2-LIFE-009.** An execution attempt **MUST** own its one run evidence root from the point of its admission, before and independently of any execution activity carried out under it.

**WP2-LIFE-010.** A conforming laboratory **MUST NOT** record, report, or count the admission of an execution attempt as its release, its start, its running, its completion, its finalization, or the authoritative acceptance of its planned run.

**WP2-LIFE-011.** An execution attempt cancelled or failed before any execution activity began under it **MUST** remain represented with its identity, its run evidence root, its owning laboratory-worker identity, its recorded transition history, its terminal disposition, and whatever evidence it in fact produced.

**WP2-LIFE-012.** A conforming laboratory **MUST NOT** erase, overwrite, truncate, or render unreadable the identity, the recorded transition history, the terminal disposition, or the produced evidence of an execution attempt or of a planned run that has reached a terminal value in any status dimension.

**Rationale.** The admission model these requirements carry is the one the approved Section 3.1 and Section 6.4 entries state: identity begins at admission, admission may precede all execution activity, and an admitted attempt that never starts is a recorded execution attempt rather than a nonentity. WP2-LIFE-009 states the consequence for the run evidence root that the Section 6.7 register entry already requires, so that a pre-start terminal disposition has a namespace to be recorded against without relaxing the one-root-per-attempt cardinality. WP2-LIFE-012 governs erasure and unreadability; WP2-ID-024 separately prohibits a terminal value from freeing an identity for reuse, and charter Section 14.4 requires failed, interrupted, invalid, excluded, and replacement attempts to remain recorded evidence with typed dispositions. Section 5.9 records that the repository's current per-execution seal already authenticates an empty evidence set for an interruption that preceded any evidence creation, which is evidence that a pre-start terminal disposition is representable, not a requirement of this specification.

### 8.9 Transition authority, provenance, and history

**WP2-LIFE-013.** Every transition a conforming laboratory records **MUST** name the execution attempt or planned run whose status changed, the study above it and, where the changed status is an execution attempt's, the planned run above it, the status dimension, the prior recorded value, the identity of the prior transition record or current revision from which the transition proceeds within that entity and status dimension, the next recorded value, the authority that recorded the transition, the reason or triggering fact, and the time-domain facts that Section 11 makes applicable to it.

**WP2-LIFE-014.** A transition **MUST** be recorded only by an authority that the applicable model entry in Sections 8.5 and 8.6 names as permitted to record it.

**WP2-LIFE-015.** The complete recorded transition history of every planned run and of every execution attempt **MUST** remain reconstructible from the record, in the order in which the transitions were recorded, with the authority and reason of each retained, and with the predecessor linkage WP2-LIFE-013 requires readable from each transition record rather than inferred from that order.

**WP2-LIFE-016.** A conforming laboratory **MUST NOT** overwrite, delete, or change the meaning of an already-recorded transition or of an earlier recorded status value.

**WP2-LIFE-017.** A correction to an already-recorded transition, status value, lineage-relation record, or correction record **MUST** be recorded as a correction record that explicitly names and supersedes the record it corrects, carrying the correcting authority and the reason for the correction, rather than as an alternate successor of the corrected record's predecessor or as a further transition of the entity's status dimension.

**WP2-LIFE-034.** A conforming laboratory **MUST** accept at most one transition from each current revision of each entity's status dimension, at most one initial recording of each such dimension, and at most one correction record superseding any one already-recorded transition, status value, initial recording, lineage-relation record, or correction record, deciding each acceptance at an atomic or equivalently safe authority boundary at which two competing operations proceeding from one current revision, two competing initial recordings of one dimension, or two competing corrections of one record never both become current and at which neither currentness nor the resolution of a race between competing operations is inferred from wall-clock arrival order.

**WP2-LIFE-035.** Every operation recording a transition, an initial value, or a correction that loses a race under WP2-LIFE-034, or that proceeds from a revision that is no longer the current revision of its entity and status dimension, **MUST** be preserved as a distinguishable rejection or refusal record naming the entity, the status dimension, the predecessor revision the operation attempted to proceed from — or that it attempted the initial recording of that dimension or the correction of a named record — the next value or record it attempted to record, the authority that attempted it, and the reason it was not accepted, without deleting, overwriting, truncating, or rendering unverifiable any recorded status, transition history, or evidence that existed before the operation was attempted or that the operation had already produced.

**Rationale.** A reconstructible history is what lets a later audit tell a cancelled attempt from a failed one, an attempt that was never released from one that started and crashed, and a correction from a rewrite. WP2-ID-023 already requires the lineage relationships of Section 6 to be readable from the record rather than reconstructed from ordering, paths, or names; WP2-LIFE-015 requires the same of status history. Recorded order alone, however, is not an authority rule: it can show that two competing successors were both written, but it can neither prevent the fork nor repair it afterwards. That is why WP2-LIFE-013 requires every transition to name the prior transition record or current revision it proceeds from rather than merely the prior value's name — two operations that each claim to proceed "from Finalizing" are indistinguishable, whereas two operations that each name one current revision are provably competing — and why WP2-LIFE-034 places the acceptance of a transition at an atomic or equivalently safe authority boundary: without one, Schedulable moving to Attempted can race Schedulable moving to Planned run cancelled, Admitted moving to Released can race Admitted moving to Cancelled, and Finalizing moving to Completed can race Finalizing moving to Cancelled, each pair leaving two individually permitted successors both recorded as current. The boundary is a rule about where acceptance is decided and what makes it final rather than a mechanism, and wall-clock arrival order never supplies it, consistent with WP2-ISO-014's rule that wall-clock order is no implicit ordering guarantee and with WP2-SCHED-033, which prohibits it as a commit rule. WP2-LIFE-035 keeps the losing or stale side of a race as distinguishable evidence rather than letting it vanish or be silently retried, in the same evidence-preserving discipline WP2-LIFE-030 and WP2-LIFE-031 apply to refusals. WP2-LIFE-016 and WP2-LIFE-017 apply to lifecycle records the same append-and-supersede discipline that WP2-ID-025 and WP2-ID-026 apply to identities, so that an error is corrected without an earlier recorded meaning changing under a reader who already relied on it, and WP2-LIFE-017 keeps a correction out of the lifecycle itself: a correction supersedes the erroneous record and never stands as a second successor of that record's predecessor. WP2-LIFE-013 names the time-domain facts as applicable rather than enumerating them, because which domains apply to which transition is stated, so far as it is stated, by the domain model in Section 11.3 and bound by WP2-TIME-001. No transaction, lock, database, store, log, or consensus primitive is selected by any of these requirements, and WP2-SCOPE-015 prohibits such a selection throughout this document.

### 8.10 Process restart, orchestrator restart, and laboratory-worker identity

**WP2-LIFE-018.** A restart of the process or processes hosting any part of a conforming laboratory **MUST NOT** by itself change the recorded status of any planned run or execution attempt in any status dimension.

**WP2-LIFE-019.** A conforming laboratory resuming operation after an orchestrator restart **MUST** reconstruct the recorded status of every affected planned run and execution attempt from durable, identity-matched records, rather than from process memory, storage or directory ordering, identifier shape, or wall-clock proximity.

**WP2-LIFE-020.** An execution attempt interrupted by a process restart or an orchestrator restart **MUST NOT** be continued, revived, or reopened in place.

**WP2-LIFE-021.** An execution attempt interrupted by a process restart or an orchestrator restart **MUST** receive a recorded terminal disposition that preserves its identity, its recorded transition history, and the evidence it produced.

**WP2-LIFE-022.** Whether a restarted execution agent returns to service under its existing laboratory-worker identity or under a new laboratory-worker identity **MUST** be decided and recorded explicitly by the authority that admits laboratory workers into service, rather than inferred from the restart itself, from a process identifier, from a host identity, or from configuration equality.

**WP2-LIFE-023.** A restarted execution agent **MUST NOT** treat its return to service under an existing laboratory-worker identity as, by itself, restoring an assignment-authority grant, an execution-attempt assignment, or an in-flight execution attempt that was current before the restart.

**Rationale.** WP2-LIFE-022 and WP2-LIFE-023 answer the question the Section 6.5 laboratory-worker entry assigns here: whether a restarted execution agent retains its identity or receives a new one. Neither answer is imposed. A restart is a fact about a process, and Section 3.1 records that a process restart is not itself a resume, a retry, a new execution attempt, or a replacement; making it silently mint or silently preserve a laboratory-worker identity would let a process event decide an identity question that the Section 6.5 entry assigns to the authority that admits laboratory workers into service. What is fixed is that the decision is the admitting authority's, that it is recorded rather than inferred, and that identity continuity never carries authority continuity with it. The Section 6.5 rule that a laboratory-worker identity is never reassigned to a different execution agent continues to hold either way, and the currency of any assignment-authority grant after a restart is decided under Section 9 rather than by the restarted agent. WP2-LIFE-021 likewise requires that an interrupted attempt receive a recorded terminal disposition and names none: the typed disposition vocabulary is assigned to Section 14, and Section 5.9 records that the repository's current mechanism already converts an execution left in progress by a crash into a failed, sealed, preserved execution rather than continuing it in place. WP2-LIFE-019 states the recovery obligation in terms of durable identity-matched records because the alternatives it names are exactly the ones that silently misattribute work under concurrency: Section 5.3 records that the repository derives an execution identifier by counting the executions recorded in one state file, and Section 5.4 records that its only ownership record is a lock file whose liveness test is meaningful solely inside one host's process namespace. Neither observation is a requirement of this specification, and WP2-SCOPE-010 keeps it from being read as one.

### 8.11 Resume and further execution attempts

**WP2-LIFE-024.** A conforming laboratory **MUST** admit any further execution attempt of a resumed planned run only under the registered replacement or continuation authority applicable to that planned run, and only as a new execution-attempt identity with its own run evidence root.

**WP2-LIFE-025.** A resume of a planned run **MUST NOT** by itself admit an execution attempt, change the recorded status of an existing execution attempt, or change the authoritative-outcome state of that planned run.

**Rationale.** Section 3.1 defines a resume as re-entering an existing, identity-matched unit of work after an interruption, without continuing an interrupted execution attempt in place and without erasing what that attempt produced. WP2-LIFE-024 states what a resume may lead to and under whose authority, and WP2-LIFE-025 states what it does not do on its own, so that re-entering a planned run cannot become an unregistered route to an additional physical execution. WP2-ISO-005 already prohibits two execution attempts of one planned run from continuing one another in place, and charter Section 14.4 prohibits retrying an attempt merely to obtain a preferred trajectory. The rules that decide when a further attempt is permitted, and the sample-size treatment of one, are assigned to Section 14.

### 8.12 Replacement within the lifecycle

**WP2-LIFE-026.** The admission of a registered replacement **MUST NOT** rename, renumber, mutate, reopen, or change the recorded operational lifecycle state, terminal disposition, or evidence of the execution attempt it replaces.

**Rationale.** WP2-ID-010 through WP2-ID-012 already require a registered replacement to be an additional execution attempt of the same planned run whose lineage record names the replaced attempt explicitly and is never established from a suffix, an ordering, a path, a timestamp, or proximity alone. WP2-LIFE-026 adds the lifecycle half of the same rule: the replaced attempt's own operational lifecycle state, terminal disposition, and evidence are left exactly as they stand, and the lineage relation is recorded on both participants rather than as a change to the replaced attempt's own progression. Charter Section 14.4 requires replacement rules to be preregistered and prohibits a replacement from erasing the original attempt.

### 8.13 Cancellation scopes

**WP2-LIFE-027.** Every cancellation **MUST** be recorded as an operation issued at exactly one of study scope, planned-run scope, or execution-attempt scope, identifying the scope at which it was issued, the authority that issued it, the identity and version of the registered cancellation policy under which it was issued, its reason, and each unit whose recorded status it changed.

**WP2-LIFE-028.** A conforming laboratory **MUST NOT** record or report a cancellation issued at one scope as a cancellation issued at another, or treat a unit as cancelled because a unit that its explicitly recorded lineage does not place above it was cancelled.

**Rationale.** Cancellation at three scopes is three different operations with three different consequences: cancelling a study reaches the planned runs and execution attempts its recorded lineage places below it, cancelling a planned run reaches that planned run's attempts, and cancelling an execution attempt reaches one attempt and leaves its planned run schedulable or closed according to the registered policy. WP2-ISO-023 already confines a cancellation or cleanup operation to its own lineage, and WP2-ISO-024 prohibits it from destroying a sibling's or an earlier attempt's evidence; WP2-LIFE-027 and WP2-LIFE-028 make the scope itself a recorded fact so that the confinement is checkable after the event. The typed dispositions a cancellation produces, and the containment of sibling units after a failure, are assigned to Section 14.

### 8.14 Illegal and unprovable transitions

**WP2-LIFE-029.** A conforming laboratory **MUST** refuse a transition that the applicable model in Sections 8.5 and 8.6 does not permit, that is attempted by an authority the model does not permit to record it, that cannot demonstrate at the time it is attempted either the prior transition record or current revision of its entity and status dimension from which it proceeds or that it is the initial recording of that dimension, or whose minimum transition provenance cannot be demonstrated at the time it is attempted.

**WP2-LIFE-030.** Every refusal that WP2-LIFE-029 requires **MUST** be recorded as a distinguishable refusal identifying the entity, the attempted transition, each condition of WP2-LIFE-029 the attempted transition met, and such provenance as the refused operation demonstrated.

**WP2-LIFE-031.** A refusal that WP2-LIFE-029 requires **MUST NOT** delete, overwrite, truncate, or render unverifiable any recorded status, transition history, or evidence that existed before the refused transition was attempted or that the refused operation had already produced.

**Rationale.** These three requirements apply to lifecycle transitions the same safe, typed, evidence-preserving refusal discipline that WP2-ISO-030 through WP2-ISO-032 apply to identity, namespace, ownership, authority, and attribution conditions, and they are stated separately because the conditions differ: a transition can be illegal because the model forbids it, because the wrong authority attempted it, because it cannot prove which prior transition record or current revision it attempts to succeed, or because the facts it would have to record are not available. The unproven-predecessor condition is what makes refusal reliable under concurrency: an operation that does not say which current revision it proceeds from cannot be refused as stale with any confidence, whereas one that names a revision no longer current is turned back at the boundary WP2-LIFE-034 requires and preserved as the distinguishable rejection WP2-LIFE-035 requires. Charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed, which a silently dropped or silently coerced transition would defeat. This section defines no failure-class taxonomy, disposition vocabulary, or error-code set; those are assigned to Section 14, and how a refusal is exercised in a conformance check is assigned to Section 17 and the conformance document.

### 8.15 Options deliberately left unselected

**Unselected option.** Status representation. The five scalar status dimensions and the lineage-relation collection may be carried by separate fields on one record, by separate records, by an append-only transition log from which current values are derived, or by another arrangement. WP2-LIFE-003, WP2-LIFE-004, and WP2-LIFE-032 state the properties any arrangement has to satisfy; no encoding, schema, or store is selected.

**Unselected option.** Transition-record placement and acceptance-boundary realization. The transition provenance WP2-LIFE-013 requires may be recorded inline on the entity's record, in a separate transition record, in an event stream, or in more than one of those, and the atomic or equivalently safe authority boundary WP2-LIFE-034 requires may be realized by a transactional record store, by a single arbiter role that serializes acceptance for one entity's status dimension, by a compare-against-current-revision append discipline, by a consensus mechanism, or by another arrangement, the coordinated coherence decision WP2-LIFE-033 requires, at which two such per-dimension acceptances become one all-or-none compound outcome, being realizable by the same range of arrangements. WP2-LIFE-015 requires only that the history, with its predecessor linkage, remain reconstructible from the record; no transaction, lock, store, log, arbiter topology, or consensus primitive is selected.

**Unselected option.** Recovery procedure after an orchestrator restart. The reconstruction WP2-LIFE-019 requires may be performed by re-reading durable records at startup, by a separate recovery pass, by an authority-issued reconciliation, or by another procedure. No procedure, ordering, or store is selected, and WP2-SCOPE-015 prohibits selecting one.

**Unselected option.** Laboratory-worker identity continuity across a restart. The decision WP2-LIFE-022 assigns to the admitting authority may be realized by re-admission under a recorded identity, by an agent-held credential presented at re-admission, by an external service record, or by another mechanism. Neither continuity nor discontinuity is preferred here.

**Unselected option.** Interruption detection. What tells a laboratory that an execution attempt was interrupted may be a liveness policy under Section 9, a durable marker, an authority-issued reconciliation, or another mechanism. WP2-LIFE-020 and WP2-LIFE-021 state what follows from the determination rather than how it is reached.

**Unselected option.** Additional recorded states. A laboratory may record finer states inside any value of either model, provided every transition of the model itself remains recorded with the provenance WP2-LIFE-013 requires. No finer decomposition is required, prohibited, or preferred here.

### 8.16 Boundaries assigned to later chunks

This section states what values a planned run and an execution attempt may hold, how they move between them, who may record each move, and what each move has to record. It deliberately defines none of the following, each of which the staged instructions assign elsewhere: queueing, delivery, assignment, dispatch, lease and assignment-authority mechanics, liveness policy, and the mechanics of the acceptance operation, which belong to Section 9; the contents, fields, and comparison rules of a concurrency profile, which belong to Section 10; the time domains and the measurement rules the transition provenance of this section names as applicable, which belong to Section 11; the model-request lifecycle, its record placement, and budget accounting, which belong to Section 12; evidence formats, inventory contents, replay verification, the finalization evidence contract, packaging, and sealing, which belong to Section 13; the failure-class taxonomy, the typed disposition vocabulary, replacement eligibility, sample-size treatment, and the containment of sibling units after a failure, which belong to Section 14; the rules that make a study complete and the treatment of undispositioned scheduled units, which belong to Section 15; secret custody and the security boundary, which belong to Section 16; and the conformance checks, fault injections, and pass conditions for every requirement stated here, which belong to Section 17 and to the conformance document.

## 9. Scheduling, leasing, and authoritative commit

### 9.1 What this section establishes

This section states the scheduling, assignment, authority, liveness, and authoritative-commit properties that a conforming laboratory has to satisfy while many independent runs and many independent studies execute at the same time. It answers the questions that Sections 6 and 7 expressly assign here: whether a laboratory issues leases at all and how a claim on a unit of work is acquired, renewed, revoked, and arbitrated; whether more than one lease over one planned run may be valid at one point; and how an authoritative commit is reached and competing claimants decided. It selects no queue, broker, scheduler, lock, database, lease algorithm, commit primitive, laboratory-worker count, lease duration, retry count, or timing value, and the selections WP2-SCOPE-015 enumerates remain prohibited throughout this document.

Section 9.2 separates the events a scheduling path produces. Sections 9.3 through 9.5 state the queueing, assignment, and dispatch-wave requirements. Sections 9.6 through 9.8 state the assignment-authority, liveness, and stale-authority requirements. Sections 9.9 through 9.11 state the authoritative-commit, race-resolution, and cleanup requirements. Section 9.12 records options deliberately left unselected, and Section 9.13 records what is assigned to later chunks.

Every substantive statement here is a Required future invariant carrying exactly one `WP2-SCHED-###` identifier, a Design rationale introduced by a **Rationale.** lead-in, or an Unselected option introduced by an **Unselected option.** lead-in, in the Section 4.3 sense, or else an entry of the event table in Section 9.2 or the definitional statements that open Sections 9.6 and 9.9, each of which states how a term is used in this section and carries no obligation of its own beyond the requirements that cite it, or the assignment-authority record model in Section 9.6, its introducing statements and each of its entries, whose normative force flows through WP2-SCHED-051 rather than through an identifier of their own, or a boundary statement in Section 9.13. The lifecycle values this section refers to are the ones the models in Sections 8.5 and 8.6 establish, and every defined term carries the meaning Section 3.1 assigns it, as WP2-SCOPE-005 requires.

### 9.2 The distinct scheduling and authority events

Eight events are kept apart. Each is a separate recorded fact with its own provenance, and none of them implies another.

| Event | What it is | What it is not |
| --- | --- | --- |
| Queue presence | A unit of work is present in, or eligible under, the laboratory's own scheduling path. | Not an assignment, not authority, and not a commitment that the unit will execute. |
| Delivery | A message or record conveying an assignment reaches a laboratory worker or an intermediate component. | Not authority to execute, and not proof that the assignment it conveys was created once. |
| Assignment | An execution attempt is associated with the one laboratory worker that owns it. | Not the grant of authority, and not the start of execution activity. |
| Grant of assignment authority | An explicit, revocable record entitles the owning laboratory worker to act for the assigned execution attempt. | Not a delivery, not a liveness observation, and not an authoritative acceptance. |
| Execution admission | The execution-attempt identity and its run evidence root come into existence, and the attempt names its one owning laboratory worker, already admitted into service, as Section 8.6 states. | Not release, not start, and not acceptance, under WP2-LIFE-010. |
| Release | The scheduling authority records that an admitted attempt may begin execution activity. | Not the start of execution activity, and not a guarantee that any will occur. |
| Execution start | The owning laboratory worker begins execution activity under the attempt. | Not a claim that the attempt will finalize, and not an authoritative outcome. |
| Authoritative acceptance | The planned run's authoritative-outcome state records exactly one accepted execution attempt. | Not a property of an attempt's own finalization, under WP2-LIFE-006. |

**WP2-SCHED-001.** A conforming laboratory **MUST** record each of queue presence, delivery, assignment, the grant of assignment authority, execution admission, release, execution start, and authoritative acceptance that occurs as a distinct event, separately identified and separately attributable to the entities of the Section 6 register that it concerns.

**WP2-SCHED-002.** A conforming laboratory **MUST NOT** treat the presence of a unit of work in a queue, the delivery of a message or record, or the dequeuing of one as, by itself, authority to execute an execution attempt or to record any transition of the models in Sections 8.5 and 8.6.

**Rationale.** Collapsing these events is the ordinary way a distributed execution path loses attribution: a system that treats a delivered message as authority cannot distinguish a redelivery from a second grant, cannot say which of two laboratory workers holding the same message was entitled to act, and cannot preserve the losing side's output as evidence. Section 5.5 records that the repository has no queue, dispatch, lease, or arbitration mechanism at all today, and that its whole concurrency control is one per-root lock plus a serial loop; that is evidence about the current system rather than a requirement, and WP2-SCOPE-010 keeps it from being read as one. The eight events are recorded where each in fact occurs: a laboratory whose scheduling path is a direct call produces no queue-presence or delivery event and records none, and WP2-SCHED-001 requires the events that occur to be recorded as distinct rather than requiring all eight to occur.

### 9.3 Queue presence, delivery, and assignment

**WP2-SCHED-003.** Every admitted execution attempt **MUST** name exactly one owning laboratory-worker identity, from its admission and for the whole of its lifecycle, including after it reaches a terminal value in any status dimension.

**WP2-SCHED-004.** A conforming laboratory **MUST NOT** reassign an execution-attempt identity to a laboratory worker other than the one named as its owner at admission.

**WP2-SCHED-005.** Repeated delivery of the same assignment for the same admitted execution attempt **MUST** be resolved idempotently, creating no further execution-attempt identity, no further run evidence root, and no second assignment-authority grant.

**WP2-SCHED-006.** A delivery, an assignment, or a dispatch-wave membership record that conflicts with the recorded assignment or the recorded dispatch-wave membership of an admitted execution attempt **MUST** be refused, recorded as a distinguishable refusal naming the conflicting facts, and neither merged with, reconciled against, nor applied in part to that attempt's record.

**Rationale.** WP2-SCHED-003 and WP2-SCHED-004 carry forward the exactly-one-owning-laboratory-worker cardinality that the Section 6.4 register entry states and WP2-ID-027 makes binding, and they state it in scheduling terms so that no assignment, cancellation, or recovery path can change it as a side effect. An execution attempt cancelled or failed before start keeps its owning laboratory-worker identity, because WP2-LIFE-011 keeps that identity represented and this section reassigns nothing; a further physical execution after such a cancellation is a separately admitted attempt under WP2-SCHED-007, with its own owning laboratory worker, rather than a transfer of the cancelled attempt. WP2-SCHED-005 concerns the same assignment arriving more than once, which is a transport fact in the Section 3.1 sense of a transport or delivery retry; WP2-SCHED-006 concerns two assignments that cannot both be true, which is a conflict rather than a repeat. WP2-ISO-030 already requires a refusal where an operation cannot demonstrate its own owning lineage, and WP2-ISO-032 prohibits a refusal from destroying evidence.

### 9.4 Further physical executions and simultaneous attempts

**WP2-SCHED-007.** An additional physical execution of one planned run **MUST** be admitted as a new execution attempt carrying its own execution-attempt identity, its own run evidence root, its own owning laboratory-worker identity, and its own assignment-authority grant.

**WP2-SCHED-008.** A conforming laboratory **MUST NOT** record or report an additional physical execution of one planned run as a transport or delivery retry, a process restart, a resume, or the continuation of an earlier execution attempt.

**WP2-SCHED-009.** Whether a planned run may have more than one execution attempt in a nonterminal operational value at one point **MUST** be fixed by the registered, versioned scheduling policy that the planned run's records identify.

**WP2-SCHED-010.** A conforming laboratory **MUST NOT** allow the number of simultaneous nonterminal execution attempts of one planned run to be determined by an unrecorded property of its infrastructure, its delivery path, or its recovery behavior.

**Rationale.** These four requirements keep the difference between repeating a delivery and executing again from being decided by accident. Charter Section 14.2 prohibits an execution-architecture or concurrency-profile change within one registered study unless its preregistered design explicitly treats the change as a condition, and charter Section 10.3 treats a deliberately varied profile as a registered experimental parameter rather than hidden infrastructure; a laboratory in which a redelivery quietly produced a second running execution would be varying its own execution architecture without registering the variation. WP2-SCOPE-006 already prohibits recording a planned run, an execution attempt, a process restart, a resume, a transport or delivery retry, and a registered replacement as interchangeable events. What the registered scheduling policy decides, and what it may permit, is a study-design question that Section 14 and Section 15 rather than this section complete; WP2-SCHED-009 requires only that the decision be registered, versioned, and identified.

### 9.5 Dispatch waves

**WP2-SCHED-011.** Every dispatch-wave record **MUST** name every execution attempt admitted to that wave, including an attempt cancelled before release and an attempt that never begins execution activity.

**WP2-SCHED-012.** An execution attempt admitted to a dispatch wave **MUST** name that dispatch-wave identity in its own record, recorded at the time the membership is established rather than derived afterwards from ordering, identifier shape, storage location, or timing.

**Rationale.** WP2-SCHED-012 decides, explicitly and in the affirmative, the reverse-reference question left open to this chunk: an attempt records the wave it belongs to, and that reference is recorded rather than read back off the wave record. The Section 6.4 execution-attempt entry already lists the dispatch-wave identity among the references an attempt's identity record has to name where the attempt was in fact admitted or carried out under one, and WP2-ID-002 already makes that testable record by record; what WP2-SCHED-012 adds is that the scheduling path records the reference when it forms the membership, so that the two records can be compared afterwards instead of one being reconstructed from the other. A disagreement between them is a conflict in the WP2-SCHED-006 sense, refused and recorded rather than resolved by inference. Neither requirement changes the Section 6.5 rule that one execution attempt belongs to at most one dispatch wave, or the Section 6.5 identity scope that reaches every wave the laboratory forms whether or not any admitted member is ultimately released. Grouping dispatch into waves remains optional: an attempt admitted to no wave names none, and WP2-SCHED-011 binds only the waves a laboratory in fact forms.

### 9.6 Assignment authority

An assignment-authority grant is the explicit, revocable record by which a laboratory entitles one laboratory worker to act for one admitted execution attempt of one planned run. Its subject is the planned run over which the claim is made, which is how the Section 6.5 lease entry and its rationale identify the subject of a claim, and its relation to the admitted execution attempt it entitles is recorded in addition under WP2-SCHED-017. A time-bounded lease in the Section 3.1 sense is one permitted realization of the grant, and where a laboratory realizes the grant as a lease, the Section 6.5 lease register entry binds that record in addition, through WP2-ID-027. A lease or other claim over a planned run may also exist before any execution attempt of that planned run is admitted, under the same Section 6.5 lease entry; such a pre-admission claim remains distinct from the attempt-specific grant WP2-SCHED-013 requires at admission, and it never silently stands in for that grant. More than one such pre-admission claim over one planned run may be valid at one logical authority point; none of them entitles execution activity, and none is counted against the grant cardinality WP2-SCHED-014 and WP2-SCHED-015 bound. What makes a record the grant backing an admission is the explicit binding the record model below states: the grant names the one admitted execution attempt it entitles, that relation is recorded at admission rather than inferred from a claim's subject, holder, or timing, and the Admitted entry of Section 8.6 already carries the grant identity in its minimum transition provenance.

The assignment-authority record model below states, in the register style of Section 6, what every assignment-authority grant record and every authority event over one establishes. Its entries carry no requirement identifier of their own; their normative force flows through WP2-SCHED-051.

| Attribute | Statement |
| --- | --- |
| Identity scope | Every assignment-authority grant the laboratory records, across all studies, all planned runs, all laboratory workers, and all concurrent execution, each such grant separately identified within that scope, together with every authority event recorded over such a grant — its issuance, every renewal, revocation, release, and supersession of it, and every correction of the grant record or of such an event — each such event separately identified. |
| Subject planned run | Exactly one planned-run identity, the subject over which the claim is made. |
| Holding laboratory worker | Exactly one laboratory-worker identity, which is the owning laboratory worker of the admitted execution attempt the grant entitles. |
| Admitted execution-attempt relation | Exactly one admitted execution-attempt identity, named on the grant record itself, so that the grant WP2-SCHED-013 requires at admission is bound to its attempt explicitly. A pre-admission lease or claim over the subject planned run names no admitted execution attempt, and that absence is what distinguishes it from the grant; it never becomes that grant, which is separately issued at the admission. |
| Issuing authority | The authority that issued the grant; each subsequent authority event names the authority that recorded it. |
| Governing policy identity and version | The identity and version of the registered policy under which the grant was issued, and for each authority event the identity and version of the registered policy under which that event was recorded. |
| Predecessor or superseded authority-event identity | Every authority event other than the issuance names the grant and the prior authority event it succeeds or supersedes; the issuance names no predecessor and is recorded as the issuance. A correction carries two distinct references — the current predecessor authority event from which it advances currentness, and the corrected record, which may be the grant record or any authority event, current or historical, whose content it corrects — and the corrected record never stands in for that predecessor, the two references naming one event only where the corrected record is itself the current predecessor, a correction advancing currentness only from the current event rather than branching from or returning currentness to a historical one. The currentness of a grant is established through this linkage, one linear predecessor chain through corrections, never from wall-clock arrival order. |
| Authority fact | Whether the grant is current, released, revoked, expired, or superseded is established by the recorded authority events and by the validity facts the grant carries, expiry among them. The fact is recorded; no representation of it is selected, and Section 9.12 records that choice as unselected. |
| Begins to exist | The grant record exists from the recording of its issuance, which for the grant backing an admission is that admission itself, the admitted execution-attempt identity the grant names beginning to exist at that same admission under the Section 6.4 execution-attempt entry; each authority event exists from the recording of that event. |
| Non-reuse and correction | A grant identity and an authority-event identity are never reused. A grant keeps its identity after it ends, whichever authority fact ended it, so that what was carried out under it remains attributable. A material error in a grant record or in an authority event is corrected by a further recorded event that names, as two distinct references, the current predecessor authority event from which it advances currentness and the record it corrects, together with the correcting authority and the reason, never by rewriting an already-recorded grant or event in place; the correction becomes current only where its stated current predecessor remains current at the boundary WP2-SCHED-052 requires, and competing corrections of one record never both become current, the losing correction preserved as the rejection that requirement states. |

**WP2-SCHED-013.** Every execution-attempt admission **MUST** be decided as one all-or-none operation at an atomic or equivalently safe admission boundary, at which the execution-attempt identity, its run-evidence-root identity, its owning-laboratory-worker relation, the initial recordings of its status dimensions, its initial lineage-relation-collection state as the Section 8.6 collection block states it, and exactly one backing assignment-authority grant entitling that owning laboratory worker to act for the attempt, current from the issuance so decided, either all become authoritative records of one admitted execution attempt or none of them does, each such record remaining separately identified and separately attributable, a losing, stale, conflicting, or incomplete admission operation being preserved as a distinguishable refusal or rejection that carries any identity values it proposed while creating neither an admitted execution attempt nor a current grant, and two competing admissions, or two competing initial grant issuances, for one proposed attempt never producing a partially admitted attempt or an orphan current grant.

**WP2-SCHED-014.** A conforming laboratory **MUST NOT** hold more than one assignment-authority grant current for one execution attempt at one logical authority point, currentness being the recorded authority fact that the record model of this section establishes through authority events, their predecessor or supersession linkage, and the validity facts the grant carries rather than a condition inferred from delivery, possession, or arrival order.

**WP2-SCHED-015.** More than one assignment-authority grant over one planned run **MUST** be current at one logical authority point only where the registered scheduling policy identified under WP2-SCHED-009 permits more than one nonterminal execution attempt of that planned run at that point, and only where each such grant names a distinct admitted execution attempt of it under the admitted-execution-attempt relation the record model of this section states.

**WP2-SCHED-016.** Every grant, renewal, revocation, release, and supersession of assignment authority, and every correction of such a grant or of an authority event over one, **MUST** be recorded as an individually attributable event carrying an identity that is never reused for another such event, and naming both the grant record and the prior authority event it succeeds or supersedes, or, where it is the issuance, the grant record it creates and the fact that it has no predecessor, a correction naming in addition, as a reference distinct from the current predecessor authority event from which it advances currentness, the corrected record — the grant record or the authority event, current or historical, whose content it corrects.

**WP2-SCHED-017.** Every assignment-authority grant record **MUST** identify its subject planned run, its holding laboratory worker, the authority that issued it, the facts that establish its validity and any supersession or correction of it, the identity and version of the policy under which it was issued, and the one admitted execution attempt it entitles, each as the assignment-authority record model of this section states it.

**WP2-SCHED-051.** Every assignment-authority grant record and every authority event over one that a conforming laboratory creates, records, references, or relies upon **MUST** conform to every clause of the assignment-authority record model in Section 9.6 — its identity scope, subject planned run, holding laboratory worker, admitted execution-attempt relation, issuing authority, governing policy identity and version, predecessor or superseded authority-event identity, current-predecessor and corrected-record references of a correction event, authority fact, point at which the grant and each authority event begins to exist, and non-reuse and correction rules — except only the specific question or clause that the model expressly assigns to a later section, an exemption that reaches no other clause of that attribute or entry.

**WP2-SCHED-052.** Every operation that would establish, renew, revoke, release, or supersede an assignment-authority grant, or correct such a grant or an authority event over one, **MUST** be decided at an authority boundary that is atomic, or safe against competing grant operations to an equivalent degree — the initial grant issuance backing an execution-attempt admission being decided within the all-or-none admission acceptance WP2-SCHED-013 requires, and a correction prevailing only where the current predecessor authority event it names remains current at that authority boundary, the corrected record it names never standing in for that predecessor — and, where it loses or is stale, preserved as a distinguishable, recorded rejection naming the grant or authority event it attempted to succeed or supersede — for a correction, both the current predecessor it claimed and the record it attempted to correct, and for an issuance, the proposed or admitted execution attempt and subject planned run for which it was attempted — the authority that attempted it, and the reason it did not prevail, without deleting, overwriting, truncating, or rendering unverifiable any recorded grant, authority event, status, or evidence, so that two competing grant operations attempting to succeed one current authority event, two competing issuances for one proposed or admitted execution attempt, or two competing corrections of one grant record or authority event, can never both become current.

**Rationale.** WP2-SCHED-013 through WP2-SCHED-017, the record model above, and WP2-SCHED-051 and WP2-SCHED-052 answer the questions the Section 6.5 lease entry and the Section 7.13 rationale assign here. Whether a laboratory issues leases at all is not fixed: what is required is an explicit, revocable, recorded authority grant, which a time-bounded lease, a fencing record, an ownership record, or another mechanism may realize, and Section 9.12 records that choice as unselected. Acquisition is the recorded issuance WP2-SCHED-013 requires, decided within the all-or-none admission acceptance that requirement states so that no execution attempt is admitted without its one backing grant becoming current and no such grant becomes current without its attempt admitted; renewal, revocation, release, supersession, and correction are the individually recorded events WP2-SCHED-016 requires, each naming the grant or prior authority event it succeeds or supersedes — a correction naming in addition, as a distinct reference, the corrected record — so that currentness is read from the record's own linkage as one linear predecessor chain; expiry is one of the validity facts the record model's authority-fact clause carries; and arbitration between competing claimants is decided by WP2-SCHED-014 and WP2-SCHED-015 together with the registered, versioned policy every grant identifies, never by wall-clock arrival; WP2-SCHED-031 separately governs a race between cancellation and acceptance, and acceptance itself is decided under the registered, versioned authoritative-commit policy Section 9.9 governs. WP2-SCHED-015 answers the cardinality question the Section 6.5 lease entry defers: more than one grant over one planned run may be current at once exactly where the registered scheduling policy permits more than one nonterminal attempt of it and each grant names a different admitted attempt, and never otherwise. A claim under the Section 6.5 lease entry that names no admitted execution attempt is not an assignment-authority grant and is not bounded by that rule; it entitles no laboratory worker to act for an execution attempt, which requires the grant WP2-SCHED-013 requires at admission, and the claim's own record remains bound by the Section 6.5 lease entry through WP2-ID-027. The Section 6.5 cardinality question is thereby answered in two halves: a claim that is an assignment-authority grant is bounded by WP2-SCHED-015, and a claim that is not may coexist with others over the same planned run while entitling nothing, so its multiplicity decides no authority. The record model is stated in the register style of Section 6, and WP2-SCHED-051 is the single requirement that incorporates it and makes each clause binding, in the way WP2-ID-027 binds the register entries and WP2-LIFE-001 binds the lifecycle models, so that no individual table cell carries a requirement identifier of its own. WP2-SCHED-052 closes the race that identity and linkage alone cannot: without it, two individually permitted grant operations could each name the same current authority event as predecessor and both claim to have succeeded it, and the boundary it requires is the counterpart, for authority records, of the acceptance boundary WP2-SCHED-030 requires and the scalar-transition boundary WP2-LIFE-034 requires, with the losing operation preserved as WP2-LIFE-035 preserves a losing lifecycle transition. WP2-SCHED-013 places the admission bundle under one such boundary for the compound form of the same reason: the admission facts are separately recorded, and acceptance boundaries independent of one another could let the attempt admission become current while its initial grant issuance loses, or the issuance become current while the admission is refused, leaving a partially admitted attempt or an orphan current grant that no later record explains, so the identity, root, owner relation, initial status recordings, initial lineage-relation-collection state, and backing grant become authoritative records of one admitted execution attempt together or not at all, and a losing, stale, conflicting, or incomplete admission operation is preserved as a refusal or rejection that creates neither an admitted attempt nor a current grant. A correction event carries two distinct references because one reference cannot serve both purposes: a correction naming only the record it corrects would, where that record is the grant record or a historical authority event, either fork the currentness chain at that historical point or return currentness past every later event, whereas naming the current predecessor separately keeps currentness one linear chain through corrections while leaving every record in the chain correctable, the corrected target never standing in for the predecessor and a correction prevailing only where its stated predecessor remains current. The explicit admitted-execution-attempt relation is what keeps a pre-admission claim from silently becoming the grant: a claim over a planned run under the Section 6.5 lease entry names no admitted execution attempt, so the grant backing an admission is distinguishable from every earlier or broader claim over the same planned run by the record itself rather than by timing. A *logical authority point* is a point at which the laboratory decides authority under its own recorded rules rather than an instant read from a wall clock; WP2-ISO-014 already prohibits wall-clock order from serving as an implicit ordering guarantee between isolation units, and WP2-SCHED-033 prohibits it as a commit rule. This specification selects no lease duration, renewal interval, expiry rule, fencing mechanism, store, or representation of the authority fact, and WP2-SCOPE-015 prohibits selecting any of them.

### 9.7 Liveness evidence

**WP2-SCHED-018.** A conforming laboratory **MUST NOT** treat a heartbeat, a health report, or any other liveness evidence about a laboratory worker or an assignment-authority grant as, by itself, authority to execute an execution attempt or to record a transition.

**WP2-SCHED-019.** A conforming laboratory **MUST NOT** treat the absence of liveness evidence as establishing that a laboratory worker has died, that an execution attempt has failed, or that reassignment of work is safe, except as the registered, versioned liveness policy it identifies provides.

**WP2-SCHED-020.** Every determination a conforming laboratory makes under its registered liveness policy **MUST** be recorded with the identity and version of the policy applied, the evidence and the absence of evidence on which the determination rested, the determining authority, and each entity whose recorded status the determination changed.

**Rationale.** Liveness evidence answers a different question from authority: a heartbeat says that something is running, and a grant says who is entitled to act. A laboratory that conflates them reassigns work whenever a network path is slow, and it cannot afterwards say whether the reassignment was justified. Section 5.5 records that the repository's nearest current mechanisms are a per-attempt stall watchdog inside one process and a host-level sleep inhibition, neither of which arbitrates between competing claimants; that is an observation about the current system, not a requirement. What follows from a liveness determination — whether the affected execution attempt receives a terminal disposition, and whether a further attempt may be admitted — is governed by WP2-LIFE-021, WP2-SCHED-007, and the registered policies those requirements name, and the disposition vocabulary is assigned to Section 14. No heartbeat interval, timeout, or grace value is selected here, and WP2-SCOPE-015 prohibits selecting one.

### 9.8 Stale authority, crash, and preserved output

**WP2-SCHED-021.** A laboratory worker whose assignment-authority grant has expired, been revoked, or been superseded **MUST NOT**, by any operation performed in exercise of that grant while it is not current, mutate the authoritative-outcome state of any planned run, mutate the recorded status of any execution attempt in any status dimension, append a relation record to any execution attempt's lineage-relation collection, or cause its own output to become the authoritative outcome of a planned run.

**WP2-SCHED-022.** Output produced under an expired, revoked, or superseded assignment-authority grant **MUST** remain attributable to the laboratory worker, the grant, and the execution attempt that produced it, and preserved for later disposition.

**WP2-SCHED-023.** The crash, loss, or unexplained silence of a laboratory worker or of an orchestrator in the Section 8.3 sense **MUST NOT** by itself transfer an existing execution attempt, its run evidence root, or its assignment authority to another laboratory worker.

**WP2-SCHED-024.** Any further physical execution of a planned run after a crash, loss, or unexplained silence of the kind WP2-SCHED-023 names **MUST** be admitted as a separate execution attempt under WP2-SCHED-007 rather than as a continuation of the interrupted attempt.

**Rationale.** WP2-SCHED-021 states one prohibition on one subject with four named consequences that a stale holder cannot bring about by an operation performed in exercise of the lapsed grant; it is the scheduling counterpart of WP2-ISO-020, which states the corresponding prohibition for a lease specifically, and it reaches an authority grant realized by any mechanism. WP2-SCHED-022 likewise generalizes WP2-ISO-021, and strengthens its preservable to preserved for output produced under a grant. Together they separate authority from evidence: losing a claim removes the power to make an outcome authoritative and licenses nothing about the artifacts already produced, which charter Section 14.4 requires to remain recorded evidence with typed dispositions and charter Section 14.9 requires not to be concealed. Staleness attaches to the operation rather than to the laboratory worker's whole history: an ordinary completed assignment ends with its grant released or expired, so an authority-ending event after an attempt's result was validly produced and finalized removes the power to act from that point forward without retroactively stripping the completed result of its eligibility for acceptance, and WP2-SCHED-026 accordingly tests the grant's currency at each production and finalization operation rather than at the moment of acceptance. The coherence recordings WP2-LIFE-033 requires after a result was validly produced and finalized are not exercises of the lapsed grant: the applicable Section 8.6 entries name the finalizing authority, or the authority recording the operational departure, as the role entitled to record them, an entitlement that does not derive from the assignment-authority grant, so an ordinarily ending grant leaves a completed, eligible result behind rather than an attempt stranded in Finalizing, and WP2-ISO-030 continues to require refusal of any exercise of authority under an expired, revoked, or superseded lease. Output produced under a grant already expired, revoked, or superseded is the opposite case: WP2-SCHED-022 keeps it attributable and preserved, and the verification WP2-SCHED-026 requires keeps any output produced or finalized under a grant not current at that operation, whichever authority fact ended that currentness, from ever being accepted as authoritative. WP2-SCHED-023 and WP2-SCHED-024 keep a crash from becoming a silent transfer, which is the failure mode that lets two laboratory workers believe they own one unit of work; WP2-LIFE-020 separately prohibits reviving an interrupted attempt in place, and WP2-LIFE-021 requires the interrupted attempt to receive a recorded terminal disposition.

### 9.9 Authoritative commit

An authoritative commit is a transition of the planned run's authoritative-outcome state, not of any execution attempt's finalization state. It is reached at most once for a planned run, it may never be reached at all, and it is the only operation that records an authoritative accepted outcome.

**WP2-SCHED-025.** A conforming laboratory **MUST NOT** consider an execution attempt for authoritative acceptance unless that attempt's recorded operational lifecycle state is Completed, its recorded finalization state is Finalization succeeded, and its recorded identity and lineage match the planned run whose authoritative-outcome state the acceptance operation would change.

**WP2-SCHED-026.** An acceptance operation **MUST** verify, before it records an authoritative outcome, the identity of the planned run, the lineage of the execution attempt it would accept, the recorded operational lifecycle state and recorded finalization state that WP2-SCHED-025 requires of that attempt, the currency, under the registered authoritative-commit policy, of the authoritative-commit authority under which the operation is performed, the absence of any production or finalization of the result it would accept under an assignment-authority grant not current at the time of that production or finalization, the registered condition and treatment under which that attempt was executed, the cancellation state of the study, planned run, and attempt, and the absence of a prior authoritative outcome for that planned run.

**WP2-SCHED-053.** A conforming laboratory **MUST** keep the assignment authority under which an execution attempt's result was produced and finalized distinct from the authoritative-commit authority entitled to record its planned run's authoritative outcome, recording the two as jointly attributable in every acceptance record — which names both the current authoritative-commit authority or authority record under the registered authoritative-commit policy and the accepted attempt's complete assignment-authority history relevant to the production and finalization of its result, a history that establishes through the grants and authority events it names an unbroken succession of current assignment authority from the attempt's recorded Starting transition to its recorded Finalization succeeded result — and never treating a laboratory worker's ownership, execution, or finalization of an execution attempt as by itself conferring authority to record the authoritative outcome of any planned run.

**WP2-SCHED-027.** The authoritative-outcome record of a planned run **MUST** name either no accepted execution attempt or exactly one.

**WP2-SCHED-028.** Two acceptance operations for one planned run **MUST NOT** both record an authoritative outcome.

**WP2-SCHED-029.** An execution attempt that loses an acceptance decision, or whose result arrives late, duplicated, stale, cancelled, or superseded, **MUST** be preserved with a recorded, distinguishable non-authoritative result rather than deleted, rewritten, merged into another attempt's record, or left undispositioned.

**WP2-SCHED-030.** The authority boundary at which an authoritative outcome is recorded **MUST** be atomic, or safe against concurrent acceptance operations to an equivalent degree, so that no interleaving of acceptance operations can produce two authoritative outcomes for one planned run or a partially recorded one.

**Rationale.** These seven requirements answer the question the Section 6.10 rationale and the Section 7.12 rationale assign here: how an authoritative commit is reached. It is reached by an operation that verifies a stated set of facts and then transitions one planned run's authoritative-outcome state, under an authority whose currency is part of what it verifies. WP2-ID-009 already prohibits a planned run from acquiring more than one authoritative accepted outcome and WP2-ISO-019 already places the record of the outcome on the planned run by identifying the one accepted attempt, and WP2-LIFE-007 requires that named attempt's recorded finalization state to be Finalization succeeded; WP2-SCHED-027 and WP2-SCHED-028 state the corresponding scheduling obligations, on the record's form and on the operation's outcome, so that a conformance check can exercise two concurrent acceptances and observe that exactly one succeeded. WP2-SCHED-030 states the property the boundary has to have and selects no primitive, no transaction model, no store, and no algorithm to provide it; Section 9.12 records those as unselected, and WP2-SCOPE-015 prohibits selecting them. Section 5.7 records that the repository's current finalizer orders its writes against interruption rather than against a competing writer, and Section 5.4 records that its exclusion rests on a cooperative per-root lock evaluated inside one host's process namespace; both are observations about the current system, and neither is a requirement of this specification. WP2-SCHED-053 keeps the two authorities the acceptance record relates from collapsing into one. An assignment-authority grant entitles one laboratory worker to act for one admitted execution attempt; recording a planned run's authoritative outcome is a planned-run authority transition that only the authority named by the registered authoritative-commit policy performs; and a laboratory worker that could accept its own output because it owned or finalized the attempt would hold a power its grant never conferred. The Section 8.5 Authoritatively accepted entry therefore names the current authoritative-commit authority or authority record together with the accepted attempt's complete assignment-authority history relevant to the production and finalization of its result, so that both provenances are readable in one acceptance record without either standing in for the other; the grant record itself and the concurrency-safe currentness of a grant are governed by WP2-SCHED-051 and WP2-SCHED-052 in Section 9.6.

### 9.10 Cancellation and acceptance races

**WP2-SCHED-031.** A race between a cancellation and an authoritative acceptance affecting one planned run **MUST** be resolved by one registered, versioned authority policy that the planned run's records identify.

**WP2-SCHED-032.** The resolution of a race that WP2-SCHED-031 governs **MUST** be recorded, identifying the winning transition, each competing operation that was rejected, the reason each was rejected, and the identity and version of the authority policy applied.

**WP2-SCHED-033.** A conforming laboratory **MUST NOT** decide which of two competing operations affecting one planned run prevails by the wall-clock order in which they arrived, were observed, or were recorded.

**Rationale.** A cancellation and an acceptance can each be legitimate and can each arrive while the other is in flight, so the contract fixes that one registered policy decides between them and that both the decision and the rejected operation are recorded. What it does not fix is which way the policy decides: whether a late cancellation defeats an already-verified acceptance, or the reverse, is a study-design question that a registered policy answers, and charter Section 14.3 requires the registration governing an evidence-generating study to precede execution and lists the execution and concurrency profile among what a registration identifies. WP2-SCHED-033 removes the tempting implicit rule; WP2-ISO-014 already prohibits wall-clock order as an implicit causal relation, ordering guarantee, or identity join between isolation units, and WP2-TIME-016 prohibits cross-host wall-clock ordering as an authoritative tie-break.

### 9.11 Cleanup after scheduling, cancellation, failure, or commit

**WP2-SCHED-034.** Cleanup performed after scheduling, cancellation, failure, or an authoritative commit **MUST NOT** delete, truncate, overwrite, or render unverifiable the recorded transition history, the assignment and authority records, or the produced evidence of any execution attempt.

**Rationale.** Cleanup is where a scheduling path most easily destroys the record it was supposed to leave behind, because the work is finished and the artifacts look disposable. WP2-ISO-024 already prohibits a cancellation or cleanup operation from destroying a sibling's or an earlier attempt's evidence, and WP2-LIFE-012 prohibits erasing a terminal entity's history; WP2-SCHED-034 states the same prohibition for the scheduling and authority records specifically, because those are the records that establish who was entitled to act. Retention rules, evidence-size budgets, and what may be discarded after a defined retention period are assigned to Section 13.

### 9.12 Options deliberately left unselected

**Unselected option.** Queue and delivery mechanism. The queue presence and delivery events of Section 9.2 may be realized by a message broker, a polled table, a work-stealing pool, a filesystem or object-store convention, a direct call, or another mechanism. WP2-SCHED-001 through WP2-SCHED-006 state the properties any of them has to satisfy; no broker, queue, database, or transport is selected.

**Unselected option.** Assignment-authority mechanism. The grant WP2-SCHED-013 requires may be realized by a time-bounded lease, a fencing token, an ownership record, a conditional write, or another explicit, revocable record, and the atomic or equivalently safe boundaries WP2-SCHED-013 requires for the admission bundle and WP2-SCHED-052 requires for grant operations may be realized by the same range of arrangements the authoritative-commit option below records for WP2-SCHED-030. This section and its record model require the properties, not the mechanism, and they select no lease duration, renewal interval, expiry rule, clock, store, or representation of the authority fact.

**Unselected option.** Liveness mechanism. The liveness policy WP2-SCHED-019 and WP2-SCHED-020 refer to may rest on heartbeats, lease renewal, external health checks, an authority-issued probe, or another arrangement, at any granularity. No interval, threshold, or detector is selected.

**Unselected option.** Dispatch and release policy. Whether a laboratory releases attempts individually or in dispatch waves, how it sizes or paces a wave, and how it orders releases are unselected. WP2-SCHED-011 and WP2-SCHED-012 bind only the waves a laboratory in fact forms, and WP2-SCOPE-015 prohibits selecting a numeric operating parameter such as a wave size or a laboratory-worker count.

**Unselected option.** Simultaneity of attempts of one planned run. Whether a registered scheduling policy permits one nonterminal execution attempt of a planned run at a time or more than one is a decision this specification leaves to the registered design, under WP2-SCHED-009 and WP2-SCHED-015. Neither arrangement is preferred here.

**Unselected option.** Authoritative-commit primitive. The atomic or equivalently safe authority boundary WP2-SCHED-030 requires may be realized by a database transaction, a conditional or compare-and-set write, a single-writer arrangement, a consensus protocol, an authority-issued token, or another mechanism. No primitive, store, or algorithm is selected.

**Unselected option.** Race-resolution direction. Which of a cancellation and an authoritative acceptance prevails when the two race is fixed by the registered authority policy WP2-SCHED-031 requires, not by this specification. Neither direction is described as preferred or expected.

### 9.13 Boundaries assigned to later chunks

This section states which scheduling and authority events exist, what each of them entitles, what each of them records, and how competing claims are decided. It deliberately defines none of the following: the lifecycle values and transitions those events cause, which belong to Section 8; the contents, fields, and comparison rules of the concurrency profile whose policy identities this section requires to be identified, which belong to Section 10; the time domains in which queueing, dispatch, transport, runtime, and finalization intervals are measured, which belong to Section 11; provider retry semantics, model-request record placement, and budget accounting, which belong to Section 12; evidence formats, inventory contents, replay verification, packaging, sealing, and retention, which belong to Section 13; the failure-class taxonomy and the typed disposition vocabulary behind the refusals and non-authoritative results this section requires, including the disposition of superseded output, which belong to Section 14; the rules that make a study complete and the treatment of undispositioned scheduled units, which belong to Section 15; secret custody and the security boundary, which belong to Section 16; and the conformance checks, fault injections, and pass conditions for every requirement stated here, which belong to Section 17 and to the conformance document.

## 10. Concurrency-profile provenance

### 10.1 What this section establishes

This section realizes the concurrency profile Section 3.1 defines — the versioned record of the execution architecture and contention conditions under which evidence was produced — as two connected records: the registered concurrency profile a study adopts before execution, and the observed concurrency provenance recorded against it. This section always writes those qualified forms for the two parts, and neither displaces the Section 3.1 meaning, which the two parts together carry. A concurrency profile is not an assertion that concurrency made no difference: charter Section 8.5 states that throughput does not establish scientific validity and that parallel execution is not presumed behaviorally neutral, and charter Section 10.3 requires every future study to version and record a concurrency profile precisely because concurrency can change observed behavior. This section completes what the Section 6.8 register entry defers — the contents, fields, further cardinalities, and comparison rules of the profile, and how a profile references dispatch waves, laboratory workers, execution attempts, and contention conditions — and what the Section 6.5 laboratory-worker entry defers about recording execution-agent composition as versioned provenance. It selects no provider, vendor, stack, deployment topology, or numeric operating parameter; the selections WP2-SCOPE-015 enumerates remain prohibited throughout this document.

Section 10.2 states the two records, their cardinalities, and how the tables of this section bind. Sections 10.3 and 10.4 state the requirements on each record. Section 10.5 holds the required category model. Sections 10.6 through 10.10 state divergence, distinctness, sufficiency, nonsecret-identity, and comparison requirements. Section 10.11 states what a profile may never be cited as establishing. Section 10.12 records options deliberately left unselected, and Section 10.13 records what is assigned to later chunks.

Every substantive statement here is a Required future invariant carrying exactly one `WP2-SCHED-###` identifier, continuing the sequence Section 9 begins, a Design rationale, or an Unselected option, in the Section 4.3 sense, or else an entry of the record and cardinality tables in Section 10.2 or of the category table in Section 10.5, whose normative force flows through WP2-SCHED-035 rather than through an identifier of its own, or a boundary statement in Section 10.13.

### 10.2 The two records, their cardinalities, and how the tables bind

| Record | What it is | When it is established | What it is not |
| --- | --- | --- | --- |
| Registered concurrency profile | The versioned description a study adopts before execution of the execution architecture it intends and the contention conditions it expects, identified by a concurrency-profile identity and version as the Section 6.8 register entry states. | At registration, which charter Section 14.3 requires to precede execution and among whose identified items charter Section 14.3 lists the execution and concurrency profile. | Not a record of what happened, not a claim of behavioral neutrality, and not a substitute for the registered treatment or condition identity. |
| Observed concurrency provenance | The record of the execution architecture and contention conditions that in fact obtained while a unit executed, attributed to the units whose execution it describes. | During and after execution, from the facts the laboratory in fact observed. | Not a registration, not an amendment to one, and not evidence of parity between execution architectures. |

The cardinalities the Section 6.8 register entry assigns here are as follows.

| Relationship | Cardinality |
| --- | --- |
| Study to registered concurrency profile | One study registers one or more registered concurrency profiles, at least one as the Section 6.8 entry states. A study registers more than one only where its preregistered design declares the difference as a registered condition or treatment difference, as WP2-SCHED-037 requires and as charter Section 14.2 requires for a change within one registered study. |
| Planned run to registered concurrency profile | One planned run identifies exactly one applicable registered concurrency-profile identity and version. |
| Execution attempt to registered concurrency profile | One execution attempt identifies exactly one applicable registered concurrency-profile identity and version, which is the one its planned run identifies. |
| Execution attempt to observed concurrency provenance | One execution attempt carries exactly one observed concurrency-provenance record, which names the registered concurrency-profile identity and version it is provenance against. |
| Registered concurrency profile to units | One registered concurrency profile applies to zero or more planned runs and zero or more execution attempts of the study whose registration adopts it, as the Section 6.8 entry's required reference states; a further study adopting the same architectural description registers its own concurrency-profile identity. |
| Concurrency records to scheduling entities | A registered concurrency profile names the policy identities and versions of Section 10.5 by identity; an observed concurrency-provenance record names by identity every dispatch wave, laboratory worker, assignment-authority grant, execution attempt, shared resource, and contention observation of Section 10.5 that applies to the execution it describes, zero or more of each. |

**WP2-SCHED-035.** Every study, every registered concurrency profile, and every observed concurrency-provenance record that a conforming laboratory creates, references, or relies upon **MUST** conform to every clause of the record and cardinality tables in Section 10.2 — what each record is, when it is established, what it is not, and every cardinality they state — and carry, for every category the table in Section 10.5 states, the registered or observed content and the identities that table assigns to it, or an explicit recorded statement that the category did not apply to the study or to the particular unit whose record is being written, or was not observable.

**Rationale.** The tables supply the normative content model, and WP2-SCHED-035 is the single requirement that incorporates them and makes each record description, cardinality, and category binding, so that no individual table cell carries a requirement identifier of its own and no later implementation can omit a category silently. A category that genuinely does not apply is recorded as not applying rather than left absent, because an absent field and an inapplicable one are different facts and only the second is checkable, and WP2-SCHED-035 offers the statement at each scope at which an inapplicability can hold — the whole study, or the particular unit whose record is being written, as with the provider-and-route and upstream categories of a deterministic execution attempt in a study whose other units make model requests — so that a mixed study never forces such a record to claim either that a category failed to apply study-wide or that an inapplicable category was merely unobservable. The Section 6.8 register entry already states that one study registers at least one concurrency profile and that the identity is versioned as charter Section 10.3 requires; the further cardinalities above are the ones that entry assigns here, and WP2-ID-027 continues to bind the entry's own non-deferred clauses.

### 10.3 The registered concurrency profile

**WP2-SCHED-036.** Every planned run and every execution attempt **MUST** identify the registered concurrency-profile identity and version applicable to it.

**WP2-SCHED-037.** A deliberately varied concurrency profile **MUST** be represented as a registered condition or treatment difference of the study's preregistered design, identified as such in the registration.

**WP2-SCHED-038.** A conforming laboratory **MUST NOT** alter, replace, amend, or reinterpret a registered concurrency profile on the basis of what execution was observed to do.

**Rationale.** Charter Section 10.3 states that when profiles differ between conditions or are varied deliberately, the profile is a registered experimental parameter rather than hidden infrastructure, and charter Section 14.2 prohibits an execution-architecture or concurrency-profile change within one registered study unless its preregistered design explicitly treats the change as a condition. WP2-SCHED-037 states that obligation inside this contract so that a conformance check can be written against it, and WP2-ID-015 separately keeps a change of laboratory worker, lease, dispatch wave, or execution host from altering a planned run's identity or registered treatment by itself. WP2-SCHED-038 protects the direction of the relationship: a registration is a statement made before execution, and a laboratory that edited it to match what happened would destroy the only record against which a deviation could be detected. Charter Section 14.5 separately prohibits a registered study from silently changing its execution architecture midstream.

### 10.4 Observed concurrency provenance

**WP2-SCHED-039.** Every execution attempt **MUST** carry an observed concurrency-provenance record attributed to it, naming the registered concurrency-profile identity and version it is provenance against.

**WP2-SCHED-040.** Every numeric fact that Section 10.5 requires to be observed — an observed laboratory-worker count, an observed queue duration, an observed rate-limit response count, and the rest — **MUST** be recorded as an observed value carrying the identity of the record or authority that observed it and, where the fact is a duration or other timing fact, the time domain in which it was measured, identified under WP2-TIME-001.

**WP2-SCHED-041.** This specification **MUST NOT** be cited as selecting, endorsing, recommending, or bounding a value, threshold, limit, target, or scaling rule for any numeric fact it requires to be recorded.

**Rationale.** An observed concurrency-provenance record is provenance recorded against the execution attempt it describes and the registered concurrency-profile identity and version it names; it introduces no entity beyond the ones Sections 6.3 through 6.8 register, and the identity requirements that reach it are the ones the register carries for the entities it names. The distinction WP2-SCHED-040 and WP2-SCHED-041 draw is the one the staged instructions and charter Section 10.3 both rest on: recording how many laboratory workers ran, how long a unit waited, and how often a rate limit was met is provenance, and choosing how many laboratory workers may run, how long a unit may wait, or what rate a study may consume would be an operating decision this specification is prohibited from making. WP2-SCOPE-015 already prohibits selecting a numeric operating parameter such as a laboratory-worker count, lease duration, retry count, quota, budget, or threshold; WP2-SCHED-041 makes the prohibition auditable against a later reading of this section, so that a recorded example or an observed value in a study's evidence is never mistaken for a parameter this document chose. WP2-SCHED-040 requires the observing record and, for a duration or other timing fact, the time domain, because an unattributed number cannot be compared across studies, and Section 11 states which domain each duration belongs to.

### 10.5 Required profile and provenance categories

Fourteen categories are required. For each, the registered concurrency profile states what the study intends and the observed concurrency provenance states what in fact obtained, and WP2-SCHED-035 makes both binding.

| Category | Registered concurrency-profile content | Observed concurrency-provenance content | Identities the records name |
| --- | --- | --- | --- |
| Execution-architecture identity and version | The identity and version of the intended execution architecture, described as architectural facts rather than as a vendor, product, or stack. | The identity and version of the execution architecture that in fact carried the execution, and any respect in which it differed from the registered one. | Execution-architecture identity and version; the study, planned run, and execution attempt it applies to. |
| Laboratory-worker population and identities | The intended laboratory-worker population and the intended composition of a laboratory worker, recorded as versioned provenance. | The laboratory workers that in fact carried out execution attempts, the observed population at the recorded points, and the recorded composition of each such laboratory worker and the version of that composition. | Laboratory-worker identities; the execution attempts each carried out. |
| Dispatch-wave identity and start or release policy | The identity and version of the intended start or release policy, including whether dispatch is grouped into waves. | The dispatch waves in fact formed, their admitted members, and the release decisions in fact recorded. | Dispatch-wave identities; the admitted execution attempts each names under WP2-SCHED-011. |
| Queue, assignment, lease, heartbeat, and liveness policy identity and version | The identities and versions of the intended queueing, assignment, assignment-authority, heartbeat, and liveness policies. | The policies in fact applied, each identified and versioned, together with the liveness determinations recorded under WP2-SCHED-020. | Policy identities and versions; the assignment-authority grants and liveness determinations recorded under them. |
| Duplicate-delivery and restart policy identity and version | The identities and versions of the intended duplicate-delivery, restart, and recovery policies. | The duplicate deliveries resolved under WP2-SCHED-005, the restarts and recoveries in fact performed, and the policy identity and version applied to each. | Policy identities and versions; the execution attempts and laboratory workers affected. |
| Authoritative-commit policy identity and version | The identity and version of the intended authoritative-commit and race-resolution policy. | The policy in fact applied to each acceptance operation, and each race resolution recorded under WP2-SCHED-032. | Policy identities and versions; the planned runs and execution attempts whose acceptance it decided. |
| Host or runner class and execution-environment identity | The intended host or runner class and execution-environment identity, where either is relevant to the registered design, stated as class and version rather than as a vendor or instance. | The host or runner class and execution-environment identity that in fact carried each execution attempt, and the clock source and host association Section 11 requires where cross-host comparison matters. | Host or runner class identities; execution-environment identities and versions; the laboratory workers and execution attempts they carried. |
| Process, browser or headless, gateway, and inference-path topology | The intended topology of processes, browser or headless surfaces, gateways, and inference paths, stated as non-vendor architectural facts, where relevant to the registered design. | The topology in fact used for each execution attempt, and any respect in which it differed from the registered one. | Topology element identities; the execution attempts and model requests they served. |
| Provider, provider-project or nonsecret account scope, model, serving-provider, and route identity | The registered provider, the nonsecret identity of the provider-project or account scope, the model identity, the serving-provider identity, and the route identity, as far as the registered design fixes them. | The provider, nonsecret provider-project or account scope, model, serving provider, and route in fact used, recorded per model request or per the grouping the model-accounting contract defines. | Provider, project-scope alias or registered identity, model, serving-provider, and route identities; the model requests, execution attempts, and studies they served. |
| Local queue conditions and dispatch pressure | The intended local queueing arrangement and the conditions under which dispatch pressure is expected. | The observed local queue conditions and dispatch pressure, including observed local queue durations recorded in the local-queue-time domain of Section 11. | The waiting units; the dispatch waves and laboratory workers involved; the time-domain records. |
| Upstream latency, rate-limit, outage, and correlated-failure windows | The upstream conditions the registered design anticipates and any registered treatment of them. | The observed upstream latency, the rate-limit responses, outages, and correlated-failure windows in fact encountered, each attributed to the units affected and the window in which it occurred. | The affected model requests, execution attempts, studies, and route identities; the time-domain records. |
| Timeout, fallback, rejection, supersession, and cancellation behavior | The registered timeout, fallback, rejection, supersession, and cancellation behavior of the intended architecture, identified and versioned. | The timeouts, fallbacks, rejections, supersessions, and cancellations that in fact occurred, each identifying the time domain of the timeout under WP2-TIME-005 and the authority that recorded it. | The affected model requests, execution attempts, and planned runs; the policy identities applied. |
| Shared-resource identities, dependency policy, capacity constraints, and contention observations | The shared resources the registered design expects the study to use, the dependency policy governing them, and the capacity constraints the design assumes. | The shared resources in fact used, the contention in fact observed, and the units whose execution the contention affected. | Shared-resource identities; the isolation units and laboratory workers that used them; the contention observations and their time-domain records. |
| Registered policy controlling simultaneous attempts of one planned run | The identity and version of the registered scheduling policy WP2-SCHED-009 requires, and what it permits. | The simultaneous nonterminal execution attempts of one planned run that in fact existed, and the policy identity and version under which each was admitted. | The planned runs and execution attempts concerned; the scheduling-policy identity and version. |

**Rationale.** This table answers the Section 6.8 questions about what a profile contains and how it references dispatch waves, laboratory workers, execution attempts, and contention conditions, and the Section 6.5 laboratory-worker question about whether execution-agent composition is recorded as versioned provenance: it is, in the laboratory-worker category, as provenance recorded about the agent rather than as a version of the laboratory-worker identity, which the Section 6.5 entry states is not separately versioned. The shared-resource and contention category answers what the Section 7.2 rationale assigns here, namely the provenance of shared infrastructure and of contention: WP2-ISO-001 prohibits sharing from merging identities, treatments, state, evidence, or budget attribution, and this category is where the sharing and its observed effects are recorded so that a later analysis can see them. The categories are stated as architectural and policy facts rather than as vendor or product names, which is what lets a profile be reproduced or compared conceptually without this specification selecting a stack. Charter Section 10.3's own conceptual list — "execution architecture", "worker count", "start-wave or dispatch policy", "logical commit policy", "provider, project, and model identity", "local queue delay", "upstream latency", "rate-limit and failure windows", "fallback behavior", and "shared-world dependency policy, where applicable" — is covered by these fourteen categories, the charter's "worker count" being the laboratory-worker population this table's second category carries, and the shared-world dependency policy remaining out of scope for Work Package 2 under WP2-SCOPE-004.

### 10.6 Divergence between registered and observed execution

**WP2-SCHED-042.** A material divergence between a registered concurrency profile and the observed concurrency provenance of a unit executed under it **MUST** be recorded as a distinguishable deviation or violation, attributed to the units affected and retained for later disposition.

**WP2-SCHED-043.** A recorded divergence **MUST NOT** by itself change the registered condition, the registered treatment, the registered concurrency profile, or any other part of the registered design of the study in which it occurred.

**Rationale.** Together these keep a deviation visible and inert: it is written down, attributed, and left for a disposition that Section 14 defines, and it does not quietly become the study's new design. Charter Section 14.2 requires an execution-architecture or concurrency-profile change within one registered study to have been declared as a condition of the preregistered design, and charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed; a laboratory that reconciled a divergence by adjusting the registration would silently alter a registered record, which charter Section 14.2 prohibits. What counts as material, and what disposition a deviation or violation receives, are assigned to Section 14; what a deviation does to a study's completeness and to its reported result is assigned to Section 15.

### 10.7 Distinctness and explicit joining

**WP2-SCHED-044.** The registered concurrency-profile identity, the observed concurrency-provenance record, and the registered treatment identity **MUST** be recorded as three distinct identities or records, none of them standing in for another.

**WP2-SCHED-045.** The join among a registered concurrency profile, the observed concurrency provenance recorded against it, and the registered treatment of the unit that executed **MUST** be recorded explicitly at the time it is established, rather than reconstructed from naming, ordering, storage location, or timing.

**Rationale.** These three answer three different questions — what the study registered about its execution architecture, what execution in fact did, and what the study was testing — and a laboratory that merged any two of them would lose the ability to say whether an observed difference was registered, incidental, or a treatment effect. WP2-ID-023 already requires the lineage relationships of Section 6 to be recorded explicitly and read from the record; WP2-SCHED-045 states the same discipline for this join, which spans a registration, an execution record, and a design identity.

### 10.8 Sufficiency without vendor or stack selection

**WP2-SCHED-046.** A registered concurrency profile together with the observed concurrency provenance recorded against it **MUST** be sufficient to reconstruct and compare the execution architecture and contention conditions of an execution at the conceptual level of the categories in Section 10.5, without depending on a vendor, product, or stack identity beyond the provider, model, serving-provider, and route identities the ninth category of Section 10.5 itself requires.

**Rationale.** This states the sufficiency property the profile has to have while keeping the prohibition on stack selection intact. Sufficiency here is conceptual: the record has to let a later reader say what kind of architecture ran, under which policies, with what population, and against what contention, not to let that reader rebuild a deployment. A laboratory that in fact runs on a named product is not prohibited from recording that fact if its own registered design calls for it; what WP2-SCHED-046 requires is that the categories be reconstructible without any vendor dependence beyond the identities the ninth category itself records, so that a comparison across studies does not rest on a shared vendor.

### 10.9 Nonsecret identity where a secret would otherwise be exposed

**WP2-SCHED-047.** Where a provider-project identifier, an account identifier, or any other identifier required by Section 10.5 would expose secret material, the record **MUST** carry instead a nonsecret alias, digest, or registered identity that remains stable across the records that have to be joined by it.

**Rationale.** The category model needs the provider-project or account scope in order to attribute contention, rate limiting, and correlated failure correctly, and that scope is sometimes carried by a value that is itself sensitive. A stable nonsecret alias, digest, or registered identity preserves the join without carrying the secret. This requirement designs no secret boundary and selects no custody, injection, rotation, or redaction mechanism: WP2-ISO-025 already prohibits secret material made available to one isolation unit from becoming available to another as a consequence of shared infrastructure, and the security and secret boundary in general is assigned to Section 16.

### 10.10 Comparison of profiles

**WP2-SCHED-048.** Where a conforming laboratory compares two registered concurrency profiles, or a registered profile and an observed provenance record, the comparison **MUST** be made category by category over the content Section 10.5 requires, under a comparison rule that the comparison record identifies by identity and version.

**WP2-SCHED-049.** A conforming laboratory **MUST NOT** treat two executions as having occurred under the same execution architecture and contention conditions on the basis of profile identity, profile name, or policy name alone.

**Rationale.** These two answer the comparison-rule question the Section 6.8 register entry assigns here. Comparison is stated as an operation over recorded category content under a versioned rule, because a profile identity records what a study adopted rather than what two studies share, and because a later parity or replication analysis has to be able to say which categories agreed and which did not. What the comparison is used for is bounded by WP2-SCHED-050 and by Work Package 3's separate authorization; the statistical treatment of any such comparison is not specified here, and charter Section 10.4 records that no parity threshold or test is predeclared.

### 10.11 What a concurrency profile may never be cited as establishing

**WP2-SCHED-050.** A concurrency profile, an observed concurrency-provenance record, a comparison of either, or any throughput result **MUST NOT** be reported or cited as evidence of serial-versus-parallel behavioral parity, neutrality, or interchangeability.

**Rationale.** Charter Section 8.5 states that throughput does not establish scientific validity and that parallel execution is not presumed behaviorally neutral, and charter Section 10.4 requires parallel execution to earn behavioral use through a preregistered serial-versus-parallel parity study, which remains Work Package 3 and remains unauthorized. WP2-SCOPE-011 already prohibits reporting a conformance result under this specification as parity evidence; WP2-SCHED-050 extends the same prohibition to the profile and provenance records themselves and to any throughput figure derived from them, because those are the artifacts a reader would most naturally mistake for parity evidence.

### 10.12 Options deliberately left unselected

**Unselected option.** Profile record placement and encoding. The registered concurrency profile and the observed concurrency provenance may be carried in the study registration and evidence records, in separate documents, in an index, or in more than one of those. WP2-SCHED-035 and WP2-SCHED-039 state what has to be recorded and against which units; no schema, field structure, serialization, or store is selected, and Section 13 rather than this section decides where evidence is written.

**Unselected option.** Granularity of observed provenance. A laboratory may record observed provenance per execution attempt, per dispatch wave, per interval, or at a finer granularity, provided the per-attempt record WP2-SCHED-039 requires exists, each observation carries the attribution WP2-SCHED-040 requires, and a finer-grained observation is a record the per-attempt record references rather than a further observed concurrency-provenance record of the attempt. No granularity is preferred here.

**Unselected option.** Nonsecret-identity scheme. The alias, digest, or registered identity WP2-SCHED-047 requires may be realized by a registered mapping, a keyed digest, an authority-issued alias, or another scheme. No scheme is selected, and the secret boundary itself is assigned to Section 16.

**Unselected option.** Comparison rule. The versioned comparison rule WP2-SCHED-048 requires may weigh categories equally, may treat some categories as decisive, or may be specific to a registered design. No rule, weighting, tolerance, or equivalence class is selected, and no numeric tolerance is stated.

**Unselected option.** Architectural vocabulary. The non-vendor architectural facts of Section 10.5 may be described by a registered taxonomy, by structured attributes, or by another vocabulary. WP2-SCHED-046 states the sufficiency property; no vocabulary is selected.

### 10.13 Boundaries assigned to later chunks

This section states what a concurrency profile is, what it and the observed provenance have to contain, how they are joined, how they are compared, and what they may never be cited as establishing. It deliberately defines none of the following: the lifecycle values whose transitions the provenance records, which belong to Section 8; the scheduling, assignment, liveness, and commit mechanics whose policy identities the categories require, which belong to Section 9; the definitions and measurement rules of the time domains in which observed durations are recorded, which belong to Section 11; the model-request record, its accounting, and provider retry semantics, which belong to Section 12; evidence formats, inventory contents, packaging, sealing, and retention for these records, which belong to Section 13; what counts as a material divergence and what disposition a deviation or violation receives, which belong to Section 14; the effect of a deviation on study completeness and reporting, which belongs to Section 15; the secret boundary within which a nonsecret alias is issued and held, which belongs to Section 16; the conformance checks and fault injections for every requirement stated here, which belong to Section 17 and to the conformance document; and the design of any serial-versus-parallel parity comparison, which belongs to the separately authorized Work Package 3.

## 11. Time domains and logical-time integrity

### 11.1 What this section establishes

This section defines seven time domains, keeps them distinct, and states the integrity requirements that keep non-logical delay out of simulated causation while many independent runs and many independent studies execute at the same time. Charter Section 10.5 requires future evidence to distinguish logical simulation time, provider wall-clock time, and local queue time, and states that provider latency must not silently change simulated psychology or causality unless latency is explicitly part of the registered treatment; charter Section 14.5 requires the three to remain distinct. This section states those obligations as testable requirements and adds the four further domains that a concurrent laboratory has to keep apart from them. It completes what the Section 7.8 rationale assigns here — the time-domain rules beyond the isolation boundary WP2-ISO-013 and WP2-ISO-014 state — and it selects no clock, timing library, timestamp format, timeout value, or tolerance.

Section 11.2 states how the domain model is read and carries the requirement that makes it binding. Section 11.3 holds the seven domains. Sections 11.4 through 11.11 hold the remaining requirements. Section 11.12 records options deliberately left unselected, and Section 11.13 records what is assigned to later chunks.

Every substantive statement here is a Required future invariant carrying exactly one `WP2-TIME-###` identifier, a Design rationale, or an Unselected option, in the Section 4.3 sense, or else an entry of the domain model in Section 11.3, whose normative force flows through WP2-TIME-001 rather than through an identifier of its own, or a boundary statement in Section 11.13. This section names model-request stages only so far as is needed to keep the domains distinct; the complete model-request lifecycle and accounting contract are assigned to Section 12.

### 11.2 How the time-domain model is read

Each entry of the model states the same seven facts in the same order.

| Fact | What the entry states |
| --- | --- |
| Owning entity or record | The entity whose time the domain measures, and the record that carries the measurement. |
| Start boundary | The recorded event at which the measured interval begins. |
| End boundary | The recorded event at which the measured interval ends. |
| Clock or logical source | What the measurement is taken from, and whose it is. |
| May it affect simulation state | Whether the domain is permitted to influence the simulated world, its psychology, its causation, or decision eligibility. |
| Required lineage | The identities the measurement has to be attributable to. |
| Missing or unobservable treatment | What is recorded where a boundary or an interval is not observable. |

**WP2-TIME-001.** Every timing fact a conforming laboratory records **MUST** identify the time domain to which it belongs — one of the seven domains of Section 11.3, or a further domain or named stage the laboratory itself identifies and never merges into one of the seven — and, where it belongs to a domain of Section 11.3, conform to every clause of that domain's entry — its owning entity or record, start boundary, end boundary, clock or logical source, permitted effect on simulation state, required lineage, and missing or unobservable treatment — except only the specific question or clause that the entry expressly assigns to a later section, an exemption that reaches no other clause of that fact or entry.

**Rationale.** The domain model is stated as a register in the manner of Section 6, and WP2-TIME-001 is the single requirement that incorporates it and makes each clause binding, so that no individual table cell carries a requirement identifier of its own. Requiring every timing fact to identify its domain is what makes the rest of this section checkable: a duration with no domain cannot be tested against a start boundary, a clock source, or a rule about what it may influence. The seven domains are not exhaustive of everything a laboratory may measure: WP2-TIME-001 therefore requires a further measurement to identify the further domain or stage it belongs to rather than merging it into one of the seven, and the requirements of Sections 11.4 through 11.11 reach such a measurement so far as their terms apply to it.

### 11.3 The seven time domains

**Logical simulation time.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The deterministic engine of one independent simulated world, recorded in that world's authoritative event stream and canonical state under one execution attempt. |
| Start boundary | The first authoritative simulation event of that world under that execution attempt. |
| End boundary | The last authoritative simulation event of that world under that execution attempt. |
| Clock or logical source | Engine-owned logical time, advanced only by that world's authoritative simulation rules; charter Section 14.8 makes the engine final authority over objective world state, legal affordances, and committed consequences. No wall clock is a source of it. |
| May it affect simulation state | Yes, as the simulated world's own time; every other domain may affect simulation state only as WP2-TIME-004 permits. |
| Required lineage | The execution attempt; the planned run and study above it; the world or scenario identity and version; and the registered concurrency-profile identity and version. |
| Missing or unobservable treatment | Logical time is engine-owned and is not an unobservable external stage. A gap or contradiction in the recorded event stream is an evidence-integrity problem recorded under WP2-TIME-019 and dispositioned under Sections 13 and 14, and it is never filled by inference from a wall-clock record. |

**Local queue time.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The unit that waited under the laboratory's own scheduling or local inference path, recorded against that unit — an admitted execution attempt awaiting release, or a model request awaiting local dispatch. |
| Start boundary | The recorded event at which the unit became ready to proceed and began waiting: the recorded transition into Admitted for an execution attempt, and origination for a model request. |
| End boundary | The recorded event at which the wait ended: release, or the recorded transition into a terminal operational value where that precedes release, for an execution attempt, and local dispatch, refusal, or cancellation for a model request. Start is not an end boundary of this domain: WP2-TIME-021 fixes the execution-attempt end boundary, and a delay between release and start is recorded, where it is recorded at all, as the separately identified release-to-start stage or further domain WP2-TIME-021 requires rather than as part of local queue time. |
| Clock or logical source | A monotonic or equivalently safe duration basis under WP2-TIME-013, taken on the host that observed the wait, with that host and clock source recorded under WP2-TIME-015 where cross-host comparison matters. |
| May it affect simulation state | No, except as a preregistered treatment or condition difference under WP2-TIME-004. |
| Required lineage | The waiting unit; its execution attempt, planned run, and study; the owning laboratory worker where one is assigned; the dispatch wave where one applies; and the applicable registered concurrency-profile identity and version. |
| Missing or unobservable treatment | Recorded as unobserved or unavailable under WP2-TIME-010, never derived from provider latency, from a total interval, or from a neighboring timestamp. |

**Dispatch and transport time.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The model request, recorded against it. |
| Start boundary | The local dispatch event, for the outbound interval; the provider-completed event, for the inbound interval. |
| End boundary | The provider-accepted event, for the outbound interval; the local-response-received event, for the inbound interval. Each interval is recorded separately and only where its boundaries are observed. |
| Clock or logical source | A monotonic or equivalently safe duration basis on the dispatching host for the local boundaries; the provider's own reporting for a provider-side boundary, recorded as the provider's under WP2-TIME-015. Each interval of this domain spans one local boundary and one provider-side boundary, so it is recorded as a directly measured duration only where its two boundary marks rest on one common monotonic or equivalently safe basis; otherwise both stage facts are preserved and the interval is treated under WP2-TIME-022, and a provider timestamp is never substituted for a local clock mark, nor a local clock mark for a provider timestamp, under WP2-TIME-023. |
| May it affect simulation state | No, except as a preregistered treatment or condition difference under WP2-TIME-004. |
| Required lineage | The model request; the execution attempt, planned run, and study; the owning laboratory worker; the route identity; and the applicable registered concurrency-profile identity and version. |
| Missing or unobservable treatment | Where a provider-accepted or provider-completed boundary is not observable, the affected interval is recorded as unobserved or unavailable under WP2-TIME-010 and is never obtained by subtracting provider latency from a locally measured total or by inference from a neighboring timestamp. |

**Provider wall-clock latency.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The model request, recorded against it. |
| Start boundary | The provider-accepted event. |
| End boundary | The provider-completed event. |
| Clock or logical source | The provider's own reported timing, recorded as the provider's. A local timestamp is never substituted for a provider boundary. A provider-reported duration rests on the provider's clock and is recorded with its provenance under WP2-TIME-015 rather than measured under WP2-TIME-013. |
| May it affect simulation state | No, except as a preregistered treatment or condition difference under WP2-TIME-004, which is the exception charter Section 10.5 itself preserves for provider latency. |
| Required lineage | The model request; the execution attempt, planned run, and study; the deciding episode or decision the request serves; the provider identity; the serving-provider and route identities, which WP2-SCOPE-009 keeps distinct from the decision authority; and the applicable registered concurrency-profile identity and version. |
| Missing or unobservable treatment | Where the provider reports neither boundary, provider latency is recorded as unobserved or unavailable under WP2-TIME-010 rather than derived from local dispatch and receipt timestamps. |

**Laboratory-worker wall-clock runtime.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The execution attempt, recorded against it and attributed to its owning laboratory worker. |
| Start boundary | The recorded transition of the execution attempt into Starting, under the model in Section 8.6. |
| End boundary | The recorded transition of that attempt into Completed, Failed, or Cancelled, where the end mark of the measured interval was produced on the owning laboratory worker's own monotonic or equivalently safe basis, or on a common such basis that the start mark shares under WP2-TIME-013. A terminal transition whose end mark was not so produced — one recorded on a remote observation of the attempt, or recorded after the owning laboratory worker was lost, among them — closes the attempt's operational lifecycle and not this measured interval, and is treated under this entry's missing-or-unobservable clause and WP2-TIME-023. |
| Clock or logical source | A monotonic or equivalently safe duration basis on the host of the owning laboratory worker, with that host or runner identity and clock source recorded under WP2-TIME-015. No mark resting on a basis the start mark does not share closes this measured interval, under WP2-TIME-023. |
| May it affect simulation state | No, except as a preregistered treatment or condition difference under WP2-TIME-004. |
| Required lineage | The execution attempt; the owning laboratory worker; the planned run and study; the host or runner identity; and the applicable registered concurrency-profile identity and version. |
| Missing or unobservable treatment | Where no end mark produced on the basis this interval identifies exists — because the worker was lost, or because the terminal transition rests on a remote observation — the measured runtime remains open-ended and is recorded with an unobserved end boundary under WP2-TIME-010, with the loss or the remote observation named as the reason; the attempt's recorded terminal disposition is the one the applicable requirements of Sections 8 and 9 require, and where the loss followed a process or orchestrator restart, WP2-LIFE-021 separately requires one. A remote terminal observation is recorded as its own separately identified fact and never becomes the missing end mark, under WP2-TIME-023, and any remote estimate or bound of the runtime is a separately identified derived estimate carrying the facts WP2-TIME-022 requires. |

**Finalization time.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The execution attempt's finalization record. |
| Start boundary | The recording of Finalization in progress for that attempt, under the model in Section 8.6, which WP2-LIFE-033 pairs with the attempt's operational transition into Finalizing; where a Finalization failed result is recorded with no Finalization in progress recording, in the departure case the Finalization failed entry states, this interval is unmeasured. |
| End boundary | The recording of Finalization succeeded or Finalization failed for that attempt. |
| Clock or logical source | A monotonic or equivalently safe duration basis on the host of the finalizing authority, with that host and clock source recorded under WP2-TIME-015. A finalization-time interval whose start and end marks do not rest on one common such basis — as where the attempt's operational departure from Finalizing through Failed or Cancelled is recorded by another authority on another host — is treated under WP2-TIME-022 rather than reported as a directly measured duration. |
| May it affect simulation state | No. Finalization follows the end of execution activity, and no finalization delay is a permitted influence on the simulated world. |
| Required lineage | The execution attempt; its run evidence root; the planned run and study; the finalizing authority; the host or runner identity; and the applicable registered concurrency-profile identity and version. |
| Missing or unobservable treatment | An interrupted finalization is recorded with an unobserved end boundary under WP2-TIME-010, and the interruption is preserved rather than closed by a later inferred timestamp. An interval the start-boundary clause leaves unmeasured is recorded as unavailable under WP2-TIME-010, naming the absence of a Finalization in progress recording as the reason. |

**Study-level elapsed time.**

| Fact | Statement |
| --- | --- |
| Owning entity or record | The study, recorded against its own record. |
| Start boundary | The exact study-level start event that the study's registration identifies, named by event identity under WP2-TIME-012. |
| End boundary | The exact study-level end event that the study's registration or its completion record identifies, named by event identity under WP2-TIME-012. What makes a study complete is assigned to Section 15. |
| Clock or logical source | A monotonic or equivalently safe duration basis where a duration is reported, together with separately recorded wall-clock instants where human-readable instants are needed, each with its clock source and host recorded under WP2-TIME-015. A study-level duration whose start and end marks do not rest on one common such basis is treated under WP2-TIME-022 rather than reported as a directly measured duration, any estimate or bound of it being a separately identified derived estimate carrying the facts WP2-TIME-022 requires. |
| May it affect simulation state | No. |
| Required lineage | The study identity and version; the registration identity; the planned runs and execution attempts falling within the interval; and every registered concurrency-profile identity and version under which the study executed. |
| Missing or unobservable treatment | Where a boundary event is not recorded, the elapsed time is recorded as unavailable under WP2-TIME-010 rather than derived from the earliest or latest timestamp found anywhere in the study's evidence. |

### 11.4 Engine-owned logical time

**WP2-TIME-002.** Logical simulation time **MUST** be owned by the deterministic engine of the independent simulated world it belongs to and advance only through that world's authoritative simulation rules.

**WP2-TIME-003.** A delay in queueing, dispatch, transport, provider processing, laboratory-worker execution, or finalization **MUST NOT** advance logical simulation time, alter simulated psychology, create a causal event, change decision eligibility, or change expiry or supersession behavior in a simulated world, otherwise than as WP2-TIME-004 permits.

**WP2-TIME-004.** Any intended effect of a non-logical delay on simulated state **MUST** be a preregistered treatment or condition difference of the study's registered design whose causation is engine-owned and explicitly recorded.

**Rationale.** Charter Section 10.5 states that provider latency must not silently change simulated psychology or causality unless latency is explicitly part of the registered treatment, and charter Section 14.8 makes the deterministic engine final authority over objective world state, legal affordances, and committed consequences. WP2-TIME-003 states the prohibition over every non-logical domain rather than provider latency alone, because a concurrent laboratory introduces queueing, dispatch, transport, and finalization delays that a serial one largely does not, and any of them could reach the simulation through the same route. WP2-TIME-004 states the exception charter Section 10.5 preserves and bounds it: an intended latency effect is registered before execution and is caused by the engine under its own rules, so that it is a treatment rather than an artifact. WP2-ISO-013 separately keeps the logical clock and authoritative event stream of one independent simulated world isolated from every other one's.

### 11.5 Timeouts, expiry, freshness, and stop conditions

**WP2-TIME-005.** Every timeout, expiry, freshness test, and stop condition a conforming laboratory applies **MUST** identify the time domain in which it is evaluated.

**WP2-TIME-006.** A conforming laboratory **MUST NOT** infer the expiry of a logical-tick deadline from a wall-clock duration in any domain.

**WP2-TIME-007.** A conforming laboratory **MUST NOT** record or report a wall-clock timeout as a logical expiry or as a logical supersession.

**Rationale.** A deadline is meaningless without its domain: "expired" can mean that a simulated world advanced past a logical tick, that a request waited longer than a wall-clock bound, or that a laboratory worker stopped reporting, and the three have entirely different consequences for the evidence. Section 5.6 records that the repository's engine already emits an expiry tick on its decision requests and records accepted, expired, and superseded resolutions, while Section 5.5 records that its attempt-level watchdogs convert an exceeded wall clock and an unchanging simulation tick into two separately typed failure classes; those are observations about the current system rather than requirements, and WP2-SCOPE-010 keeps them from being read as requirements. What WP2-TIME-006 and WP2-TIME-007 prohibit is the substitution of one domain's verdict for the other's, in either direction.

### 11.6 Keeping the domains and the model-request stages distinct

**WP2-TIME-008.** A conforming laboratory **MUST NOT** record or report the interval of one time domain of Section 11.3 as, or as part of, the interval of another, or present a derived interval without recording that it was derived and the recorded intervals or recorded instants, with the clock or logical source of each, from which it was derived, together with, where the derivation spans more than one clock, the facts WP2-TIME-022 requires of an explicit derived estimate.

**WP2-TIME-009.** Where a conforming laboratory records the timing of a model request, the provider-accepted, provider-completed, local-response-received, response-validated, and simulation-accepted stages **MUST** be recorded as separately identified stage facts rather than represented by one timestamp or one interval.

**WP2-TIME-021.** The local-queue-time interval of an admitted execution attempt **MUST** end at the recorded transition of that attempt into Released, or at the recorded transition of it into a terminal operational value where that transition precedes release, and at no other recorded event, any delay between the recorded transition into Released and the recorded transition into Starting being recorded, wherever a conforming laboratory records it at all, as a separately identified named stage or further domain under WP2-TIME-001 rather than as part of local queue time or of any other domain of Section 11.3.

**Rationale.** Local queue time measures waiting under the laboratory's own scheduling and local inference path, dispatch and transport time measures the intervals on either side of the provider's processing, and provider wall-clock latency measures the provider's processing itself; a laboratory that reports one number for all three cannot tell a slow provider from a saturated local queue, and charter Section 14.5 requires the provider queueing, rate-limit, correlated-failure, local-queueing, fallback, timeout, rejection, supersession, scheduling, and commit behavior to be observable where relevant. WP2-TIME-008 permits a derived interval and requires the derivation to be visible, so that a subtraction is never mistaken for an observation. WP2-TIME-009 names the five model-request stages solely to keep the domains apart at their boundaries; the complete request lifecycle, the placement of these records, their accounting, and provider retry semantics are assigned to Section 12, and Section 5.6 records that the gateway record separates no provider-accepted stage from a provider-completed one. WP2-TIME-021 fixes one end boundary for the execution-attempt half of local queue time because release and start are distinct recorded events under Sections 8.3 and 9.2, and a domain whose interval could end at either of them would carry two different quantities under one name — a defect no comparison rule can repair, because the mismatch lies in the underlying measurement rather than in its treatment. The delay between release and start is a real and separately meaningful quantity; recording it as a separately identified named stage or further domain keeps it observable without folding a post-release delay into a domain that measures waiting for release.

### 11.7 Unobservable and missing stages

**WP2-TIME-010.** Where a stage boundary or an interval that Section 11.3 requires is not observable, the record **MUST** state that it is unobserved or unavailable, together with the reason where one is known.

**WP2-TIME-011.** A conforming laboratory **MUST NOT** infer an unobservable stage boundary or interval from a neighboring recorded timestamp, from a locally measured total, or from a value observed for another unit.

**Rationale.** An unobservable provider stage is a fact about what the evidence can support, and recording it as such keeps a later analysis from treating an inferred boundary as a measured one. The alternative is quietly corrosive: filling a missing provider-accepted timestamp with the local dispatch timestamp makes transport time appear to be zero and provider latency appear to include the network, and nothing in the record afterwards says so. Charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed, and charter Section 12.10 lists provider and local latency, queue delay, and evidence completeness among the operational diagnostics that support interpretation and reproducibility rather than defining believable behavior, and records that operational differences may confound a comparison if they change fallback, timing, or evidence coverage; a diagnostic that conceals the limits of its own coverage cannot do either.

### 11.8 Measuring durations and recording instants

**WP2-TIME-012.** The laboratory-worker wall-clock runtime, the finalization time, and the study-level elapsed time of any unit **MUST** each name the exact start and end event identities between which they were measured.

**WP2-TIME-013.** Every duration a conforming laboratory measures on its own hosts **MUST** be measured on a monotonic basis, or on a basis that is safe against clock adjustment to an equivalent degree, that the record itself identifies and that both of its boundary marks share, an interval whose two boundary marks do not rest on one such common basis being treated under WP2-TIME-022 rather than recorded as a measured duration.

**WP2-TIME-014.** A human-readable wall-clock instant **MUST** be recorded separately from the duration measurement of the same interval, rather than substituted for it or derived from it.

**Rationale.** Naming the exact events is what makes two recorded runtimes comparable: an interval whose boundaries are described only as "when the attempt started" cannot be checked against the transition record that WP2-LIFE-013 requires. WP2-TIME-013 states a property rather than a mechanism, because a monotonic source is one way to be safe against a clock adjustment and not the only one; the requirement asks of one locally measured duration that it rest on such a basis, that both of its boundary marks share that one basis, and that the record name which basis that was, and no timing library, resolution, or unit is selected. A provider-reported duration is not measured by the laboratory and is recorded with its clock provenance under WP2-TIME-015, and an interval whose two boundaries rest on different clocks is not a laboratory-measured duration at all: it is treated under WP2-TIME-022, preserved as its two boundary facts and recorded as unobserved or unavailable, or recorded as an explicit derived estimate under WP2-TIME-008 with the facts WP2-TIME-022 requires, because subtracting marks taken from clocks with unrelated epochs or an unknown offset is not a monotonic measurement. Wall-clock instants remain necessary for human reading and for correlation with external records, and keeping them separate from the measured duration is what keeps a clock adjustment from silently changing a duration after the fact.

### 11.9 Clock provenance and cross-host comparison

**WP2-TIME-015.** Where timing records from more than one host are compared, joined, or reported together, the clock source, the host or runner association, and any material synchronization uncertainty of each such record **MUST** be recorded and attributable to it, together with the offset or synchronization basis relied upon in comparing or joining them, recorded against the comparison.

**WP2-TIME-016.** Wall-clock ordering across hosts **MUST NOT** be used as a causal relation, an identity join, or an authoritative tie-break.

**WP2-TIME-022.** A wall-clock interval that a conforming laboratory itself reports, other than a provider-reported duration, or an interval between two provider-reported boundary marks of one provider clock, each recorded as the provider's under WP2-TIME-015, whose two boundary marks do not rest on one common monotonic or equivalently safe basis **MUST** be recorded as unobserved or unavailable, in the manner WP2-TIME-010 requires, with both of its boundary stage facts preserved separately, or as an explicit derived estimate identifying the source records of both boundaries, the clock source and host or runner identity of each, the offset or synchronization basis relied upon, and any material uncertainty of the estimate, rather than reported as a directly measured duration.

**WP2-TIME-023.** A conforming laboratory **MUST NOT** substitute a timestamp or observation produced on one clock or host for a missing boundary mark of a measured duration whose identified basis belongs to another — a provider timestamp for a local clock mark, a local clock mark for a provider timestamp, or a remote terminal observation of an execution attempt for the runtime end mark its owning laboratory worker never produced — or close, on the strength of such a substitution, a measured interval that its own identified basis leaves open-ended, unobserved, or unavailable.

**Rationale.** Two hosts' clocks agree only to within their synchronization, and a concurrent laboratory that compares their timestamps without recording that uncertainty produces orderings it cannot defend. WP2-ISO-014 already prohibits wall-clock order from serving as an implicit causal relation, ordering guarantee, or identity join between isolation units; WP2-TIME-016 prohibits cross-host wall-clock ordering as a causal relation or identity join whether the use is implicit or explicit, and adds the authoritative tie-break, which WP2-SCHED-033 separately prohibits for competing operations on one planned run. What WP2-TIME-015 requires is not a synchronization mechanism but the provenance that makes a comparison defensible, and Section 11.12 records the mechanism as unselected. WP2-TIME-022 draws the consequence for a single reported number: subtracting two marks taken from clocks with unrelated epochs or an unknown offset is not a measurement, however plausible the result looks, so an interval spanning two clocks is grounded on one common safe basis, reduced to its two preserved boundary facts, or reported as what it is — a derived estimate whose sources, clocks, offset or synchronization basis, and material uncertainty are on the record. WP2-TIME-023 closes the remaining substitution route: a remote observation answers when an observer learned of an event rather than when the event occurred on the clock whose mark is missing, and a laboratory that let the first stand in for the second would manufacture a measured duration no clock produced — which is why the laboratory-worker runtime entry keeps a remote terminal observation as its own recorded fact and leaves the measured runtime open-ended without it. Neither requirement selects a synchronization protocol, tolerance, or clock product, and WP2-SCOPE-015 continues to prohibit selecting one.

### 11.10 Impossible timing records

**WP2-TIME-017.** A negative, discontinuous, contradictory, or otherwise impossible timing record **MUST** be preserved exactly as recorded.

**WP2-TIME-018.** A conforming laboratory **MUST NOT** silently normalize, clamp, correct, reorder, or discard a timing record that WP2-TIME-017 requires to be preserved.

**WP2-TIME-019.** A timing record that WP2-TIME-017 requires to be preserved **MUST** be surfaced as a distinguishable typed integrity problem attributed to the units and the time domains it concerns, and retained for later disposition.

**Rationale.** An impossible timing record is evidence that something in the measurement path is wrong, and a laboratory that clamps a negative duration to zero destroys exactly the signal that would have shown it. Charter Section 14.9 requires evidence loss, mutation, collision, adoption, or incomplete finalization to be treated as an explicit failure rather than concealed, and charter Section 12.10 records that operational differences can confound a comparison if they change timing or evidence coverage. The vocabulary of integrity problems and their dispositions is assigned to Section 14, and how such a record is preserved within an evidence root is assigned to Section 13; WP2-TIME-019 requires only that the problem be distinguishable, attributed, and retained.

### 11.11 Attribution of timing evidence

**WP2-TIME-020.** Every timing record a conforming laboratory retains **MUST** be attributable to the study, the planned run, the execution attempt, the laboratory worker, the model request or the deciding episode or decision it serves, and the registered concurrency profile to which it applies, naming each of those that applies and stating the absence of any that does not.

**Rationale.** Timing evidence that cannot be joined to the unit it describes is unusable for the comparative, long-horizon research the charter describes, and under concurrency it is actively misleading, because a duration observed while other units contended for the same resources means nothing without knowing which units those were. WP2-ISO-017 already requires every retained log or diagnostic record to carry explicit attribution to each entity of the Section 6 register whose activity it describes; WP2-TIME-020 states the corresponding obligation for timing records and adds the concurrency profile, so that a later analysis can relate an observed duration to the execution architecture and contention conditions under which it was observed. Stating the absence of an inapplicable identity, rather than omitting it, keeps an unattributed record distinguishable from one whose attribution does not apply — a timing record about a laboratory worker with no execution attempt assigned to it, for instance.

### 11.12 Options deliberately left unselected

**Unselected option.** Duration basis. The monotonic or equivalently safe basis WP2-TIME-013 requires may be a platform monotonic counter, a steady clock, a sequence of authority-issued marks, or another arrangement. No library, counter, resolution, or unit is selected.

**Unselected option.** Timestamp and instant representation. The wall-clock instants WP2-TIME-014 requires to be recorded separately may be represented in any calendar, precision, or encoding the evidence contract later adopts. No format, epoch, precision, or time zone is selected, and Section 13 rather than this section decides how evidence is written.

**Unselected option.** Clock synchronization. The synchronization uncertainty WP2-TIME-015 requires to be recorded may be established by a network time protocol, an authority-issued reference, a measured offset, or another arrangement. No protocol, service, or tolerance is selected, and WP2-SCOPE-015 prohibits selecting a numeric operating parameter.

**Unselected option.** Timing-record placement. The timing facts this section requires may be carried on the record of the unit measured, in a separate timing record, in an event stream, or in more than one of those. WP2-TIME-020 states the attribution property; no placement or join key is selected, and the placement of model-request records is assigned to Section 12.

**Unselected option.** Timeout values and stop conditions. Which timeouts, expiries, freshness tests, and stop conditions a laboratory applies, and at what values, are unselected. WP2-TIME-005 requires only that each identify its domain, and WP2-SCOPE-015 prohibits this specification from selecting a duration, threshold, or bound.

### 11.13 Boundaries assigned to later chunks

This section states which time domains exist, what each measures, what may and may not influence simulated causation, and how timing evidence is measured, attributed, and preserved. It deliberately defines none of the following: the lifecycle transitions whose events serve as domain boundaries, which belong to Section 8; the scheduling, assignment, and commit mechanics whose intervals these domains measure, which belong to Section 9; the concurrency-profile categories under which observed durations are recorded, which belong to Section 10; the complete model-request lifecycle, the placement of request records, provider retry semantics, budget reservation, and token or monetary accounting, which belong to Section 12; the evidence format, inventory, replay, and retention of timing records, which belongs to Section 13; the typed vocabulary of the timing-integrity problems WP2-TIME-019 requires to be surfaced, which belongs to Section 14; the study-completion rules that fix a study's end boundary, which belong to Section 15; and the conformance checks, fault injections, and pass conditions for every requirement stated here, which belong to Section 17 and to the conformance document.

## 12. Model-request accounting, budgets, and provider behavior

Scope note: This section will define future model-request identity, accounting, budget, and provider-behavior boundaries.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 5 and is not authorized in Chunk 1.

## 13. Evidence roots, replay, finalization, and sealing

Scope note: This section will define future evidence roots and distinguish replay, finalization, and sealing concepts.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 6 and is not authorized in Chunk 1.

## 14. Failure, cancellation, retry, resume, and replacement

Scope note: This section will distinguish future failure, cancellation, retry, resume, and replacement concepts and their evidence consequences.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 6 and is not authorized in Chunk 1.

## 15. Study aggregation and completion

Scope note: This section will define future study-level aggregation and completion semantics.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 6 and is not authorized in Chunk 1.

## 16. Security and secret boundaries

Scope note: This section will define future security and secret-handling boundaries without selecting a provider or deployment topology.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 5 and is not authorized in Chunk 1.

## 17. Conformance model

Scope note: This section will define the relationship between normative requirements and conceptual conformance checks.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 7 and is not authorized in Chunk 1.

## 18. Implementation handoff and unselected options

Scope note: This section will define the future implementation handoff boundary and record options intentionally left unselected.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 7 and is not authorized in Chunk 1.

## 19. Work Package 3 dependency

Scope note: This section will state the dependency boundary between the completed Work Package 2 specification and any separately authorized Work Package 3 activity.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 7 and is not authorized in Chunk 1.

## 20. Acceptance criteria

Scope note: This section will state the future acceptance criteria for the completed Work Package 2 specification package.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 7 and is not authorized in Chunk 1.

## 21. Open questions and later rulings

Scope note: This section will record unresolved questions and later rulings without silently resolving them in earlier sections.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 7 and is not authorized in Chunk 1.
