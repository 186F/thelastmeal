# Milestone 002 Scope Ruling and Required Brief Amendments

**Date:** July 30, 2026  
**To:** Coding Agent  
**From:** Project Advisor  
**Repository:** `186F/thelastmeal`  
**Status:** Authoritative scope ruling for amendment of the Milestone 002 implementation brief  
**Affected brief:** [`MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md)

---

# 1. Executive directive

The coding agent’s proposed additions are **mostly approved**, but they must not be incorporated wholesale.

Milestone 2 remains an **instrumentation-and-sparse-cognition experiment**, not a general repair or feature milestone. Its purpose is to:

1. Build a deterministic behavioral-evaluation laboratory.
2. Automate unattended live-run execution and evidence production.
3. Measure repeat-run variance and biography sensitivity.
4. Implement and evaluate bounded, reusable policy patches against a per-decision model comparator.
5. Preserve the frozen Milestone 1 and Vertical Slice 001 records.

The following disposition is authoritative:

| Item | Ruling |
| --- | --- |
| R1 — Headless live-run harness | **Include; centerpiece of the laboratory** |
| R2 — Repeat-run variance baseline | **Include as a calibration study** |
| R3 — Biography-sensitivity metric | **Include, with a narrower hypothesis** |
| R4 — Affordance-space auditor | **Include with an explicit known-gap registry** |
| R5 — Commitment-layer repair | **Exclude from Milestone 2; defer to Vertical Slice 002** |
| R6 — Blinded evaluation extended to live runs | **Include as non-gating instrumentation** |
| R7 — Rationale bound and confidence semantics | **Include rationale repair; remove confidence from control semantics** |
| R8 — Study pre-registration | **Include; mandatory for every collected dataset** |
| R9 — `liveSmoke.ts` shutdown race | **Include as a small maintenance fix** |

The Milestone 2 implementation brief must be amended before implementation begins.

Because no Milestone 2 source work or live data collection has begun, these amendments remain within:

```text
M2_EXPERIMENT_ID = sparse-cognition-policy-001
M2_EXPERIMENT_VERSION = 1.0.0
Target package release = 1.7.0
```

No M2 experiment-version bump is required for this pre-implementation scope amendment.

---

# 2. Governing scientific baseline

Milestone 1 demonstrated a rigorous, replayable control plane for model-driven NPC behavior. It did **not** establish a statistically generalizable behavioral result.

The correct baseline is:

> Milestone 1 produced a strong systems result, a valid live integration result, and useful descriptive behavioral evidence—including a behaviorally weak B1/B2 memory effect—but only one formal run per condition.

Do not describe Milestone 1 as having established that biography does not affect model behavior. It established only that the tested memory intervention did not materially alter behavior in the single observed matched pair.

Milestone 2 should convert those descriptive findings into repeatable measurements.

---

# 3. R1 — Repository-native unattended live-run harness

## 3.1 Ruling

**Approved. This is the centerpiece of the laboratory.**

The user must be able to launch a study with one command and leave the computer unattended. The authoritative runner must be repository-native Playwright/Chromium automation.

Claude Code, Chrome DevTools, MCP browser tools, or another conversational agent may supervise, inspect failures, and invoke resume operations. They may not be the only execution path and may not make experimental decisions.

## 3.2 Required execution path

The unattended runner must automate the same operator path used manually in Milestone 1:

```text
preflight
  ↓
start fixed-port Vite process
  ↓
start fresh gateway process
  ↓
launch isolated Chromium context
  ↓
select registered scenario and condition
  ↓
assert 1× speed
  ↓
start live run
  ↓
monitor logical time and gateway state
  ↓
wait for terminal state and settled client
  ↓
export ledger and run bundle
  ↓
replay latest and require a hash match
  ↓
stop gateway
  ↓
model:prepare-run
  ↓
strict model:finalize
  ↓
behavioral evaluation
  ↓
threshold verdict
  ↓
preserve evidence and sequence state
```

## 3.3 Required guardrails

The harness must:

- Start a **fresh gateway process for every model-backed attempt**.
- Use a fresh browser context and page for every attempt.
- Run attempts sequentially, never concurrently.
- Use the existing per-run and process-wide call caps.
- Refuse to start when the plan’s worst-case call budget exceeds the acknowledged budget.
- Preserve failed and abandoned attempts rather than deleting or overwriting them.
- Keep the API key inside the gateway process only.
- Never parse, print, export, or copy the API key into browser automation state.
- Secret-scan the completed evidence package.
- Maintain an atomic, resumable `sequence-state.json` outside the tracked repository.
- Capture screenshots, DOM state, browser traces, console errors, process logs, and heartbeat state for every failed attempt.
- Fail rather than silently switch ports, models, providers, prompts, speeds, conditions, or thresholds.

## 3.4 Pacing ruling

Formal live evidence must run at:

```text
speed = 1×
```

Accelerated execution may be used for:

- unit tests,
- fake-adapter rehearsals,
- deterministic headless tests,
- synthetic policy-interpreter benchmarks,
- non-evidentiary development runs.

No accelerated live run may enter a behavioral study until a separately pre-registered pacing-comparability study demonstrates that the alternate pace preserves the relevant race, latency, supersession, and fallback semantics.

## 3.5 Initial unattended acceptance test

Before using the harness for R2 or the formal M2 sequence, it must complete this three-run unattended acceptance:

```text
1. Scenario A — deterministic baseline — gateway off
2. Scenario A — M2 per-decision condition — live gateway
3. Scenario A — M2 policy-patch condition — live gateway
```

The two model-backed runs must:

- strict-finalize as `completed`,
- replay exactly,
- produce complete evidence bundles,
- record the pinned model and provider,
- use no manual browser interaction after launch,
- create no secret-bearing artifact.

The gateway-stop path must first be demonstrated keylessly and then included in the formal M2 sequence.

## 3.6 Secret boundary

The orchestrator must not read `.env.gateway` itself. It may spawn the gateway process, which remains the only component responsible for reading live credentials.

---

# 4. R2 — Repeat-run variance baseline

## 4.1 Ruling

**Approved as a calibration study, not as a Milestone 2 acceptance gate.**

The first live study executed through the unattended harness should measure how behaviorally different Mara is from herself under an identical observable configuration.

## 4.2 Required pre-registration

Create a tracked study plan equivalent to:

```text
study ID: m2-calibration-variance-a-001
study version: 1.0.0
status: calibration
scenario: A
seed: 1001
condition: mara-model-per-decision-m2-v1
n: 10 valid primary runs
speed: 1×
model: pinned
provider: pinned
prompt: pinned
repository SHA: pinned for the study
```

Failed attempts remain part of the evidence archive but do not count toward `n` unless the study plan explicitly defines them as primary observations.

## 4.3 Required metrics

Produce at least:

- Pairwise behavioral-fingerprint similarities and distances.
- Median, p10, p25, p75, and p90 composite similarity.
- Tick and semantic context of first divergence.
- Action-category entropy.
- Action-mode entropy.
- Transition entropy.
- Task, commitment, meal, treatment, and violation outcome frequencies.
- Upstream calls attempted and completed.
- Accepted-model coverage.
- Latency distribution.
- Token distribution.
- Rationale-normalization frequency.
- Returned-model and serving-provider consistency.

## 4.4 Matched-decision rule

Decision opportunities are directly comparable only while both runs share the same:

- semantic world context,
- relevant beliefs and memories,
- current activity state,
- offered-affordance descriptors,
- hard-dependency fingerprint.

After the first behavioral divergence, later ordinal decisions must not be treated as though they remain naturally matched.

After divergence, use:

- trajectory-level behavioral fingerprints,
- outcome distributions,
- event-sequence alignment where explicitly valid,
- semantic context matching rather than raw ordinal matching.

## 4.5 Change-control consequence

R2 may reveal that the formal behavioral-similarity thresholds are poorly calibrated. It may **not** be used to silently alter the existing M2 thresholds.

Any threshold or similarity-formula change after observing R2 data requires:

- a new metric version when the formula changes,
- a new M2 experiment version when formal acceptance thresholds change,
- a repeated pilot before formal M2 data collection.

---

# 5. R3 — Biography-sensitivity metric

## 5.1 Ruling

**Approved, with a narrower hypothesis.**

Do not register:

> No biography input moves model behavior.

Instead register:

> Does between-condition behavioral separation caused by the B1/B2 criticism-memory ablation exceed Mara’s ordinary within-condition behavioral variation?

## 5.2 Required comparison

Evaluate:

```text
B1 versus B2 distance
    compared with
A versus A repeat-run distance
B1 versus B1 repeat-run distance
B2 versus B2 repeat-run distance
```

The deterministic provider’s B1/B2 effect may be included as a reference scale, but it is not psychological ground truth. The deterministic provider was intentionally designed to respond to the memory intervention.

## 5.3 Required causal distinction

For every B1/B2 matched pair, separately report whether the memory changed:

1. The model or compiler input.
2. The compiled policy structure.
3. The locally selected policy rule.
4. The selected affordance.
5. The accepted action.
6. The final consequential outcome.

Do not infer one level from another.

## 5.4 Scope limit

Use the existing B1/B2 intervention and the matched replicates already included in the M2 formal plan.

Do not add a family of new memories or biography scenarios to Milestone 2. Additional biography interventions belong in separately registered studies after the laboratory exists.

## 5.5 Status

Biography sensitivity remains exploratory in Milestone 2. A null result does not fail the milestone.

---

# 6. R4 — Affordance-space and interruption-contract auditor

## 6.1 Ruling

**Approved, with an explicit known-gap registry.**

The auditor must not make CI permanently red merely by rediscovering already documented VS001 limitations.

## 6.2 Commitment lifecycle contracts

Do not implement the overly broad rule:

> Every commitment role must always have a compliance affordance.

Each commitment type must instead declare a machine-readable lifecycle contract containing concepts such as:

```text
fulfillment recognition:
  automatic | explicit-response

renegotiation:
  forbidden | unilateral | target-response-required

prevention or waiver:
  applicable | not-applicable

required response modes:
  [accept, decline, counter, ...]
```

The auditor checks whether generated affordances and event transitions satisfy the declared contract.

## 6.3 Affordance coverage checks

At minimum, audit:

- Required response affordances for the actual target of a pending proposal.
- Registered commitment lifecycle exits.
- Registered dilemma checkpoints.
- At least two **consequentially distinct lawful exits** for each registered dilemma.
- The absence of generated response modes that no legal transition can consume.
- The absence of lifecycle states that cannot legally resolve.

Syntactically distinct wait variants do not count as distinct exits unless they produce meaningfully different consequences.

## 6.4 Interruption-contract checks

Every action mode must declare:

- ordinary interruptibility,
- whether the actor may voluntarily preempt it,
- world-event interruption classes,
- target-departure behavior,
- target-incapacity behavior,
- resource-loss behavior,
- scenario-end behavior.

The auditor and tests must prove actual engine behavior matches the declaration.

The term `non-interruptible` must have one precise engine meaning. It may not remain only a presentation label.

## 6.5 Known-gap registry

Add a versioned VS001 known-gap registry with fields equivalent to:

```text
knownGapId
affectedScenario
affectedMechanic
expectedFinding
sourceMilestone
exactMatchCriteria
plannedResolution
```

CI behavior must be:

```text
Known finding matching the registry exactly:
  report as known limitation; do not fail

New unregistered gap:
  fail

Known gap changes shape, severity, or affected scope:
  fail

New M2 mechanic lacks required coverage:
  fail
```

The current VS001 proposal-response and treatment-movement limitations must be registered rather than silently fixed in Milestone 2.

---

# 7. R5 — Commitment-layer repair

## 7.1 Ruling

**Rejected from Milestone 2.**

The diagnosis may be valid, but the proposed repair is not merely instrumentation. It would change:

- canonical commitment semantics,
- event streams,
- beliefs,
- relationship consequences,
- subsequent decisions,
- world-state hashes,
- ledger hashes,
- accepted historical outcomes.

That would confound the sparse-cognition comparison by changing the world model at the same time as the decision architecture.

## 7.2 Governance ruling for Q1

Create a new future vertical slice rather than changing VS001:

```text
Vertical Slice 002 — Social Causality and Counterparty Agency
```

Potential VS002 scope includes:

- tender and conforming performance,
- prevention,
- waiver,
- creditor-caused nonperformance,
- renegotiation response affordances,
- proximate-cause social consequences,
- treatment-interruption semantics.

Do not:

- create `VS001 v1.1`,
- overwrite VS001 behavior,
- regenerate the accepted VS001 golden hashes,
- reinterpret Milestone 1 evidence under new semantics.

VS001 remains the immutable accepted baseline.

## 7.3 Milestone 2 reporting rule

In M2 evaluators and reports, describe the commitment field as:

> The mechanical commitment terminal status produced under VS001 rules.

Do not present it as a validated attribution of moral responsibility or realistic blame.

It may remain a behavioral-similarity component because both compared M2 conditions operate under the same frozen rules.

---

# 8. R6 — Blinded evaluation for live runs

## 8.1 Ruling

**Approved as non-gating laboratory infrastructure.**

Extend the existing reviewer-package machinery to accept:

- validated live ledgers,
- strict-finalized run directories,
- versioned behavioral fingerprints,
- hidden condition labels,
- separate answer keys,
- separately imported reviewer scores.

## 8.2 Permitted diagnostic questions

The laboratory may generate blinded packages for:

```text
Mara versus Jonas versus Rin identity recognition
deterministic Mara versus per-decision Mara
per-decision Mara versus policy-patch Mara
```

These remain diagnostic unless a separate human-review study pre-registers:

- reviewer population,
- sample size,
- recruitment and exclusion rules,
- assignment design,
- chance baseline,
- primary statistic,
- confidence interval method,
- pass threshold.

## 8.3 Model-discrimination limitation

Do not claim that reviewers can distinguish Gemini-Mara from Ling-Mara using the existing Milestone 1 archives.

The current evidence is unbalanced because:

- the Ling sequence was aborted under a capacity failure,
- experiment versions differ,
- model conditions were not randomized or counterbalanced,
- run counts differ.

The machinery may support a future balanced model-discrimination study. The existing evidence may be used only for exploratory method development.

---

# 9. R7 — Rationale and confidence semantics

## 9.1 Rationale ruling

**Approved, but do not merely increase the maximum length.**

For M2 action selection and policy compilation:

1. Validate structural fields independently of rationale.
2. Treat rationale as optional, noncanonical diagnostic data.
3. Normalize a missing or non-string rationale to `null`.
4. Truncate an overlong rationale to a fixed trace limit.
5. Record a noncanonical `rationaleNormalized` flag or equivalent.
6. Never reject an otherwise structurally valid action or policy solely because rationale is missing or overlong.
7. Never request or retain hidden chain-of-thought.

The upstream schema may request a presentation bound, but local structural validity must not depend on the model honoring it.

## 9.2 Confidence ruling

**Remove confidence from control semantics.**

The model’s self-reported score is uncalibrated and must not decide whether an otherwise valid policy is installed.

Amend the M2 brief to remove:

```text
POLICY_PATCH_MIN_CONFIDENCE_BP
policy-confidence-below-minimum
```

Also remove `confidenceBp` from behaviorally consequential canonical policy state.

Confidence must:

- not affect action legality,
- not affect policy installation,
- not affect rule selection,
- not affect fallback behavior,
- not enter the semantic world hash,
- not enter formal acceptance thresholds.

It may remain as optional, noncanonical trace metadata named explicitly as:

```text
selfReportedConfidenceBp
```

If retained, exclude it from primary analysis unless a separate calibration study defines its semantics and validates it against outcomes.

The existing action-response interface may retain a compatibility field, but its value remains diagnostic only.

## 9.3 Governance ruling for Q2

Milestone 2 may use new prompt text and must use new prompt versions:

```text
M2_ACTION_PROMPT_VERSION = mara-action-selection-m2-1.0.0
M2_POLICY_PROMPT_VERSION = mara-policy-compiler-1.0.0
```

Do not modify:

```text
mara-action-selection-1.0.0
```

Because M2 implementation and live data collection have not begun, the approved pre-implementation prompt text remains part of M2 experiment `1.0.0`.

After the first live M2 pilot:

- any prompt-text change requires a new prompt version,
- any treatment-relevant prompt change requires a new M2 experiment version,
- the live pilot must be repeated before formal data collection.

---

# 10. R8 — Study pre-registration

## 10.1 Ruling

**Approved and mandatory.**

Every dataset collected through the laboratory must have a registered study file written before execution.

## 10.2 Required study fields

Each study declaration must include:

```text
study ID
study version
status: confirmatory | calibration | exploratory | pilot
research question
hypothesis or explicit no-hypothesis statement
repository SHA
package version
experiment and condition IDs
model and provider
prompt versions
scenario IDs and seeds
sample size n
run order, matching, or randomization method
primary metrics
secondary metrics
analysis-script and metric versions
thresholds, when applicable
exclusion rules
replacement policy
stop rule
live-call budget
output root
evidence retention policy
```

## 10.3 Evidence discipline

- Failed studies remain registered.
- Aborted studies remain registered.
- Null results remain registered.
- Replacement attempts remain linked to the original study.
- Exploratory analyses remain labeled exploratory.
- A study may not become confirmatory after its output looks favorable.
- Metrics and thresholds may not change mid-study.

---

# 11. R9 — `liveSmoke.ts` shutdown race

## 11.1 Ruling

**Approved for the first Milestone 2 source PR.**

The current script can call `process.exit(1)` inside a `try` whose `finally` awaits gateway shutdown. Immediate process exit can prevent asynchronous cleanup from completing.

Replace immediate exits with one of these patterns:

```text
throw an error and allow finally to execute
```

or:

```text
set process.exitCode = 1 and return only after finally
```

## 11.2 Required tests

Prove `gateway.stop()` completes after:

- a successful smoke response,
- a schema-invalid gateway response,
- a typed upstream failure,
- a fetch or transport exception.

This fix belongs in package `1.7.0`. Do not create a separate `1.6.3` release solely for it.

---

# 12. Q3 — Study-local freeze versus milestone acceptance freeze

## 12.1 Ruling

R2, R3, and R6 are not automatically formal milestone-acceptance sequences.

However, “no freeze protocol per study” is not acceptable.

Use two levels of control.

## 12.2 Formal milestone acceptance freeze

The formal M2 sequence requires:

- one exact repository SHA,
- one tracked plan hash,
- fixed model and provider,
- fixed prompt versions,
- fixed policy vocabulary and lifecycle constants,
- fixed metrics and thresholds,
- fixed replacement rules,
- full sequence restart after a material change.

## 12.3 Study-local freeze

Every calibration, exploratory, pilot, or blinded-evaluation dataset requires:

- one exact repository SHA for the entire study,
- one immutable study-plan hash,
- one fixed nonsecret configuration fingerprint,
- no code, model, provider, prompt, metric, or sample-definition change mid-study,
- a complete restart or new study version after a material change,
- full provenance and preserved failures.

The governing rule is:

> Milestone-level acceptance freezes govern milestone verdicts. Study-local freezes and provenance govern every collected dataset.

---

# 13. Required amendment to the Milestone 2 brief

Before implementation, amend PR #10 so the authoritative Milestone 2 brief explicitly contains the following.

## 13.1 Add or strengthen

- R1 as the centerpiece unattended harness.
- The three-run unattended harness acceptance test.
- R2’s ten-run variance calibration study.
- R3’s within-condition-versus-between-condition formulation.
- Semantic-context matching before first divergence.
- R4’s commitment lifecycle contracts.
- R4’s interruption-contract audit.
- R4’s known-gap registry and CI behavior.
- R6’s live-ledger reviewer-package support.
- R8’s general study registry and study-local freeze.
- R9’s shutdown-race fix and cleanup tests.

## 13.2 Remove or revise

Remove:

```text
POLICY_PATCH_MIN_CONFIDENCE_BP
policy-confidence-below-minimum
confidenceBp as behaviorally consequential canonical patch state
confidenceBp from world-state hashing
```

Revise the rationale contract so rationale is non-gating and normalized locally.

Revise any claim that one Milestone 1 pair established the absence of biography effects.

## 13.3 Explicitly defer

Add R5 to a deferred-requirements section titled or equivalent to:

```text
Vertical Slice 002 — Social Causality and Counterparty Agency
```

State that Milestone 2 may audit and report the VS001 gaps but may not repair them or regenerate VS001 goldens.

---

# 14. Approved implementation sequence

Follow this order.

## Phase 0 — Close Milestone 1

- Merge the completed Milestone 1 acceptance report.
- Seal the portable evidence archive.
- Tag accepted implementation SHA `38026cc986f59e8526053417666c921826dd34e9`.

## Phase 1 — Amend and merge the M2 brief

- Apply this ruling to PR #10.
- Conduct review before merging.
- Do not begin M2 source implementation until the amended brief is authoritative.

## Phase 2 — Laboratory foundation

Implement:

- behavioral fingerprints,
- behavioral similarity,
- study registry and plan schema,
- evidence and analysis versioning,
- R4 auditors,
- VS001 known-gap registry,
- R6 live-run reviewer-package support,
- R9 shutdown-race repair.

## Phase 3 — Unattended harness

Build R1 first against existing deterministic and per-decision paths.

Prove:

- process isolation,
- fresh gateway per run,
- browser isolation,
- downloads,
- replay,
- finalization,
- failure preservation,
- resume behavior,
- secret scanning,
- portable packaging.

## Phase 4 — M2 per-decision comparator

- Implement the new M2 action prompt and condition.
- Run the three-run unattended harness acceptance.
- Execute the R2 variance calibration study.

## Phase 5 — Sparse policy system

Implement:

- bounded policy schema,
- deterministic novelty broker,
- policy-compilation lifecycle,
- policy acceptance and replay,
- local policy interpreter,
- artifact finalization,
- rationale normalization,
- no confidence gating.

## Phase 6 — Pilot

Run one unattended live attempt for each M2 condition:

```text
mara-model-per-decision-m2-v1
mara-policy-patch-m2-v1
```

After the pilot, any material prompt, schema, metric, threshold, model, or provider change requires new versioning and a repeated pilot.

## Phase 7 — Formal M2 sequence

Execute the pre-registered 25-run comparison only after all preceding gates pass.

Generate R3 and R6 outputs from the same evidence, without altering formal thresholds after observing the data.

## Phase 8 — Future VS002

Address commitment attribution, counterparty agency, renegotiation response, prevention, waiver, and treatment interruption only in a new vertical slice with new configuration and golden baselines.

---

# 15. Change-control summary

The following changes before the first live M2 pilot do **not** require an M2 experiment-version bump, provided they are incorporated into the authoritative brief and implementation before data collection:

- the R1–R9 rulings in this document,
- removal of confidence gating,
- final wording of the initial M2 prompts,
- study-registry structure,
- evaluator formula implementation matching the approved brief.

The following changes after the first live M2 pilot require version review and normally require a new M2 experiment version:

- prompt text,
- model or provider,
- policy vocabulary,
- policy lifecycle constants,
- novelty triggers,
- policy interpreter semantics,
- behavior-similarity formula,
- formal acceptance thresholds,
- formal sample design.

The Milestone 1 experiment, prompts, evidence, schemas, conditions, and conclusions remain immutable.

---

# 16. Final directive to the coding agent

> Amend Milestone 2 PR #10 before implementing source code. Include R1, R2, the narrowed R3, R4 with an explicit VS001 known-gap registry, R6 as non-gating instrumentation, R8, and R9. Preserve the existing non-gating rationale design and strengthen it where necessary. Remove policy-confidence gating and remove confidence from canonical patch behavior and formal analysis. Record R5 as a deferred Vertical Slice 002 requirement; do not alter VS001 mechanics, event streams, accepted evidence, or golden hashes. Apply a study-local freeze to every dataset and the full freeze protocol to the formal M2 acceptance sequence. Do not begin implementation until the Milestone 1 closeout and amended Milestone 2 brief are merged.

Build the laboratory so that null, negative, failed, or inconvenient results remain valid outcomes rather than reasons to redefine the experiment.
