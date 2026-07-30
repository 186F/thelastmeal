# Milestone 2 — Phase 2 Laboratory Foundation — Implementation Report

**Package:** `1.7.0` (first Milestone 2 source PR)
**Governing documents:** [`MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) §10, §21, §27.6–§27.8, §31 Phase 2, and the authoritative [`MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md`](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md)
**Scope discipline:** no canonical simulation-mechanics change; no orchestrator, no M2 conditions, no policy system, no prompts, no commitment repair, no live API calls. All fourteen deterministic golden hashes are byte-identical (batch + explicit golden test at the implementation head).

## 0. Remediation record — Phase 2 audit (July 30, 2026)

[`MILESTONE_002_PHASE2_LABORATORY_AUDIT.md`](MILESTONE_002_PHASE2_LABORATORY_AUDIT.md) requested changes on four blocking findings. All four are remediated in this head; the four version-1 contracts retain their `1.0.0` literals per the audit's explicit allowance (nothing had merged).

| Audit finding | Resolution |
| --- | --- |
| 1 — request/provider/upstream conflation | Explicit provider-source taxonomy (`src/shared/providerTaxonomy.ts`): `deterministic-utility` / `external-action-request` / `local-policy-executor` / `external-policy-compilation`; typed `ProviderClassificationError` on unknown IDs (never defaults to external); `mara-policy-patch-executor-v1` classified local; upstream-capable = the OpenRouter action + compiler authorities only. Fingerprint fields renamed to request facts (`externalActionRequestsEmitted`, `acceptedExternalActions`, `policyExecutorDecisions`, `policyCompilationRequestsEmitted`); transport facts (`upstreamActionCalls*`, `upstreamPolicyCompilationCalls*`) are `not-observable` from ledger-only evidence — a real unanswered-external-condition engine run proves emitted ≠ called (decision 8 below) |
| 2 — coverage-blind known-gap audit | Every registry entry declares CI-exercisable coverage; the audit reports `matchedKnownGapIds` / `unobservedKnownGapIds` / `unregisteredFindings` and fails on any unobserved entry; committed synthetic fixture reproduces the scenario-C response-window gap through the real audit code; `KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW` **removed** and the dilemma detector refined per §4.4 (§5 below carries the determination for re-audit) |
| 3 — movement-excluded active time | Category active time is movement-inclusive per the brief: open at `MovementStarted` when a travel leg exists, else `ActionStarted`; close at completion/interruption/arrival-rejection/scenario end; `ActionStarted` still governs counts, mode starts, transitions, and work-session counts. All pins and sample comparisons regenerated — the recomputed A-deterministic/A-live composite is **6,672 bp, equal to the audit's §5.2 independent recomputation** |
| 4 — condition/plan conflation | `conditionId` split into `providerPlanId` (= `ledger.providerId`, ledger-proven) and `registeredConditionId` (`not-observable` for ledger-only evidence; populated only by manifest/study-plan proof, never inferred from a plan) across schemas, similarity provenance, Markdown reports, and reviewer answer keys |

Non-blocking corrections in the same head: strict reviewer-score schema with `reviewerId`, duplicate-judgment rejection, declared-partial-submission coverage reporting, and per-reviewer + pooled accuracy (§7.1); test counts updated (§7.2); `liveSmoke.ts` wording corrected to match the code (§7.3); one shared CLI argument parser accepting both `--name value` and `--name=value` across the evaluation and audit CLIs (§7.4).

## 1. What Phase 2 delivers

| Component | Files | Purpose |
| --- | --- | --- |
| Exact evaluator arithmetic | `src/sim/evaluation/arithmetic.ts` | `roundHalfAwayFromZero`, deterministic largest-remainder basis-point allocation, total-variation similarity, bounded-difference similarity, exact-match, integer mean |
| Versioned behavior contracts | `src/shared/behaviorArtifacts.ts` | strict zod schemas for fingerprints, similarity, comparisons; version literals; weights; fixed metric ranges; comparability rule |
| Provider-source taxonomy | `src/shared/providerTaxonomy.ts` | explicit closed classification of decision-request provider IDs; typed error on unknown IDs; upstream-capable registry (audit finding 1) |
| Shared CLI argument parser | `scripts/cli/args.ts` | one parser for all evaluation/audit CLIs; accepts `--name value` and `--name=value` (audit §7.4) |
| Fingerprint derivation | `src/sim/evaluation/behaviorFingerprint.ts` | one fingerprint per NPC from a validated ledger (§10.4), pure and Node-only |
| Similarity | `src/sim/evaluation/behaviorSimilarity.ts` | five weighted components + composite (§10.6–10.7) |
| Evaluation CLIs | `scripts/evaluation/behavior.ts`, `compare.ts`, `behaviorIo.ts` | `eval:behavior`, `eval:compare`; full ledger validation before evaluation; canonical JSON + Markdown out |
| Study registry | `src/shared/studyRegistry.ts`, `scripts/experiments/m2/studyRegistry.ts` | §21.1 declaration schema; §21.2 study-local freeze artifacts (`planSha256`, `configFingerprint`); `study:validate` |
| Auditors | `src/sim/audit/{contracts,findings,affordanceAudit,knownGaps}.ts`, `scripts/audit/affordances.ts` | interruption contracts, commitment lifecycle contracts, registered dilemma checkpoints, event-stream conformance, VS001 known-gap registry, `audit:affordances` CI step |
| Reviewer packages | `scripts/evaluation/{blinding,reviewerPackages}.ts` | blinded packages from validated live ledgers with separate answer keys and score import (`eval:reviewer-package`, `eval:score-reviews`) — non-gating (R6) |
| `liveSmoke.ts` repair | `scripts/model/liveSmoke.ts` | exported `runSmokeOnce` returns an exit code or throws, never calls `process.exit`; its `finally` always awaits `gateway.stop()` (transport errors rethrow after cleanup); the CLI `main()` sets `process.exitCode` (R9/§27.8) |

## 2. Versions

```text
BEHAVIOR_FINGERPRINT_VERSION = behavior-fingerprint-1.0.0
BEHAVIOR_SIMILARITY_VERSION  = behavior-similarity-1.0.0
STUDY_REGISTRY_VERSION       = study-registry-1.0.0
AUDIT_CONTRACTS_VERSION      = vs001-audit-contracts-1.0.0
KNOWN_GAP_REGISTRY_VERSION   = vs001-known-gaps-1.0.0
```

Any formula, event interpretation, normalization denominator, or component-weight change requires a new version (§10.3).

## 3. Formulas (exact)

- **Largest remainder (§10.5):** floors of `count·10000/total` per vocabulary key; remaining points to the largest remainders, ties broken by earlier key position. Zero total → all-zero (degenerate) distribution.
- **Total variation (§10.6A–C):** `10000 − Σ|l−r|/2` over the complete vocabulary (the Σ of two 10000-sum vectors is even, so halving is exact). Both degenerate → 10000; one degenerate → 0.
- **Bounded difference (§10.6E):** `10000 − min(10000, roundHalfAwayFromZero(|l−r|·10000/fixedRange))`.
- **Outcome subcomponents:** task, meal-consumer, commitment terminal status, injury-worsened, treatment-occurred (exact matches); ownership-violation (range 4), relationship deltas (range 2,000,000 micro, mean over the two outgoing edges), treatment latency (range 2,700 ticks, **included only when both sides observed treatment**, otherwise excluded from the average — occurrence mismatch is captured by its own subcomponent). Fixed ranges are versioned metric constants, never observed-data-derived.
- **Composite (§10.7):** `roundHalfAwayFromZero((A·3500 + B·2000 + C·1500 + D·1000 + E·2000)/10000)`; weights sum to exactly 10,000 (pinned by test).
- **Comparability:** same scenario+seed, or the registered B1/B2 ablation pair at the shared seed; anything else is refused with a typed error.

## 4. Interpretation decisions (assumptions, documented per §10.4 latitude)

1. **Active time is movement-inclusive** (brief §10.4; audit finding 3): the active-time clock opens at the action's `MovementStarted` tick when a travel leg exists (the moving action's category resolves via its `ActionProposed` descriptor), else at `ActionStarted`, and closes at the earliest of `ActionCompleted`, `ActionInterrupted`, arrival `ActionRejected`, or scenario end. Travel toward an action that fails start validation on arrival is attributed to the selected category **without** counting an action start. `ActionStarted` alone governs start counts, mode-start distributions, category/mode transitions, and work-session counts; `longestWorkSessionTicks` measures continuous bench occupancy from `ActionStarted` (travel to the bench is not bench work). Verified by an isolated reference derivation over three frozen scenarios, five hand-computed synthetic event-shape tests, and a legacy-comparison test proving the clock strictly grew where travel exists.
2. **Transitions** count only between consecutive accepted `ActionStarted` events per NPC (§10.4's "changes between actual accepted action starts").
3. **Treatment fields are patient-perspective** (`firstTreatmentStartTick`, `treatmentCompletionTick`, `injuryWorsened`): the injury story belongs to the injured.
4. **Commitment counts are debtor-attributed** (`commitmentsFulfilledAsDebtor` / `BrokenAsDebtor`), resolved via `CommitmentCreated`; the per-run `commitmentTerminalStatus` is the ledger's `promiseOutcome` and is labeled per §10.11: *the mechanical commitment terminal status produced under VS001 rules — not a validated attribution of moral responsibility or realistic blame.*
5. **`mealTransferAcceptances`** = `ReservationTransferred` events with a non-null `requestId`, attributed to the granting owner.
6. **`helpRequestsAnswered` = `not-observable`**: VS001 offers no answering affordance; per §10.4 the absence is reported honestly, never as zero.
7. **Target-orientation buckets (§10.6D)** resolve NPC targets through the V1 role assignment (exports are v1-roles-only by construction): `role:benchWorker|debtor|mealOwner`, `resource:meal|workbench`, `untargeted`.
8. **Decision sources follow the explicit provider-source taxonomy** (audit finding 1) — never a negative comparison. `externalActionRequestsEmitted` counts `DecisionRequested` events addressed to a registered external action authority; `acceptedExternalActions` are their non-fallback acceptances; `policyExecutorDecisions` are non-fallback acceptances served by the local policy executor (parallel to `deterministicFallbackDecisions`); an action request addressed to the compilation authority is refused as mis-wired evidence; an unknown provider ID throws `ProviderClassificationError`. An emitted request is **not** an upstream call: `upstreamActionCalls*`/`upstreamPolicyCompilationCalls*` are `not-observable` from a plain ledger and may only be populated by gateway-trace evidence (M1 Run 6's 75-requests/10-calls distinction; proven by a real unanswered external-condition run in the tests). The formal M2 call-reduction evaluator must consume actual upstream trace counts.
9. **Relationship end-values** derive from the last `RelationshipChanged` per ordered pair (event-sourced; no state-shape dependency); needs at end come from the isolated reducer replay.
10. **Policy-condition fields** (`policyPatch*`, `policyCompilationRequestsEmitted`) are present with zero/empty values so the fingerprint vocabulary is stable when Phase 5 arrives; no policy-compilation lifecycle exists in the VS001 event vocabulary.
11. **Confidence and score diagnostics are never read** (R7): a mutation test proves the fingerprint is byte-identical when every `confidenceBp`/`scores` value in the ledger's decision events is altered. Rationale does not exist in canonical events at all.
12. **Provider-failure vocabulary** is the closed set the frozen engine can emit: the nine gateway-client codes plus `provider-exception` (the engine's catch-all) and `scripted-failure-mode` (scenario F's frozen failing provider, whose code lives inside the hashed event stream and is therefore immutable). All seven frozen scenarios — including the failed-run scenario F — fingerprint without error (§10.1), pinned by test (127 scripted failures in deterministic F). Any code outside the set is vocabulary drift and fails loudly (§10.3).
13. **Completion-time staleness is not interruption**: `stale-at-completion:<class>` reasons are the engine's universal completion discipline (outcome suppression of a finished action) and are excluded from the non-interruptible gap rule; the precise audited meaning of `non-interruptible` is "no voluntary preemption and no mode-specific mid-flight world-event termination." The interruption contracts therefore declare sustained classes only — every declared field is consumed by a check and proven by an engine test.
14. **Provenance separates plan from condition** (audit finding 4): `providerPlanId` is the ledger-proven `run.plan.id`; `registeredConditionId` is `not-observable` for ledger-only evidence and is populated only when a manifest or study plan proves it. A condition is never inferred from a provider plan; a future one-to-one mapping would itself require a versioned explicit registry.
15. **A pending own meal-transfer request satisfies the lawful-acquisition exit class** (audit §4.4): lawful acquisition is already in progress, and the engine correctly withholds a duplicate request affordance. The post-refusal cooldown is evaluated separately (decision recorded in §5).

## 5. Auditor design and the known-gap registry

- **Interruption contracts** declare, per action mode: the advertised `interruptible` flag (verified against every offer in every audited stream) and the mode-specific sustained termination classes, transcribed from `validateSustained` and **proven by direct engine tests** (patient-absent, meal-missing, bench-reservation-lost, actor-incapacitated). `non-interruptible` has one precise engine meaning: no voluntary preemption and no mode-specific mid-flight world-event termination; incapacitation, scenario end, and completion-time staleness (`stale-at-completion:` — universal completion discipline, not interruption) always apply to every action (§27.6, decision 13 above).
- **Commitment lifecycle contract** for `relieve-at-bench`: fulfillment recognition `automatic`, renegotiation `target-response-required` (response modes accept/reject-renegotiation), prevention/waiver `not-applicable` — VS001 as it actually is.
- **Registered dilemma checkpoint** `meal-scarcity-violation-choice`: whenever `eat-violation` is offered, the set must satisfy two consequentially distinct lawful exit classes (lawful-acquisition; forgo). Per the audit §4.4 refinement, the lawful-acquisition class is satisfied by an offered `request-transfer`, by the actor's own **pending** transfer request (acquisition in progress), or by the post-refusal **cooldown** (acquisition exercised and lawfully refused); the two world states are tracked from the transfer-request lifecycle events, evaluated separately, and reported per source in the audit's dilemma-statistics table.
- **Checks:** static declaration audit; per-stream advertised-flag conformance; dilemma exits; commitment resolution; renegotiation response opportunity while a proposal is pending. The audit CLI always audits fresh deterministic runs of all seven scenarios (keyless), every committed synthetic coverage fixture, plus any supplied ledgers.
- **Registry (four entries)** with exact-match classification per §27.7: treat/patient-absent, eat/meal-missing, eat-violation/meal-missing (the VS002 finding-3 family), and the scenario-C renegotiation response window. `KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW` was **removed per the audit's §4.4 ruling** — see the determination below.
- **Coverage guarantee (audit finding 2):** every entry declares at least one CI-exercisable coverage source (`static-contract`, `deterministic-scenario`, or `committed-synthetic-fixture`; `retained-live-evidence-fixture` is documentation-only and cannot satisfy CI alone — enforced by the registry schema). The audit reports `matchedKnownGapIds`, `unobservedKnownGapIds`, and `unregisteredFindings`, and passes only when both the unregistered and the unobserved sets are empty: a registered gap that stops being observed by its declared coverage is a regression of the audit itself. The three interruption gaps are covered by the static contract audit; the renegotiation gap by a committed synthetic fixture (`scripts/audit/fixtures/kg-vs001-renegotiation-response-window-events.json`) that reproduces the exact finding through the real `auditEventStream` code — a deleted or malformed fixture fails the audit. New registry entries require explicit Advisor approval after independent review of the detector's semantics.
- **Scenario-D determination (for re-audit).** Probe evidence over the frozen deterministic scenario D: the six offer sets presenting `eat-violation` without `request-transfer` split exactly into ticks 90/150 (Mara's own transfer request **pending**) and ticks 210–390 (post-refusal **cooldown**, `cooldownUntil` tick 810), with forgo modes (`work`, `request-break`, `rest`, `routine-work`, `wait`) offered in every one. Under the frozen affordance rules, `request-transfer` is withheld **exactly** when pending ∨ cooldown — so the refined detector fires only when the engine's own generation invariant is broken (proven by a mutation test). On the cooldown sub-state, the determination submitted for the Advisor's review is that it is **not** a missing-lawful-exit gap: a consequentially lawful non-violation path (forgo) remains offered in every observed cooldown set, and the acquisition path was actually exercised and lawfully resolved by the modeled counterparty's refusal — the cooldown is that resolution's social consequence, not an affordance-generation defect. The temptation-remains-while-the-owner-said-no squeeze is scenario D's intended dramatic state. No proposed registry entry is submitted; if the Advisor rules the cooldown state a genuine frozen gap, a scoped entry (scenario D, cooldown-only key) can be added under the approval rule above.
- **Verification against live evidence:** run locally against the five retained v1.2.0 live ledgers, the remediated auditor reports **5 known limitations** (the three static contract findings plus Run 5's two live scenario-C occurrences: treat/patient-absent and the renegotiation response window), **0 unregistered findings**, and **4/4 registered gaps observed** — the registry describes exactly what Milestone 1 documented, and every live dilemma evaluation resolves by offered modes alone.

## 6. Sample reports from retained Milestone 1 evidence

Generated with `eval:behavior`/`eval:compare` (git-ignored artifacts; regenerable from the archived ledgers). Headline Mara composites under the **movement-inclusive** metric — **descriptive, n=1 per condition; no statistical claim**:

| Comparison | Mara composite (bp) |
| --- | --- |
| A deterministic baseline vs A live (architecture change) | 6,672 |
| **B1 live vs B2 live (registered memory ablation, model condition)** | **9,999** |
| A live vs A gateway-stop (mid-run provider loss) | 6,056 |
| B1 vs B2 deterministic reference (provider designed to respond to the memory) | 7,189 |

The A-deterministic/A-live value equals the Phase 2 audit's independent movement-inclusive recomputation (§5.2: 6,691 → 6,672) to the basis point; the two live-vs-live pairs are unchanged by movement inclusion, exactly as the audit's analysis implied. The Milestone 1 descriptive finding — the memory intervention moved the model's rhetoric, not its behavior — remains a computed number: one basis point of separation under the model versus 2,811 under the deterministic reference. The laboratory's R2/R3 studies will determine whether that separation exceeds within-condition variance.

## 7. Test evidence

- Full suite at the remediated head: **60 files, 553 tests passing**. New coverage for the audit's required tests includes: the five hand-computed movement-inclusive synthetic event shapes plus an isolated reference derivation cross-checked on three frozen scenarios; the provider-taxonomy suite (unanswered external-condition engine run distinguishing emitted requests from upstream calls, policy-executor-is-local, upstream-capable registry, unknown-ID typed error, compilation-authority refusal); known-gap coverage (declared sources, fixture reproduction, missing-fixture failure, unobserved-entry failure, refined dilemma sub-state pins 2 pending / 4 cooldown on frozen scenario D, and the withheld-without-cause mutation guard); strict reviewer-score schema, duplicates, and coverage reporting; shared CLI parser. The frozen B1/B2 similarity regression pins are 5,634 categoryTime / 7,189 composite (movement-inclusive).
- `npm run validate` (architecture purity scan over `src/sim` + `src/shared`, including all new evaluator/audit modules): 0 errors, 0 warnings.
- `npm run batch`: PASSED, replay=match on all seven scenarios; `golden-hashes.test.ts` 7/7 — all fourteen pinned hashes byte-identical.
- Gateway suite 55/55; model-bundle suite 127/127; Playwright e2e 9/9; keyless rehearsal normal/gateway-stop/latency all strict-completed with replay matches.
- `npm run audit:affordances`: OK — 4 known limitations, 0 unregistered findings, **4/4 registered gaps observed by declared coverage** (the CI pass condition now requires both empty unregistered findings and empty unobserved-gap sets).
- CI retains the named step `Affordance and interruption-contract audit (known-gap registry)`, placed after the batch/rehearsal per the A10 ordering rule; its exit code now also enforces the coverage guarantee.

## 8. Known limitations

1. Sample-report numbers are descriptive n=1 values; every statistical question is deferred to the registered R2/R3 studies.
2. The B1/B2 similarity pins are frozen-deterministic-behavior regression constants; they move only with a new metric version.
3. `helpRequestsAnswered` is structurally `not-observable` under VS001, as are all four upstream-call fields from ledger-only evidence — populating the upstream fields requires gateway-trace evidence from a finalized run directory or orchestrated sequence (Phase 3+).
4. Policy-condition fingerprint fields are zero-valued placeholders until Phase 5.
5. Reviewer packages and identification rates are diagnostic instrumentation only (R6); no human-review study is registered, and the unbalanced M1 archives support no model-discrimination claim. The strict score schema is in place, but scorer hardening for a registered human study should be re-reviewed when such a study is registered.
6. The auditor's renegotiation-response check is windowed on observed streams; it cannot prove response availability under unreached states (the registered scenario-C gap is conditional by nature). Its CI coverage therefore runs through a committed synthetic fixture, not a deterministic scenario.
7. The registered known gaps remain unrepaired by design; resolution belongs to Vertical Slice 002 (§7.3).
8. The scenario-D cooldown determination (§5) is submitted for the Advisor's review; the refined detector intentionally reports the pending and cooldown sub-states separately so that ruling can be revisited with data.
