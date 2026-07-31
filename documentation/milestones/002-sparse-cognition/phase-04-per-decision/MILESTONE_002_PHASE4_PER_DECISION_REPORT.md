# Milestone 2 Phase 4 — M2 Per-Decision Comparator: Implementation Report

**Package version:** 1.9.0 · **Experiment:** `sparse-cognition-policy-001` v1.0.0 (unchanged)
**Governing documents:** [implementation brief](../MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) · [scope ruling](../MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) (ruling governs on ambiguity)
**Directive:** the Advisor's Phase 4 authorization of 2026-07-31 (branch from `ad223be`, implement §31 Phase 4, register the formal profile and Stage A study configuration, bounded tracing before any 1× live run, exercise everything keylessly, stop for audit)
**Live model calls made during this phase:** **zero.** Stage A and the calibration study are PREPARED, not executed.

---

## 1. Scope delivered

| # | Directive item | Delivered by |
| - | -------------- | ------------ |
| 1 | M2 action condition + prompt (`mara-model-per-decision-m2-v1` / `openrouter-mara-action-m2-v1` / `mara-action-selection-m2-1.0.0`) | §2 below |
| 2 | M1 identities, artifacts, scenarios, mechanics, and all fourteen golden hashes preserved | §2.6, §6 |
| 3 | Formal attempt profile + exact Stage A study configuration registered | §3 |
| 4 | Bounded/chunked Playwright tracing, evidence-size forecasting, explicit retention | §4 |
| 5 | Stage A plan prepared (Run 1 baseline off, Run 2 M2 per-decision live) | §3.3 |
| 6 | Registered variance-calibration study `m2-calibration-variance-a-001` prepared | §3.3 |
| 7 | Everything exercised keylessly through the fake adapter | §5 |
| 8 | Exact-head CI + stop for audit | PR body records the run |

Out of scope and NOT touched, per the directive: policy patches, the policy
compiler, the local policy interpreter, the novelty broker, policy
lifecycle state, the policy-patch condition (`m2:pilot` remains a refusal
stub), dialogue, reflection, memories, additional model-backed NPCs, new
scenarios, and simulation-mechanics repairs.

## 2. The M2 per-decision condition

### 2.1 The condition-contract registry (new: `src/shared/conditionContract.ts`)

Every MODEL-BACKED condition is paired with its complete registered
identity — experiment id/version, provider id, prompt version, target NPC,
upstream platform, scenario coverage, and its **diagnostic contract**
(`m1-strict` or `m2-normalized`) — in one closed registry. Consumers
resolve everything from the condition id; no site can mix identities:

- **engine** (`src/sim/decisions/conditions.ts`): the M2 condition resolves
  to the identical per-NPC wiring as Milestone 1 — Mara on an
  `ExternalDeferredProvider` bound to `openrouter-mara-action-m2-v1`, Jonas
  and Rin deterministic — with its own condition-carried request validator
  and the same scenario coverage (A, B1, B2, C, D, E; Scenario F stays
  deterministic-only). Engine-side authority is UNCHANGED: the revised
  diagnostic contract lives entirely at the gateway boundary (§9.2:
  "behaviorally equivalent in authority").
- **transport envelope** (`externalSchemas.ts`): the conditionId enum grew,
  and the experiment identity became an exact per-condition PAIRING — an
  M2 condition envelope must carry `sparse-cognition-policy-001` v1.0.0,
  M1 envelopes the frozen M1 identity, every mixture refused. The schema
  version stays 1: every previously valid envelope remains byte-identically
  valid (the registry grew; the wire shape did not).
- **browser client** (`modelGatewayClient.ts`): contract pins, envelopes,
  the request filter, and client-trace rows all derive from the SELECTED
  condition's registered contract via an accessor; a condition change
  always passes through a run reset.
- **run bundle** (`runBundle.ts`): the handoff identity comes from the
  selected condition's contract, and validation now also proves the
  handoff's identity fields against the bundle's own declared condition —
  a mixed-identity bundle can never validate.
- **gateway**: one process serves exactly ONE registered pairing, selected
  by the nonsecret `MODEL_GATEWAY_CONDITION_ID` variable (default: the M1
  condition, preserving all pre-Phase-4 behavior). `/v1/provider-config`
  advertises the served contract; the identity gate and prompt/parser
  selection follow it. The orchestrator's per-attempt fresh gateway child
  is pinned to the attempt's condition.
- **finalizer** (`scripts/model/finalize.ts`): previously pinned M1
  literals at three verification layers; it now derives the expected
  identity from the manifest's conditionId via the registry (an
  unregistered condition is a contradiction) and enforces full agreement
  across manifest, bundle handoff, and every archived envelope. The
  orchestrator separately verifies the finalized manifest against the
  reviewed plan's expected treatment, so a run cannot pass by being merely
  self-consistent under the wrong condition.

### 2.2 The M2 prompt (`gateway/prompts/maraActionSelectionM2.ts`)

A NEW parallel module bound to `mara-action-selection-m2-1.0.0`; the frozen
M1 module is untouched. Framing and world presentation are deliberately
retained from Milestone 1 (the treatment change is the output contract, not
the world description, §17.2); the output instruction now names the two
structural fields as required and describes rationale/confidence as
optional diagnostic notes that "never affect what happens in the
simulation". The upstream JSON Schema requires only
`selectedAffordanceId` + `reasonCode` and REQUESTS a bounded rationale —
local acceptance never trusts that bound (§17.5).

### 2.3 The revised diagnostic-output contract (`gateway/adapters/m2DecisionContract.ts`)

`parseM2Choice` validates the structural fields strictly (offered-set enum,
bounded reason codes — the same nine as M1) and normalizes the diagnostics:

- rationale: missing, non-string, or overlong → null or truncated to the
  fixed trace limit, with `rationaleNormalized: true`. A structurally valid
  choice can NEVER become `invalid-model-output` because of rationale —
  Milestone 1's seven rationale-length live failures are impossible by
  construction under this contract.
- confidence: a non-conforming or absent claim → null. The engine
  response's required `confidenceBp` field carries the claim when present,
  else the fixed constant 0 (the ruling's permitted compatibility field,
  diagnostic only). The trace additionally records the claim under the
  ruling's required explicit name `selfReportedConfidenceBp`.
- unknown extra fields are tolerated and never stored; structural failures
  (unoffered id, invalid reason code, non-object) still fail exactly as
  before, with bounded raw capture.

### 2.4 Trace rows

M2 rows add two ADDITIVE OPTIONAL fields to trace schema v2 —
`rationaleNormalized` (always present on M2 rows) and
`selfReportedConfidenceBp` — and are never present on M1 rows. Every
previously written v2 row validates byte-identically; the schema version
does not move. The run-manifest seed already carried its identity from the
envelope, so M2 manifests record the M2 experiment automatically.

### 2.5 Orchestrator integration

- `ORCHESTRATABLE_CONDITION_IDS` gains the M2 condition; M2 attempts
  require a gateway and fail statically outside the M2 scenario set.
- **One sequence, one treatment:** a plan mixing model-backed conditions is
  refused (`plan-mixes-model-conditions`), and a plan whose
  `expectedTreatment` contradicts its condition's registered contract is
  refused statically (`expected-treatment-contradicts-condition-contract`).
- The sequence resume identity, study reconciliation context, and
  pre-Start gateway treatment verification all derive the experiment
  identity from the plan's model condition (`planExperimentIdentity`);
  deterministic-only plans keep recording the M1 experiment, preserving
  Phase 3 sequence identities byte-for-byte.

### 2.6 Frozen surface

`modelExperiment.ts`, the M1 prompt module, `modelChoiceSchema`, the M1
condition wiring, and all M1 artifacts are unmodified. The full suite pins
this: all fourteen deterministic golden hashes are byte-identical, and a
dedicated regression test proves an overlong rationale under the SERVED M1
condition still fails as `invalid-model-output` with no normalization flag.

## 3. Formal attempt profile, studies, and the registration ritual

### 3.1 The formal profile (`m2-formal-attempt-profile` v1.0.0)

Registered alongside its studies, lifting `parsePlan`'s
`formal-attempt-profile-required` refusal. Every numeric bound is
pre-registered in the brief, not chosen ad hoc: treatment thresholds are
the §23.2 upstream reliability gate (completion/attempted ≥ 0.90, in basis
points ≥ 9,000, plus ≥ 1 attempted call) — and a normalized-rationale
output still counts as completed, which the M2 contract guarantees by
construction; the replacement cap is §24.2's ONE identical replacement;
the stop rule carries §24.5. Artifact gates are the rehearsal profile's
plus the §23.1 `no-budget-exhausted-failure` per-run integrity gate: a
primary run with any budget-exhausted upstream call (read from the final
manifest's failure categories) is preserved as `invalid-treatment`, with
the planned gateway-stop run exempt per §23.8. Gateway lifecycle is
identical to the rehearsal profile, which exists precisely to exercise
the shared gates keylessly.

### 3.2 The registration ritual (`m2:register`, new `scripts/experiments/m2/register.ts`)

A registered study must pin ONE exact repository SHA (§21.2), but a
tracked file cannot contain the SHA of the commit that introduces it. The
resolution: the tracked, reviewed TEMPLATES
(`experiments/m2/templates/*.template.json`) carry schema-valid sentinel
pins that can never match a real HEAD; `npm run m2:register` stamps them —
by pure text substitution of exactly the sentinels — into REGISTERED
instances at the operator's clean HEAD, in a directory OUTSIDE the
repository, immediately before execution. The registered study is
re-validated through the registry pipeline (freeze record written beside
it); the registered plan receives the study's real byte-sha256 and config
fingerprint and is parsed under the complete orchestrator schema. The
ritual is create-once per output directory and refuses dirty worktrees,
double stamping, and in-repo output. The orchestrator's existing freeze
machinery then enforces the pins for the sequence lifetime.

### 3.3 The two registered studies

- **`m2-stage-a-acceptance-001`** (status: pilot, n = 2): Run 1 Scenario A
  deterministic baseline gateway-off; Run 2 Scenario A M2 per-decision
  live. Bound to the formal profile; §19.16 requirements as primary
  metrics; measured 1× evidence sizes as a named secondary output (the
  §8.2 measurement that gates the formal sequence); live-call budget 240 =
  the §19.14 worst case (1 live attempt × min(120,120) × (1 + 1
  replacement)).
- **`m2-calibration-variance-a-001`** (status: calibration, n = 10,
  scenario A, seed 1001, speed 1×): the §22.6/R2 registration verbatim —
  research question, required outputs, no-hypothesis statement, exclusion
  rules, §4.5 change-control consequence, budget 2400. Explicitly NOT an
  acceptance gate.

Both plans use the exact formal timing profile (75 min / 120 s / ≤60 s
heartbeat), 1× pacing, out-of-repo output roots under
`../thelastmeal-m2-sparse-cognition-001/`, `postSequenceBatch: true`, and
ten-minute trace chunks. Stage A execution order (§19.16 "both must pass
before R2 begins") is operational sequencing enforced by the runbook and
the study registrations; neither plan is runnable until registered at a
merged SHA, and none was run.

## 4. Bounded tracing, forecasting, retention

- **Chunked rotation** (`browserDriver.ts`): tracing starts once per
  attempt and rotates on a plan-configurable cadence
  (`tracing.chunkIntervalMs`, minimum 60 s, default 10 min, part of the
  plan config fingerprint). Rotated chunks land in
  `trace-chunks/attempt-trace-chunk-NNN.zip`; the final (often only) chunk
  lands at the existing contract name (`attempt-trace.zip`, or
  `failure-trace.zip` on terminal failure), so attempts shorter than one
  interval produce exactly the pre-Phase-4 artifact shape. A
  `trace-manifest.json` records the cadence, every chunk with its size,
  the total, and the explicit policy `retain-all-chunks` (§19.12: no raw
  trace is ever discarded). Heartbeats expose `traceChunksWritten` and
  `traceBytesWritten`; browser provenance records the cadence and policy.
- **Attempt-level forecasting**: at every rotation, cumulative trace bytes
  are extrapolated to the attempt's full wall-clock allowance; a
  projection exceeding the sequence evidence budget fails the attempt
  EARLY as `evidence-budget-exceeded: forecast …` instead of discovering
  the overrun after hours of live spend.
- **Sequence-level forecasting**: before each execution, with at least one
  execution measured, the observed average per execution is projected over
  the next execution; a budget the sequence cannot absorb refuses BEFORE
  spending (`sequence-failed:evidence-forecast`).
- Phase 3's machinery (free-disk preflight, before/after root measurement,
  archive cap, bounded nested scans, no source embedding) is unchanged
  beneath this. Formal 1× evidence sizes must still be MEASURED during
  Stage A — registered as a Stage A output — before the 25-run sequence is
  authorized.

## 5. Keyless exercise (zero live calls)

- **Rehearsal part 9** (`m2:rehearse`, CI): two accelerated fake-gateway
  attempts under the M2 condition — one plain, one with the planned
  tick-900 gateway stop — through the complete pipeline: M2 treatment
  verification against the gateway's advertised contract, strict
  finalization, exact in-browser replay, evidence enrichment, sealing,
  packaging, and an identity-checked no-op resume. Asserted: the sequence
  identity records `sparse-cognition-policy-001` / M2 prompt / M2
  provider; every execution is artifact-valid AND study-valid; every
  accepted trace row carries `rationaleNormalized`; every retained trace
  chunk exists with its manifest; heartbeats carry rotation fields; the
  no-op resume changes no byte. Because the browser driver selects the
  condition through the REAL operator select, this is also the §27.3
  proof that the M2 condition appears and loads correctly in the UI.
  An incidental validation: the first rehearsal run of this phase FAILED
  with a freeze violation because the package version was bumped
  mid-sequence during development — the freeze recheck caught the drift
  between executions exactly as designed.
- **Gateway suite**: the M2-served gateway end to end through real HTTP —
  contract advertisement, cross-pairing refusals, wire-level normalization
  (overlong → truncated+flagged 200 response; absent rationale+confidence
  → nulls, compatibility constant, flagged), structural failures still
  failing with bounded raw capture, and the M1-served regression pin.
- **Unit/integration**: the contract registry pins; engine-level M2
  condition (Mara-only requests bound to the M2 provider, Scenario F
  refused); the envelope pairing matrix; the `parseM2Choice` normalization
  matrix (§27.1 "rationale normalization without structural rejection");
  legacy condition registration intact (§27.1); Phase 4 plan rules; the
  formal profile's pre-registered values incl. the 90.00%/89.99% §23.2
  boundary; the registration ritual against scratch repositories (both
  template pairs stamped, validated, hashed, and fully plan-parsed).
- **Failure paths**: the §27.4 mutation concerns are covered structurally:
  rationale length cannot gate acceptance (normalization matrix + wire
  tests), and the confidence value never reaches any control path (the
  response carries it as an inert diagnostic; the M2 engine wiring is
  byte-identical to M1's authority path, whose independence is already
  pinned).

Full-suite evidence at the PR head (exact numbers recorded in the PR
body): every unit/integration/gateway/bundle/e2e suite green; the
deterministic batch byte-identical against all fourteen golden hashes;
`m2:rehearse` OK with all nine parts.

## 5.1 Pre-push adversarial round

Per project convention, the implementation was adversarially reviewed
before push: six review dimensions (frozen-surface byte-compatibility,
§17.5 contract, profiles/studies/registration, orchestrator identity,
tracing lifecycle, directive scope and documentation truth) with one
adversarial refuter per claim, 26 agents total. Twenty findings were
raised; ten were refuted; ten confirmed (several duplicates across
dimensions), and every confirmed defect was fixed before push:

1. **`verifyFinalManifestTreatment` still pinned the Milestone 1 provider
   id** — every M2 attempt would have failed `treatment-mismatch` at the
   FINAL verification stage (a reviewer proved it by running the committed
   M2 rehearsal plan through the real orchestrator). Fixed by deriving the
   expected identity from the treatment's condition via the registered
   contract — strictly stronger than before, since the plan schema already
   pins the treatment block to the reviewed contract — and extended to
   also verify the manifest's experiment id/version. Regression tests now
   drive M2 manifests (right and wrong provider/experiment) through the
   check.
2. **§23.1's "no budget-exhausted failure" gate was enforced nowhere** —
   added to the formal profile's artifact gates and enforced from the
   final manifest's failure categories (§23.8 gateway-stop exemption
   honored), classifying violations as `invalid-treatment`.
3. **The attempt-level evidence forecast mixed measurement windows**
   (bytes since tracing start over time since run start), overstating the
   rate without bound — rate and horizon now share the tracing-start
   origin.
4. Documentation corrections: the technical reference's release header,
   a contradictory phase status in the documentation index, and a
   systematic miscitation of the confidence ruling as "R9" (it is R7
   §9.2) across code, tests, and schema comments.

The same review CONFIRMED clean, with independent end-to-end probes: M1
gateway responses and trace rows byte-identical to the merge base
(including JSON key order), the envelope widening rejecting nothing
previously valid, the finalizer not weakenable by a forged conditionId,
and all fourteen golden hashes intact. Separately, live rehearsal
failures during development validated two guardrails for free: a
mid-sequence package-version bump was caught by the freeze recheck, and a
stale IPv6-bound Vite imposter was caught by navigation detection — the
latter also motivating a new readiness check that refuses to proceed when
the orchestrator's own Vite child has exited (`vite-start-failed`),
since any server answering then is definitionally not ours.

## 6. Interpretation decisions (for audit)

1. **M2 artifact names** (§18.1): M2 per-decision runs keep the existing
   trace/artifact file names (`model-trace.jsonl`,
   `finalized-trace.jsonl`, `requests/<id>.json`, `routing/<id>.json`).
   §18.1 grants "exact names may differ, but every source must be
   unambiguous and recursively hash-bound" — both hold today, because
   per-decision runs contain only action requests. The
   `requests/action/` vs `requests/policy/` split becomes meaningful, and
   will be introduced, in Phase 5 when policy requests exist.
2. **The fixed trace limit** is `M2_RATIONALE_TRACE_MAX_CHARS = 600`
   (`m2Experiment.ts`). The brief pins no number; per R7 the remedy is
   normalization, not the bound — the bound only caps trace growth. It is
   deliberately larger than M1's 160-character structural cap and bound to
   the prompt version.
3. **Missing rationale is flagged** as normalized: §17.5 lists missing
   among the normalization cases, and the R2 rationale-normalization
   frequency should count absent rationales.
4. **The confidence compatibility value** is the constant 0 when the model
   reports none: deterministic in the model output, visibly a floor
   value, and inert in every control path. The raw claim (or null) lives
   in the trace as `selfReportedConfidenceBp`.
5. **Trace schema version stays 2** with two additive optional M2-only
   fields; every previously written row validates byte-identically. A
   version bump would have forced needless churn through the frozen M1
   verification chain.
6. **One plan, one model-backed condition**: mixed-condition plans are
   statically refused in Phase 4. The later formal design's paired
   per-decision/policy-patch plans arrive with Phase 5+ and will be
   reviewed with the multiplicity binding scheduled there.
7. **Sequence identity of deterministic-only plans** continues to record
   the M1 experiment (Phase 3 behavior preserved); any plan containing a
   model-backed attempt records that condition's experiment.
8. **Stage A ordering** (baseline before live, Stage A before R2) is
   enforced operationally (runbook + study registration + the §19.16
   gate), not by new plan-schema machinery: both Stage A runs live in one
   reviewed plan whose attempt order is the run order (`plan-order`).

## 7. Known limitations and scheduled work

1. Stage A and the calibration study are prepared, not executed; they
   require the merged SHA, the `m2:register` ritual, `M2_LIVE_RUNS=1`,
   `--acknowledge-live-cost`, and the Advisor's explicit go-ahead. Formal
   1× evidence sizes are MEASURED during Stage A before the 25-run
   sequence is authorized.
2. The observation-cell/replicate-multiplicity binding for multi-condition
   formal designs remains scheduled with the Phase 5+ paired plans
   (focused re-audit §8.1; current set-based reconciliation is sufficient
   for the single-cell Stage A and R2 designs).
3. The policy system, Stage B, the pilot, and the formal sequence remain
   Phases 5–8; `m2:pilot` still refuses.
