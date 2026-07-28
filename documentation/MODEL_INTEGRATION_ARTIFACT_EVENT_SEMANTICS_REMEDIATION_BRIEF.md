# Model Integration Artifact Event Semantics Remediation Brief

**Repository:** `186F/thelastmeal`  
**Base branch:** `main`  
**Base commit at authoring:** `1a296549ac567dfbb9659f8acb28799d197060d7`  
**Target implementation release:** `1.6.1`  
**Vertical Slice experiment:** `Vertical Slice 001 — v1.0`, unchanged  
**Model experiment:** `model-backed-npc-001` v `1.1.0`, unchanged  
**Condition:** `mara-model-per-decision-v1`, unchanged  
**External provider identity:** `openrouter-mara-action-v1`, unchanged  
**Prompt version:** `mara-action-selection-1.0.0`, unchanged  
**Status:** Required before the formal six-run live acceptance sequence

## 1. Executive directive

Implement one narrow correction to the derived model-run research artifacts: make every event-ID field in `finalized-trace.jsonl` describe the engine lifecycle event its name claims to describe.

The disposable live OpenRouter smoke request has already passed. Do **not** make another paid request for this remediation. This work is entirely keyless and must be validated with fixtures, the fake gateway, the deterministic batch, and the formal rehearsal.

The current defect does not affect canonical simulation state, model authority, action legality, replay, provider binding, routing pinning, or deterministic hashes. It affects the semantic accuracy of the finalized research trace.

The required final model is:

```text
External request emitted
        ↓
Optional engine submission event
  DecisionResponseReceived
  or DecisionProviderFailed
        ↓
Optional response verdict
  DecisionResponseAccepted
  or DecisionResponseRejected
        ↓
Exactly one canonical request resolution in a complete run
  DecisionResponseAccepted
  or DecisionRequestExpired
  or DecisionRequestSuperseded
```

After this patch, a finalized row must expose separate event IDs for those distinct stages.

## 2. Confirmed root cause

The shared schema currently describes `engineResolutionEventId` as:

```text
Event id of the engine's resolving lifecycle event, when one exists.
```

But `scripts/model/finalize.ts` currently computes:

```text
submission = DecisionResponseReceived or DecisionProviderFailed
```

and then writes:

```text
engineResolutionEventId = submission.eventId
```

The current integration test preserves the same mistake by asserting that:

- a response row's `engineResolutionEventId` equals its `DecisionResponseReceived` event ID; and
- a failure row's `engineResolutionEventId` equals its `DecisionProviderFailed` event ID.

Those events record that a result entered the engine. They do **not** necessarily resolve the request.

The canonical request-resolution events are:

```text
DecisionResponseAccepted
DecisionRequestExpired
DecisionRequestSuperseded
```

`DecisionResponseRejected` is a verdict about one submitted response, not a terminal request resolution. A rejected response can leave the request pending until it later expires, is superseded, or is resolved by another response.

## 3. Non-goals and frozen boundaries

Do not change any of the following:

- Scenario definitions, seeds, schedules, identities, memories, traits, needs, rates, weights, or action vocabulary
- Canonical event behavior or event payloads
- Reducer behavior
- World-state or ledger hashing
- Provider plans
- The OpenRouter adapter request body
- The pinned model/provider routing rules
- Prompt text or prompt version
- Model experiment ID, version, condition, or external provider identity
- Browser gateway-client behavior
- Model authority or engine acceptance rules
- Raw `model-trace.jsonl` schema version
- Run-bundle schema version
- Final-manifest schema version
- Bundle-manifest schema version
- Any of the fourteen deterministic golden hashes
- Policy patches, dialogue, reflection, additional model-backed NPCs, NCP integration, or the intersubjectivity/coping layer

Do not commit:

- `.env.gateway`
- An API key
- The raw disposable smoke-test request, trace, manifest, or routing sidecar
- Any generated `artifacts/` directory

This is a derived-artifact semantics correction only.

## 4. Required field contract

### 4.1 Retain `logicalSubmittedTick`

`logicalSubmittedTick` already has the correct intended meaning:

```text
Tick of DecisionResponseReceived, or
Tick of DecisionProviderFailed, or
null when nothing entered the engine.
```

Do not rename it and do not change its meaning.

### 4.2 Add `engineSubmissionEventId`

Add:

```text
engineSubmissionEventId: string | null
```

Meaning:

```text
Event ID of DecisionResponseReceived, or
Event ID of DecisionProviderFailed, or
null when nothing entered the engine.
```

`engineSubmissionEventId` and `logicalSubmittedTick` must come from the same indexed event and must be co-null:

```text
both non-null, or both null
```

### 4.3 Add `responseVerdictEventId`

Add:

```text
responseVerdictEventId: string | null
```

Meaning:

```text
Event ID of DecisionResponseAccepted or DecisionResponseRejected
for this row's responseId.
```

It is null when the row does not describe a submitted response with an engine verdict—for example, a provider failure, a pre-dispatch client failure, a request that simply expires, or a request that is superseded before any response arrives.

This field is keyed by `responseId`, not merely by `requestId`.

### 4.4 Correct `engineResolutionEventId`

Retain the field name but correct its implementation:

```text
engineResolutionEventId: string | null
```

Meaning:

```text
Event ID of the single canonical request-resolution event:
- DecisionResponseAccepted, keyed by requestId
- DecisionRequestExpired, keyed by requestId
- DecisionRequestSuperseded, keyed by requestId
```

In a strict `status: "completed"` bundle, every engine-emitted external request must have exactly one such resolution, so this field must be non-null for every finalized request row.

It may remain null only in a deliberately degraded artifact whose failed criteria explicitly include a missing engine resolution.

### 4.5 Preserve `engineOutcome`

Do not silently redefine `engineOutcome` in this patch. Keep the existing shared resolution ladder and precedence:

```text
accepted response
rejected response
expired request
superseded request
unresolved
```

This means a finalized row can legitimately contain:

```text
engineOutcome: "rejected"
responseVerdictEventId: DecisionResponseRejected event
engineResolutionEventId: later DecisionRequestExpired event
```

or:

```text
engineOutcome: "rejected"
responseVerdictEventId: late DecisionResponseRejected event
engineResolutionEventId: earlier DecisionRequestSuperseded event
```

That is not a contradiction. `engineOutcome` describes the verdict most relevant to this trace row under the existing ladder; `engineResolutionEventId` identifies how the request itself terminally resolved.

## 5. Required lifecycle matrix

The implementation and tests must prove the following cases.

| Case | `engineSubmissionEventId` | `responseVerdictEventId` | `engineResolutionEventId` | Existing `engineOutcome` |
| --- | --- | --- | --- | --- |
| Gateway response accepted | `DecisionResponseReceived` | `DecisionResponseAccepted` | Same `DecisionResponseAccepted` | `accepted` |
| Gateway response rejected, then request expires | `DecisionResponseReceived` | `DecisionResponseRejected` | `DecisionRequestExpired` | `rejected` |
| Late response arrives after request was superseded | Late `DecisionResponseReceived` | `DecisionResponseRejected` | Earlier `DecisionRequestSuperseded` | `rejected` |
| Gateway/provider failure enters engine | `DecisionProviderFailed` | `null` | `DecisionRequestExpired` | `expired` |
| Client-side pre-dispatch failure enters engine | `DecisionProviderFailed` | `null` | `DecisionRequestExpired` | `expired` |
| No response or failure enters engine before TTL | `null` | `null` | `DecisionRequestExpired` | `expired` |
| Request is superseded before any result arrives | `null` | `null` | `DecisionRequestSuperseded` | `superseded` |
| Gateway response is rejected, another response/fallback resolves request | `DecisionResponseReceived` | `DecisionResponseRejected` | `DecisionResponseAccepted` for the accepted response | `rejected` for the gateway-response row |
| Failure arrives after the request is already resolved and is dropped as moot | `null` unless an engine event was actually emitted | `null` | Existing accepted/expired/superseded event | Existing request resolution |

Do not add a universal chronological assertion such as:

```text
submission tick <= resolution tick
```

A late response to an already superseded request is valid evidence in which the canonical resolution predates the submission and rejection events.

## 6. Implementation requirements

### 6.1 `src/shared/modelArtifacts.ts`

1. Advance:

```text
FINALIZED_TRACE_SCHEMA_VERSION: 2 -> 3
```

2. Add the two new fields to `finalizedTraceEntrySchema`:

```text
engineSubmissionEventId
responseVerdictEventId
```

3. Retain `engineResolutionEventId` but rewrite its documentation to state that it identifies the canonical request resolution, not submission.

4. Use a canonical engine-event ID schema rather than an unconstrained string. These lifecycle events are canonical ledger events, so the value should match the repository's canonical event-ID form.

5. Add a cross-field refinement requiring:

```text
logicalSubmittedTick is null exactly when engineSubmissionEventId is null
```

6. A non-null `engineOutcome` of `accepted` or `rejected` must have a non-null `responseVerdictEventId`, because those outcomes can only be derived from a corresponding verdict event.

7. Do not require `engineResolutionEventId` at schema level for all rows, because degraded finalization may intentionally preserve an unresolved row. Strict completeness is enforced by the finalizer.

8. Update every comment that describes finalized trace v2. The raw gateway trace remains v2; only the derived finalized trace advances to v3.

Do **not** advance:

```text
MODEL_TRACE_SCHEMA_VERSION
CLIENT_TRACE_SCHEMA_VERSION
FINAL_MANIFEST_SCHEMA_VERSION
BUNDLE_MANIFEST_SCHEMA_VERSION
run bundle schema version
ledger/event/worker protocol versions
```

### 6.2 `scripts/model/finalize.ts`

Introduce one reusable event reference shape, for example:

```text
EventRef
- eventId
- tick
```

Enrich `LedgerIndex` so the finalizer can retrieve actual lifecycle events rather than merely test membership.

At minimum, index:

```text
receivedByResponseId
  responseId -> EventRef

providerFailedByRequestId
  requestId -> EventRef + errorCode

acceptedByResponseId
  responseId -> EventRef + requestId

acceptedByRequestId
  requestId -> EventRef + responseId

rejectedByResponseId
  responseId -> EventRef + requestId + rejectionReason

expiredByRequestId
  requestId -> EventRef + reasonCode

supersededByRequestId
  requestId -> EventRef + supersededByRequestId
```

The existing sets/maps used by `resolveEngineOutcome` may remain as derived views, or the shared helper may be adapted to the richer index. Do not create a second independent outcome ladder.

For each finalized row, compute three independent references:

```text
submissionRef
  receivedByResponseId[responseId]
  else providerFailedByRequestId[requestId]
  else null

responseVerdictRef
  acceptedByResponseId[responseId]
  else rejectedByResponseId[responseId]
  else null

requestResolutionRef
  acceptedByRequestId[requestId]
  else expiredByRequestId[requestId]
  else supersededByRequestId[requestId]
  else null
```

Then populate:

```text
logicalSubmittedTick      = submissionRef?.tick ?? null
engineSubmissionEventId   = submissionRef?.eventId ?? null
responseVerdictEventId    = responseVerdictRef?.eventId ?? null
engineResolutionEventId   = requestResolutionRef?.eventId ?? null
```

Important rules:

- Acceptance is both a response verdict and a request resolution, so the last two IDs are expected to be equal in an accepted row.
- Rejection is only a response verdict. Never use `DecisionResponseRejected` as `engineResolutionEventId`.
- `DecisionProviderFailed` is only a submission/failure-delivery event. Never use it as `engineResolutionEventId`.
- `DecisionResponseReceived` is only a submission event. Never use it as `engineResolutionEventId`.
- Resolve the response verdict by the row's actual `responseId`.
- Resolve the terminal request event by `requestId`, including an acceptance caused by a different response or the trusted fallback.
- Preserve the current outcome precedence for late responses.
- Do not infer event IDs from naming conventions such as `gw-<requestId>` when the validated ledger contains the actual event.

The fully validated ledger remains the sole authority for all three event IDs.

### 6.3 `scripts/model/summarize.ts`

Preserve the one-shared-ladder rule.

`model-summary.json` does not need to expose the three event IDs in this patch. However:

- Any refactor of `EngineResolutionIndex` must preserve identical `engineOutcome` and `engineRejectionReason` results between `model-summary.json` and `finalized-trace.jsonl`.
- Do not duplicate the outcome precedence inside `finalize.ts`.
- If a new shared helper is introduced for event references, keep it pure and test it directly.

### 6.4 Derived artifact regeneration

`finalized-trace.jsonl` is derived evidence, not source evidence. Existing v2 finalized traces must not be silently reinterpreted as v3.

The supported upgrade path is:

```text
retain raw ledger + client bundle + gateway trace + request/routing sidecars
rerun model:finalize
regenerate finalized-trace.jsonl as schema v3
regenerate hashes and bundle manifest
```

No migration of the disposable smoke run is required; it was intentionally not a formal complete run.

## 7. Required tests

### 7.1 Update the existing strict-success fixture

In `tests/integration/model-bundle.test.ts`, update the `FinalRow` test type and assertions.

For an accepted response, find all three ledger events and assert:

```text
logicalSubmittedTick == DecisionResponseReceived.tick
engineSubmissionEventId == DecisionResponseReceived.id
responseVerdictEventId == DecisionResponseAccepted.id
engineResolutionEventId == DecisionResponseAccepted.id
engineSubmissionEventId != engineResolutionEventId
```

For an explicit provider failure, assert:

```text
logicalSubmittedTick == DecisionProviderFailed.tick
engineSubmissionEventId == DecisionProviderFailed.id
responseVerdictEventId == null
engineResolutionEventId == DecisionRequestExpired.id
engineSubmissionEventId != engineResolutionEventId
```

Apply equivalent assertions to the pre-dispatch failure and gateway-interrupted fixture rows.

Delete the current assertions that equate `engineResolutionEventId` with `DecisionResponseReceived` or `DecisionProviderFailed`.

### 7.2 Add a focused lifecycle-semantics integration suite

Create a focused test file, preferably:

```text
tests/integration/model-artifact-event-semantics.test.ts
```

It must cover at least:

1. Accepted response
2. Rejected response followed by expiry
3. Late response rejected after the request was already superseded
4. Provider failure followed by external-failure expiry
5. Request expiry without any submission event
6. Request supersession without any submission event
7. Rejected gateway response followed by acceptance of another response/fallback

For the late-response case, explicitly prove:

```text
resolution event tick < submission event tick
```

while the artifact still finalizes correctly. This prevents a future developer from introducing an invalid chronological assumption.

### 7.3 Schema tests

Update `tests/unit/model-artifact-schemas.test.ts` and any other fixtures containing `finalizedTraceSchemaVersion`.

Prove:

- Version 2 rows are rejected by the v3 schema.
- A valid v3 row parses.
- Unknown fields remain rejected.
- Invalid event-ID formats are rejected.
- `logicalSubmittedTick` and `engineSubmissionEventId` must be co-null.
- `engineOutcome: accepted` requires `responseVerdictEventId`.
- `engineOutcome: rejected` requires `responseVerdictEventId`.
- Expired/superseded rows may have a null response verdict.
- Degraded unresolved rows may have a null `engineResolutionEventId`.

### 7.4 Rehearsal and bundle tests

The ordinary formal rehearsal must generate v3 finalized rows and continue to strict-finalize all three cases:

```text
normal
gateway-stop
latency/supersede
```

The latency/supersede case must assert the corrected resolution event type, not merely successful finalization.

The bundle manifest's aggregate hash will naturally change because the finalized trace bytes change. Tests must recompute and verify it; do not pin a hand-written replacement hash.

### 7.5 Mutation expectations

At least one negative test must fail if each of the following regressions is reintroduced:

- `engineResolutionEventId` is assigned from `DecisionResponseReceived`.
- `engineResolutionEventId` is assigned from `DecisionProviderFailed`.
- A rejected response is incorrectly treated as the request resolution.
- A late superseded response assumes resolution must occur after submission.
- The response verdict is joined by request ID rather than response ID.

## 8. Versioning and documentation

### 8.1 Package release

Advance the implementation package release:

```text
1.6.0 -> 1.6.1
```

Update both `package.json` and the root package entry in `package-lock.json` so they agree.

Do not change the model experiment or prompt versions. This correction changes derived artifact semantics, not the experimental condition presented to the model.

### 8.2 README

Add a `1.6.1` release-lineage entry stating that it corrects finalized engine lifecycle event provenance without changing the frozen simulation, model condition, prompt, or OpenRouter route.

Update the artifact documentation to describe finalized trace schema v3 and the three event-ID fields.

### 8.3 OpenRouter implementation report

Update:

```text
documentation/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md
```

The known limitation stating that `engineResolutionEventId` carries pre-1.6.0 submission semantics must be marked closed, with the implementation PR, commit, CI run, and schema-version evidence added after merge.

### 8.4 Live acceptance report

Update:

```text
documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md
```

The current statement that no live request has ever been executed is no longer accurate. Replace it with:

```text
Status: PENDING — disposable smoke test passed; formal six-run sequence not yet executed
```

Record a small, clearly non-formal smoke-test section with these nonsecret facts:

```text
Date: July 28, 2026
Run ID: live-smoke-8420-1785272208027
Requested model: inclusionai/ling-2.6-flash
Pinned provider: novita
Reported provider: Novita
Routing strategy: direct
Attempts: 1
Selected affordance: aff:mara:60:continue:work
Reason code: commitment
Confidence: 8500 basis points
Input/output tokens: 2853 / 81
Gateway latency: 2402 ms
Result: passed
```

State prominently that:

- This was a disposable connectivity/contract smoke test.
- It is not one of the six formal acceptance runs.
- The raw request, trace, routing sidecar, manifest, and API key are not committed.
- The overall milestone remains `PENDING` until the fixed-SHA formal sequence is complete.

### 8.5 Implementation report

Create:

```text
documentation/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md
```

The report must record:

- Base and final commits
- Files changed
- Exact schema changes
- Event mapping behavior
- Test counts
- CI run IDs
- Confirmation that all fourteen golden hashes are unchanged
- Confirmation that no live API call was made during this remediation
- Any deviations from this brief

## 9. Required validation and CI

Implement on a branch created from current `main`. Do not push directly to `main`.

The PR-head and merged-main SHAs must each receive a visible green `Required checks (clean checkout)` run covering:

```text
npm ci
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
npm run test:e2e:install
npm run test:e2e
npm run batch
npm run model:rehearse -- --ci
```

Required results:

- All unit and integration tests pass.
- All gateway tests pass without a key.
- All model-bundle tests pass.
- All browser tests pass.
- The formal keyless rehearsal strict-finalizes all three cases.
- The 100-runs-per-scenario batch passes.
- All fourteen golden hashes remain byte-identical.
- The dist secret scan passes.
- No workflow or test makes a live OpenRouter call.
- Rehearsal and batch artifacts upload successfully.

Do not set `RUN_LIVE_MODEL_TESTS=1` during this remediation.

## 10. Manual verification

After the automated suite passes, inspect one generated strict finalized trace and verify against its ledger:

### Accepted response

```text
engineSubmissionEventId -> DecisionResponseReceived
responseVerdictEventId -> DecisionResponseAccepted
engineResolutionEventId -> same DecisionResponseAccepted
```

### Provider failure

```text
engineSubmissionEventId -> DecisionProviderFailed
responseVerdictEventId -> null
engineResolutionEventId -> DecisionRequestExpired
```

### Rejected late response

```text
engineSubmissionEventId -> late DecisionResponseReceived
responseVerdictEventId -> DecisionResponseRejected
engineResolutionEventId -> earlier DecisionRequestSuperseded
```

Confirm that every non-null event ID resolves to exactly one event in the validated canonical ledger and that the event type matches the field contract.

## 11. Definition of done

This remediation is complete only when all of the following are true:

- `FINALIZED_TRACE_SCHEMA_VERSION` is 3.
- Every v3 finalized row exposes `engineSubmissionEventId`, `responseVerdictEventId`, and corrected `engineResolutionEventId`.
- `logicalSubmittedTick` and `engineSubmissionEventId` always identify the same event.
- `engineResolutionEventId` never points to `DecisionResponseReceived`.
- `engineResolutionEventId` never points to `DecisionProviderFailed`.
- `engineResolutionEventId` never points to `DecisionResponseRejected`.
- An accepted row points both verdict and resolution to the same `DecisionResponseAccepted` event.
- A rejected row can point its verdict and request resolution to different events.
- A late response can legally have a resolution event that predates submission.
- Strict completed bundles contain a non-null request resolution ID for every external request.
- Degraded artifacts explicitly report any missing resolution evidence.
- Raw gateway trace, client bundle, final manifest, bundle manifest, ledger, event, worker, experiment, condition, provider, and prompt versions remain unchanged except where this brief explicitly requires a package-version or finalized-trace-version update.
- Package and lockfile report `1.6.1`.
- Documentation accurately records the passed disposable smoke test while keeping formal acceptance `PENDING`.
- PR-head and merged-main CI are green.
- All fourteen deterministic golden hashes are unchanged.
- No API key or generated live artifact enters Git.
- No live model call is made during implementation or CI.

## 12. Stop condition and next step

After this remediation merges and the exact merged SHA has green CI, freeze that SHA and the live configuration for the formal six-run sequence:

1. Scenario A deterministic baseline
2. Scenario A live Mara
3. Scenario B1 live Mara
4. Scenario B2 live Mara with identical model, route, prompt, and limits
5. Scenario C live Mara
6. Scenario A live condition with the gateway stopped after at least one accepted response

Every live model run must strict-finalize with `status: "completed"`, include validated routing evidence, and replay exactly.

Do not begin policy-patch work, dialogue, reflection, additional model-backed NPCs, NCP integration, or the intersubjectivity/coping layer until the formal live acceptance report is complete.
