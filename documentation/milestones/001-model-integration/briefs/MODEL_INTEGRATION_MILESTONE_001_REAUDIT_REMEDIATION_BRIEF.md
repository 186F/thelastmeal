# Model Integration Milestone 001 — Re-Audit, Remediation, and Completion Brief

**Document status:** implementation instructions for the coding agent  
**Repository:** `186F/thelastmeal`  
**Audited branch:** `main`  
**Audited commit:** `3f5aa06c84af226927928edcaa29ea5adb51d3f9`  
**Audited package version:** `1.3.0`  
**Experiment:** `model-backed-npc-001` version `1.0.0`  
**Prompt:** `mara-action-selection-1.0.0`  
**External provider:** `openai-mara-action-v1`  
**Target NPC:** Mara

This document records the results of the post-implementation audit of Model Integration Milestone 001 and defines the remaining work required to complete the milestone as a reliable research experiment.

The existing implementation is a credible and appropriately constrained model-integration architecture. It is ready for a disposable live smoke test. It is **not yet ready to produce the formal experimental dataset**, because its trace and manifest artifacts are not self-contained, the browser-to-gateway configuration handshake does not fully pin the pre-registered condition, and no live model-backed scenario has yet been completed and verified.

The coding agent must implement the remediations below without weakening the deterministic world authority, replay, provider binding, constraint gate, failure behavior, frozen scenarios, or golden hashes.

---

# 1. Executive audit verdict

| Question | Verdict |
| --- | --- |
| Does the implementation follow the core safety architecture? | **Yes** |
| Can the model directly mutate canonical state? | **No inspected path permits it** |
| Does the model select only engine-offered affordances? | **Yes** |
| Is only Mara model-backed? | **Yes** |
| Do Jonas and Rin remain deterministic? | **Yes** |
| Does the engine independently enforce provider binding, staleness, constraints, and action validity? | **Yes** |
| Does gateway or model failure preserve logical progress? | **Yes** |
| Are frozen deterministic baselines protected? | **Yes, according to source, tests, and the repository's reported batch results** |
| Is the fake-gateway integration sufficient for infrastructure testing? | **Yes** |
| Is the live OpenAI path implemented? | **Yes** |
| Has the live OpenAI path been demonstrated? | **No** |
| Is the run bundle a complete, self-contained research artifact? | **No** |
| May work begin on policy patches, reflection, dialogue, or a second model-backed NPC? | **No** |

The release status is therefore:

> **Conditional GO for one disposable live Mara smoke test. NO-GO for formal live data collection until this brief is implemented.**

---

# 2. Audit scope and evidence limits

The audit examined the implementation at commit `3f5aa06c84af226927928edcaa29ea5adb51d3f9`, including:

- Provider plans and registered conditions
- External deferred-provider behavior
- Exact outbound request schemas
- Bounded external context construction
- Worker and browser transport boundaries
- Gateway validation and budget controls
- OpenAI Responses API adapter
- Prompt and Structured Output contract
- Provider binding and the authoritative engine gate
- Explicit external-failure lifecycle
- Model trace, manifest, summarizer, and bundle hashing
- Model-integration UI
- Fixture, gateway, client, replay, and determinism tests
- CI workflow definitions
- Documentation and manual setup

This was a static source audit. The repository reports successful execution of 306 Vitest tests, 21 gateway tests, nine Playwright tests, both builds, the distribution-secret scan, and the full 100-runs-per-scenario deterministic batch. Those are repository-reported results rather than independently reproduced results from this audit environment.

The implementation report correctly states that no live OpenAI run has been completed. Do not reinterpret fake-adapter evidence as live-model evidence.

---

# 3. What is already correct and must be preserved

## 3.1 Deterministic authority

The simulation—not the model, gateway, browser, or prompt—retains exclusive authority over:

- Canonical world state
- Time
- Available affordances
- Resource ownership and reservations
- Physical and logical action validity
- Survival and identity constraints
- Action execution
- Commitments
- Consequences
- Event creation
- Replay
- Final semantic state

Do not move any of these responsibilities into the gateway or model adapter.

## 3.2 Mixed-provider condition

The registered condition correctly routes:

```text
Mara   -> openai-mara-action-v1
Jonas  -> deterministic-utility-v1
Rin    -> deterministic-utility-v1
```

Scenario F correctly remains outside the model condition.

Do not broaden the target population in this remediation.

## 3.3 Provider binding

Every external response still passes through the single authoritative acceptance gate. The gate correctly distinguishes the requested provider from the engine-owned fallback and prevents an externally submitted response from spoofing fallback authority.

Do not introduce a shortcut around `processDecisionResponse`.

## 3.4 Failure behavior

Known external failures correctly become:

```text
DecisionProviderFailed
        +
DecisionRequestExpired(reason = external-failure)
```

The NPC continues through provisional or existing behavior and re-decides on ordinary cadence.

Do not add automatic upstream retries in this milestone.

## 3.5 Gateway boundary

The OpenAI SDK and API key remain gateway-only. The model receives a bounded structured context and may return only one offered affordance ID, a bounded reason code, confidence, and a short rationale.

Do not add tools, web access, file access, arbitrary function calls, conversation persistence, or direct model-written world effects.

## 3.6 Frozen baseline

The following remain frozen:

- Scenario data
- Seeds
- NPC identities
- Need and task constants
- Deterministic weights
- Memory appraisal weights
- Event consequences
- Constraint semantics
- Existing deterministic event streams
- Fourteen golden hashes

No remediation may silently re-baseline the frozen deterministic experiment.

---

# 4. Audit findings

## Finding 1 — High: the model-run artifact is not self-contained

### Current state

`model-trace.jsonl` records useful gateway-level information:

- Run and request IDs
- NPC and scenario IDs
- Requested logical tick
- Provider and prompt
- Model identifier
- Context hash
- Truncation counts
- Selected affordance
- Reason, confidence, and rationale
- Token usage
- Wall-clock latency
- Gateway outcome

However, it does not retain:

- The exact validated request envelope or model context
- The exact affordance descriptors presented to the model
- `logicalSubmittedTick`
- The gateway-generated response or failure ID
- The final engine outcome inside the finalized trace
- The engine rejection reason inside the finalized trace

`run-manifest.json` is seeded on the first request but is not finalized. It lacks required completed-run fields such as:

- Scenario version
- Seed
- Completion timestamp
- `worldStateHash`
- `canonicalLedgerHash`
- Final request and call counts
- Final token totals
- Final model-identifier evidence

The summarizer reconstructs some engine outcomes later, but the bundle cannot independently reconstruct the exact input supplied to the model from a context hash alone.

### Consequence

A completed run cannot be independently audited for:

- The precise memories and beliefs the model saw
- Exact context truncation
- The complete offered action menu
- Prompt-input fidelity
- Logical request-to-response delay
- Full request, gateway, and engine lifecycle joins

This is a blocker for H6 measurability and for formal experimental data collection.

---

## Finding 2 — Medium: the pre-registered condition is not fully pinned at the browser handshake

### Current state

The gateway itself correctly rejects:

- Non-Mara requests
- Wrong providers
- Wrong conditions
- Wrong prompt versions
- Context-hash mismatches

But the generic shared external-request schema permits any NPC ID and a bounded arbitrary provider ID. The transport envelope permits either registered condition and an arbitrary bounded prompt-version string.

More importantly, `ModelGatewayClient.connect()` accepts a gateway configuration when its shape and request-schema version are valid. It does not require exact agreement with the pre-registered:

- Provider ID
- Prompt version
- Experiment ID and version
- Condition ID

The client then copies the gateway-advertised prompt version into the outgoing envelope.

### Consequence

A browser pointed at an older or misconfigured gateway may silently run a different prompt or provider configuration. The engine will still protect world integrity, but the resulting run will not be the experiment that was pre-registered.

This is an experimental-integrity problem rather than a canonical-world safety problem.

---

## Finding 3 — Medium: the live milestone has not been demonstrated

The live OpenAI adapter is implemented, but no actual live model request or full model-backed scenario has been executed and verified.

The milestone's stop condition remains unmet until all of the following occur:

1. One real Mara request is accepted through the live gateway.
2. One complete live model-backed scenario reaches terminal state.
3. Its exported ledger imports and replays exactly.
4. Gateway failure during a live-condition run preserves a valid terminal run.
5. Only Mara generated external calls.
6. Frozen deterministic hashes remain unchanged.
7. The finalized model trace joins cleanly to the canonical ledger.

This is a completion gate, not a defect in the fake-gateway architecture.

---

## Finding 4 — Low: release and specification documentation are inconsistent

The repository contains several documentation inconsistencies:

- The implementation brief is still associated with an open draft documentation PR rather than clearly being established as the authoritative specification on `main`.
- The implementation report does not state the exact final commit SHA in its header.
- The README introduction still identifies the implementation as remediation release 1.1.0 even though the package and implementation report identify 1.3.0.
- The implementation report describes the trace and manifest layer more completely than the actual current artifacts justify.

These should be corrected before live evidence is recorded.

---

# 5. Additional hardening required for full implementation

The following issues were identified while translating the audit into an implementation plan. They are compatible with the original brief and should be included in the remediation.

## 5.1 One engine request must cause at most one upstream model call

The browser client and SDK currently avoid retries, but the gateway does not deduplicate repeated HTTP submissions carrying the same `(runId, requestId)`.

A duplicated POST can therefore cause a second upstream model call even though both responses will carry the same deterministic engine response ID.

Add gateway-side idempotency so one validated engine request produces at most one adapter invocation.

## 5.2 The server should enforce the origin policy, not only emit CORS headers

The gateway currently writes an `Access-Control-Allow-Origin` header but does not inspect a supplied `Origin` header.

For `POST /v1/decision`:

- If an `Origin` header is present, require exact equality with the configured allowed origin.
- Permit a missing `Origin` for loopback CLI tests and the opt-in smoke script.
- Reject a mismatched present origin before reading or dispatching the request.

## 5.3 The browser should reconcile a gateway result with the request before engine submission

A result may pass the generic response schema while naming another request, NPC, scenario, provider, or action.

The engine will reject such a payload, but the main thread should perform defense-in-depth relational validation against the exact request it dispatched.

For a response, verify:

```text
requestId
npcId
scenarioId
providerId
selectedAffordanceId is offered
```

For a failure, verify:

```text
requestId
npcId
scenarioId
providerId
```

A mismatch must become `invalid-gateway-response` for the original request. Do not forward the gateway-supplied mismatched identity into the worker.

---

# 6. Required remediation architecture

Implement a three-source research record:

```text
Canonical ledger
    objective world and engine lifecycle

Client transport trace
    every external engine request and browser transport outcome

Gateway upstream trace
    every validated gateway dispatch and model outcome

            ↓ finalized join

model-trace.jsonl
run-manifest.json
model-summary.json
bundle-manifest.json
```

The gateway cannot record failures that occur because it is unavailable. Therefore, the browser/client must retain its own noncanonical trace for every external request.

## 6.1 Raw client trace

Add an in-memory `ModelClientTraceRecorder` owned by the browser composition root.

It must record one entry for every exact-valid external request emitted by the worker, including requests that never reach the gateway.

Suggested file name when exported:

```text
client-trace.jsonl
```

Each entry must include at least:

```text
traceSchemaVersion
runId
conditionId
requestId
npcId
scenarioId
providerId
promptVersionExpected
requestedAtLogicalTick
exactExternalDecisionRequest
contextHash
queuedAtUtc
dispatchedAtUtc
completedAtUtc
clientOutcome
clientFailureCode
responseId
failureId
clientLatencyMs
```

`exactExternalDecisionRequest` must contain the complete bounded request, context, context hash, and truncation counts exactly as received from the worker.

Do not store secrets or process environment data.

## 6.2 Raw gateway trace

Rename or explicitly version the current gateway trace as a raw upstream trace.

Recommended file name:

```text
gateway-trace.jsonl
```

Each entry must include:

```text
traceSchemaVersion
runId
requestId
responseId or failureId
providerId
promptVersion
modelId
contextHash
upstreamResponseId
selectedAffordanceId
reasonCode
confidenceBp
rationale
inputTokens
outputTokens
totalTokens
latencyMs
concurrentInFlight
gatewayOutcome
```

Do not duplicate the complete request payload here if it is already preserved in the client trace. The context hash must join the two records.

## 6.3 Finalized model trace

The finalizer must create:

```text
model-trace.jsonl
```

This is the self-contained, strict-schema-validated joined trace used for analysis and bundle hashing.

Each finalized row must include:

```text
traceSchemaVersion
runId
requestId
npcId
scenarioId
conditionId
providerId
promptVersion
modelId
requestedAtLogicalTick
logicalSubmittedTick
exactRequestPayload
contextHash
truncationCounts
responseId
failureId
selectedAffordanceId
reasonCode
confidenceBp
rationale
inputTokens
outputTokens
totalTokens
clientLatencyMs
gatewayLatencyMs
gatewayOutcome
engineOutcome
engineRejectionReason
engineResolutionEventId
```

Define `logicalSubmittedTick` as:

- `DecisionResponseReceived.tick` for a response that entered the engine, or
- `DecisionProviderFailed.tick` for an explicit external failure.

Do not estimate this value from the browser's latest rendered snapshot.

## 6.4 Finalized run manifest

Use a strict versioned manifest schema.

A run may begin with:

```text
status = in-progress
```

The formal bundle is valid only after the finalizer writes:

```text
status = completed
```

The completed manifest must contain at least:

```text
manifestSchemaVersion
experimentId
experimentVersion
conditionId
runId
scenarioId
scenarioVersion
seed
providerPlanId
externalProviderId
promptVersion
requestedModelId
returnedModelIds
modelSettings
startedAtUtc
completedAtUtc
worldStateHash
canonicalLedgerHash
externalRequestsEmitted
upstreamCallsAttempted
callsCompleted
callsFailedByCategory
acceptedModelResponses
inputTokens
outputTokens
totalTokens
```

The finalizer must fail if the ledger, client trace, gateway trace, or manifest disagree on run, scenario, condition, provider, prompt, or context hashes.

## 6.5 Formal bundle

The final bundle must contain:

```text
artifacts/model-runs/<runId>/
  ledger-*.json
  client-trace.jsonl
  gateway-trace.jsonl
  model-trace.jsonl
  run-manifest.json
  model-summary.json
  bundle-manifest.json
```

`bundle-manifest.json` must include SHA-256 hashes for every file except itself, plus an aggregate bundle hash computed from the sorted file-name/hash pairs.

The finalizer must validate every input and output file against a strict schema before reporting success.

---

# 7. Exact condition and gateway configuration pinning

## 7.1 Central registered contract

Create one shared, immutable experiment-contract module usable by browser, simulation schemas, gateway, scripts, and tests.

A suitable location is:

```text
src/shared/modelExperiment.ts
```

It must export literals equivalent to:

```text
experimentId        = model-backed-npc-001
experimentVersion   = 1.0.0
conditionId         = mara-model-per-decision-v1
targetNpcId         = mara
providerId          = openai-mara-action-v1
promptVersion       = mara-action-selection-1.0.0
requestSchemaVersion = 1
```

The prompt text remains gateway-owned. Only the version identifier belongs in the shared contract.

## 7.2 Condition-specific external schema

The exact schema used for model-condition traffic must enforce the literals above.

A general reusable request schema may remain internally, but add a condition-specific schema such as:

```text
maraModelDecisionRequestSchema
maraModelDecisionEnvelopeSchema
```

It must reject:

- Jonas
- Rin
- Scenario F
- Any provider other than `openai-mara-action-v1`
- Any condition other than `mara-model-per-decision-v1`
- Any experiment ID or version mismatch
- Any prompt-version mismatch
- Any request-schema-version mismatch

Use this same condition-specific schema at:

- Engine construction of the external request
- Worker output boundary
- Browser input boundary
- Browser envelope construction
- Gateway input boundary
- Tests

## 7.3 Provider-config handshake

Extend `/v1/provider-config` to return exact nonsecret contract metadata:

```text
status
experimentId
experimentVersion
conditionId
providerId
promptVersion
requestSchemaVersion
modelId
```

The browser must accept the gateway only when every contract field except `modelId` matches its pinned constants.

Differentiate connection failure types:

- Transport cannot reach gateway: `gateway-unavailable`
- Gateway responds with incompatible configuration: `invalid-gateway-response`

Display incompatibility explicitly in the model panel.

## 7.4 Result-to-request reconciliation

Create one shared pure validator:

```text
validateGatewayResultForRequest(result, originalRequest)
```

The browser must invoke it before submitting anything to the worker.

It must never trust identity fields merely because a Zod object parsed.

---

# 8. Gateway idempotency and origin enforcement

## 8.1 Idempotency

Maintain a bounded map keyed by:

```text
runId + requestId
```

The first validated request owns one adapter invocation.

For a duplicate request:

- If the original is in flight, await and return the same promise/result.
- If it has completed, return the cached terminal result.
- Do not call the adapter again.
- Do not write a second upstream trace entry.
- Record a transport-level duplicate counter in metrics if useful.

Bound retention deterministically. The current run-budget retention strategy may be reused, but document the limit and eviction behavior.

## 8.2 Origin policy

For `POST /v1/decision` and any new trace endpoint:

```text
Origin absent       -> allow loopback CLI/test request
Origin exact match  -> allow browser request
Origin mismatch     -> 403, no body dispatch, no adapter call
```

Continue binding the server to `127.0.0.1` for this milestone.

## 8.3 Request body and content type

Preserve:

- JSON-only content type
- Strict body-size limit
- Exact schemas
- No arbitrary URL proxy
- No user-supplied system prompt
- No authorization-data logging

---

# 9. Model-client trace export and operator workflow

## 9.1 UI support

Add diagnostics controls that do not permit action or prompt manipulation:

```text
Export client trace
Export run handoff manifest
```

The client trace must remain in memory for the current run and reset only when a new run begins.

The handoff manifest should contain:

```text
runId
conditionId
scenarioId
expectedProviderId
expectedPromptVersion
clientTraceFileName
```

## 9.2 Formal run directory helper

Add a CLI helper that creates or validates the run directory without copying secrets:

```text
npm run model:prepare-run -- --run-id <runId> --ledger <path> --client-trace <path>
```

It may copy the operator-exported ledger and client trace into the existing gateway run directory. It must reject run-ID or scenario mismatches.

## 9.3 Finalizer

Replace or extend `model:summarize` so one command performs full validation and finalization:

```text
npm run model:finalize -- --run-id <runId>
```

It must:

1. Load strict-schema-validated ledger, client trace, gateway trace, and initial manifest.
2. Confirm run, experiment, condition, scenario, provider, and prompt consistency.
3. Join every client request to zero or one gateway result and exactly one eventual engine resolution.
4. Explain any unresolved entry and fail a completed-run bundle when unexplained.
5. Produce finalized `model-trace.jsonl`.
6. Produce finalized `run-manifest.json`.
7. Produce `model-summary.json`.
8. Produce `bundle-manifest.json`.
9. Exit nonzero on any inconsistency.

Keep `model:summarize` as an alias or document its replacement clearly.

---

# 10. Metrics requirements

The finalized summary must distinguish these concepts rather than deriving all of them from gateway trace length:

## 10.1 Client and engine demand

- External requests emitted by the engine
- Requests queued by the client
- Requests rejected by client queue limit
- Requests not dispatched because gateway unavailable
- Requests dispatched to gateway

## 10.2 Upstream activity

- Upstream calls attempted
- Calls completed
- Calls failed by category
- Idempotent duplicate HTTP submissions
- Maximum concurrent upstream calls
- Input, output, and total tokens
- Latency minimum, median, p95, and maximum

## 10.3 Engine lifecycle

- Accepted model responses
- Provider mismatches
- Duplicate responses
- Expired responses
- Superseded requests
- Unoffered selections
- Stale dependencies
- Constraint violations
- Actions no longer valid
- Busy/noninterruptible rejections
- External-failure expiries
- Provisional fallbacks
- Ordinary fallbacks

## 10.4 Behavior

- Final purifier outcome
- Meal outcome
- Promise outcome
- Treatment outcome
- Ownership violations
- Relationship changes
- Mara action count and duration by category
- Mara break requests
- Mara work persistence
- B1/B2 differences

## 10.5 Rates

- Upstream calls per Mara decision opportunity
- Upstream calls per simulated model-backed NPC-hour
- Accepted model responses per upstream call
- Stale/rejected responses per upstream call

Do not count client-only gateway-unavailable failures as upstream calls.

---

# 11. B1/B2 controlled-ablation verification

Add a preflight test proving that the first equivalent model decision opportunity in B1 and B2 differs only in the intended Mara criticism memory after normalizing fields that necessarily identify the scenario or request.

The test must:

1. Create B1 and B2 model-condition runs.
2. Advance each to its first external Mara request.
3. Compare the structured contexts.
4. Prove the only semantic difference is the presence or absence of the pre-registered criticism memory.
5. Prove provider, prompt, identity, traits, values, needs, task state, affordances, and hard boundaries are otherwise equivalent.

If another difference exists because of scenario data, document it and either remove it from the model context or increment the experiment version. Do not silently call a non-equivalent comparison an ablation.

The live B1/B2 pair must use:

- The same requested model configuration
- The same returned model family identifier where practical
- The same prompt version
- The same gateway limits
- Fresh run IDs
- No prompt edits between runs

---

# 12. Documentation remediation

Update the repository documentation as part of the same change.

## 12.1 README

- Update the implementation release from 1.1.0/1.3.0 wording to the actual new package version.
- Keep the frozen Vertical Slice experiment version distinct from the implementation release.
- Document client trace export and model-run finalization.
- State clearly that raw run artifacts are git-ignored.
- State clearly that the live milestone is not complete until a live acceptance report exists.

## 12.2 Implementation report

Update:

```text
documentation/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md
```

It must contain:

- Exact final commit SHA
- New package version
- New trace and manifest schema versions
- Exact remediation files
- Every deviation from this brief
- Exact tests and commands actually run
- Fake-gateway results
- Live result only if actually executed
- Known limitations

Do not retain claims that the prior trace/manifest contract was complete.

## 12.3 Authoritative brief

Ensure the implementation brief itself is present on `main` and clearly linked from the README and completion report. Close or reconcile stale documentation-only pull requests so readers do not have to infer which specification is authoritative.

## 12.4 Live acceptance report

Prepare a template:

```text
documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md
```

Do not mark it passed until the live sequence is actually executed.

The completed report must record:

- Date and operator
- Repository commit
- Package version
- Run IDs
- Scenario IDs
- Requested and returned model identifiers
- Prompt version
- Gateway settings
- Final hashes
- Token and latency summaries
- Engine acceptance/rejection summaries
- Replay result
- Only-Mara call verification
- Gateway-failure result
- Artifact bundle hashes
- Any anomalies

Never commit an API key or raw environment file.

---

# 13. Required automated tests

No test may require a live API key.

## 13.1 Trace and manifest schemas

Add strict-schema tests proving:

- A complete client trace entry parses.
- A complete gateway trace entry parses.
- A finalized model trace entry parses.
- A completed manifest requires scenario version, seed, completion time, hashes, and totals.
- Missing, extra, mistyped, fractional, oversized, and unknown fields fail.
- Request payload and context hash agree.
- A bundle with an absent client trace cannot be finalized as a formal completed run.

## 13.2 Trace coverage

Prove:

- Every engine external request creates exactly one client-trace entry.
- Gateway-unavailable requests still appear in client trace.
- Queue-overflow and client-timeout outcomes still appear in client trace.
- Every adapter invocation creates exactly one gateway-trace entry.
- Every finalized row joins client, gateway when applicable, and engine lifecycle.
- `logicalSubmittedTick` comes from the canonical ledger.
- Response and failure IDs are explicit, not reconstructed by naming convention.

## 13.3 Configuration pinning

Prove the browser refuses a provider-config response with:

- Wrong provider ID
- Wrong prompt version
- Wrong experiment ID
- Wrong experiment version
- Wrong condition ID
- Wrong request-schema version

Prove each mismatch becomes `invalid-gateway-response`, not `gateway-unavailable`.

## 13.4 Condition-specific request schema

Prove the exact model-condition schema rejects:

- Jonas
- Rin
- Scenario F
- Wrong provider
- Wrong prompt
- Wrong condition
- Wrong experiment
- Context-hash mismatch
- Offered-ID/descriptor mismatch

## 13.5 Gateway result reconciliation

Prove a schema-valid gateway result is rejected by the browser when it changes:

- Request ID
- NPC ID
- Scenario ID
- Provider ID
- Selected affordance to an unoffered ID

The original request must receive an `invalid-gateway-response` failure.

## 13.6 Gateway idempotency

Prove two simultaneous or sequential POSTs with the same `(runId, requestId)`:

- Cause one adapter invocation
- Return the same terminal result
- Produce one gateway upstream trace entry
- Do not consume two units of the upstream-call budget

## 13.7 Origin enforcement

Prove:

- Exact configured origin succeeds.
- Wrong present origin returns 403 before adapter invocation.
- Missing origin remains permitted for loopback CLI tests.

## 13.8 Bundle finalization

Generate a full fixture bundle in a temporary directory and prove:

- All strict schemas pass.
- Every request joins.
- Both hashes match.
- Aggregate and per-file bundle hashes are stable.
- Modifying any raw trace, ledger, manifest, or finalized trace changes the relevant bundle hash.
- Run/scenario/prompt/provider mismatches fail finalization.

## 13.9 B1/B2 ablation

Add the exact first-context equivalence test described in section 11.

## 13.10 Existing regression gates

Retain and rerun:

```text
npm run typecheck
npm run typecheck:gateway
npm run lint
npm run validate
npm run test:run
npm run test:gateway
npm run build
npm run build:gateway
npm run check:dist
npm run test:e2e:install
npm run test:e2e
npm run batch
```

All fourteen deterministic golden hashes and complete default streams must remain unchanged.

Add a fake-bundle CI gate such as:

```text
npm run test:model:bundle
```

This must create, finalize, validate, and delete a temporary fixture bundle without a live provider.

---

# 14. Recommended file changes

Exact organization may vary, but responsibilities must remain explicit.

Likely additions or modifications:

```text
src/shared/
  modelExperiment.ts
  modelArtifacts.ts

src/sim/decisions/
  externalSchemas.ts
  externalContext.ts

src/app/
  modelGatewayClient.ts
  modelClientTraceRecorder.ts
  workerClient.ts
  store.ts
  main.ts

src/ui/
  modelPanel.ts

src/worker/
  commandProcessor.ts

src/sim/runtime/
  engine.ts
  host.ts

src/sim/replay/
  validateLedger.ts

gateway/
  config.ts
  server.ts
  schemas.ts
  tracing/modelTraceWriter.ts
  metrics/runMetrics.ts

scripts/model/
  prepareRun.ts
  finalize.ts
  summarize.ts
  liveSmoke.ts

scripts/validate/
  run.ts

tests/unit/
  model-artifact-schemas.test.ts
  model-gateway-client.test.ts
  external-request-schema.test.ts
  model-ablation-context.test.ts

tests/gateway/
  gateway.test.ts
  gateway-idempotency.test.ts
  summarize-and-scan.test.ts

tests/integration/
  model-gateway-integration.test.ts
  model-bundle.test.ts

README.md
documentation/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md
documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md
.github/workflows/ci.yml
package.json
```

The simulation core must still import no gateway, browser, DOM, network, wall-clock, or OpenAI SDK code.

---

# 15. Manual setup after remediation

## 15.1 Install and verify without a live key

```bash
npm ci
npm run typecheck
npm run typecheck:gateway
npm run lint
npm run validate
npm run test:run
npm run test:gateway
npm run build
npm run build:gateway
npm run check:dist
npm run test:e2e:install
npm run test:e2e
npm run batch
npm run test:model:bundle
```

## 15.2 Start the fake path

Terminal 1:

```bash
npm run gateway:dev:fake
```

Terminal 2:

```bash
npm run dev
```

Run Scenario A under `mara-model-per-decision-v1`, export the ledger and client trace, place them in the run directory, and finalize the bundle.

The formal fixture/fake bundle must pass before spending live API credits.

## 15.3 Configure the live path

```bash
cp .env.gateway.example .env.gateway
```

Set only in `.env.gateway` or the process environment:

```text
OPENAI_API_KEY
OPENAI_MODEL
```

Never use a `VITE_` prefix for a secret.

## 15.4 Live smoke

```bash
RUN_LIVE_MODEL_TESTS=1 npm run test:model:live
```

This must perform one real request and validate the gateway result. It does not by itself complete the milestone.

---

# 16. Required live acceptance sequence

Perform this only after all code and fake-bundle gates pass.

Use one fixed repository commit and do not change prompt, model configuration, limits, or code during the sequence.

## Run 1 — Scenario A deterministic baseline

- Condition: `deterministic-baseline-v1`
- Confirm zero gateway calls.
- Record final hashes.

## Run 2 — Scenario A live Mara model condition

- Condition: `mara-model-per-decision-v1`
- Speed: 1×
- Do not pause while waiting for the model.
- Do not select Mara's actions manually.
- Complete the scenario.
- Export ledger and client trace.
- Finalize and validate the run bundle.
- Replay the ledger and confirm both hashes match.
- Confirm only Mara generated external requests.

## Run 3 — Scenario B1 live model condition

- Same model configuration as B2.
- Same prompt version.
- Fresh run ID.
- Preserve failed or surprising results.

## Run 4 — Scenario B2 live model condition

- Identical configuration to B1.
- Fresh run ID.
- Finalize both bundles before comparing behavior.

## Run 5 — Scenario C live model condition

- Verify at least one socially or medically meaningful decision opportunity.
- Confirm stale responses, if any, are recorded rather than hidden.
- Complete and replay.

## Run 6 — Scenario A with gateway stopped mid-run

- Begin under the live model condition.
- Stop the gateway after at least one accepted model response.
- Confirm explicit failures are recorded.
- Confirm logical time continues.
- Confirm the scenario reaches a valid terminal state.
- Export and finalize the client/ledger bundle even though the gateway trace is partial.

Do not discard failed live runs.

---

# 17. Live acceptance criteria

The live milestone passes only when:

## Causal integrity

- Every accepted live choice was offered by the engine.
- Every accepted live choice passed provider binding, freshness, constraints, and action validation.
- No model or gateway payload directly changed world state.

## Operational continuity

- Gateway absence, timeout, refusal, malformed output, and stale response paths do not freeze logical time.
- The gateway-stop run reaches terminal state.

## Provider isolation

- Every external request names Mara.
- Jonas and Rin generate zero external requests.

## Replay

- Every completed live ledger imports.
- Every completed live ledger replays to the same `worldStateHash` and `canonicalLedgerHash`.

## Measurement

- Every engine external request has one client trace row.
- Every upstream model call has one gateway trace row.
- Every finalized row joins to one engine lifecycle outcome.
- Completed manifests contain hashes, totals, scenario metadata, model evidence, and completion time.
- Bundle validation passes.

## Baseline preservation

- The complete deterministic batch still passes.
- All fourteen golden hashes remain unchanged.

## Documentation

- The live acceptance report contains actual evidence and does not describe mock results as live results.

---

# 18. Change control

## Experiment and prompt versions

Keep:

```text
experimentId      model-backed-npc-001
experimentVersion 1.0.0
promptVersion     mara-action-selection-1.0.0
```

provided that no prompt text, model-facing context semantics, action vocabulary, or experimental condition changes.

If any model-facing semantic content changes, increment the appropriate experiment or prompt version before collecting live data.

## Implementation version

Increment the package implementation version from `1.3.0` and document it. Do not conflate the package version with the frozen Vertical Slice or model-experiment version.

## Trace schemas

Increment trace and manifest schema versions for the new artifact formats. Do not silently reinterpret old raw traces as complete finalized traces.

---

# 19. Definition of done for the coding agent

The remediation implementation is code-complete only when:

- The formal artifact architecture is implemented.
- Exact client, gateway, finalized-trace, manifest, and bundle schemas exist.
- Every external engine request is captured even when the gateway is unavailable.
- Exact request payloads are preserved in the formal bundle.
- Completed manifests contain scenario metadata, final hashes, totals, and completion time.
- Gateway configuration is pinned to the pre-registered contract at the browser handshake.
- Gateway results are relationally checked against the dispatched request.
- Gateway duplicate POSTs cannot cause duplicate upstream model calls.
- Origin mismatch is rejected.
- The B1/B2 first-context ablation test passes.
- A complete fake fixture bundle finalizes and validates in CI.
- Existing deterministic streams and hashes are unchanged.
- README and implementation documentation are reconciled.
- A live acceptance report template exists and is explicitly marked pending unless actual live runs were completed.

The **milestone** is complete only when the live acceptance sequence also passes.

---

# 20. Stop condition

Do not begin any of the following yet:

- Policy-patch compilation
- Reflection
- Model-generated memory
- Dialogue
- Player chat
- A second model-backed NPC
- Multi-agent model scenes
- Vector retrieval
- Hosted deployment

Those steps remain blocked until:

1. One real live Mara scenario completes.
2. Its ledger replays exactly.
3. Its formal bundle is self-contained and validates.
4. Gateway failure preserves a valid run.
5. Only Mara generated external calls.
6. Frozen deterministic hashes remain unchanged.
7. B1/B2 live runs are collected under identical model and prompt configuration.

The next architectural experiment remains the pre-registered comparison between per-decision model control and reusable model-compiled policy patches. That comparison is meaningful only after this per-decision live baseline is measured through complete, trustworthy artifacts.
