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
pins that can never match a real HEAD; `npm run m2:register` stamps them
into REGISTERED instances at the operator's clean HEAD, in a directory
OUTSIDE the repository, immediately before execution. After the audit
remediation round the ritual is CLOSED, GIT-AUTHENTICATED, and
TRANSACTIONAL (§6.1 item 3): callers select a registration by id from the
closed `REGISTRATION_REGISTRY` (`stage-a`, `calibration-variance-a`) —
template paths never come from the command line; each template's committed
bytes are loaded via `git show HEAD:<path>`, working-tree equality is
judged by `git diff --quiet`, and the blob ids and SHA-256 digests enter a
`registration-provenance.json` whose hash is stamped into the registered
plan (and thereby the configuration fingerprint, resume identity, and every
freeze checkpoint); the committed templates must BE the registered pair
(study id/version, plan sequence id, study binding, and attempt profile
are each enforced, with cross-pairing swaps refused by test); a
calibration registration additionally requires a cryptographically
verified Stage A prerequisite (§3.3); and every output is built and
validated in a `.staging` sibling then atomically renamed into the
create-once destination — a failure at any stage leaves no partial
registration. The registered study is re-validated through the registry
pipeline (freeze record written beside it, metric-producer completeness
asserted); the registered plan receives the study's real byte-sha256 and
config fingerprint and is parsed under the complete orchestrator schema.
The ritual refuses dirty worktrees, double stamping, and in-repo output.
The orchestrator's existing freeze machinery then enforces the pins for
the sequence lifetime.

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
ten-minute trace chunks. Stage A ordering (§19.16 "both must pass before
R2 begins") is MECHANICALLY enforced since the remediation round (§6.1
item 2): the calibration registration refuses outright unless a completed
Stage A sequence root passes end-to-end cryptographic verification at the
same repository SHA, carries the registered `stage-a` identity (study,
version, sequence, attempt profile — any other completed sequence
refuses), and satisfied the live-model requirement; the resulting
prerequisite record's SHA-256 is stamped into the registered calibration
study and plan, entering the freeze projection, configuration fingerprint,
resume identity, and every freeze checkpoint. Neither plan is runnable
until registered at a merged SHA, and none was run.

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
8. **Stage A ordering** (baseline before live, Stage A before R2):
   baseline-before-live lives in one reviewed plan whose attempt order is
   the run order (`plan-order`); Stage-A-before-R2 was operational in the
   audited head and is mechanically enforced since the remediation round —
   calibration registration refuses without a verified Stage A prerequisite
   bound to the registered `stage-a` identity at the same repository SHA
   (§3.3, §6.1 item 2).

## 6.1 Audit remediation round (audit commit `99eefbc`)

The Advisor's Phase 4 audit accepted the comparator architecture (§7) and
requested changes on four study-governance/operations findings; all four
are remediated in this round:

1. **Versioned calibration analyzer** (`m2-calibration-variance-analysis-1.0.0`,
   `src/shared/calibrationAnalysis.ts` + `scripts/evaluation/calibrationVariance.ts`,
   `npm run m2:analyze`): a distinct installed analysis program emitting
   deterministic canonical JSON plus Markdown with every registered R2
   output — the full pairwise matrix with distances and pairing
   classifications; median/p10/p25/p75/p90 composite similarity under an
   EXACTLY defined quantile algorithm (type-7 linear interpolation,
   floor-rounded milli-units, integer arithmetic); first-divergence under
   the matched-decision rule (ordinal pairs comparable only while context
   hash — covering semantic world context, beliefs, memories, activity
   state — hard-dependency fingerprint, and offered-affordance lists all
   match; ordinal matching explicitly invalid after first divergence);
   action-category/mode/transition entropies in milli-bits (base 2, the
   §6.3 TRUE-floor algorithm — never `Math.log2` — zero counts excluded,
   populations documented in the report
   itself); outcome frequencies (commitment outcomes labeled as mechanical
   terminal statuses, never moral blame); and the operational set reported
   PER RUN and IN AGGREGATE (§3.4.F) — per-run request/acceptance counts,
   coverage, failure categories, latency and token distributions, and a
   per-run route-consistency verdict, plus aggregate emitted/accepted
   totals, pooled floored coverage, summed failure categories, pooled
   latency/token distributions, rationale-normalization frequency, and
   distinct returned-model/serving-provider sets with an aggregate route
   verdict. A CLOSED metric-producer registry
   maps every registrable metric ID to its installed producer;
   registration AND study reconciliation refuse a study declaring an
   unimplemented metric or an uninstalled analysis version. Both study
   templates now declare machine metric IDs. The §3.5 synthetic ten-run
   fixture drives the pure analysis core: 45 pairs, quantile boundaries
   and ties, entropy closed forms and floors (including transition
   entropy asserted against its registered population), the divergence
   matrix, returned-model inconsistency, exclusions, byte-identical
   repetition, and the create-once write/render path; the filesystem
   entry point (`analyzeCalibrationSequence`/`loadRunEvidence`) is
   additionally drilled against REAL orchestrated evidence — the
   validated-ledger decision-timeline join, the deterministic-run
   exclusion, and refusals of non-completed sequences, doctored verdicts,
   and non-strict-finalized run directories.
2. **Authenticated Stage A prerequisite**
   (`scripts/experiments/m2/stageAPrerequisite.ts`,
   `m2-stage-a-prerequisite-1.0.0`): calibration registration VERIFIES a
   completed Stage A root end to end (identity-checked archived plan,
   every seal, strict inventory with recomputed aggregate, tree bytes,
   immutable manifest reconciled against control state, semantic
   revalidation, archive + digest sidecar + receipt + extraction) and
   builds the canonical record — Stage A study/sequence identity,
   repository SHA (must equal the calibration HEAD: any source change
   after Stage A forces Stage A to run again), package/experiment/profile
   identity, both execution IDs with conditions and gateway modes, prompt/
   model/route identity, manifest/archive/receipt hashes, artifact/study/
   replay/strict-finalization/threshold verdicts, the packaging-enforced
   secret-scan witness, and the inventory aggregate. The record's SHA-256
   is stamped into the registered calibration study (freeze projection)
   and plan (configuration fingerprint → resume identity → every freeze
   checkpoint). The ruling's live requirement is enforced: fake-gateway
   Stage A evidence refuses unless the provenance-recorded drill flag is
   set. The evidence must also BE the registered Stage A sequence: a real
   calibration registration binds the prerequisite to the closed
   registry's `stage-a` identity (study id/version, sequence id, attempt
   profile), so any OTHER completed two-attempt sequence at the right SHA
   refuses on identity. Drills run against ONE real keyless Stage
   A-shaped sequence
   (`plans/stage-a-drill.json`) with per-case tampered copies: missing
   attempts, doctored verdicts, rewritten archived plan, modified
   inventory, flipped archive byte, SHA mismatch, the identity-binding
   refusal, plus the end-to-end registration binding.
3. **Closed Git-authenticated transactional registration**
   (`register.ts` rework): `m2:register` now takes `--registration
   <stage-a|calibration-variance-a>` — template paths come from the closed
   registry, never the command line. Every source is authenticated against
   `git show HEAD:<path>` (working tree must match HEAD, git's own
   eol-aware judgment), its blob ID and committed-byte SHA-256 recorded in
   `registration-provenance.json`, whose hash is stamped into the
   registered plan's fingerprint; the study instance carries its source
   blob/hash in its own bytes and freeze projection. Pairing is enforced
   (study id/version, plan sequence id, study binding, profile binding);
   output is built in a staging sibling and atomically renamed into the
   create-once destination — a failure leaves nothing, including failures
   INSIDE the staging transaction (drilled with a committed template that
   passes pairing but fails the metric-producer gate after staging
   begins). Refusal tests cover unknown registrations, modified/untracked
   sources, all four cross-pairing template swaps (each registration's
   study and plan slots fed the OTHER pair's committed bytes, refused with
   the offending field named), in-repo output, double registration, and
   partial-output cleanup.
4. **CI artifact profiles** (`scripts/ci/prepareCompactArtifact.mjs` +
   workflow rework): routine PR/`main` runs execute and verify the FULL
   rehearsal locally on the runner but upload only compact proof —
   manifests, reports, control state, inventories, digest sidecars,
   receipts, trace manifests, failure manifests — assembled by an
   allowlist that hard-refuses ZIP/trace/image payloads, gated by a
   registered ≤ 50 MiB budget with a machine-readable
   `artifact-size-report.json` before upload (measured compact output:
   ~0.2 MiB), retention 21 days. Full evidence uploads only on a failing
   run or an explicit `workflow_dispatch` full-evidence input, retention
   7 days, and is itself assembled by the same script under
   `--profile full`: each sequence payload uploads exactly ONCE (sealed
   ZIP + digest sidecar + receipt for archived sequences, whose raw trees
   are contained in the ZIPs and excluded, plus the packaging-recovery
   drill's preserved superseded archive as evidence; raw trees only for
   never-archived sequences such as the failure drill), under a
   registered ≤ 4 GiB full budget — measured ~2.7 GiB for the complete
   keyless rehearsal set — with per-sequence uniqueness
   dispositions in its own pre-upload `artifact-size-report.json`. Every
   workflow upload now carries explicit `retention-days`.
   Formal live evidence is retained locally as sealed packages with
   independent durable backup — never entrusted to expiring Actions
   artifacts.

## 6.2 Remediation verification round

The remediation itself was adversarially reviewed (27 read-only agents
across the four finding areas plus regressions/documentation, each claim
independently refuted or confirmed). Ten confirmed findings were applied
before this head: analyzer §3.4.F per-run/aggregate completeness and §3.5
entry-point/returned-model/transition-entropy coverage (item 1 above now
describes the final state); the Stage A prerequisite's registered-identity
binding (item 2); the staging-rollback and four cross-pairing registration
drills (item 3); the full-evidence profile's uniqueness/budget rework
(item 4); and the §3.2/§3.3/CI documentation corrections in this report,
the technical reference, and the status pages. The real-evidence
entry-point drill caught and fixed a genuine extraction defect (the
decision-timeline reader filtered ledger events on a nonexistent field and
returned zero decisions) — precisely the gap the coverage finding named.

## 6.3 Final targeted remediation (ruling at PR head `f73b911`)

The Advisor's final focused remediation instructions
([audits/MILESTONE_002_PHASE4_PER_DECISION_FINAL_TARGETED_REMEDIATION.md](audits/MILESTONE_002_PHASE4_PER_DECISION_FINAL_TARGETED_REMEDIATION.md))
accepted the comparator and the first remediation substantially and
required four final corrections, all implemented at this head:

1. **Exact, fast calibration entropy (A).** `entropyMilliBits(counts)`
   now returns `floor(1000 × ShannonEntropyBase2(counts))` — the TRUE
   floor, proven per call: (i) a rationality test over prime-exponent
   cancellation of `T^T / Π c^c` answers exactly when the entropy is
   rational (then one integer division gives the floor) and PROVES the
   target irrational otherwise; (ii) for irrational targets,
   directed-rounding BigInt logarithm bounds (`log2BoundsFixed`) refine —
   48 fraction bits doubling to a 1536-bit cap — until both bounds floor
   to the same milli-bit, which is then the proven answer. The cap is a
   typed refusal (`entropy-refinement-exhausted`), never a wrong value.
   The superseded Q20 approximation undercounted the audit regression
   `[1785, 2031]` (997, not 996) and its unbounded numerator squaring was
   the real cost driver (~26 ms per call); the interval algorithm is
   ~250× faster, and the full analyzer suite — ten-run fixture, 45 pairs,
   double-construction byte-identity — runs in ~120 ms under the DEFAULT
   five-second test timeout (every earlier timeout raise was reverted).
   A deterministic sweep is verified against an independent pure-
   BigInt-power reference (binary search over `2^(mT)·D^1000 ≤ N^1000`,
   no logarithms). The analysis version stays `1.0.0`: no Phase 4 live
   data or registered dataset exists, and the corrected implementation is
   exact — the documented contract is now true.
2. **Exact registered-study binding (B).** The production entry
   (`m2:analyze` → `analyzeRegisteredCalibration`) verifies the completed
   sequence end to end (seals, inventory, immutable manifest WITH its
   registration attestation re-derived from archived records, semantic
   revalidation, archive + sidecar + receipt), loads and validates the
   archived plan, study, freeze record, registration provenance, and
   Stage A prerequisite copies, and refuses anything but the exact
   registered design: `m2-calibration-variance-a-001@1.0.0`, sequence
   `m2-calibration-variance-a`, ten planned M2 per-decision attempts on
   scenario A seed 1001 under `m2-formal-attempt-profile@1.0.0`, the
   pinned model/route/prompt, matching package version, producible
   metrics, and analysis `m2-calibration-variance-analysis-1.0.0`.
   Exactly one valid primary maps to each planned attempt — a permitted
   successful replacement IS its attempt's primary, never an eleventh
   observation; failed and superseded executions become typed exclusions;
   nine or eleven primaries, duplicates, and out-of-set executions
   refuse. First divergence now carries an interpretable SEMANTIC context
   (§4.3): bounded structural facts from the validated archived request
   envelopes only — location and current activity, hunger/fatigue/injury
   state, beliefs, memories, commitments, relationships, offered
   affordance descriptors — with field-level differences made explicit
   and both hard-dependency fingerprints, in the JSON schema and the
   Markdown rendering together; facts are never inferred (absent
   envelopes yield an explicit null). The pure report builder remains
   reusable for deterministic unit fixtures.
3. **Mandatory authenticated registration at formal launch (C).** The
   plan schema now REQUIRES a registration binding on every evidentiary
   or live plan — the closed-registry id, matching study/sequence/profile
   and treatment pins, and plan-relative paths to
   `registration-provenance.json` (and `stage-a-prerequisite.json` for
   calibration) with mandatory hashes. Before any write or spawn the
   orchestrator preflight reopens everything: provenance re-hashed and
   schema-validated; both source templates re-read from Git AT THE PINNED
   SHA with blob and byte-hash equality; the DERIVATION re-proven by
   re-stamping the committed templates and requiring the launched plan
   and registered study to be byte-identical to the stamped output; and,
   for calibration, the Stage A prerequisite re-hashed, its evidence root
   re-verified end to end, and the canonical record rebuilt to byte
   equality — with drill-mode evidence structurally unable to authorize a
   live launch. The provenance and prerequisite records are archived into
   the evidence root before execution, join the freeze identity (re-
   hashed at every checkpoint through packaging), the resume identity
   (three new fields), and the immutable manifest (a registration
   attestation with template paths, blob ids, and Stage A identities)
   that completed-sequence verification re-derives and reconciles.
4. **CI failure-path hygiene (D).** The full-evidence profile is bound to
   its PRODUCER: it prepares and uploads only when the `m2:rehearse` step
   itself ran and failed, or on an explicit `workflow_dispatch`
   full-evidence request — an early typecheck/lint/unit failure uploads
   compact diagnostics only. Report uploads are producer-bound (model
   rehearsal, batch, Playwright each keyed to their own step outcome), so
   a skipped producer can never cause a secondary artifact-upload
   failure, while `if-no-files-found: error` still guards every artifact
   whose producer claimed success. One registered full budget — 4 GiB —
   appears consistently in the script, the workflow, and this report
   (measured ~2.7 GiB for the complete keyless set, each payload exactly
   once). Static workflow assertions pin the failure-path conditions that
   the merge-gate run itself cannot induce.

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
