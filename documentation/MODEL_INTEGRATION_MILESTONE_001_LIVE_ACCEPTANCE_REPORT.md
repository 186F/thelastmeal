# Model Integration Milestone 001 — Live Acceptance Report

**Status: PENDING — no live run has been executed**

This is a TEMPLATE. Every evidence field below is literally `PENDING` until
the live acceptance sequence (re-audit remediation brief §16) has actually
been performed against the live OpenRouter Responses API. Do not mark any run or criterion
passed on the basis of fake-adapter or fixture evidence; fake results are
infrastructure evidence only and must never be transcribed here as live
results. Failed or surprising live runs are recorded, not discarded.

Never record an API key, `.env.gateway` contents, or any other secret in this
file.

## Prerequisite: 1.5.0 artifact-integrity and CI gates

The release 1.5.0 artifact-integrity work and its CI gates passed — see
[`MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md`](MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md).
The registered live route was subsequently migrated in release 1.6.0 to
OpenRouter Responses under model experiment version 1.1.0. Formal runs must use
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

**This prerequisite does not advance the live milestone.** No live model call
has been made; every evidence field below remains `PENDING` and the overall
verdict remains PENDING.

## Provenance

| Field | Value |
| --- | --- |
| Date of live sequence | PENDING |
| Operator | PENDING |
| Repository commit (exact SHA, fixed for the whole sequence) | PENDING |
| Package version | PENDING |
| Experiment | `model-backed-npc-001` v `1.1.0` |
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
