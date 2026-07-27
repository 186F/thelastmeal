# Model Integration Milestone 001 — Artifact Integrity, CI Verification, and Keyless Rehearsal Brief

**Document status:** implementation instructions for the coding agent  
**Repository:** `186F/thelastmeal`  
**Base branch:** `main`  
**Base repository head at authoring:** `5c1f75565c99c46d4c71b1a89c50e925cbe2322b`  
**Substantive implementation under review:** `914b641a9e42c8bb73173f69faa3b9b5a5931312`  
**Current package version:** `1.4.0`  
**Target package version:** `1.5.0`  
**Frozen vertical-slice experiment:** `vs001-1.0.0` — unchanged  
**Model experiment:** `model-backed-npc-001` version `1.0.0` — unchanged  
**Prompt:** `mara-action-selection-1.0.0` — unchanged  
**External provider:** `openai-mara-action-v1` — unchanged  
**Target NPC:** Mara only

This brief covers only the first three next steps from the latest re-audit:

1. Complete one final artifact-integrity remediation.
2. Produce independently visible GitHub CI evidence for the exact implementation commit.
3. Execute a complete keyless formal-bundle rehearsal, including a gateway-stop run.

Do **not** perform live OpenAI calls as part of this work. Do **not** begin policy-patch compilation, reflection, dialogue, player chat, model-generated memory, or a second model-backed NPC.

---

# 1. Executive directive

The 1.4.0 implementation is approved as a deterministic model-control architecture. The model remains constrained to selecting an engine-offered affordance, and the simulation remains authoritative over state, legality, constraints, consequences, events, and replay.

The remaining problem is narrower but important:

> The formal research bundle can still lose the exact model-facing request for an engine request that fails before reaching the gateway, and the current preparation/finalization path does not invoke the simulation's complete ledger validator.

The coding agent must make the evidence layer strict enough that a bundle marked `completed` proves all of the following:

- Every external engine request is represented.
- The exact bounded request and context are preserved for every external engine request, whether or not it reached the gateway.
- Every context hash recomputes.
- Every dispatched request is reconciled with gateway evidence.
- Every external request reaches one canonical engine resolution.
- The canonical ledger itself passes the full import/replay/hash/invariant validator.
- Missing evidence cannot be mislabeled as a formally completed run.
- The actual client-observed completion time is distinguishable from export and finalization times.

Once those properties are implemented, the repository must prove them through a named GitHub Actions gate and a keyless end-to-end rehearsal using the real client, gateway, engine, ledger, and finalizer paths with the fake adapter.

---

# 2. Preserve these invariants

The following are frozen and must not change in this implementation.

## 2.1 Canonical simulation authority

The simulation alone controls:

- Canonical world state
- Logical time
- Affordance generation
- Resource ownership and reservations
- Physical and logical action validity
- Provider-independent survival and identity constraints
- Commitments and social consequences
- Action execution
- Event emission
- Replay
- `worldStateHash`
- `canonicalLedgerHash`

No browser, gateway, model adapter, trace writer, finalizer, or artifact script may mutate canonical state.

## 2.2 Frozen experiment data

Do not change:

- Scenario definitions
- Seeds
- NPC identities
- Need rates
- Task rates
- Injury rules
- Action vocabulary
- Deterministic-provider weights
- Memory-appraisal weights
- Constraint semantics
- Event consequences
- Existing default event streams
- Any of the fourteen pinned deterministic hashes

## 2.3 Model experiment contract

Keep exactly:

```text
experimentId       model-backed-npc-001
experimentVersion  1.0.0
conditionId         mara-model-per-decision-v1
targetNpcId         mara
providerId          openai-mara-action-v1
promptVersion       mara-action-selection-1.0.0
```

No prompt text or model-facing context semantics should change in this remediation. If implementation work reveals that such a change is unavoidable, stop and increment the appropriate experiment or prompt version before collecting any evidence.

## 2.4 Provider isolation

- Mara remains the only model-backed NPC.
- Jonas and Rin remain deterministic.
- Scenario F remains outside the model condition.
- The browser may choose only a registered condition.
- The gateway may not accept an arbitrary provider, prompt, system instruction, model-facing tool, or action.

## 2.5 Failure behavior

- No automatic model retries.
- One engine request causes at most one upstream adapter invocation.
- Gateway absence or model failure never pauses logical time.
- Known external failures still resolve through the typed failure lifecycle.
- Provisional or deterministic fallback continues to keep the NPC active.

---

# 3. Scope and non-goals

## In scope

- Exact client-side preservation of every external request
- Reconciliation between client request evidence and gateway request sidecars
- A self-contained finalized trace
- Full ledger validation inside preparation and finalization
- Strict versus degraded finalization semantics
- Separate completion, export, and finalization timestamps
- Complete gateway settings in the final manifest
- Dedicated, visible CI gates
- A keyless normal-run rehearsal
- A keyless gateway-stop rehearsal
- Documentation, package versioning, and implementation reporting

## Out of scope

- Live OpenAI calls
- Prompt tuning
- Model-choice quality analysis
- Policy patches
- Reflection
- Dialogue generation
- Model-written memory
- Vector retrieval
- Additional model-backed NPCs
- Hosted deployment
- Changes to the canonical event or ledger format
- Changes to the worker protocol unless an unavoidable defect is proven

---

# 4. Workstream 1 — Final artifact-integrity remediation

## 4.1 Root defect

The current client trace is intentionally slim. It records identity, timing, transport outcome, and `contextHash`, while the gateway stores the exact validated envelope as:

```text
requests/<requestId>.json
```

That is sufficient only when the request reaches the gateway.

Requests that fail before gateway dispatch can currently lack an exact preserved model-facing payload. Examples include:

- Gateway unreachable during configuration discovery
- A latched gateway-contract mismatch
- Client queue overflow
- Client-side per-run budget exhaustion
- A client timeout before gateway acceptance
- Requests emitted after the gateway has been stopped

A hash without the underlying payload is not independently auditable. The formal bundle must preserve the exact request for these cases too.

## 4.2 Required client request archive

Extend the browser-side model-run recorder so that it preserves the complete, exact prospective gateway envelope for every exact-valid external request **before** any queue, budget, connection, or contract decision.

The preserved object must include:

```text
schemaVersion
experimentId
experimentVersion
conditionId
runId
providerId
promptVersion
contextHash
request
context
truncationCounts
```

Use the same pinned constants and exact shared schema used for a real gateway dispatch.

The archive must be populated at the start of `handleDecisionRequest`, after structural validation of the worker payload and the Mara/provider filter, but before:

- Contract-mismatch fast failure
- Client budget checks
- Queue-cap checks
- Configuration discovery
- HTTP dispatch

The archive is evidence, not authority. It must never affect simulation state, provider selection, action selection, or hashes.

## 4.3 Recommended client-bundle version 2

Increment the run-bundle schema from version 1 to version 2.

A recommended shape is:

```text
RunBundleV2
  bundleSchemaVersion = 2
  handoff
    runId
    conditionId
    scenarioId
    providerId
    promptVersion
    experimentId
    experimentVersion
    worldStateHash
    canonicalLedgerHash
    callsAttempted
    gatewayResponses
    acceptedModelResponses
    failuresByCode
    completedAtUtc
    exportedAtUtc
  clientTrace
  exactRequestEnvelopes
```

`exactRequestEnvelopes` should be a stable array sorted by `request.requestId`.

Each entry must parse against the exact external-envelope schema. Add a schema-level refinement proving:

- Request IDs are unique.
- Every envelope `runId` equals `handoff.runId`.
- Every envelope condition, experiment, provider, and prompt equals the pinned contract.
- Every envelope NPC is Mara.
- Every envelope scenario is supported by the model condition.
- `externalContextHash(envelope.context) === envelope.contextHash`.
- The descriptor IDs agree exactly with `offeredAffordanceIds`.

Every current-run client trace entry must have one matching exact envelope. An exact envelope may exist before a terminal client trace outcome is known, but run-bundle export remains prohibited until the gateway client is idle and every current-run request has a terminal client outcome.

## 4.4 Request-archive duplicate behavior

The worker should not normally emit the same request twice, but the recorder must fail safely.

For a repeated `requestId`:

- If the complete prospective envelope is canonically identical, retain one copy.
- If any field differs, raise an explicit client contract error, record it in diagnostics, and do not export a formal bundle as completed.

Do not silently replace an earlier envelope.

## 4.5 Reconcile client envelopes with gateway sidecars

During finalization, build a complete request index from:

1. The canonical ledger's external-provider `DecisionRequested` events.
2. `client-bundle.json` exact request envelopes.
3. Gateway `requests/<requestId>.json` sidecars.
4. Raw gateway trace rows.
5. Client trace rows.

For each external engine request:

- A client exact envelope is required in strict mode.
- If a gateway sidecar exists, it must be canonically identical to the client envelope.
- Both context hashes must recompute.
- Request, NPC, scenario, provider, offered IDs, and requested logical tick must agree with the ledger.
- A request that never reached the gateway may legitimately have no gateway sidecar and no gateway trace row.
- A request that the client reports as dispatched must have gateway evidence unless the bundle is explicitly degraded.
- No gateway sidecar, gateway row, or client row may be orphaned from the run's external request set.

Do not treat matching hashes alone as sufficient when both full payloads are present. Require canonical deep equality.

## 4.6 Finalized trace version 2

Increment the finalized trace schema from version 1 to version 2.

Each finalized row must be independently understandable and include the complete reconciled model-facing envelope:

```text
FinalizedTraceEntryV2
  finalizedTraceSchemaVersion = 2
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
  exactRequestEnvelope
  exactRequestSources
  contextHash
  truncationCounts
  responseId
  failureId
  selectedAffordanceId
  reasonCode
  confidenceBp
  rationale
  tokens
  clientLatencyMs
  gatewayLatencyMs
  clientOutcome
  gatewayOutcome
  engineOutcome
  engineRejectionReason
  engineResolutionEventId
```

`exactRequestSources` should be a stable array containing one or both of:

```text
client
gateway
```

When both sources exist, the finalizer must have proven exact equality before writing the row.

Embedding the envelope in the finalized row is intentionally redundant. It makes `finalized-trace.jsonl` self-contained while raw client and gateway artifacts remain preserved and independently hash-bound.

## 4.7 Every request must have an engine resolution

For a strict completed bundle, each external engine request must resolve to exactly one of:

```text
accepted
rejected
expired
```

The finalizer must reject:

- Multiple terminal engine outcomes for one request
- An accepted or rejected response without a matching received response
- A provider failure without the corresponding terminal expiry
- A trace response that never entered the engine and has no client-side stale-run explanation
- A client terminal failure that never produced the expected engine failure/expiry lifecycle
- A request still unresolved at the terminal ledger state

`logicalSubmittedTick` must continue to come from the canonical ledger:

- `DecisionResponseReceived.tick` for responses
- `DecisionProviderFailed.tick` for explicit failures

Do not infer logical submission time from wall-clock timestamps or the latest rendered snapshot.

---

# 5. Full ledger validation in preparation and finalization

## 5.1 Do not rely on schema parsing alone

Both `model:prepare-run` and `model:finalize` must call the complete ledger validator:

```text
validateLedgerFile(rawLedgerText)
```

They must not treat `ledgerFileSchema.parse(...)` as sufficient evidence.

The full validator already proves:

- Exact event payload schemas
- Event ordering and IDs
- Causation and correlation integrity
- Decision lifecycle integrity
- Action lifecycle integrity
- Provider authorization
- Offered-action membership
- Isolated reducer replay
- Structural invariants
- Recomputed `worldStateHash`
- Recomputed `canonicalLedgerHash`
- Rebuilt final summary

## 5.2 Preparation behavior

`model:prepare-run` must:

1. Read the raw ledger text.
2. Run `validateLedgerFile`.
3. Require `ok === true` and a non-null validated file.
4. Permit warnings but reject every validation error.
5. Perform bundle/handoff checks only against the validated file.
6. Complete all validation before writing or copying anything.
7. Leave the destination untouched after any failure.

## 5.3 Finalization behavior

`model:finalize` must independently rerun `validateLedgerFile` on the staged ledger.

Do not assume that preparation was used or that the file remained unchanged after preparation.

No derived output may be written until:

- The full ledger validation passes.
- Every input artifact parses.
- All cross-artifact contradictions have been checked.
- Strict completeness has been determined.

Use temporary files or a temporary output directory, then atomically replace derived outputs only after final validation succeeds. A failed finalization must not leave a partially updated `finalized-trace.jsonl`, final manifest, summary, or bundle manifest.

## 5.4 Required corruption tests

Add tests using ledgers that are valid JSON and pass the top-level ledger schema but fail semantic validation.

At minimum, prove both preparation and finalization reject:

- A corrupted `RepairProgressed` payload
- A dangling or incorrect `causationId`
- An accepted response selecting an affordance not offered by its request
- A mismatched provider in an accepted lifecycle
- A final summary inconsistent with replayed state
- A ledger whose reducer replay aborts
- A ledger with top-level hashes edited to match one another but not the event stream

A rejection must occur before any destination mutation.

---

# 6. Strict versus degraded finalization

## 6.1 Current ambiguity

The current finalizer can produce `status: completed` while recording incomplete evidence through completeness notes. That conflates two different uses:

- A formal completed research bundle
- A recoverable but incomplete archival bundle

Separate them explicitly.

## 6.2 Final manifest version 2

Increment the final manifest schema from version 1 to version 2.

Use:

```text
status = completed | degraded
```

Include:

```text
manifestFinalSchemaVersion = 2
status
experimentId
experimentVersion
conditionId
runId
scenarioId
scenarioVersion
seed
configVersion
providerPlanId
externalProviderId
promptVersion
requestedModelId
returnedModelIds
modelSettings
startedAtUtc
completedAtUtc
exportedAtUtc
finalizedAtUtc
worldStateHash
canonicalLedgerHash
externalRequestsEmitted
requestsSeenByClient
requestsDispatchedToGateway
upstreamCallsAttempted
callsCompleted
callsFailedByCategory
acceptedModelResponses
engineRejectionsByReason
inputTokens
outputTokens
totalTokens
completeness
```

`modelSettings` must include all limits capable of affecting the run, including:

- Adapter ID
- Requested model
- Request timeout
- Maximum output tokens
- Per-run call limit
- Maximum concurrency
- Process-wide `maxTotalCalls`

## 6.3 Default strict mode

The default command:

```bash
npm run model:finalize -- --run-id <runId>
```

must be strict.

It may write `status: completed` only when all of the following are true:

- Full ledger validation passes.
- Client bundle is present.
- The client bundle handoff matches the ledger and run.
- Every external engine request has exactly one client trace entry.
- Every external engine request has one complete client exact envelope.
- Every exact envelope context hash recomputes.
- Every dispatched request has exactly one effective gateway terminal result.
- Gateway sidecars agree exactly with client envelopes when both exist.
- Every adapter invocation has exactly one raw gateway trace row.
- Every external request has exactly one engine resolution.
- There are no unexplained rows or orphan artifacts.
- All provider, condition, prompt, experiment, scenario, and hash fields agree.
- The run has distinct completion, export, and finalization timestamps.
- The final bundle manifest covers every file except itself.

If any condition is missing, strict finalization exits nonzero and writes no new derived outputs.

## 6.4 Explicit degraded mode

Provide an explicit recovery command:

```bash
npm run model:finalize -- --run-id <runId> --allow-degraded
```

This mode may preserve a recoverable run when evidence is absent but non-contradictory.

It must:

- Write `status: degraded`.
- Record every missing source and failed completeness criterion.
- Never describe the bundle as formally complete.
- Keep contradictions fatal.
- Produce a bundle manifest with a producer/status discriminator.
- Exit successfully only because the operator explicitly opted into degraded archival output.

Analytical tooling and the live acceptance report must reject `status: degraded` as evidence of milestone completion.

## 6.5 Gateway-stop runs can still be completed

The required gateway-stop rehearsal and later live gateway-stop run should still qualify as `completed` when evidence is complete.

After the gateway stops:

- Later requests still exist in the client exact-envelope archive.
- Their client transport outcome is explicit.
- The typed failure enters the engine.
- The engine records its terminal failure/expiry lifecycle.
- No gateway row is expected for a request that never reached the gateway.

This is complete evidence, not degraded evidence.

---

# 7. Completion, export, and finalization timestamps

## 7.1 Record client-observed completion

When the browser receives the worker's `run-complete` response, record:

```text
completedAtUtc
```

Semantics:

> Wall-clock timestamp at which the browser received authoritative notice that the logical run reached terminal state.

This is noncanonical and must not affect simulation state or hashes.

Clear it on a new run or reset.

## 7.2 Preserve separate timestamps

Keep these distinct:

```text
startedAtUtc    gateway manifest seed time
completedAtUtc  browser observed run-complete time
exportedAtUtc   client bundle export time
finalizedAtUtc  finalizer completion time
```

Do not substitute one for another.

## 7.3 Export gating

The _Export run bundle_ control must remain disabled unless:

- The run is terminal.
- The selected condition is the model condition.
- `completedAtUtc` is present.
- The gateway client is idle.
- The client request archive and client trace cover the same current-run request set.
- Every current-run trace entry is terminal.

The export path must first settle the gateway client, then snapshot the trace/archive atomically.

---

# 8. Artifact schema and version policy

Use these implementation-version changes unless a stronger reason is documented:

```text
package version                 1.4.0 -> 1.5.0
raw gateway trace schema        2     -> 2 (unchanged unless its shape changes)
client trace entry schema       1     -> 1 (unchanged if entry shape is unchanged)
run bundle schema               1     -> 2
finalized trace schema          1     -> 2
final manifest schema           1     -> 2
bundle manifest schema          1     -> 2 if status/proof fields are added
canonical event schema          unchanged
ledger format                   unchanged
worker protocol                 unchanged unless proven necessary
model experiment version        unchanged
prompt version                  unchanged
```

Do not silently parse a version-1 run bundle as version 2. Either reject it with an explicit migration message or support an explicit non-formal legacy import path that can produce only degraded output.

---

# 9. Workstream 2 — Independently visible CI evidence

## 9.1 Use a pull request, not a direct push

Implement this brief on a new branch from current `main`.

Recommended branch:

```text
agent/model-artifact-integrity-1.5.0
```

Open a draft pull request. Do not merge it until all required checks are visible and green on the PR head.

The final implementation report must record:

- Base commit SHA
- Final implementation commit SHA
- Merge commit SHA after merge
- Package version
- Exact workflow run URL or run ID for the PR head
- Exact workflow run URL or run ID for the merged `main` SHA

## 9.2 Update the workflow trigger

Add manual dispatch to `.github/workflows/ci.yml`:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

Preserve all current required checks.

## 9.3 Add a named formal-bundle test script

Add an explicit npm script:

```text
test:model:bundle
```

It should run the targeted artifact-integrity suites, including at minimum:

- Run-bundle schema and producer tests
- Exact client request archive tests
- Full bundle finalization tests
- Strict/degraded status tests
- Semantic ledger-corruption tests
- Result/request reconciliation tests
- B1/B2 request-time ablation tests

It may overlap with `test:run`. The purpose is not unique coverage; it is an independently visible, named gate for the most important research-artifact contract.

## 9.4 Add a named keyless rehearsal step

Add a CI step:

```text
Keyless formal model-run rehearsal
```

Run the rehearsal command defined in Workstream 3. It must use only the fake adapter and localhost.

The step must fail if either rehearsal bundle is not strict-complete.

## 9.5 Required CI sequence

The PR workflow must visibly run:

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
npm run model:rehearse -- --ci
npm run batch
```

No step may require an API key or make a non-local network call.

## 9.6 Upload CI artifacts

Always upload the keyless rehearsal report and final bundle manifests, even on failure.

Recommended artifact paths:

```text
artifacts/model-rehearsal/report.json
artifacts/model-rehearsal/report.md
artifacts/model-rehearsal/**/run-manifest.final.json
artifacts/model-rehearsal/**/bundle-manifest.json
artifacts/model-rehearsal/**/model-summary.json
```

Do not upload secrets, `.env.gateway`, or authorization material.

## 9.7 Exact-merge verification

After merging:

1. Confirm the push-triggered workflow ran on the exact merged `main` SHA.
2. If needed, run `workflow_dispatch` against `main` without changing code.
3. Record the run URL/ID and exact SHA in the implementation report.
4. Do not call CI verified merely because local commands passed.

## 9.8 Manual repository setup

After the workflow is green, configure GitHub branch protection for `main` if it is not already enabled:

- Require a pull request before merging.
- Require the CI job `Required checks (clean checkout)` or its replacement.
- Require branches to be up to date before merging.
- Prevent direct pushes except for explicitly designated administrators when necessary.

This repository setting is a manual administrative step, not a source-code change. Document whether it was completed.

---

# 10. Workstream 3 — Keyless formal-bundle rehearsal

## 10.1 Add a rehearsal command

Add:

```text
model:rehearse
```

Recommended implementation file:

```text
scripts/model/rehearse.ts
```

The command must run two complete, keyless rehearsals through the actual infrastructure modules:

1. Normal fake-gateway Scenario A
2. Fake-gateway Scenario A with the gateway stopped after at least one accepted response

It must not use direct synthetic insertion as its primary path. Drive the same components used by the browser integration:

```text
WorkerSession / SimulationHost
        -> decision-request
ModelGatewayClient
        -> real localhost HTTP
Gateway server
        -> FakeDecisionAdapter
ModelGatewayClient
        -> response/failure command
WorkerSession / engine gate
```

Using the fake adapter is required. Reading `OPENAI_API_KEY`, loading the live adapter, or contacting a non-local host is forbidden.

## 10.2 Rehearsal output root

Default output:

```text
artifacts/model-rehearsal/
```

Recommended layout:

```text
artifacts/model-rehearsal/
  report.json
  report.md
  normal-<runId>/
    ...formal run bundle files...
  gateway-stop-<runId>/
    ...formal run bundle files...
```

Support an explicit output argument for tests and CI so temporary directories can be used safely.

## 10.3 Rehearsal A — Normal fake gateway

Run Scenario A under:

```text
mara-model-per-decision-v1
```

Requirements:

- Start a real local gateway instance with `FakeDecisionAdapter`.
- Drive logical time in whole ticks.
- Route every worker request through `ModelGatewayClient`.
- Await client settlement between appropriate tick advances without pausing canonical time on a provider promise.
- Reach terminal state.
- Verify only Mara produced external requests.
- Export the canonical ledger using the real ledger builder.
- Build the client bundle using the real `buildRunBundle` and real client recorder.
- Run the same preparation logic as `model:prepare-run`.
- Run strict `model:finalize`.
- Re-import and replay the ledger through the full validator/replay path.

Strict assertions:

```text
final manifest status = completed
completeness sources = gateway + ledger + client
completeness notes = []
full ledger validation = pass
replay world hash = match
replay ledger hash = match
external engine requests = client trace entries = exact client envelopes
all dispatched requests have one gateway row
all requests have one engine resolution
all exact context hashes recompute
only Mara has the external provider
bundle aggregate hash exists
```

## 10.4 Rehearsal B — Gateway stopped mid-run

Run Scenario A under the same model condition.

Procedure:

1. Start the fake gateway.
2. Drive the run until at least one gateway response is accepted by the engine.
3. Stop the gateway process deliberately.
4. Continue driving the simulation to terminal state.
5. Preserve every subsequent external request in the client exact-request archive.
6. Require explicit client failures and engine failure/expiry lifecycle events after the stop.
7. Export the ledger and client bundle.
8. Run preparation and strict finalization.
9. Replay the ledger.

Strict assertions:

```text
at least one accepted model-shaped response occurred before stop
at least one gateway-unavailable or equivalent typed failure occurred after stop
logical time reached the scenario end
final state is valid
final manifest status = completed, not degraded
client exact envelope exists for every post-stop request
no gateway row is required for a request that never reached the gateway
all post-stop requests still have an engine resolution
full ledger validation = pass
both replay hashes = match
only Mara produced external requests
no unexplained finalized rows
bundle aggregate hash exists
```

The gateway-stop run is the decisive proof that the artifact layer remains complete when the gateway cannot preserve request sidecars.

## 10.5 Rehearsal report

Write both JSON and Markdown reports.

At minimum, record per run:

```text
runId
scenarioId
conditionId
providerId
promptVersion
fake adapter ID
startedAtUtc
completedAtUtc
exportedAtUtc
finalizedAtUtc
external requests emitted
client trace rows
client exact envelopes
requests dispatched
upstream calls attempted
accepted responses
engine rejections by reason
external failures by code
worldStateHash
canonicalLedgerHash
replay match
final manifest status
completeness sources
completeness notes
bundle aggregate SHA-256
only-Mara verification
```

The top-level report should contain:

```text
ok
packageVersion
repositoryCommit when available
normalRun
 gatewayStopRun
failures
```

Exit nonzero on any failed assertion.

## 10.6 CI mode

Support:

```bash
npm run model:rehearse -- --ci
```

CI mode must:

- Use stable, collision-safe run IDs.
- Use an isolated output directory.
- Start gateways on ephemeral ports.
- Close every server in `finally` blocks.
- Leave no timers or processes running.
- Never read a live API key.
- Never contact an external network host.
- Produce uploadable reports even when one assertion fails where practicable.

---

# 11. Required automated tests

## 11.1 Client exact-request archive

Prove:

- A normal request is archived before dispatch.
- A gateway-unavailable request is archived.
- A contract-mismatch request is archived.
- A client-budget request is archived.
- A queue-overflow request is archived.
- A client timeout request is archived.
- Archive entries parse against the exact envelope schema.
- Context hashes recompute.
- Same-ID/same-envelope duplicates coalesce.
- Same-ID/different-envelope duplicates fail explicitly.
- `newRun()` resets the current-run archive.

## 11.2 Run bundle version 2

Prove:

- The actual producer emits a strict version-2 bundle.
- `completedAtUtc` and `exportedAtUtc` are both required and distinct fields.
- Every trace request has a matching exact envelope.
- Missing exact envelopes fail schema/refinement validation.
- Foreign run IDs fail.
- Wrong provider, prompt, condition, or experiment fields fail.
- Context-hash mismatches fail.
- Extra, missing, fractional, mistyped, and unknown fields fail.

## 11.3 Client/gateway envelope reconciliation

Prove:

- Equal client and gateway envelopes pass.
- A changed memory fails.
- A changed affordance descriptor fails.
- A reordered or divergent offered-ID list fails.
- A changed run ID fails.
- A changed prompt/provider/condition fails.
- A gateway sidecar absent for a never-dispatched request is valid.
- A gateway sidecar absent for a client-recorded dispatched response fails strict finalization.

## 11.4 Full ledger validation

Prove both preparation and finalization reject every semantic corruption listed in section 5.4.

Confirm no destination or derived output is modified after failure.

## 11.5 Strict/degraded behavior

Prove:

- Complete evidence produces `status: completed` in default mode.
- Missing client bundle fails default mode.
- Missing exact request fails default mode.
- Missing gateway row for a dispatched request fails default mode.
- Missing gateway evidence for a never-dispatched client failure does not fail.
- `--allow-degraded` produces `status: degraded` with exact notes.
- Contradictions still fail under `--allow-degraded`.
- A degraded manifest cannot pass the formal completion validator.

## 11.6 Timestamp semantics

Prove:

- `completedAtUtc` is set only on `run-complete` receipt.
- Reset clears it.
- Export time is later than or equal to completion time in controlled tests.
- Finalization time is later than or equal to export time in controlled tests.
- Finalization does not rewrite completion time.

Use injected clocks in tests rather than wall-clock sleeps.

## 11.7 Gateway settings

Prove the seed/final manifest contains the process-wide call cap in addition to per-run and concurrency limits.

## 11.8 Rehearsal tests

Test the rehearsal harness itself with temporary output:

- Normal fake run strict-completes.
- Gateway-stop fake run strict-completes.
- Reports parse.
- Bundle manifests cover all files.
- Rehearsal exits nonzero after a deliberately induced evidence gap.
- All servers are closed after success and failure.

## 11.9 Existing gates

Rerun and preserve:

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
npm run test:e2e
npm run batch
```

All fourteen deterministic golden hashes and complete default streams must remain byte-identical.

---

# 12. Recommended file changes

Exact organization may vary, but responsibilities must remain explicit.

Likely changes:

```text
package.json
.github/workflows/ci.yml
README.md
.env.gateway.example

src/shared/modelArtifacts.ts
src/shared/modelExperiment.ts

src/app/modelClientTraceRecorder.ts
src/app/modelGatewayClient.ts
src/app/runBundle.ts
src/app/store.ts
src/app/workerClient.ts
src/ui/modelPanel.ts

scripts/model/prepareRun.ts
scripts/model/finalize.ts
scripts/model/rehearse.ts
scripts/model/summarize.ts

gateway/config.ts
gateway/server.ts
gateway/tracing/modelTraceWriter.ts

tests/unit/model-gateway-client.test.ts
tests/unit/run-bundle.test.ts
tests/unit/model-artifact-schemas.test.ts

tests/integration/model-bundle.test.ts
tests/integration/model-rehearsal.test.ts
tests/integration/model-ablation-context.test.ts

tests/gateway/gateway.test.ts
tests/gateway/gateway-idempotency.test.ts

documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md
documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md
```

Do not introduce gateway, DOM, worker, timer, wall-clock, network, or OpenAI imports into the pure simulation core.

---

# 13. Implementation order

Execute in this order.

1. Bump the package implementation version to `1.5.0` without changing experiment versions.
2. Define version-2 run-bundle, finalized-trace, and final-manifest schemas.
3. Add the client exact-request archive.
4. Record `completedAtUtc` on authoritative run-complete receipt.
5. Update run-bundle production and export gating.
6. Add exact client/gateway envelope reconciliation.
7. Integrate the full ledger validator into preparation.
8. Integrate the full ledger validator into finalization.
9. Implement strict default finalization and explicit degraded mode.
10. Add process-wide call-cap evidence to model settings.
11. Add all schema, corruption, strict/degraded, and timestamp tests.
12. Add `test:model:bundle`.
13. Implement the keyless rehearsal harness.
14. Add the named CI gates and `workflow_dispatch`.
15. Run the complete local gate suite.
16. Run the keyless rehearsal locally and inspect both formal bundles.
17. Update README and write the implementation report.
18. Open a draft PR and obtain visible green CI on the exact PR head.
19. Merge only after review and green checks.
20. Confirm a green push or manual-dispatch run on the exact merged `main` SHA.

Do not reorder the work so that CI or rehearsal scripts are written against incomplete artifact semantics.

---

# 14. Manual setup and verification

## 14.1 Clean install

```bash
npm ci
npm run test:e2e:install
```

## 14.2 Full local checks

```bash
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
npm run test:e2e
npm run batch
```

## 14.3 Keyless rehearsal

```bash
npm run model:rehearse
```

Inspect:

```text
artifacts/model-rehearsal/report.md
artifacts/model-rehearsal/report.json
```

Both runs must show:

```text
status = completed
ledger validation = passed
replay = matched
only Mara external = true
exact request coverage = 100%
```

## 14.4 Manual fake-browser smoke

Terminal 1:

```bash
npm run gateway:dev:fake
```

Terminal 2:

```bash
npm run dev
```

Then:

1. Select Scenario A.
2. Select `mara-model-per-decision-v1`.
3. Run to terminal state.
4. Confirm the export button remains disabled until the client is idle.
5. Export the ledger and version-2 run bundle.
6. Run `model:prepare-run`.
7. Run strict `model:finalize`.
8. Confirm `status: completed` and zero completeness notes.
9. Repeat with the gateway stopped after one accepted response.

No live model key is needed or permitted for these steps.

---

# 15. Documentation requirements

## 15.1 README

Update the README to state:

- Implementation release `1.5.0`
- Frozen experiment and prompt versions remain unchanged
- Version-2 run bundles preserve exact client requests
- Strict finalization is the default
- `--allow-degraded` is archival only
- `completedAtUtc`, `exportedAtUtc`, and `finalizedAtUtc` have distinct meanings
- `test:model:bundle` and `model:rehearse` commands
- GitHub CI is the authoritative merge gate
- The live milestone remains pending after this code work

## 15.2 Implementation report

Add:

```text
documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md
```

Record:

- Base SHA
- Final implementation SHA
- Merge SHA when available
- Package version
- Artifact schema versions
- Exact files changed
- Every deviation from this brief with rationale
- Test counts and commands actually run
- Normal rehearsal result
- Gateway-stop rehearsal result
- Both rehearsal bundle aggregate hashes
- All fourteen deterministic hashes
- PR workflow run URL/ID
- Merged-main workflow run URL/ID
- Any branch-protection setup completed
- Known limitations
- Explicit statement that no live OpenAI call was made

## 15.3 Live acceptance report

Keep:

```text
documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md
```

marked `PENDING`.

Do not fill live evidence fields with fake-rehearsal results. You may add a short prerequisite section noting that the 1.5.0 artifact and CI gates have passed, but the overall live verdict must remain pending.

---

# 16. Definition of done

The coding work is complete only when all conditions below are satisfied.

## Artifact integrity

- Every external engine request is preserved exactly in the client bundle.
- Requests that never reach the gateway retain their complete context.
- Gateway sidecars and client envelopes reconcile exactly.
- Every finalized trace row embeds the complete reconciled request envelope.
- Every context hash recomputes.
- Every external request has exactly one client outcome and one engine resolution.
- Strict finalization rejects missing request evidence.
- Degraded finalization is explicit and cannot masquerade as complete.

## Ledger integrity

- Preparation invokes the full ledger validator.
- Finalization independently invokes the full ledger validator.
- Schema-valid semantic corruption is rejected.
- Failed preparation/finalization leaves no partial output.

## Temporal evidence

- `completedAtUtc` is captured from run-complete receipt.
- Completion, export, and finalization timestamps remain distinct.
- All three are recorded in the final manifest.

## Rehearsal

- Normal fake-gateway Scenario A produces a strict completed bundle.
- Gateway-stop Scenario A produces a strict completed bundle.
- Both ledgers import and replay exactly.
- Both runs preserve every exact external request.
- Only Mara produces external traffic.
- Both aggregate bundle hashes are recorded.

## CI

- The implementation is delivered through a PR.
- `workflow_dispatch` exists.
- `test:model:bundle` is a named CI step.
- The keyless rehearsal is a named CI step.
- All existing checks remain.
- The exact PR head has a visible green run.
- The exact merged `main` SHA has a visible green run.
- The full 100-runs-per-scenario deterministic batch passes with all fourteen hashes unchanged.

## Documentation

- README reflects release 1.5.0 and the strict artifact workflow.
- The implementation report contains exact commit and CI evidence.
- The live acceptance report remains honestly pending.

---

# 17. Stop condition

After completing this brief, stop.

Do not begin:

- Policy-patch compilation
- Reflection
- Dialogue
- Player chat
- Model-generated memory
- A second model-backed NPC
- Multi-agent model scenes
- Vector retrieval
- Hosted deployment

The next step after this brief is the controlled live acceptance sequence already defined in the pending live acceptance report. That sequence must use one fixed, green repository SHA and must produce strict completed bundles.

Only after the live sequence passes should the project begin the comparison between per-decision model control and reusable model-compiled policy patches.
