# Model Integration Milestone 001 — Live Acceptance Report

**Status: COMPLETE — the six-run formal sequence was executed 2026-07-29 →
2026-07-30 under experiment v1.2.0 at frozen SHA `38026cc986f59e8526053417666c921826dd34e9`
and PASSED: six of six runs, every pre-registered threshold met, every
acceptance criterion checked. One earlier sequence (experiment v1.1.0,
2026-07-29) was aborted after Run 2 on a valid but threshold-failing artifact
and is recorded below as non-acceptance evidence.**

The Provenance table and Run log below are filled exclusively from live
evidence: the six strict-finalized run artifacts and the operator's sealed
evidence package (see Overall verdict). No fake-adapter or fixture number
appears anywhere in them. Failed or surprising live runs are recorded, not
discarded — the aborted 2026-07-29 attempt is recorded in its own section
below and its evidence is retained in full.

Never record an API key, `.env.gateway` contents, or any other secret in this
file.

## Prerequisite: 1.5.0 artifact-integrity and CI gates

The release 1.5.0 artifact-integrity work and its CI gates passed — see
[`MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md`](MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md).
The registered live route was subsequently migrated in release 1.6.0 to
OpenRouter Responses under model experiment version 1.1.0; release 1.6.2
advanced the experiment to version 1.2.0 when the formal treatment changed
from `inclusionai/ling-2.6-flash` via `novita` to
`google/gemini-2.5-flash-lite` via `google-ai-studio` after the aborted
2026-07-29 attempt recorded below. Formal runs must use
one exact `OPENROUTER_MODEL`, one exact `OPENROUTER_PROVIDER`, fallbacks disabled,
and router metadata enabled; see
[`OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md`](OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md).
Release 1.5.0 makes version-2 run bundles preserve every exact client request,
runs the complete ledger validator in both model CLIs, makes `model:finalize`
strict by default, and adds the keyless three-case rehearsal to the required
CI job. Two consequences bind this sequence:

- Only a finalized run whose `run-manifest.final.json` carries
  `status: "completed"` may be recorded below as evidence. A run finalized
  with `--allow-degraded` (`status: "degraded"`, non-empty `failedCriteria`)
  is archival only and is **not** acceptable as live acceptance evidence.
- The rehearsal is keyless and driven by the fake adapter. It is
  infrastructure evidence about the pipeline only, and none of its numbers,
  hashes, or verdicts may ever be transcribed into the fields below.

**This prerequisite did not itself advance the live milestone.** The
milestone was advanced by the completed v1.2.0 formal sequence recorded in
the Provenance table and Run log below. Total live traffic across the
milestone: the two disposable 2026-07-28 smoke requests, the 54 upstream
calls of the aborted v1.1.0 attempt's Run 2, one disposable smoke request on
the v1.2.0 route (2026-07-29, passed on the first attempt: requested =
returned `google/gemini-2.5-flash-lite`, provider `Google AI Studio`,
665 ms), and the 199 upstream calls of the formal sequence — **256 live
requests in total**.

## Disposable smoke test of 2026-07-28 — non-formal, NOT acceptance evidence

The one required disposable connectivity/contract smoke test
(`RUN_LIVE_MODEL_TESTS=1 npm run test:model:live`) was executed on
2026-07-28, after the 1.6.0 merge. It took two attempts — a failed first
request and a passed second request — and both are recorded here because this
report's own rule applies to smoke traffic too: failed or surprising live
runs are recorded, not discarded.

**Smoke requests: 2** (one failed, one passed). Each smoke attempt was
one HTTP request; the router metadata's `attempt` field on the passed request
is OpenRouter's per-call routing-attempt counter, not a request count.

State of play, prominently:

- This was a disposable connectivity/contract smoke test only.
- It is **not** one of the six formal acceptance runs, and none of its
  numbers may ever be transcribed into the Provenance table or Run log.
- The raw request, gateway trace, manifest, and routing sidecar are not
  committed, and no API key is recorded anywhere.
- The fixed-SHA formal sequence has since been completed; see the Run log and
  Overall verdict.

### Attempt 1 — FAILED

| Field | Value |
| --- | --- |
| Run ID | `live-smoke-8508-1785271979256` |
| Timestamp | 2026-07-28T20:52:59Z |
| Result | FAILED |
| Gateway outcome | `upstream-error` (upstream HTTP 429, shared-pool rate limit) |
| Gateway latency | 560 ms |
| Tokens | none |
| Provider selected | none — routing sidecar `upstreamProviderId` null, `selected: false` |

### Attempt 2 — PASSED

| Field | Value |
| --- | --- |
| Run ID | `live-smoke-8420-1785272208027` |
| Timestamp | 2026-07-28T20:56:48Z |
| Result | PASSED |
| Requested model | `inclusionai/ling-2.6-flash` |
| Pinned provider (`OPENROUTER_PROVIDER`) | `novita` |
| Reported provider (routing sidecar) | `Novita` |
| Routing strategy | `direct` |
| Router `attempt` field | 1 (routing-attempt counter, not request count) |
| Selected affordance | `aff:mara:60:continue:work` |
| Reason code | `commitment` |
| Confidence | 8500 basis points |
| Input / output tokens | 2853 / 81 |
| Gateway latency | 2402 ms |

The gateway trace row's returned model id is `inclusionai/ling-2.6-flash` —
exactly the requested slug. The routing sidecar's endpoint metadata names the
dated endpoint build `inclusionai/ling-2.6-flash-20260421`; the `pinned-model`
finalization criterion compares the trace-row `modelId` only
(`scripts/model/finalize.ts`), so the dated build is endpoint metadata about
the serving deployment, **not** a model substitution.

## Aborted formal sequence of 2026-07-29 — experiment v1.1.0 — NOT acceptance evidence

One formal six-run sequence was started on 2026-07-29 at frozen SHA
`b446ca7ac96bf5c7d28851d9aee4e2b3cb533123` (v1.6.1, tag
`model-live-acceptance-001`) under model experiment v1.1.0, with the treatment
`inclusionai/ling-2.6-flash` pinned to provider `novita`, caps 120/120,
concurrency 1, timeout 20 s, and pre-registered thresholds fixed before Run 1:
zero budget-exhausted failures, ≥ 90% upstream completion, ≥ 80%
accepted-model coverage for Runs 2–5.

**The sequence was aborted after Run 2 and none of it is acceptance
evidence.** It is recorded here because failed or surprising live runs are
recorded, not discarded. Its numbers are never transcribed into the Provenance
table or Run log below, which belong to the v1.2.0 sequence.

### Attempt Run 1 — Scenario A, deterministic baseline: passed

Gateway deliberately stopped; the ledger proves **zero** external requests
(all 134 decisions via `deterministic-utility-v1`). `worldStateHash`
`8bf6de492261aa78` and `canonicalLedgerHash` `2b37e828af8d8b30` match the
frozen goldens exactly; full ledger validation passed with replay match
(5,715 events, `TaskCompleted` at tick 2700).

### Attempt Run 2 — Scenario A, live Mara model condition: valid artifact, below thresholds — sequence aborted

| Field | Value |
| --- | --- |
| Run ID | `43478d34-85e5-4e7b-b642-626aa3ea7a6d` |
| Result | **valid but threshold-failing; aborted** — caused by sustained upstream rate limiting |
| `model:finalize` | strict `status: completed` — 54 requests joined, sources `gateway+ledger+client`, 0 notes, 0 failed criteria |
| Requested / returned model | `inclusionai/ling-2.6-flash` / `inclusionai/ling-2.6-flash`; provider `Novita` on all 42 answered calls |
| Upstream calls attempted / completed | 54 / 42 (**77.8%** vs ≥ 90% required — FAIL) |
| Accepted model responses | 42 of 54 (**77.8%** coverage vs ≥ 80% required — FAIL); zero engine rejections |
| `callsFailedByCategory` | `{"upstream-error": 12}`; zero `budget-exhausted` (that criterion passed) |
| `worldStateHash` / `canonicalLedgerHash` | `71626dab64b7d002` / `ccf56b898beac682`, replay match |
| Tokens in / out | 100,309 / 3,694 |
| Bundle aggregate SHA-256 | `330bd4e1452cd572f38a934db7bd3e6c6f37a04672fd6688ae4968e6494e6a54` (115 files) |

**Cause.** The 12 failures were immediate upstream rejections (mean 346 ms vs
2,342 ms for successes) clustering in the final ~10 minutes — the signature of
a shared-pool quota depleting under sustained use, matching the smoke test's
explicit `limit_source: upstream_provider_shared_pool`. The pinned model had
exactly one serving endpoint, and with fallbacks correctly disabled its
exhaustion left no route. The implementation behaved to specification
throughout: every answered call was gate-accepted, every routing sidecar was
written, and the artifact strict-finalized.

**Disposition.** Under the freeze protocol a treatment change is a
configuration change, so the sequence was aborted rather than continued, the
treatment was changed for capacity (five independent structured-output
endpoints, first-party `google-ai-studio`), and release 1.6.2 advanced the
model experiment to v1.2.0. The v1.2.0 sequence restarts from Run 1 at a
freshly frozen SHA. The attempt's complete evidence — both ledgers, the
finalized run bundle, provenance, and the sequence log — is retained
unmodified in the operator's evidence archive outside the tracked repository
(`thelastmeal-live-acceptance-001/`), per the operator's evidence-folder
protocol; nothing from it was deleted or rewritten.

## Provenance

The formal sequence ran 2026-07-29 → 2026-07-30 at one frozen SHA under the
freeze protocol: gateway restarted fresh before every model-backed run, 1×
speed, no pausing while awaiting the model, no manual Mara actions, every
command executed from the frozen SHA, and zero configuration changes after
Run 1 began. Pre-flight at the frozen SHA (clean tree, `npm ci`, `validate`,
100-run batch, explicit golden-hashes test) passed before Run 1; a
post-sequence batch at the same SHA passed after Run 6.

| Field | Value |
| --- | --- |
| Date of live sequence | 2026-07-29 → 2026-07-30 (UTC) |
| Operator | Project operator, single operator throughout; manual browser-driven runs |
| Repository commit (exact SHA, fixed for the whole sequence) | `38026cc986f59e8526053417666c921826dd34e9` (release 1.6.2, PR #9 merge commit; local freeze tag `model-live-acceptance-002`) |
| Package version | `1.6.2` |
| Experiment | `model-backed-npc-001` v `1.2.0` |
| Condition | `mara-model-per-decision-v1` |
| External provider | `openrouter-mara-action-v1` |
| Prompt version | `mara-action-selection-1.0.0` |
| Requested model (`OPENROUTER_MODEL`) | `google/gemini-2.5-flash-lite` |
| Pinned OpenRouter provider (`OPENROUTER_PROVIDER`) | `google-ai-studio` |
| Returned model identifier(s) (from finalized manifests) | `google/gemini-2.5-flash-lite` — the only returned model id in every finalized manifest (Runs 2–6); reported routing provider `Google AI Studio` on all 198 provider-bearing routing sidecars (the single exception across 199 sidecars is Run 3's one upstream-error call, provider null per the failed-call contract) |
| Gateway settings (timeout / concurrency / per-run budget / total cap) | 20,000 ms / 1 / 120 / 120 |
| OpenRouter routing (`require_parameters`, fallbacks, provider allowlist) | `require_parameters: true`, `allow_fallbacks: false`, `provider.only: ["google-ai-studio"]`, router metadata enabled |
| Prompt, model configuration, limits, or code changed mid-sequence? | **no** |

---

## Run log (brief §16)

### Run 1 — Scenario A, deterministic baseline

Condition `deterministic-baseline-v1`; confirms zero gateway calls and the
frozen hashes before any live spend.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (2026-07-29; gateway deliberately down, port verified free before start) |
| Run ID | none — the baseline condition has no gateway client activity, so no gateway run id exists |
| Gateway calls observed (must be 0) | **0** — proven from the ledger: all 134 `DecisionRequested` carry `deterministic-utility-v1`; lifecycle perfectly balanced 134/134/134 with zero failures |
| `worldStateHash` | `8bf6de492261aa78` — **matches the frozen golden** |
| `canonicalLedgerHash` | `2b37e828af8d8b30` — **matches the frozen golden** |
| Anomalies | none. Notable confirmation: the exported ledger is byte-identical (same SHA-256) to the v1.6.1 sequence's baseline export — release 1.6.2 provably touched nothing on the frozen deterministic path |

### Run 2 — Scenario A, live Mara model condition

1× speed; no pausing while awaiting the model; no manual Mara actions;
complete the scenario; export ledger + run bundle; finalize; replay.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (all thresholds: 0 budget-exhausted; completion **92.0%** ≥ 90%; coverage **92.0%** ≥ 80%) |
| Run ID | `97a93968-323b-41bd-ad2d-8f980b159950` |
| Scenario completed to terminal state | yes — `TaskCompleted` at tick 2700; progressUnits 120,000; 5,646 events |
| Ledger exported / imported / replayed | yes / yes / yes (complete ledger validator at staging) |
| Replay hash match (`worldStateHash` / `canonicalLedgerHash`) | **match / match** |
| `worldStateHash` | `3a2b723bc6da3841` |
| `canonicalLedgerHash` | `b08e72cbff7651a3` |
| Only Mara generated external requests | yes — 50 of 50 |
| Upstream calls attempted / completed | 50 / 46 |
| Accepted model responses / engine rejections (by reason) | 46 / none (`engineRejectionsByReason: {}`) |
| Token totals (input / output / total) | 113,368 / 3,771 / 117,139 |
| Latency (min / median / p95 / max) | 491 / 660 / 813 / 2,559 ms |
| `model:finalize` result (completeness sources + notes) | strict `status: completed`; sources `gateway+ledger+client`; 0 notes; 0 failed criteria |
| `bundle-manifest.json` aggregate SHA-256 | `87c078fea449b2f0ffea71882ccb7ae3352439ca84fa39096a8d9c85c26ea39f` (107 files) |
| Anomalies | 4 `invalid-model-output` failures, all diagnosed from raw outputs as rationale-length overruns (198/228/163/245 chars vs the 160 bound, which the upstream's structured-output mode does not enforce; longest accepted rationale exactly 160). Complete valid JSON, in-enum selections, correct model+provider on all four; the failure lifecycle ran to spec and the engine never saw an invalid output. Scattered ticks — no capacity signature |

### Run 3 — Scenario B1, live model condition

Same model configuration and prompt version as Run 4; fresh run ID; preserve
failed or surprising results.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (0 budget-exhausted; completion **95.8%**; coverage **95.8%**) |
| Run ID | `564e85b8-7260-470c-a0b0-a7b525f3a7be` |
| Replay hash match | **match** (complete validator at staging) |
| `worldStateHash` / `canonicalLedgerHash` | `0b1ed3d11c90154d` / `c669beffb36e491a` |
| Only Mara generated external requests | yes — 48 of 48 |
| Upstream calls / accepted / rejected | 48 attempted, 46 completed / 46 accepted / 0 engine rejections |
| Token totals / latency summary | 107,276 / 3,493 / 110,769; latency 551 / 673 / 950 / 1,307 ms (min/med/p95/max) |
| Finalized bundle aggregate SHA-256 | `32188b290426db1797c1965bb9fab93745aca4d8d70e3444e21d9ca1572aba25` (103 files); strict `completed`, sources `gateway+ledger+client`, 0 notes, 0 failed criteria |
| Anomalies | 1 isolated `upstream-error` (tick 1741: 279 ms immediate rejection, no upstream response id, null provider in its sidecar per the failed-call contract — the sequence's only upstream failure, not clustered); 1 rationale-length overrun (175 chars) |

### Run 4 — Scenario B2, live model condition

Identical configuration to B1; fresh run ID; both bundles finalized before
any behavioral comparison.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (0 budget-exhausted; completion **97.9%**; coverage **97.9%**; **B1/B2 coverage gap 2.1 pts ≤ 10 — PASS**) |
| Run ID | `30443549-6b28-4ae5-b0fa-635fd517677d` |
| Configuration identical to Run 3 (model, prompt, limits) | yes — guaranteed by the freeze: same SHA, model, provider, prompt, caps, concurrency, timeout; both finalized manifests record identical `modelSettings` |
| Replay hash match | **match** (complete validator at staging) |
| `worldStateHash` / `canonicalLedgerHash` | `4e9920f37f73f139` / `633703a7390806a2` |
| Only Mara generated external requests | yes — 48 of 48 |
| Upstream calls / accepted / rejected | 48 attempted, 47 completed / 47 accepted / 0 engine rejections |
| Token totals / latency summary | 104,270 / 3,523 / 107,793; latency 494 / 712 / 1,086 / 1,354 ms (min/med/p95/max) |
| Finalized bundle aggregate SHA-256 | `8cee8aaad35b7c552db28fef971a8e590e46f74386a486c1234d3200a18d3072` (103 files); strict `completed`, sources `gateway+ledger+client`, 0 notes, 0 failed criteria |
| Anomalies | 1 rationale-length overrun (169 chars), zero upstream errors |

### Run 5 — Scenario C, live model condition

Verify at least one socially or medically meaningful decision opportunity;
stale responses, if any, must be recorded rather than hidden.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (0 budget-exhausted; completion **97.7%**; coverage **97.7%**) |
| Run ID | `90430f64-e724-412f-9b3e-a60eff8e46d7` |
| Meaningful social/medical decision opportunity observed | **yes, observed and taken**: `InjuryOccurred` (rin, severity 0.55) at tick 720; the `treat` affordance appeared in three of Mara's offered sets and she selected `treat:rin` twice (both engine-accepted; `TreatmentStarted healer=mara` at tick 752); Jonas issued `CommitmentRenegotiationProposed` (`care-conflict`) at tick 750; Jonas later completed Rin's treatment (severity 0.55 → 0.15, `RelationshipChanged` rin→jonas +0.10 `treatment-received`) |
| Stale/rejected responses recorded (not hidden) | none occurred, proven from the lifecycle: 131 received / 131 accepted / 0 rejected / 0 superseded; the single expiry is the provider-failure path. Two ledger `ActionRejected` events (both `stale-preconditions-at-start: treatment-already-started`) are action-level constraint enforcement of two healers racing to one patient, recorded in full |
| Replay hash match | **match** (complete validator at staging) |
| `worldStateHash` / `canonicalLedgerHash` | `7fbae8b5db40e53f` / `32a23ac90a6f61ca` |
| Only Mara generated external requests | yes — 43 of 43 |
| Upstream calls / accepted / rejected | 43 attempted, 42 completed / 42 accepted / 0 engine rejections |
| Token totals / latency summary | 102,330 / 3,132 / 105,462; latency 584 / 713 / 1,074 / 1,130 ms (min/med/p95/max) |
| Finalized bundle aggregate SHA-256 | `1c2a898829489ddc3e03f28668c80816ee8f0e398f7b33f15066b0671ea12850` (93 files); strict `completed`, sources `gateway+ledger+client`, 0 notes, 0 failed criteria |
| Anomalies | 1 rationale-length overrun (211 chars). Terminal state was `TaskDeadlineMissed` at tick 2700 (progressUnits 117,600/120,000) — a valid terminal state; the shortfall closely matches the ~400 ticks Mara spent off the bench treating Rin. Mara's `treat` action, advertised `interruptible: false`, was ended by `sustained-check-failed: patient-absent` — the same pre-existing VS001 design ambiguity class recorded in the VS002 findings (finding 3 family); no mid-sequence action taken |

### Run 6 — Scenario A, gateway stopped mid-run

Begin under the live model condition; stop the gateway after at least one
accepted model response; the run must reach a valid terminal state with
explicit recorded failures; finalize the client/ledger bundle even though the
gateway trace is partial.

Do not expect a "degraded" completeness verdict for this run. The gateway
trace file still exists after the stop and its surviving rows are internally
consistent, and the post-stop requests fail client-side (typed failures with
client-minted `cf-` failure ids), so they carry no evidence of a gateway
result: `model:finalize` is expected to report sources
`gateway+ledger+client`. The finalizer drops `gateway` from the sources
(with an explicit reconciliation note) only when some request has positive
client or ledger evidence of a gateway result with no matching trace row —
a truncated or mis-staged trace file, not a mid-run stop. The evidence of
the partial trace is that the post-stop requests appear in
`finalized-trace.jsonl` with a client failure and no gateway row. Record
whatever sources and notes the finalizer actually prints.

| Field | Value |
| --- | --- |
| Status | **COMPLETE — PASS** (threshold-exempt per pre-registration; every §16 requirement for this run met) |
| Run ID | `128435d1-fcc9-4b8c-a49e-8454bdc439df` |
| Accepted model responses before the gateway stop | **10 of 10** — zero pre-kill failures; gateway hard-killed at 2026-07-30T03:55:26Z with a pre-kill snapshot (last accepted `dec-0023`, tick 570); 10 trace rows and 10 routing sidecars survive |
| Explicit typed failures recorded after the stop | **65** — every post-kill request carries a client-minted `cf-` failure id; ledger records 65 `DecisionProviderFailed` + 65 `external-failure` expiries, first at tick 633, last at tick 2673 |
| Logical time continued (no freeze) | yes — 2,700 `TimeAdvanced` events (one per tick); decisions continued on cadence; 61 `FallbackDecisionUsed` |
| Valid terminal state reached | yes — `TaskDeadlineMissed` at tick 2700 (progressUnits 115,014/120,000); 6,210 events; 75 requests emitted / 75 seen by client / 10 with gateway result |
| Replay hash match | **match** (complete validator at staging) |
| `worldStateHash` / `canonicalLedgerHash` | `8e7cc343a9ba2496` / `e93aa0bf68c37aa8` |
| Client/ledger bundle finalized despite the partial gateway trace | yes |
| `model:finalize` result (completeness sources + notes) | strict `status: completed`; sources **`gateway+ledger+client`** — exactly as this section predicts for a mid-run stop (the surviving trace rows are internally consistent and post-stop requests carry client failures, so `gateway` is retained); 0 notes; 0 failed criteria |
| Finalized bundle aggregate SHA-256 | `776a0415400488010e693962189e6655fb74bb9535bec47257c8b976ccd08a37` (27 files) |
| Anomalies | none in the failure machinery. Behavioral observation for later analysis: with the deterministic provisional fallback running Mara from tick ~630 onward, `promiseOutcome` was `fulfilled` — the only fulfilled relief promise among the five model-condition runs |

---

## Acceptance criteria (brief §17)

### Causal integrity

- [x] every accepted live choice was offered by the engine — all 191 accepted
      responses selected an id from the engine's own offered set; selection
      is validated at the gateway (dynamic enum) and independently by the
      engine's constraint gate; `engineRejectionsByReason` is `{}` in all
      five finalized manifests.
- [x] every accepted live choice passed provider binding, freshness,
      constraints, and action validation — the engine's acceptance path
      enforces all four; 191 acceptances, zero rejections, zero stale
      acceptances (Run 5's lifecycle proves 0 rejected / 0 superseded).
- [x] no model or gateway payload directly changed world state — reducer-only
      mutation; every ledger passed the complete validator with isolated
      reducer replay reproducing both hashes exactly.

### Operational continuity

- [x] gateway absence, timeout, refusal, malformed output, and stale-response
      paths did not freeze logical time — 8 upstream/content failures across
      Runs 2–5 and 65 post-kill client failures in Run 6 all resolved through
      typed `DecisionProviderFailed` + `external-failure` expiry with
      provisional fallback; Run 6 records 2,700 `TimeAdvanced` events, one
      per tick, across the outage.
- [x] the gateway-stop run (Run 6) reached terminal state —
      `TaskDeadlineMissed` at tick 2700, a valid terminal state, with the
      run strict-finalized.

### Provider isolation

- [x] every external request named Mara — 264 of 264 external
      `DecisionRequested` events across Runs 2–6 carry `npcId: mara`.
- [x] Jonas and Rin generated zero external requests — their decisions ran
      exclusively via `deterministic-utility-v1` in every ledger.

### Replay

- [x] every completed live ledger imports — all six exported ledgers passed
      `model:prepare-run`'s complete validator (Run 1 via `validateLedgerFile`
      directly).
- [x] every completed live ledger replays to the same `worldStateHash` and
      `canonicalLedgerHash` — isolated reducer replay recomputed both hashes
      with exact matches for all six runs; Run 1 additionally matches the
      frozen goldens.

### Measurement

- [x] every engine external request has one client trace row —
      `requestsSeenByClient` equals `externalRequestsEmitted` in all five
      finalized manifests (50/50, 48/48, 48/48, 43/43, 75/75).
- [x] every upstream model call has one gateway trace row — 199 upstream
      calls, 199 gateway trace rows (10 in Run 6, all pre-kill).
- [x] every finalized row joins to one engine lifecycle outcome — a strict
      finalization criterion; all five runs finalized with 0 failed criteria
      (Run 6: `accepted × 10, expired × 65`).
- [x] completed manifests contain hashes, totals, scenario metadata, model
      evidence, and completion time — present in every
      `run-manifest.final.json`.
- [x] bundle validation (`npm run model:finalize`) passed for every completed
      run — five of five strict `status: completed`, 0 notes, 0 failed
      criteria, sources `gateway+ledger+client` in each.

### Baseline preservation

- [x] the complete deterministic batch (`npm run batch`) still passes at the
      sequence commit — run twice at the frozen SHA: pre-flight before Run 1
      and post-sequence after Run 6 (2026-07-30, 100 runs/scenario,
      replay=match on all seven scenarios).
- [x] all fourteen golden hashes remain unchanged — asserted by
      `tests/integration/golden-hashes.test.ts` (7/7) at the frozen SHA both
      before Run 1 and after Run 6, and reproduced by both batches.

### Documentation

- [x] this report contains actual live evidence and describes no mock results
      as live results — every number above is transcribed from the finalized
      run artifacts and exported ledgers in the sealed evidence package; no
      fake-adapter or rehearsal value appears in the Provenance table or Run
      log.

---

## Overall verdict

**PASSED — Model Integration Milestone 001 live acceptance is complete.**
Six of six runs at one frozen SHA, every pre-registered threshold met
(Runs 2–5: zero budget-exhausted failures; completion 92.0% / 95.8% / 97.9% /
97.7% against ≥ 90%; coverage identical against ≥ 80%; B1/B2 comparability
gap 2.1 points against ≤ 10), Run 6 exempt by design and passing every
continuity requirement, and all §17 criteria checked above with live
evidence. Sequence aggregates: 199 upstream calls, 191 answered (96.0%),
zero engine rejections, one transient upstream error, seven
rationale-length `invalid-model-output` failures (3.5% of upstream calls —
the sequence's one recurring treatment characteristic, diagnosed and
recorded per-run above).

**Evidence.** The raw run artifacts live outside the Git tree in the
operator's sealed evidence package:

| Archive | SHA-256 |
| --- | --- |
| `thelastmeal-live-acceptance-v1.2.0-38026cc.zip` (original, sealed; preserved unchanged) | `f3637635672af15db373eba9b69082cb5901adb0f07473e05bd34de46cd90efe` |
| `thelastmeal-live-acceptance-v1.2.0-r2-38026cc.zip` (corrected publication archive — supersedes the original for citation) | `1ba78626c756a5ee026a86190ee89166f1c3c8135c15b8652c6fc06bf60b3dde` |

The r2 revision corrects a sequence-aggregate addition error in the original
archive's summary documents ("188 answered (94.5%)" → 191 answered (96.0%));
all per-run figures and all run artifacts are byte-identical between the two
archives. The aborted v1.1.0 sequence remains archived separately as
non-acceptance evidence.

**Stop condition (brief §20), per the Project Advisor's ruling of
2026-07-30:** with this fold-in merged under green PR-head and merged-main
CI, the accepted implementation SHA
`38026cc986f59e8526053417666c921826dd34e9` tagged, and the Milestone 2 brief
merged, the Milestone 1 stop condition is lifted **solely for implementation
of Milestone 2**. Policy patches, reflection, model-generated memory,
dialogue, a second model-backed NPC, and every other §20 item remain blocked
except as authorized by the Milestone 2 brief.
