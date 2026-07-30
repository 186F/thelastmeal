# Milestone 2 — Phase 2 Laboratory Foundation — Implementation Report

**Package:** `1.7.0` (first Milestone 2 source PR)
**Governing documents:** [`MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) §10, §21, §27.6–§27.8, §31 Phase 2, and the authoritative [`MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md`](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md)
**Scope discipline:** no canonical simulation-mechanics change; no orchestrator, no M2 conditions, no policy system, no prompts, no commitment repair, no live API calls. All fourteen deterministic golden hashes are byte-identical (batch + explicit golden test at the implementation head).

## 1. What Phase 2 delivers

| Component | Files | Purpose |
| --- | --- | --- |
| Exact evaluator arithmetic | `src/sim/evaluation/arithmetic.ts` | `roundHalfAwayFromZero`, deterministic largest-remainder basis-point allocation, total-variation similarity, bounded-difference similarity, exact-match, integer mean |
| Versioned behavior contracts | `src/shared/behaviorArtifacts.ts` | strict zod schemas for fingerprints, similarity, comparisons; version literals; weights; fixed metric ranges; comparability rule |
| Fingerprint derivation | `src/sim/evaluation/behaviorFingerprint.ts` | one fingerprint per NPC from a validated ledger (§10.4), pure and Node-only |
| Similarity | `src/sim/evaluation/behaviorSimilarity.ts` | five weighted components + composite (§10.6–10.7) |
| Evaluation CLIs | `scripts/evaluation/behavior.ts`, `compare.ts`, `behaviorIo.ts` | `eval:behavior`, `eval:compare`; full ledger validation before evaluation; canonical JSON + Markdown out |
| Study registry | `src/shared/studyRegistry.ts`, `scripts/experiments/m2/studyRegistry.ts` | §21.1 declaration schema; §21.2 study-local freeze artifacts (`planSha256`, `configFingerprint`); `study:validate` |
| Auditors | `src/sim/audit/{contracts,findings,affordanceAudit,knownGaps}.ts`, `scripts/audit/affordances.ts` | interruption contracts, commitment lifecycle contracts, registered dilemma checkpoints, event-stream conformance, VS001 known-gap registry, `audit:affordances` CI step |
| Reviewer packages | `scripts/evaluation/{blinding,reviewerPackages}.ts` | blinded packages from validated live ledgers with separate answer keys and score import (`eval:reviewer-package`, `eval:score-reviews`) — non-gating (R6) |
| `liveSmoke.ts` repair | `scripts/model/liveSmoke.ts` | exported `runSmokeOnce`; no `process.exit` on any smoke path; `finally` always awaits `gateway.stop()`; CLI uses `stopWithFallback` semantics via `process.exitCode` (R9/§27.8) |

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

1. **Active ticks** open at `ActionStarted` and close at `ActionCompleted`/`ActionInterrupted` — byte-equal with the established `buildNpcStats` algorithm (cross-checked by test); movement legs are excluded because `ActionStarted` fires on arrival.
2. **Transitions** count only between consecutive accepted `ActionStarted` events per NPC (§10.4's "changes between actual accepted action starts").
3. **Treatment fields are patient-perspective** (`firstTreatmentStartTick`, `treatmentCompletionTick`, `injuryWorsened`): the injury story belongs to the injured.
4. **Commitment counts are debtor-attributed** (`commitmentsFulfilledAsDebtor` / `BrokenAsDebtor`), resolved via `CommitmentCreated`; the per-run `commitmentTerminalStatus` is the ledger's `promiseOutcome` and is labeled per §10.11: *the mechanical commitment terminal status produced under VS001 rules — not a validated attribution of moral responsibility or realistic blame.*
5. **`mealTransferAcceptances`** = `ReservationTransferred` events with a non-null `requestId`, attributed to the granting owner.
6. **`helpRequestsAnswered` = `not-observable`**: VS001 offers no answering affordance; per §10.4 the absence is reported honestly, never as zero.
7. **Target-orientation buckets (§10.6D)** resolve NPC targets through the V1 role assignment (exports are v1-roles-only by construction): `role:benchWorker|debtor|mealOwner`, `resource:meal|workbench`, `untargeted`.
8. **External calls** are `DecisionRequested` events whose `providerId` differs from `deterministic-utility-v1`; `acceptedExternalActions` require `usedFallback === false`.
9. **Relationship end-values** derive from the last `RelationshipChanged` per ordered pair (event-sourced; no state-shape dependency); needs at end come from the isolated reducer replay.
10. **Policy-condition fields** (`policyPatch*`, `policyCompilationCalls`) are present with zero/empty values so the fingerprint vocabulary is stable when Phase 5 arrives.
11. **Confidence and score diagnostics are never read** (R7): a mutation test proves the fingerprint is byte-identical when every `confidenceBp`/`scores` value in the ledger's decision events is altered. Rationale does not exist in canonical events at all.

## 5. Auditor design and the known-gap registry

- **Interruption contracts** declare, per action mode: the advertised `interruptible` flag (verified against every offer in every audited stream) and the mode-specific sustained/completion termination classes, transcribed from `validateSustained`/`validateCompletion` and **proven by direct engine tests** (patient-absent, meal-missing, bench-reservation-lost, actor-incapacitated). `non-interruptible` has one precise engine meaning: no voluntary preemption and no mode-specific world-event termination; incapacitation and scenario end always terminate everything (§27.6).
- **Commitment lifecycle contract** for `relieve-at-bench`: fulfillment recognition `automatic`, renegotiation `target-response-required` (response modes accept/reject-renegotiation), prevention/waiver `not-applicable` — VS001 as it actually is.
- **Registered dilemma checkpoint** `meal-scarcity-violation-choice`: whenever `eat-violation` is offered, the set must contain two consequentially distinct lawful exit classes (lawful-acquisition; forgo).
- **Checks:** static declaration audit; per-stream advertised-flag conformance; dilemma exits; commitment resolution; renegotiation response opportunity while a proposal is pending. The audit CLI always audits fresh deterministic runs of all seven scenarios (keyless) plus any supplied ledgers.
- **Registry (six entries)** with exact-match classification per §27.7: treat/patient-absent, eat/meal-missing, eat-violation/meal-missing (the VS002 finding-3 family), the scenario-C renegotiation response window, and one **new Phase 2 discovery**: `KG-VS001-MEAL-DILEMMA-REQUEST-WINDOW` — while an actor's own transfer request is pending (`no-pending-own-request`) and during the post-refusal cooldown, `request-transfer` is withheld while `eat-violation` remains offered. First detected by the auditor in deterministic scenario D at tick 90; registered, not repaired.
- **Verification against live evidence:** run locally against the retained M1 gap-bearing ledgers (v1.2.0 Run 5 C and v1.1.0 Run 2 A), the auditor reports 7 known limitations and 0 unregistered findings — the registry describes exactly what Milestone 1 documented.

## 6. Sample reports from retained Milestone 1 evidence

Generated with `eval:behavior`/`eval:compare` into `artifacts/behavior-eval/m1-samples/` (git-ignored; regenerable from the archived ledgers). Headline Mara composites — **descriptive, n=1 per condition; no statistical claim**:

| Comparison | Mara composite (bp) |
| --- | --- |
| A deterministic baseline vs A live (architecture change) | 6,691 |
| **B1 live vs B2 live (registered memory ablation, model condition)** | **9,999** |
| A live vs A gateway-stop (mid-run provider loss) | 6,056 |
| B1 vs B2 deterministic reference (provider designed to respond to the memory) | 7,018 |

The Milestone 1 descriptive finding — the memory intervention moved the model's rhetoric, not its behavior — is now a computed number: one basis point of separation under the model versus 2,982 under the deterministic reference. The laboratory's R2/R3 studies will determine whether that separation exceeds within-condition variance.

## 7. Test evidence

- Full suite at the implementation head: **59 files, 518 tests passing** (58 new across seven files: arithmetic pins, fingerprint derivation + confidence-exclusion mutation guard, similarity pins incl. frozen B1/B2 regression constants (5,147 categoryTime / 7,018 composite), auditor + engine-conformance proofs + mis-advertisement mutation guard, study registry + freeze artifacts, liveSmoke shutdown contract (all four §27.8 cases), reviewer-package blinding/leak/scoring).
- `npm run validate` (architecture purity scan over `src/sim` + `src/shared`, including all new evaluator/audit modules): 0 errors, 0 warnings.
- `npm run batch`: PASSED, replay=match on all seven scenarios; `golden-hashes.test.ts` 7/7 — all fourteen pinned hashes byte-identical.
- Gateway suite 55/55; model-bundle suite 127/127.
- CI gains one named step: `Affordance and interruption-contract audit (known-gap registry)`, placed after the batch/rehearsal per the A10 ordering rule.

## 8. Known limitations

1. Sample-report numbers are descriptive n=1 values; every statistical question is deferred to the registered R2/R3 studies.
2. The B1/B2 similarity pins are frozen-deterministic-behavior regression constants; they move only with a new metric version.
3. `helpRequestsAnswered` is structurally `not-observable` under VS001.
4. Policy-condition fingerprint fields are zero-valued placeholders until Phase 5.
5. Reviewer packages and identification rates are diagnostic instrumentation only (R6); no human-review study is registered, and the unbalanced M1 archives support no model-discrimination claim.
6. The auditor's renegotiation-response check is windowed on observed streams; it cannot prove response availability under unreached states (the registered scenario-C gap is conditional by nature).
7. The registered known gaps remain unrepaired by design; resolution belongs to Vertical Slice 002 (§7.3).
