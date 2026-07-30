# Milestone 002 — Phase 2 Laboratory Foundation Audit

**Date:** July 30, 2026  
**Repository:** `186F/thelastmeal`  
**Pull request:** `#12 — Milestone 2 Phase 2: laboratory foundation (1.7.0)`  
**Audited implementation head:** `ed8f03b6a61923b11f3cc312b925cd3b664e5a94`  
**Base:** `b2b4d045016c0991a6aede33e002fd034503cec1`  
**Status:** **REQUEST CHANGES — NOT READY TO MERGE**  
**Scope:** Phase 2 only; no live model calls are required to remediate this audit.

---

# 1. Executive verdict

PR #12 is a strong and disciplined implementation of the Milestone 2 laboratory foundation, but it should **not** merge in its current form.

The pull request correctly preserves the frozen Vertical Slice 001 mechanics and Milestone 1 evidence model. It adds a useful exact-arithmetic evaluator, versioned behavior artifacts, a study registry, blinded reviewer-package support, an affordance/interruption audit, and the `liveSmoke.ts` shutdown repair. The exact PR head is green under the complete clean-checkout workflow.

However, four semantic problems must be corrected before the evaluator and auditor are published as version-1 research instruments:

1. `externalActionCalls` currently conflates engine requests, upstream calls, and any non-legacy provider—including the future **local** policy executor.
2. The known-gap audit can silently lose coverage for a registered gap while CI remains green, and the new Scenario D gap is not yet justified as modeled.
3. The primary active-time metric excludes movement despite the governing brief requiring movement-inclusive active-time derivation.
4. `conditionId` currently stores a provider-plan ID rather than a registered experimental condition.

These are not cosmetic issues. They affect the Milestone 2 call-reduction hypothesis, the validity of the behavioral-similarity metric, and the audit’s ability to detect regression. They should be corrected before `behavior-fingerprint-1.0.0`, `behavior-similarity-1.0.0`, and `vs001-known-gaps-1.0.0` become authoritative.

The coding agent should remediate this PR and request a new exact-head audit. Do not begin Phase 3 and do not perform any live API call while addressing these findings.

---

# 2. Verification performed

## 2.1 Pull-request and CI state

At the audited head:

```text
PR: #12
Head: ed8f03b6a61923b11f3cc312b925cd3b664e5a94
Changed files: 30
Additions/deletions: +4061 / -102
Package: 1.7.0
```

GitHub Actions run `30564926949` completed successfully. The required clean-checkout job passed:

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

The exact-head CI totals were:

```text
59 Vitest files
527 Vitest tests
55 gateway tests
127 model-bundle tests
```

The three model rehearsals strict-completed with replay matches:

```text
normal:       47 requests
 gateway-stop: 75 requests
latency:      52 requests, 30 superseded
```

The new audit step reported:

```text
4 known limitations
0 unregistered findings
```

All fourteen deterministic golden hashes remained unchanged.

## 2.2 Sample evaluator outputs

The three headline comparisons in the implementation report were independently reproduced from the retained Milestone 1 ledgers:

```text
A deterministic vs A live       6,691 bp
B1 live vs B2 live               9,999 bp
A live vs A gateway-stop         6,056 bp
```

The evaluator is therefore producing stable, non-arbitrary results. The blocking findings concern the meaning and future validity of several fields, not the mere fact that the scripts run.

---

# 3. Blocking finding 1 — Request, provider, and upstream-call semantics are conflated

**Severity:** High  
**Affected areas:** behavioral fingerprint, Phase 5 compatibility, call-reduction analysis

## 3.1 Current implementation

`buildBehaviorFingerprints` increments `externalActionCalls` for each `DecisionRequested` whose provider ID differs from the literal:

```text
deterministic-utility-v1
```

It applies the same negative comparison when deriving `acceptedExternalActions`.

Conceptually, the implementation currently treats:

```text
providerId !== deterministic-utility-v1
```

as equivalent to:

```text
external model call
```

That equivalence is false.

## 3.2 Why this is incorrect

### A. An external decision request is not necessarily an upstream model call

Milestone 1 Run 6 produced:

```text
75 external DecisionRequested events
10 actual upstream calls
```

After the gateway was deliberately stopped, the client still received 65 engine requests and archived their exact envelopes, but no upstream call occurred. The evidence model correctly distinguishes:

```text
engine request emitted
client request observed
gateway dispatch attempted
upstream call completed
engine response accepted
```

The fingerprint collapses these stages into one misleading field.

If a later report reads `externalActionCalls: 75`, it may incorrectly state that 75 model calls were purchased when the correct upstream count was 10.

### B. The Milestone 2 policy executor is local

The governing brief defines the policy condition as:

```text
Mara action provider:  mara-policy-patch-executor-v1
Mara policy compiler: openrouter-mara-policy-compiler-v1
```

The policy executor is a deterministic local provider. Only the compiler is external.

Under the current negative comparison, every decision served by `mara-policy-patch-executor-v1` would be counted as an external action call. That would directly corrupt the primary Milestone 2 claim:

> Policy compilation uses no more than 25% as many upstream calls as the per-decision comparator.

## 3.3 Required correction

Replace the negative provider-ID test with an explicit source taxonomy. At minimum distinguish:

```text
deterministic-utility
external-action-request
local-policy-executor
fallback
```

The versioned fingerprint and sequence evaluator should separate canonical request facts from noncanonical transport facts.

Recommended fields:

```text
externalActionRequestsEmitted
acceptedExternalActions
policyExecutorDecisions
policyCompilationRequestsEmitted
deterministicFallbackDecisions
```

Transport-derived fields should be separately named and populated only when a finalized run directory or sequence evidence supplies gateway traces:

```text
upstreamActionCallsAttempted
upstreamActionCallsCompleted
upstreamPolicyCompilationCallsAttempted
upstreamPolicyCompilationCallsCompleted
```

A plain ledger cannot prove upstream dispatch. It must report those fields as unavailable or omit them under a discriminated evidence schema; it must not infer them from `DecisionRequested`.

The formal call-reduction evaluator must use actual upstream trace counts.

## 3.4 Required tests

Add regression tests proving:

1. A gateway-stop run distinguishes 75 emitted action requests from 10 upstream calls.
2. `mara-policy-patch-executor-v1` is classified as local.
3. Policy-executor decisions do not increment external action-call totals.
4. Only the registered OpenRouter action and compiler authorities are upstream-capable.
5. Unknown provider IDs fail with a typed classification error rather than defaulting to external.
6. A ledger-only fingerprint never claims an upstream-call count it cannot observe.

Correct this before freezing `behavior-fingerprint-1.0.0`.

---

# 4. Blocking finding 2 — The known-gap audit cannot detect lost registry coverage

**Severity:** High  
**Affected areas:** CI regression detection, known-gap governance

## 4.1 Current implementation

The known-gap registry contains five entries. The clean-checkout audit observed four known limitations.

That difference is understandable: the Scenario C renegotiation gap is trajectory-dependent and is not reached in the deterministic C run. The defect is that the audit’s success rule is only:

```text
unregisteredCount === 0
```

It does not require every registered gap to be exercised by a declared coverage source.

## 4.2 Failure modes hidden by the current design

CI can remain green if:

- a known gap disappears because the auditor no longer detects it;
- a scenario path ceases to exercise the relevant state;
- a fixture proving the gap is removed;
- a known gap changes into a shape that produces no finding;
- the registry contains a stale or unreachable entry;
- a new detector is added and immediately grandfathered without independent approval.

This does not satisfy the governing rule:

```text
Known gap changes shape, severity, or affected scope → fail
```

A detector that stops observing a gap is itself a meaningful change and must not silently pass.

## 4.3 Required correction — explicit gap coverage

Every known-gap entry must declare at least one exact coverage source:

```text
static-contract
deterministic-scenario
committed-synthetic-fixture
retained-live-evidence-fixture
```

The audit report must expose:

```text
matchedKnownGapIds
unobservedKnownGapIds
unregisteredFindings
```

CI should pass only when:

```text
unobservedKnownGapIds.length === 0
unregisteredFindings.length === 0
```

Raw Milestone 1 evidence remains outside Git. Therefore, the Scenario C renegotiation-response gap needs a small committed synthetic event-stream fixture or a purpose-built audit test that deterministically reproduces its exact finding.

The fixture must exercise the real audit code, not merely assert that the registry entry exists.

## 4.4 Ruling on `KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW`

Do not merge this new registry entry in its current form.

The auditor currently treats the absence of a new `request-transfer` offer as absence of a lawful-acquisition exit even when the actor’s transfer request is already pending. In that state, lawful acquisition is already in progress. A second request is correctly withheld.

The current registry entry also combines two distinct states:

1. transfer request pending;
2. transfer request refused and cooldown active.

These should not be treated as one finding.

### Required refinement

- Treat an existing pending transfer request as a lawful-acquisition path already in progress.
- Evaluate the post-refusal cooldown separately.
- Determine whether the cooldown state truly leaves no consequentially lawful non-violation path.
- Do not add a new known-gap entry solely because the newly introduced detector raised it.
- New known-gap entries require explicit advisor approval after the detector semantics are independently reviewed.

If the refined cooldown analysis still identifies a genuine frozen gap, present it as a separate proposed registry entry with exact evidence and scope.

## 4.5 Required tests

Add tests proving:

- every registry entry has a coverage source;
- every coverage source produces the expected finding;
- deleting a coverage fixture fails CI;
- an observed changed-shape finding is unregistered;
- an unobserved registry entry fails CI;
- a pending meal-transfer request satisfies the lawful-acquisition class;
- cooldown behavior is evaluated separately.

---

# 5. Blocking finding 3 — Active-time derivation excludes movement contrary to the brief

**Severity:** Medium-high  
**Affected areas:** primary behavioral metric, sample reports, regression pins

## 5.1 Governing requirement

The authoritative Milestone 2 brief states that active time must be derived from:

```text
start
completion
interruption
movement
scenario-end events
```

The implementation instead opens an action’s active-time interval only on `ActionStarted` and explicitly documents that movement legs are excluded because `ActionStarted` fires upon arrival.

## 5.2 Why this matters

Category active-time similarity contributes 35% of the composite score. Travel is behaviorally consequential time chosen by the NPC’s accepted action. Excluding it can favor conditions that choose the same categories but incur different movement costs, or distort category shares when one policy changes destination frequency.

The current test compares the evaluator to legacy `buildNpcStats`. That proves compatibility with the older report, but `buildNpcStats` also starts at `ActionStarted`. It does not prove compliance with the M2 metric contract.

A recomputation over the sealed Milestone 1 ledgers with movement attributed to the initiating action changes the A deterministic/live composite from:

```text
6,691 bp → 6,672 bp
```

The change is modest in that pair but confirms that the definition affects the primary metric.

## 5.3 Required correction

Use this interval rule for category active time:

```text
If MovementStarted exists for actionId:
    open at MovementStarted.tick
Else:
    open at ActionStarted.tick

Close at the earliest applicable:
    ActionCompleted.tick
    ActionInterrupted.tick
    ScenarioEnded.tick
```

`ActionStarted` should continue to govern:

- action-start counts;
- mode-start distributions;
- category transitions;
- work-session count.

Only the active-time clock should include travel.

Handle actions that move and then fail start validation by attributing the movement interval to the selected action category, while leaving `actionsStarted` unchanged.

## 5.4 Required tests and report changes

Add tests for:

- movement followed by action start and completion;
- movement followed by start rejection;
- action beginning in place with no movement;
- scenario end while an action or transit remains open;
- movement-inclusive active-time totals on a frozen scenario;
- regenerated sample-comparison constants.

Recompute:

- fingerprint fixtures;
- similarity pins;
- sample reports;
- implementation-report headline values.

Because no M2 study has begun and the metric has not merged, the corrected implementation may retain:

```text
behavior-fingerprint-1.0.0
behavior-similarity-1.0.0
```

If the team wishes to exclude movement, the authoritative brief must first be amended through the same governance process. An implementation report cannot override the brief.

---

# 6. Blocking finding 4 — `conditionId` contains a provider-plan ID

**Severity:** Medium  
**Affected areas:** provenance, cross-condition analysis

## 6.1 Current implementation

The ledger-file field named `providerId` stores:

```text
run.plan.id
```

The fingerprint then copies that value into a field named:

```text
conditionId
```

The deterministic fingerprint test therefore expects:

```text
conditionId = deterministic-utility-v1
```

But the registered condition is:

```text
deterministic-baseline-v1
```

These are different concepts.

## 6.2 Why this matters

Milestone 2 will compare registered conditions and provider plans separately. Conflating them makes provenance ambiguous and can break later grouping logic.

A bare legacy ledger may not reveal whether the deterministic condition was explicitly selected or the default provider wiring was used. The evaluator should report that uncertainty rather than invent a condition.

## 6.3 Required correction

Use distinct fields:

```text
providerPlanId
registeredConditionId: string | "not-observable"
```

For a ledger-only input:

```text
providerPlanId = ledger.providerId
registeredConditionId = "not-observable"
```

For a strict-finalized run directory or orchestrated sequence:

```text
registeredConditionId = value proven by manifest / study plan
```

Do not infer a condition from a provider plan unless a versioned, explicit one-to-one registry guarantees that mapping for the relevant experiment.

Update schemas, Markdown reports, sample reports, reviewer answer keys, and tests accordingly.

---

# 7. Non-blocking but prudent corrections

These do not independently block Phase 2, but they should be addressed in the same remediation while the contracts are still new.

## 7.1 Reviewer-score validation

The reviewer package is appropriately blinded and keeps answer keys separate. The scorer is not yet safe for a registered human study because it:

- casts unvalidated JSON into TypeScript types;
- has no reviewer identifier;
- permits duplicate rows for the same run and actor;
- permits arbitrary partial submissions without declaring that behavior;
- permits repeated correct rows to inflate the aggregate rate.

Before any human study, add strict schemas and require:

```text
reviewerId
runLabel
actorLabel
guessedNpcId
```

Reject duplicate:

```text
(reviewerId, runLabel, actorLabel)
```

Declare whether partial response sets are legal. Report:

```text
reviewer count
expected judgments
received judgments
completion coverage
per-reviewer accuracy
pooled accuracy
```

R6 remains non-gating, so this may be fixed now or explicitly scheduled before the first registered human-review study.

## 7.2 Stale implementation-report counts

The report says:

```text
518 tests passing
```

The exact-head CI says:

```text
527 tests passing
```

Update the report after the remediation commit and reference the final exact-head workflow run.

## 7.3 `liveSmoke.ts` report wording

The implementation report refers to `stopWithFallback` semantics. The actual correct implementation is simpler:

```text
runSmokeOnce returns or throws
finally awaits gateway.stop()
CLI sets process.exitCode
```

Make the report match the code.

## 7.4 CLI argument syntax

Some documentation shows spaced arguments:

```text
--ledger <path>
--left <path>
--right <path>
```

The parsers currently accept only equals syntax:

```text
--ledger=<path>
--left=<path>
--right=<path>
```

Either support both forms through one shared argument parser or document only the accepted form consistently.

---

# 8. Strengths to preserve

The remediation should not discard the following strong work.

## 8.1 Exact evaluator arithmetic

The arithmetic module centralizes:

- round-half-away-from-zero;
- largest-remainder basis-point normalization;
- total-variation similarity;
- bounded numeric similarity;
- exact-match components;
- integer means.

The hand-computed tests are clear and useful. Preserve this design.

## 8.2 Full ledger validation before evaluation

The evaluation CLIs run the complete ledger validator before producing fingerprints or comparisons. This preserves the project’s core principle that analysis consumes only internally coherent, replayable evidence.

## 8.3 Confidence exclusion

The fingerprint does not consult rationale, confidence, or score diagnostics. The mutation guard proving byte-identical fingerprints after confidence/score changes is exactly the right pattern.

## 8.4 Similarity component structure

The implementation follows the approved five-component weighting and refuses unsupported pairings. The registered B1/B2 exception is explicit rather than hidden.

## 8.5 Study registry and freeze artifacts

The study schema requires an explicit hypothesis or no-hypothesis statement and produces:

```text
planSha256
configFingerprint
```

The distinction between byte-sensitive plan identity and formatting-independent configuration identity is sound.

## 8.6 `liveSmoke.ts` shutdown repair

The race is correctly fixed. `runSmokeOnce` never calls `process.exit`, its `finally` awaits shutdown, and success, schema failure, typed upstream failure, and thrown transport failure are all tested.

## 8.7 Scope discipline

No frozen simulation mechanic, prompt, condition, policy system, or golden hash changed. The PR remains within Phase 2.

---

# 9. Required remediation checklist

The coding agent must complete all blocking items before requesting re-audit.

## Behavioral evidence semantics

- [ ] Replace negative provider classification with an explicit source taxonomy.
- [ ] Rename request-derived counts so they do not claim upstream calls.
- [ ] Add trace-derived upstream call fields only where evidence supports them.
- [ ] Classify `mara-policy-patch-executor-v1` as local.
- [ ] Add gateway-stop request-versus-call regression coverage.

## Provenance

- [ ] Separate `providerPlanId` from `registeredConditionId`.
- [ ] Report `registeredConditionId: not-observable` for ledger-only evidence when necessary.
- [ ] Populate actual condition only from a manifest or study plan that proves it.

## Active-time metric

- [ ] Include movement from `MovementStarted` in category active time.
- [ ] Handle travel followed by start rejection.
- [ ] Preserve `ActionStarted` semantics for counts and transitions.
- [ ] Regenerate metric pins and sample comparisons.

## Audit and known gaps

- [ ] Give every known gap a declared coverage source.
- [ ] Report matched, unobserved, and unregistered sets.
- [ ] Fail CI on any unobserved registry entry.
- [ ] Add a committed fixture for the Scenario C response-window gap.
- [ ] Treat an already-pending transfer request as lawful acquisition in progress.
- [ ] Separate cooldown analysis from pending-request analysis.
- [ ] Remove the current Scenario D registry entry unless a refined finding receives explicit approval.

## Documentation and quality

- [ ] Update exact test counts and CI run evidence.
- [ ] Correct the smoke-shutdown wording.
- [ ] Align CLI documentation and parsing.
- [ ] Preferably add strict reviewer-score schemas and duplicate protection.

---

# 10. Required verification after remediation

Push all corrections to PR #12 and obtain a new green exact-head CI run covering:

```text
npm run typecheck
npm run typecheck:gateway
npm run lint
npm run validate
npm run test:run
npm run test:gateway
npm run test:model:bundle
npm run build
npm run build:gateway
npm run check:dist
npm run test:e2e
npm run batch
npm run model:rehearse -- --ci
npm run audit:affordances
```

The audit step must prove:

```text
unregisteredFindings = []
unobservedKnownGapIds = []
```

All fourteen deterministic golden hashes must remain unchanged.

No live model call is needed.

---

# 11. Re-audit gate

After the remediation commit and green exact-head CI, stop work and request a new audit of PR #12.

Do not merge based only on green CI. The corrected version-1 semantic contracts must be reviewed before becoming authoritative.

Do not begin Phase 3 until PR #12 is merged after re-audit.

---

# 12. Final directive

> **PR #12 is a strong foundation but is currently a no-go for merge. Correct the request/call taxonomy, known-gap coverage guarantees, movement-inclusive active-time metric, and condition-versus-provider provenance. Preserve the exact-arithmetic design, full-ledger validation, confidence exclusion, study-freeze machinery, smoke-shutdown fix, and frozen VS001 behavior. Then obtain green exact-head CI and request re-audit.**

## Audit-method note

This review combined:

- static inspection of the PR’s changed source, schemas, tests, and documentation;
- inspection of the exact-head GitHub Actions logs and artifacts;
- independent recomputation of the reported sample similarities from the sealed Milestone 1 evidence previously reviewed by the Project Advisor.

The repository was not executed from a separate local clone during this audit. The merge recommendation therefore rests on the inspected implementation, the repository-hosted clean-checkout results, and the independent evidence recomputation described above.
