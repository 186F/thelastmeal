# Model Integration Milestone 001 — Live Acceptance Report

**Status: PENDING — disposable smoke test passed; one formal sequence
(experiment v1.1.0, 2026-07-29) aborted after Run 2 on a valid but
threshold-failing artifact; the six-run sequence restarts under experiment
v1.2.0 and has not been executed**

The Provenance table and Run log below are a TEMPLATE. Every evidence field
in them is literally `PENDING` until the live acceptance sequence (re-audit
remediation brief §16) has actually
been performed against the live OpenRouter Responses API. Do not mark any run or criterion
passed on the basis of fake-adapter or fixture evidence; fake results are
infrastructure evidence only and must never be transcribed here as live
results. Failed or surprising live runs are recorded, not discarded — the
aborted 2026-07-29 attempt is recorded in its own section below and its
evidence is retained in full.

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

**This prerequisite does not advance the live milestone.** No formal live
acceptance sequence has been completed; the live traffic to date is the two
disposable smoke requests and the 54 upstream calls of the aborted v1.1.0
attempt's Run 2 (its Run 1 baseline made zero), all recorded below. Every
evidence field in the
Provenance table and Run log remains `PENDING` and the overall verdict
remains PENDING.

## Disposable smoke test of 2026-07-28 — non-formal, NOT acceptance evidence

The one required disposable connectivity/contract smoke test
(`RUN_LIVE_MODEL_TESTS=1 npm run test:model:live`) was executed on
2026-07-28, after the 1.6.0 merge. It took two attempts — a failed first
request and a passed second request — and both are recorded here because this
report's own rule applies to smoke traffic too: failed or surprising live
runs are recorded, not discarded.

**Smoke requests: 2** (one failed, one passed); together with the aborted
attempt below, total live requests to date are **56**. Each smoke attempt was
one HTTP request; the router metadata's `attempt` field on the passed request
is OpenRouter's per-call routing-attempt counter, not a request count.

State of play, prominently:

- This was a disposable connectivity/contract smoke test only.
- It is **not** one of the six formal acceptance runs, and none of its
  numbers may ever be transcribed into the Provenance table or Run log.
- The raw request, gateway trace, manifest, and routing sidecar are not
  committed, and no API key is recorded anywhere.
- The overall milestone remains **PENDING** until the fixed-SHA formal
  sequence is complete.

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

| Field | Value |
| --- | --- |
| Date of live sequence | PENDING |
| Operator | PENDING |
| Repository commit (exact SHA, fixed for the whole sequence) | PENDING |
| Package version | PENDING |
| Experiment | `model-backed-npc-001` v `1.2.0` |
| Condition | `mara-model-per-decision-v1` |
| External provider | `openrouter-mara-action-v1` |
| Prompt version | `mara-action-selection-1.0.0` |
| Requested model (`OPENROUTER_MODEL`) | PENDING |
| Pinned OpenRouter provider (`OPENROUTER_PROVIDER`) | PENDING |
| Returned model identifier(s) (from finalized manifests) | PENDING |
| Gateway settings (timeout / concurrency / per-run budget / total cap) | PENDING |
| OpenRouter routing (`require_parameters`, fallbacks, provider allowlist) | PENDING |
| Prompt, model configuration, limits, or code changed mid-sequence? | PENDING (must be "no") |

---

## Run log (brief §16)

### Run 1 — Scenario A, deterministic baseline

Condition `deterministic-baseline-v1`; confirms zero gateway calls and the
frozen hashes before any live spend.

| Field | Value |
| --- | --- |
| Status | PENDING |
| Run ID | PENDING |
| Gateway calls observed (must be 0) | PENDING |
| `worldStateHash` | PENDING |
| `canonicalLedgerHash` | PENDING |
| Anomalies | PENDING |

### Run 2 — Scenario A, live Mara model condition

1× speed; no pausing while awaiting the model; no manual Mara actions;
complete the scenario; export ledger + run bundle; finalize; replay.

| Field | Value |
| --- | --- |
| Status | PENDING |
| Run ID | PENDING |
| Scenario completed to terminal state | PENDING |
| Ledger exported / imported / replayed | PENDING |
| Replay hash match (`worldStateHash` / `canonicalLedgerHash`) | PENDING |
| `worldStateHash` | PENDING |
| `canonicalLedgerHash` | PENDING |
| Only Mara generated external requests | PENDING |
| Upstream calls attempted / completed | PENDING |
| Accepted model responses / engine rejections (by reason) | PENDING |
| Token totals (input / output / total) | PENDING |
| Latency (min / median / p95 / max) | PENDING |
| `model:finalize` result (completeness sources + notes) | PENDING |
| `bundle-manifest.json` aggregate SHA-256 | PENDING |
| Anomalies | PENDING |

### Run 3 — Scenario B1, live model condition

Same model configuration and prompt version as Run 4; fresh run ID; preserve
failed or surprising results.

| Field | Value |
| --- | --- |
| Status | PENDING |
| Run ID | PENDING |
| Replay hash match | PENDING |
| `worldStateHash` / `canonicalLedgerHash` | PENDING |
| Only Mara generated external requests | PENDING |
| Upstream calls / accepted / rejected | PENDING |
| Token totals / latency summary | PENDING |
| Finalized bundle aggregate SHA-256 | PENDING |
| Anomalies | PENDING |

### Run 4 — Scenario B2, live model condition

Identical configuration to B1; fresh run ID; both bundles finalized before
any behavioral comparison.

| Field | Value |
| --- | --- |
| Status | PENDING |
| Run ID | PENDING |
| Configuration identical to Run 3 (model, prompt, limits) | PENDING |
| Replay hash match | PENDING |
| `worldStateHash` / `canonicalLedgerHash` | PENDING |
| Only Mara generated external requests | PENDING |
| Upstream calls / accepted / rejected | PENDING |
| Token totals / latency summary | PENDING |
| Finalized bundle aggregate SHA-256 | PENDING |
| Anomalies | PENDING |

### Run 5 — Scenario C, live model condition

Verify at least one socially or medically meaningful decision opportunity;
stale responses, if any, must be recorded rather than hidden.

| Field | Value |
| --- | --- |
| Status | PENDING |
| Run ID | PENDING |
| Meaningful social/medical decision opportunity observed | PENDING |
| Stale/rejected responses recorded (not hidden) | PENDING |
| Replay hash match | PENDING |
| `worldStateHash` / `canonicalLedgerHash` | PENDING |
| Only Mara generated external requests | PENDING |
| Upstream calls / accepted / rejected | PENDING |
| Token totals / latency summary | PENDING |
| Finalized bundle aggregate SHA-256 | PENDING |
| Anomalies | PENDING |

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
| Status | PENDING |
| Run ID | PENDING |
| Accepted model responses before the gateway stop | PENDING |
| Explicit typed failures recorded after the stop | PENDING |
| Logical time continued (no freeze) | PENDING |
| Valid terminal state reached | PENDING |
| Replay hash match | PENDING |
| `worldStateHash` / `canonicalLedgerHash` | PENDING |
| Client/ledger bundle finalized despite the partial gateway trace | PENDING |
| `model:finalize` result (completeness sources + notes) | PENDING |
| Finalized bundle aggregate SHA-256 | PENDING |
| Anomalies | PENDING |

---

## Acceptance criteria (brief §17)

### Causal integrity

- [ ] PENDING — every accepted live choice was offered by the engine.
- [ ] PENDING — every accepted live choice passed provider binding,
      freshness, constraints, and action validation.
- [ ] PENDING — no model or gateway payload directly changed world state.

### Operational continuity

- [ ] PENDING — gateway absence, timeout, refusal, malformed output, and
      stale-response paths did not freeze logical time.
- [ ] PENDING — the gateway-stop run (Run 6) reached terminal state.

### Provider isolation

- [ ] PENDING — every external request named Mara.
- [ ] PENDING — Jonas and Rin generated zero external requests.

### Replay

- [ ] PENDING — every completed live ledger imports.
- [ ] PENDING — every completed live ledger replays to the same
      `worldStateHash` and `canonicalLedgerHash`.

### Measurement

- [ ] PENDING — every engine external request has one client trace row.
- [ ] PENDING — every upstream model call has one gateway trace row.
- [ ] PENDING — every finalized row joins to one engine lifecycle outcome.
- [ ] PENDING — completed manifests contain hashes, totals, scenario
      metadata, model evidence, and completion time.
- [ ] PENDING — bundle validation (`npm run model:finalize`) passed for every
      completed run.

### Baseline preservation

- [ ] PENDING — the complete deterministic batch (`npm run batch`) still
      passes at the sequence commit.
- [ ] PENDING — all fourteen golden hashes remain unchanged.

### Documentation

- [ ] PENDING — this report contains actual live evidence and describes no
      mock results as live results.

---

## Overall verdict

**PENDING — the live milestone is not complete.** Policy patches, reflection,
model-generated memory, dialogue, a second model-backed NPC, and every other
item under the brief's stop condition (§20) remain blocked until every field
above carries real evidence and every criterion is checked.
