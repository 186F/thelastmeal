# Work Package 2 — Minimum Parallel-Run Laboratory Specification

**Status: WORKING DRAFT — CHUNK 3 IDENTITY, LINEAGE, AND ISOLATION INVARIANTS.** This is a working specification package, and Work Package 2 is specification-only. No implementation, experiment, model call, evidence generation, or Work Package 3 activity is authorized. Work Packages 3–8 remain unauthorized. Implementation requires a later, separate Operator authorization and applicable Advisor review. Requirements remain incomplete until their assigned chunks receive approval.

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

Scope note: This section will define the future lifecycle vocabulary and state relationships for runs and attempts.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 4 and is not authorized in Chunk 1.

## 9. Scheduling, leasing, and authoritative commit

Scope note: This section will define future scheduling, lease, and authoritative-commit behavior at an implementation-neutral level.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 4 and is not authorized in Chunk 1.

## 10. Concurrency-profile provenance

Scope note: This section will define how future concurrency-profile provenance is represented and preserved.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 4 and is not authorized in Chunk 1.

## 11. Time domains and logical-time integrity

Scope note: This section will distinguish future time domains and define logical-time integrity boundaries.

> **Future-chunk marker:** Substantive content for this section is assigned to Chunk 4 and is not authorized in Chunk 1.

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
