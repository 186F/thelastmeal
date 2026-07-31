# Model Integration Artifact Event Semantics — Implementation Report (1.6.1)

**Repository:** `186F/thelastmeal`  
**Pull request:** [#8](https://github.com/186F/thelastmeal/pull/8) — `agent/artifact-event-semantics-1.6.1` → `main`  
**Brief:** [`MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_REMEDIATION_BRIEF.md`](../briefs/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_REMEDIATION_BRIEF.md) (merged as PR #7), as amended below  
**Base commit:** `6a1ea5cb41bb1342d95a59e03d1a58d14666a5c3` (`main` after PR #7)  
**Final commit:** `b8b2d775cd5704c3a405661b3234be5eb28c877a` (PR head; merged as `219079be739928ab00c7847ced35987d5e11fdd9`)  
**Package version:** `1.6.1`  
**Model experiment:** `model-backed-npc-001` v `1.1.0` — unchanged  
**Condition:** `mara-model-per-decision-v1` — unchanged  
**External decision provider:** `openrouter-mara-action-v1` — unchanged  
**Prompt:** `mara-action-selection-1.0.0` — unchanged  
**Frozen Vertical Slice:** v1.0 / `vs001-1.0.0` — unchanged  
**Live model calls during this remediation:** none

## Summary

Release 1.6.1 makes every event-ID field in `finalized-trace.jsonl` describe the engine
lifecycle event its name claims to describe. Before this release, the finalizer wrote the
**submission** event (`DecisionResponseReceived` / `DecisionProviderFailed`) into
`engineResolutionEventId` — a field whose documentation promised the **resolution**. The
finalized trace now separates the three lifecycle stages per row:

```text
engineSubmissionEventId   DecisionResponseReceived | DecisionProviderFailed | null
responseVerdictEventId    DecisionResponseAccepted | DecisionResponseRejected | null
engineResolutionEventId   DecisionResponseAccepted | DecisionRequestExpired
                          | DecisionRequestSuperseded | null
```

This is a derived-artifact semantics correction only. Canonical simulation state, model
authority, action legality, replay, provider binding, routing pinning, deterministic
hashes, the raw gateway trace (v2), the client bundle (v2), both manifests (v2), and the
prompt/experiment/condition identifiers are all untouched. The work was entirely keyless:
fixtures, the fake gateway, the deterministic batch, and the formal rehearsal.

## Files changed

| File | Change |
| --- | --- |
| `src/shared/modelArtifacts.ts` | `FINALIZED_TRACE_SCHEMA_VERSION` 2 → 3; local canonical event-ID schema; two new fields; `engineResolutionEventId` upgraded and re-documented; cross-field refinements; v3 comments |
| `src/shared/events.ts` | Stale `evt-<seq>` comment corrected: canonical event IDs come from the canonical-event counter, not the ledger `seq` |
| `scripts/model/finalize.ts` | `EventRef` shape; seven new event-reference maps on the finalizer's ledger index; three independent per-row lookups (submission / verdict / resolution) |
| `scripts/model/rehearse.ts` | `indexExternalLifecycle` enriched to carry event references; latency-case supersession assertions |
| `tests/integration/model-bundle.test.ts` | `FinalRow` type + assertions updated to the three-field contract for accepted, failure, pre-dispatch, gateway-interrupted, and moot rows |
| `tests/integration/model-artifact-event-semantics.test.ts` | NEW — the nine-case lifecycle-semantics suite (see Tests) |
| `tests/unit/model-artifact-schemas.test.ts` | v3 version pin; sibling version pins held at their frozen values; strict-matrix additions for the new fields |
| `tests/integration/model-rehearsal.test.ts` | Updated to the enriched latency-case assertions |
| `package.json` / `package-lock.json` | `1.6.1` in both lockfile keys (the lockfile was stale at `1.3.0`); new test file appended to `test:model:bundle` |
| `README.md` | Release lineage 1.6.1; finalized-trace v3 subsection; smoke-test status updates |
| `documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md` | Status rescoped; both disposable smoke attempts recorded as non-formal evidence; Provenance table and Run log stay fully PENDING |
| `documentation/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md` | Known limitation #1 marked satisfied, #3 marked closed by 1.6.1 |
| `documentation/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md` | This report |

## Exact schema changes (`src/shared/modelArtifacts.ts`)

```text
FINALIZED_TRACE_SCHEMA_VERSION: 2 -> 3

+ const canonicalEventId = z.string().regex(/^evt-\d{6,}$/)
    // width-6 zero-padded canonical-event counter (may exceed 6 digits);
    // NOT the ledger seq; `evt-op-` operator markers rejected.
    // Re-declared locally: modelArtifacts is a leaf module and
    // eventSchemas does not export its unexported copy.

+ engineSubmissionEventId: canonicalEventId.nullable()
+ responseVerdictEventId:  canonicalEventId.nullable()
  engineResolutionEventId: bare string -> canonicalEventId.nullable()
    // re-documented: the canonical request resolution
    // (Accepted-by-requestId | Expired | Superseded);
    // never Received, never ProviderFailed, never Rejected.

+ .superRefine on the strict row object:
    logicalSubmittedTick null  <=>  engineSubmissionEventId null
    engineOutcome in {accepted, rejected}  =>  responseVerdictEventId non-null
```

Deliberately **not** advanced: `MODEL_TRACE_SCHEMA_VERSION` (2),
`CLIENT_TRACE_SCHEMA_VERSION` (2), `FINAL_MANIFEST_SCHEMA_VERSION` (2),
`BUNDLE_MANIFEST_SCHEMA_VERSION` (2), `ROUTER_TRACE_SCHEMA_VERSION` (1), and the
`bundleSchemaVersion: 2` literal in both `modelArtifacts.ts` and `src/app/runBundle.ts`.
Only the derived finalized trace advances; the raw gateway trace comments stay v2.

`engineResolutionEventId` stays nullable at schema level: degraded finalization may
intentionally preserve an unresolved row, and strict completeness is the finalizer's
criterion, not the schema's (scoped per amendment E4 below).

## Event mapping behavior (`scripts/model/finalize.ts`)

The finalizer's ledger index now carries event references (`EventRef { eventId, tick }`)
in seven maps, and each finalized row computes three independent references:

```text
gwResponseId  = traceRowResponseId(row)         when a gateway trace row exists
              = `gw-${requestId}`               when none exists (load-bearing
                                                 response-id reconstruction — the
                                                 brief's "never infer from naming
                                                 conventions" applies to EVENT ids)

submissionRef = receivedEventByResponseId[gwResponseId]
              ?? providerFailedEventByRequestId[requestId] ?? null
verdictRef    = acceptedEventByResponseId[gwResponseId]
              ?? rejectedEventByResponseId[gwResponseId] ?? null
resolutionRef = acceptedEventByRequestId[requestId]
              ?? expiredEventByRequestId[requestId]
              ?? supersededEventByRequestId[requestId] ?? null

logicalSubmittedTick    = submissionRef?.tick ?? null     (byte-identical to 1.6.0
                                                           for all existing fixtures)
engineSubmissionEventId = submissionRef?.eventId ?? null
responseVerdictEventId  = verdictRef?.eventId ?? null
engineResolutionEventId = resolutionRef?.eventId ?? null
```

Pinned, documented policies:

- **Verdict and resolution are keyed independently** — verdict by responseId (the same
  `gwResponseId` value passed to the shared outcome ladder), resolution by requestId.
  Acceptance outranks rejection for the verdict; acceptance, then expiry, then
  supersession for the resolution (≤1 resolution is validator-guaranteed, ≥1 in strict
  is finalizer-guaranteed).
- **Duplicate responseIds** (probe-proven real: one responseId can carry two Received and
  two Rejected events, because Received is emitted before the dedup check):
  first-write-wins on Received — preserving today's `logicalSubmittedTick` bytes —
  and last-write-wins on Rejected, so the verdict event is the same event whose reason
  feeds `engineRejectionReason`. Submission and verdict may therefore come from
  different cycles; that is the pinned policy, under test.
- **No chronological assumption between submission and resolution.** A late response to
  an already-superseded request legally has `resolution.tick < submission.tick`. Within
  one submission, Received and its verdict share a tick (same drain), and a rejection
  can share a tick with the TTL expiry (drain runs before expiry) — ordering there is
  by ledger `seq`, never tick inequality.
- **The null-outcome combination is legal:** when a request was resolved by the
  acceptance of a DIFFERENT responseId than the row's, the shared ladder returns a null
  `engineOutcome` while `engineResolutionEventId` names that acceptance — legal and
  non-contradictory.

The shared outcome ladder in `scripts/model/summarize.ts` (`resolveEngineOutcome`,
`EngineResolutionIndex`) is structurally untouched — same maps, same precedence, no
casts at the call site — so `model-summary.json` is unchanged in content and there is
still exactly one outcome ladder.

## Superseded prior documentation

[`MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md`](../briefs/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md)
§4.7 describes the per-request engine resolution set as `accepted / rejected / expired`.
That ladder is **SUPERSEDED** by this work: the canonical request resolutions are
`accepted / expired / superseded`, and a rejection is a verdict about one submitted
response, never a terminal request resolution. The 1.5.0 brief is a frozen historical
document and is not retro-edited; this note is the authoritative correction.

## Amendments to the brief (spec E1–E14)

The brief was implemented under a pre-implementation verification pass — eight
Opus-xhigh probes, every engine claim probe-proven against the running engine — whose
amendments override the brief where they disagree. These amendments are also the
complete record of deviations from the brief.

| # | Amendment | Probe traceability |
| --- | --- | --- |
| E1 | The response verdict is keyed by the reconstructed `gwResponseId` (trace-row responseId, else `gw-<requestId>`), NOT by the row's nullable `responseId` field as the brief's words implied. The brief's "do not infer event IDs from naming conventions" applies to event IDs only; the `gw-` response-id reconstruction is load-bearing and shared with the outcome ladder. | Found independently by 5 of 8 probes. Probe reproduced `finalizedTraceEntrySchema.parse` throwing inside finalize on a legitimately degraded artifact when the verdict was keyed on the field (`engineOutcome: 'rejected'` coexisting with a null verdict ID). |
| E2 | "Or the trusted fallback" dropped from matrix row 8: the engine-owned fallback (`<requestId>-res-fb`) is unreachable for external/model requests. Row 8 is built by injecting a second response with a distinct responseId directly via `run.responseInbox`. | Probe ran the fallback path: `ExternalDeferredProvider` never throws and the deferred drain ignores gate results, so `runFallbackThroughGate` can never resolve an external row. The rejected-then-other-accepted row shape was probe-verified. |
| E3 | Moot rows tightened (null submission, null verdict, resolution ∈ {Expired, Superseded}); general rule blessed by schema and docs: a request resolved by a DIFFERENT responseId's acceptance yields null `engineOutcome` with non-null `engineResolutionEventId`. `engineOutcome` stays nullable. | Probe-verified against the real finalize join; the combination is produced by the existing shared ladder, not new logic. |
| E4 | The brief's "non-null resolution for every row" is scoped: it holds only for rows whose requestId appears in the ledger's external `DecisionRequested` set — no new strict criterion, no schema-level requirement. | Finalized rows enumerate the UNION of client-trace, client-envelope, trace-row, and sidecar keys, not the ledger's requested set (`finalize.ts` row enumeration), so an unscoped claim is unsatisfiable. |
| E5 | Canonical event-ID schema re-declared locally in `modelArtifacts.ts` as `/^evt-\d{6,}$/` (the module is a leaf; `eventSchemas` does not export its copy, and its envelope regex `/^evt-(op-)?\d{4,}$/` is the wrong one — lifecycle events are never operator markers). Stale `evt-<seq>` comment in `src/shared/events.ts` fixed. | Probe: canonical id `evt-000002` observed at ledger `seq=3` — event IDs come from the canonical-event counter, which operator markers do not consume, not from `seq`. |
| E6 | Finalize-local `EventRef` maps with pinned first-wins (Received) / last-wins (Rejected) policies; the shared `EngineResolutionIndex` kept exactly as-is; no `as` casts at the shared-ladder call site. | Probe proved one responseId can carry two Received + two Rejected events (Received is emitted before the dedup check); first-wins preserves today's `logicalSubmittedTick` bytes across all existing fixtures. |
| E7 | Test plan concretized: same-tick submission/verdict (never a tick inequality), `rejection.seq < expiry.seq` (drain precedes expiry in the same tick), cadence suppression or scenario-ended expiry to force rejected→expired (TTL and re-decision cadence are both 60 ticks, so supersession naturally beats expiry), assertions keyed on event TYPES and IDs with reason strings secondary. | Probe-proven sequence Requested → Superseded (tick 180) → Received (tick 211) → Rejected (tick 211); external drain runs before TTL expiry within `stepTick`; the ordinary client really does submit late responses (discard only on stale runId). |
| E8 | Degraded-unresolved fixture recipe: delete the TERMINAL scenario-ended `DecisionRequestExpired` from a real ledger, renumber seq/ids, remap causation/correlation, recompute hashes — the ledger passes full validation, strict finalize fails on engine-resolution, and `--allow-degraded` writes the null-resolution row while also tripping strict-disposition (both criteria asserted). | Probe-verified end to end; naive tampering (removing a Superseded event) aborts replay with `reduce-decision-request-overlap`, so this is the only viable construction. |
| E9 | Versioning: `npm version 1.6.1 --no-git-tag-version` must fix BOTH lockfile keys — `package-lock.json` was stale at `1.3.0` in `.version` and `.packages[""].version` while `package.json` said `1.6.0`. The new test file must be appended to the hard-coded `test:model:bundle` list or CI's model-bundle gate silently skips it. | Direct inspection of the lockfile and the script's hard-coded file list. |
| E10 | Docs corrected against reality: the live acceptance report records BOTH smoke attempts (the failed 429 and the pass) per its own recorded-not-discarded rule, its Provenance table stays fully PENDING, and the pinned-model note distinguishes the returned model id from the routing sidecar's dated endpoint build (`inclusionai/ling-2.6-flash-20260421` — not a substitution; the criterion compares trace-row `modelId` only). | Facts verified against the local artifacts of the two 2026-07-28 smoke requests (gateway trace, routing sidecars). |
| E11 | Frozen boundaries restated with two sharpenings: `logicalSubmittedTick` must be byte-identical across all existing fixtures, and the latency-rehearsal assertion covers EVERY finalized row whose requestId is in the Superseded set — `'superseded'` AND `'rejected'` outcomes — plus ≥1 row proving `resolution.tick < submission.tick` with a non-null submission. | Probe-proven late-response regime: the latency rehearsal already exercises late submissions against superseded requests. |
| E12–E14 | Reserved numbering only — the authoritative spec issued amendments E1–E11; no E12–E14 exists. Recorded so a future reader does not hunt for missing amendments. | n/a |

## Tests

Test counts at the final commit: **460** tests across **52** files (`test:run`);
`test:gateway` 55; `test:model:bundle` 127 (the new lifecycle suite is wired into the
hard-coded `test:model:bundle` list — amendment E9).

- **`tests/integration/model-artifact-event-semantics.test.ts` (NEW):** seven lifecycle
  cases against the REAL engine plus the full four-source finalize join — accepted;
  rejected → expiry (cadence-suppressed, seq-ordered); late response after supersession
  (resolution tick strictly before submission tick); provider failure → expiry; expiry
  with no submission; supersession with no submission; rejected gateway response with an
  injected distinct-responseId acceptance — plus the duplicate-responseId policy case
  and the degraded-unresolved case.
- **`tests/integration/model-bundle.test.ts`:** the assertions that equated
  `engineResolutionEventId` with Received/ProviderFailed are deleted and replaced with
  the three-field contract on every fixture row class.
- **`tests/unit/model-artifact-schemas.test.ts`:** v3 pin (siblings held at their frozen
  versions), v2-literal rejection, required-key proofs for both new fields, invalid
  event-id formats (`evt-op-000001`, `evt-12`, bare string), co-null violations in both
  directions, accepted/rejected-without-verdict rejections, and acceptance of the legal
  null-verdict and null-resolution rows.
- **`scripts/model/rehearse.ts` + `tests/integration/model-rehearsal.test.ts`:** the
  latency case now asserts the supersede event is the resolution for every superseded
  requestId regardless of `engineOutcome`, and that at least one row's resolution
  precedes its submission. Aggregate hashes are recomputed, never hand-pinned.
- **Mutation pass (manual, post-implementation):** each defect class turns at least one
  test red — resolution from Received; resolution from ProviderFailed; Rejected as
  resolution; verdict joined by requestId or by the row's `responseId` field; any
  submission ≤ resolution tick assumption. Result: **6/6 caught** — the five spec §7.5
  mutations at the implementation head, plus the field-keyed verdict variant surfaced by
  the pre-merge adversarial review. That review found the original suite left the E1 key
  SOURCE unpinned (every verdicted fixture row also had a `response` trace row, making
  the two candidate keys indistinguishable); the added `E1 key divergence` case joins a
  bundle-less, trace-less degraded directory where the row's `responseId` field is null
  while the `gw-<requestId>` fallback key still finds every verdict — red under the
  field-keyed mutation, green on the shipped code.

## Validation and CI

| Item | Value |
| --- | --- |
| PR | [#8](https://github.com/186F/thelastmeal/pull/8) — "Correct finalized-trace engine event provenance (1.6.1, schema v3)" |
| Final PR head | `b8b2d775cd5704c3a405661b3234be5eb28c877a` |
| PR head CI (`Required checks (clean checkout)`) | run `30405298109` — success |
| Merge commit | `219079be739928ab00c7847ced35987d5e11fdd9` |
| Merged-main CI | run `30405727028` — success |
| Merged at | 2026-07-28T22:45:44Z |

Both runs must execute the full required job: `npm ci`, both typechecks, lint, validate,
`test:run`, `test:gateway`, `test:model:bundle`, both builds, the dist secret scan,
Playwright e2e, the 100-runs-per-scenario deterministic batch, and the keyless formal
rehearsal (`model:rehearse -- --ci`), with `RUN_LIVE_MODEL_TESTS` unset.

## Frozen boundaries — confirmations

- **All fourteen deterministic golden hashes byte-identical:** verified at the
  implementation head (100-runs-per-scenario batch, replay=match on every scenario) and
  re-proven by the required CI job at the PR head and merged main.
- **`logicalSubmittedTick` byte-identical across all existing fixtures:** the first-wins
  Received/ProviderFailed indexing reproduces the 1.5.0 derivation exactly; every
  pre-existing `logicalSubmittedTick` assertion in `model-bundle.test.ts` passes
  unedited, and the rehearsal replays match.
- **`model-summary.json` unchanged in content** — the shared ladder is untouched.
- **No live model call was made during this remediation**, by any test, script, or CI
  run. No API key was present, required, read, or committed anywhere in this work; the
  disposable smoke traffic of 2026-07-28 predates this branch and is recorded only as
  non-formal evidence in the live acceptance report.
- Raw gateway trace, client bundle, final manifest, bundle manifest, router trace,
  ledger, event, worker-protocol, experiment, condition, provider, and prompt versions
  are all unchanged; only the package version (1.6.1) and
  `finalizedTraceSchemaVersion` (3) moved.
