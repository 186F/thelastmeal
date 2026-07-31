# Milestone 002 — Phase 2 Laboratory Foundation Re-Audit

**Date:** July 30, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#12 — Milestone 2 Phase 2: laboratory foundation (1.7.0)`  
**Re-audited implementation head:** `17f198d95b7762d31189382fef68043b7665d5b3`  
**Base:** `b2b4d045016c0991a6aede33e002fd034503cec1`  
**Prior audit:** [`MILESTONE_002_PHASE2_LABORATORY_AUDIT.md`](MILESTONE_002_PHASE2_LABORATORY_AUDIT.md)  
**Status:** **REQUEST CHANGES — TARGETED REMEDIATION REQUIRED BEFORE MERGE**  
**Scope:** Three remaining version-1 contract gaps. No live model calls are required.

---

# 1. Executive verdict

PR #12 is substantially improved. The difficult parts of the first audit have been remediated correctly:

- category active time is now movement-inclusive;
- engine-emitted requests are no longer conflated with upstream model calls;
- the local policy executor is no longer treated as external;
- registered conditions are no longer inferred from provider-plan IDs;
- every known-gap registry entry must remain exercised by declared CI-capable evidence;
- the unapproved Scenario D registry entry was removed;
- reviewer-score rows are validated and duplicate judgments are rejected;
- the smoke-test shutdown race remains correctly repaired.

The exact re-audit head is green under the complete clean-checkout workflow. The current implementation is nevertheless **not ready to merge**, because three narrow gaps remain in contracts intended to become authoritative at version `1.0.0`:

1. The provider taxonomy omits the required Milestone 2 per-decision action provider.
2. A strict-finalized run directory is still reduced to a bare ledger, discarding condition and upstream-call evidence it can prove.
3. The study registry cannot encode or freeze the required execution speed.

These should be corrected now, before Phase 2 publishes the evaluator and study registry as stable version-1 research instruments.

Do not begin Phase 3 until this PR merges following targeted verification.

---

# 2. Verification performed

## 2.1 Pull-request and CI state

At the re-audited head:

```text
PR: #12
Head: 17f198d95b7762d31189382fef68043b7665d5b3
Package: 1.7.0
Changed files: 35
```

GitHub Actions run `30573493845` completed successfully. The required clean-checkout job passed:

- application typecheck;
- gateway typecheck;
- lint and formatting;
- frozen-data validation;
- full unit and integration suite;
- gateway suite;
- formal model-bundle suite;
- application and gateway production builds;
- distribution secret scan;
- Playwright browser tests;
- 100-runs-per-scenario deterministic batch;
- keyless formal model rehearsal;
- affordance and interruption-contract audit.

The actual exact-head test totals are:

```text
60 Vitest files
558 Vitest tests
55 gateway tests
127 model-bundle tests
```

All fourteen deterministic golden hashes remain unchanged.

## 2.2 Re-audit scope

The re-audit focused on the first audit’s four blocking findings and four prudent corrections:

- provider/request/upstream semantics;
- known-gap coverage and Scenario D semantics;
- movement-inclusive active-time derivation;
- provider-plan versus registered-condition provenance;
- reviewer-score hardening;
- implementation-report accuracy;
- smoke-test wording;
- CLI argument consistency.

The first audit’s movement, arithmetic, replay, smoke-shutdown, and known-gap architecture do not require another broad redesign.

---

# 3. Confirmed remediations

## 3.1 Movement-inclusive active time — resolved

The active-time interval now follows the governing Milestone 2 definition:

```text
If MovementStarted exists for an action:
    open at MovementStarted.tick
Else:
    open at ActionStarted.tick

Close at the earliest applicable:
    ActionCompleted.tick
    ActionInterrupted.tick
    arrival ActionRejected.tick
    scenario end
```

`ActionStarted` continues to govern:

- action-start counts;
- mode-start distributions;
- category and mode transitions;
- work-session counts.

Travel toward an action that fails start validation is attributed to the selected category without incrementing `actionsStarted`.

The regenerated A deterministic/live Mara comparison is:

```text
6,672 bp
```

This exactly matches the independent recomputation in the first audit. The live B1/B2 and live/gateway-stop values remain `9,999bp` and `6,056bp`; the deterministic B1/B2 reference is now `7,189bp`.

**Ruling:** resolved. Preserve this implementation.

## 3.2 Known-gap coverage guarantee — resolved

Each registry entry now declares one or more coverage sources. CI-capable source types include:

```text
static-contract
deterministic-scenario
committed-synthetic-fixture
```

A retained live-evidence source may be documented but cannot satisfy CI alone.

The audit now exposes:

```text
matchedKnownGapIds
unobservedKnownGapIds
unregisteredFindings
```

and passes only when both failure sets are empty.

The Scenario C renegotiation-response gap is reproduced through a committed synthetic fixture that exercises the real event-stream auditor. Deleting or corrupting that fixture fails the audit. The current audit reports four registered gaps, all four observed by declared coverage, and zero unregistered findings.

**Ruling:** resolved. Preserve this architecture.

## 3.3 Scenario D meal dilemma — advisor ruling

The previous entry:

```text
KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW
```

was correctly removed.

A pending transfer request is a lawful-acquisition path already in progress; the engine should not offer a duplicate request. The post-refusal cooldown is a separate state.

The re-audit accepts the coding agent’s substantive conclusion:

> The post-refusal cooldown is not a new registered VS001 gap.

The actor already exercised the lawful acquisition route, the owner resolved it by refusal, and several non-violation forgo actions remain available. The four-entry known-gap registry is therefore appropriate.

However, the audit vocabulary should avoid claiming that the cooldown is itself a currently available acquisition exit. Prefer terminology such as:

```text
resolvedByRefusalCooldown
```

or:

```text
checkpointNotApplicableAfterRefusal
```

rather than:

```text
satisfiedByRefusalCooldown
```

This terminology correction is recommended but does not independently require a fifth known-gap entry.

## 3.4 Provider plan versus condition provenance — partially resolved

The versioned fingerprint now separates:

```text
providerPlanId
registeredConditionId
```

A bare ledger correctly reports:

```text
providerPlanId = ledger.providerId
registeredConditionId = not-observable
```

No condition is inferred from a provider plan. This is correct.

The remaining finalized-run enrichment issue is addressed separately in Blocking Finding 2.

## 3.5 Reviewer-score validation — resolved for Phase 2

Reviewer score rows now require:

```text
reviewerId
runLabel
actorLabel
guessedNpcId
```

The scorer rejects duplicate `(reviewerId, runLabel, actorLabel)` judgments and reports:

- reviewer count;
- expected judgments per reviewer;
- received judgments;
- completion coverage;
- per-reviewer accuracy;
- pooled accuracy.

Partial submissions are explicitly permitted and reported through completion coverage.

Reviewer packages and answer keys remain diagnostic, non-gating infrastructure. Runtime schemas for the package and answer-key documents would still be prudent before a registered human study, but this does not block Phase 2 by itself.

---

# 4. Remaining blocker 1 — missing M2 action-provider taxonomy entry

**Severity:** High  
**Affected areas:** Phase 4 compatibility, fingerprint acceptance, call-reduction evidence

## 4.1 Governing identities

The authoritative brief requires these Milestone 2 provider identities:

```text
M2_ACTION_PROVIDER_ID = openrouter-mara-action-m2-v1
M2_POLICY_COMPILER_PROVIDER_ID = openrouter-mara-policy-compiler-v1
M2_POLICY_EXECUTOR_PROVIDER_ID = mara-policy-patch-executor-v1
```

## 4.2 Current taxonomy

The new explicit taxonomy correctly registers:

```text
deterministic-utility-v1
openrouter-mara-action-v1                 # legacy Milestone 1 action provider
openrouter-mara-policy-compiler-v1        # M2 policy compiler
mara-policy-patch-executor-v1             # M2 local policy executor
```

It does **not** register:

```text
openrouter-mara-action-m2-v1
```

The upstream-capable registry consequently includes the legacy M1 action provider and the M2 compiler, but not the M2 per-decision action authority.

## 4.3 Why this blocks merge

Phase 4 will produce `DecisionRequested` events addressed to `openrouter-mara-action-m2-v1`. Under the current version-1 taxonomy, fingerprint generation would fail with:

```text
ProviderClassificationError
```

Adding the provider after merge would change which evidence `behavior-fingerprint-1.0.0` accepts and how it classifies that evidence.

## 4.4 Required correction

Create the central Milestone 2 identity module prescribed by the brief, for example:

```text
src/shared/m2Experiment.ts
```

It should define the complete M2 identity vocabulary, including:

```text
M2_EXPERIMENT_ID
M2_EXPERIMENT_VERSION
M2_PER_DECISION_CONDITION_ID
M2_POLICY_PATCH_CONDITION_ID
M2_ACTION_PROVIDER_ID
M2_POLICY_COMPILER_PROVIDER_ID
M2_POLICY_EXECUTOR_PROVIDER_ID
M2_ACTION_PROMPT_VERSION
M2_POLICY_PROMPT_VERSION
```

Then:

- import all M2 provider IDs into the taxonomy;
- classify `openrouter-mara-action-m2-v1` as `external-action-request`;
- classify `openrouter-mara-policy-compiler-v1` as `external-policy-compilation`;
- classify `mara-policy-patch-executor-v1` as `local-policy-executor`;
- retain the legacy M1 action provider as upstream-capable for historical evidence;
- ensure unknown IDs still throw a typed error.

The upstream-capable set should contain exactly:

```text
openrouter-mara-action-v1
openrouter-mara-action-m2-v1
openrouter-mara-policy-compiler-v1
```

## 4.5 Required tests

Add tests proving:

- the exact M2 action provider is classified as `external-action-request`;
- the exact M2 action provider is upstream-capable;
- the policy executor remains local;
- the compiler cannot serve a per-decision action request;
- all identities are imported from the central M2 module rather than redeclared.

---

# 5. Remaining blocker 2 — strict-finalized run directories discard proving evidence

**Severity:** High  
**Affected areas:** condition provenance, upstream-call metrics, Run 6 analysis, blinded condition studies

## 5.1 Required evidence distinction

The evaluator must distinguish:

```text
Bare ledger input
    providerPlanId = ledger-proven
    registeredConditionId = not-observable
    upstream call counts = not-observable
```

from:

```text
Strict-finalized run-directory input
    providerPlanId = ledger-proven
    registeredConditionId = manifest-proven
    upstream call counts = gateway/finalized-trace-proven
```

## 5.2 Current behavior

The current loader accepts either a ledger path or a directory. For a directory, it finds exactly one `ledger-*.json`, validates that ledger, and returns only the ledger.

It does not consume or validate:

```text
run-manifest.final.json
finalized-trace.jsonl
model-summary.json
bundle-manifest.json
routing sidecars / gateway trace evidence
```

As a result, every Phase 2 fingerprint reports:

```text
registeredConditionId = not-observable
upstreamActionCallsAttempted = not-observable
upstreamActionCallsCompleted = not-observable
upstreamPolicyCompilationCallsAttempted = not-observable
upstreamPolicyCompilationCallsCompleted = not-observable
```

including when a strict-finalized run directory contains the evidence needed to prove some of these values.

## 5.3 Why this blocks merge

The first audit specifically required strict-finalized run directories to enrich ledger facts with validated artifact evidence.

Without that capability:

- the evaluator still cannot express the Milestone 1 Run 6 distinction of 75 emitted requests versus ten upstream calls;
- blinded answer keys cannot carry hidden registered condition labels from finalized live evidence;
- the formal Milestone 2 call-reduction evaluator lacks the evidence ingestion boundary it is supposed to build on;
- a path documented as accepting a finalized run directory behaves semantically like a bare ledger path.

Deferring all enrichment to Phase 3 leaves the Phase 2 version-1 evidence contract incomplete.

## 5.4 Required correction

Keep the pure ledger fingerprint builder unchanged and add a Node-side evidence-loading/enrichment layer.

For a direct ledger path:

```text
validate ledger
build ledger-only fingerprint
retain not-observable transport/condition fields
```

For a run-directory path:

1. Require the strict-finalization artifacts expected for the relevant schema version.
2. Validate their schemas and bundle integrity.
3. Verify ledger, manifest, trace, request and provider identities agree.
4. Populate `registeredConditionId` from manifest-proven evidence.
5. Populate M1/M2 action-call attempted/completed counts from validated gateway/finalized-trace evidence.
6. Leave policy-compilation counts `not-observable` until the policy lifecycle and artifact schema exist.
7. Refuse contradictory or incomplete evidence instead of silently degrading to ledger-only semantics.

The enriched fingerprint may be produced by an explicit evidence wrapper or by applying a validated provenance overlay to the ledger-derived fingerprint. The pure simulation evaluator should not parse filesystem artifacts itself.

## 5.5 Required tests

Use existing keyless finalized-run fixtures to prove:

- a normal strict-finalized run populates its registered condition;
- a normal strict-finalized run populates attempted/completed upstream action calls;
- a gateway-stop strict-finalized run distinguishes emitted requests from actual gateway calls;
- a bare ledger still reports the relevant fields as `not-observable`;
- a run directory with a manifest/ledger condition conflict fails;
- a run directory with a trace count inconsistent with the manifest fails;
- an incomplete or degraded directory cannot masquerade as strict-finalized evidence.

No live model call is required.

---

# 6. Remaining blocker 3 — study registry cannot freeze pacing

**Severity:** Medium-high  
**Affected areas:** R2 pre-registration, study-local freeze, wall-clock comparability

## 6.1 Governing requirement

The required R2 calibration declaration includes:

```text
scenario: A
seed: 1001
condition: mara-model-per-decision-m2-v1
n: 10
speed: 1×
model: pinned
provider: pinned
prompt: pinned
repository SHA: pinned
```

Formal live evidence is constrained to `speed = 1×` unless a separately pre-registered pacing-comparability study authorizes another pace.

## 6.2 Current schema

The strict `studyDeclarationSchema` contains no field for speed or pacing. Its freeze projection therefore cannot bind the execution speed.

Because the schema is strict, adding the required `speed` field to the R2 study declaration would currently make `study:validate` reject the file.

## 6.3 Why this blocks merge

The first required live study cannot be faithfully pre-registered under `study-registry-1.0.0`.

A study could also change speed while retaining the same configuration fingerprint, undermining the study-local freeze and the very race/latency comparability Milestone 2 is designed to protect.

## 6.4 Required correction

Add a required execution-settings structure to the study declaration. At minimum:

```ts
executionSettings: {
  speed: 1;
}
```

Prefer a versioned structure that can bind other relevant nonsecret runtime settings when applicable, such as:

```ts
executionSettings: {
  speed: number;
  requestTimeoutMs?: number;
  maxConcurrency?: number;
  maxCallsPerRun?: number;
  maxTotalCalls?: number;
}
```

The schema should distinguish fields that apply only to live model studies from fields required for all studies. It should not force fake, deterministic or blinded-review studies to invent irrelevant model settings.

Include the entire execution-settings object in `studyFreezeProjection`.

## 6.5 Required tests

Add tests proving:

- the canonical R2 study declaration with `speed: 1` validates;
- changing speed changes the configuration fingerprint;
- omitting required pacing from a live calibration study fails;
- a study cannot encode a non-1× live pace without an explicit pacing-comparability authorization field or registered study reference;
- formatting-only changes still leave the configuration fingerprint stable.

---

# 7. Minor corrections

## 7.1 Implementation-report test count

The implementation report still states:

```text
553 tests passing
```

The exact-head CI result is:

```text
558 tests passing
```

Update the report after the final remediation commit and reference the final exact-head workflow run.

## 7.2 Cooldown terminology

As ruled above, no new Scenario D known-gap entry is warranted. Rename reporting fields or prose that imply the cooldown is a currently available acquisition exit.

Recommended concepts:

```text
resolvedByRefusalCooldown
checkpointNotApplicableAfterRefusal
```

The detector should continue to report pending and refusal-resolved states separately.

## 7.3 Reviewer package and answer-key schemas

The score rows are now strict, but the reviewer package and answer key are still represented only by TypeScript interfaces, and the score CLI casts the parsed answer key.

Before a registered human study, add strict runtime schemas for:

- reviewer package;
- answer key;
- score report.

This remains non-blocking for Phase 2, but it is small enough to include in the focused remediation if convenient.

---

# 8. Required remediation scope

The next commit should be focused. It should contain only:

1. The central M2 identity module and complete provider taxonomy.
2. Strict-finalized run-directory evidence enrichment.
3. Study execution settings with pacing included in the freeze.
4. The implementation-report test-count correction.
5. Preferably, refined cooldown terminology and strict reviewer package/answer-key schemas.

Do not introduce:

- the unattended orchestrator;
- the M2 per-decision condition wiring;
- M2 prompts;
- the policy-patch system;
- the novelty broker;
- commitment-layer repairs;
- new live runs;
- any Vertical Slice 001 mechanic or golden-hash change.

---

# 9. Verification gate

After remediation, require a new green exact-head clean-checkout run covering:

```text
application and gateway typechecks
lint and formatting
frozen-data validation
full unit/integration suite
gateway suite
formal model-bundle suite
application and gateway builds
distribution secret scan
Playwright
100-run deterministic batch
keyless formal model rehearsal
affordance/known-gap audit
```

Targeted tests must additionally prove:

```text
M2 action provider is registered and upstream-capable
policy executor remains local
finalized normal run enriches condition and call evidence
finalized gateway-stop run preserves emitted-versus-called distinction
contradictory finalized evidence fails
bare ledger remains honestly not-observable
R2 study with speed=1 validates
speed change moves the study config fingerprint
```

No live API call is required.

---

# 10. Merge and phase decision

**Current decision:** no-go for merge at `17f198d95b7762d31189382fef68043b7665d5b3`.

Once the three blockers above are corrected and the new exact head receives green CI, only a targeted verification is required. The following areas are already accepted and do not need another broad re-audit:

- movement-inclusive active-time semantics;
- exact evaluator arithmetic;
- similarity weights and supported pairings;
- known-gap coverage architecture;
- the four-entry VS001 registry;
- Scenario D’s no-new-gap ruling;
- smoke-test shutdown cleanup;
- frozen Vertical Slice 001 behavior and hashes.

After targeted verification passes, PR #12 may merge and Phase 3 — the unattended experiment orchestrator — becomes eligible to begin through a separate reviewable PR.

---

# 11. Directive to the coding agent

> Remediate the three remaining version-1 contract gaps in this re-audit: register the exact M2 per-decision action provider through a central M2 identity module; enrich strict-finalized run-directory inputs with validated condition and upstream action-call evidence while keeping bare ledgers honest; and add pacing/execution settings to the study declaration and freeze projection. Update the exact-head test count, obtain green clean-checkout CI, and stop for targeted verification. Make no live model calls and do not begin Phase 3.