# Remediation Re-Audit Report — The Last Meal 1.1.0

**Audit date:** July 26, 2026  
**Repository:** `186F/thelastmeal`  
**Audited branch:** `main`  
**Audited commit:** `6493efb4455c8ce72747176e075655ebccdc5f68`  
**Previous audited baseline:** `ece5947e7c46d356ceab4ff54a92a163e098b850`  
**Implementation label:** remediation release `1.1.0`  
**Experiment label:** Vertical Slice 001 — v1.0, unchanged

## Audit method and limits

This was a static source re-audit of the remediation changes and their tests. The audit examined the implementation of the asynchronous decision lifecycle, provider-independent constraints, ledger import validation, semantic hashing, deterministic-stream comparison, generic memory appraisal, individuality evaluation, and GitHub Actions workflows.

The repository reports successful clean-checkout execution of its required commands, including 224 Vitest tests, nine Playwright tests, a production build, and the full 100-runs-per-scenario deterministic batch. That evidence is author-reported in `documentation/AUDIT_REMEDIATION_REPORT.md`. No workflow run for the audited head commit was visible through the GitHub connector used for this review, so this report does not independently certify the latest CI execution.

## Executive verdict

The remediation is substantial and mostly successful. The repository is no longer the architecture rejected in the first audit.

- **Deterministic Vertical Slice 001:** **GO**
- **Research baseline for event sourcing, replay, constraints, hashing, memory, and individuality evaluation:** **GO after the remaining ledger-semantic checks are tightened**
- **External model controlling an NPC:** **NO-GO until provider identity is enforced at the authoritative response gate**

One high-severity blocker remains. Two medium-severity issues should be resolved before treating the system as a durable research platform. Three lower-severity gaps affect test completeness and observability rather than immediate world correctness.

---

# Findings

## 1. High — A response is not bound to the provider that received the request

### What is implemented correctly

The decision request and response contracts carry `providerId`. A replayable pending request also stores the provider that was asked.

Relevant files:

- `src/shared/decisionContracts.ts`
- `src/sim/domain/state.ts`
- `src/sim/runtime/engine.ts`

The authoritative response gate validates:

- Request identity
- NPC and scenario identity
- Duplicate response IDs
- Expiration
- Offered-affordance membership
- Hard dependency freshness
- Provider-independent constraints
- Current action validity
- Actor interruptibility and transit state

### Remaining defect

`processDecisionResponse` does **not** compare:

```text
response.providerId
```

with:

```text
pending.providerId
```

The gate therefore accepts a response from any provider label when the request ID, NPC, scenario, selected affordance, dependencies, constraints, and current action state are otherwise valid.

The current tests preserve this behavior. For example, a request created by `simulated-async-v1` can be answered by a response labeled `external-test-gateway` and still be accepted. Constraint tests similarly inject responses labeled `hostile-provider`; those responses are rejected only when their selected actions violate a hard constraint.

### Why this matters

This does not allow an impossible or constraint-forbidden action, but it breaks decision-source authority and attribution:

- A stale or misrouted gateway can answer a request intended for another provider.
- Per-provider experimental comparisons become unreliable.
- Provider cost, latency, and behavior cannot be attributed with confidence.
- The ledger can record that one provider was requested while another provider actually selected the action.
- A future multi-provider scheduler could allow one provider to take over another provider's pending request accidentally.

This is principally a routing and research-integrity defect. It is not cryptographic authentication by itself; a malicious trusted gateway could still lie about its identifier unless responses are signed or otherwise authenticated. Cryptographic provider authentication can remain outside this slice, but logical provider binding cannot.

### Required remediation

Add a structured rejection reason:

```text
provider-mismatch
```

Enforce the following inside the single authoritative response gate:

```text
For a normal response:
    response.providerId must equal pending.providerId

For an internal fallback response:
    usedFallback must be true
    response.providerId must equal run.fallback.id
```

Do not make the fallback satisfy `pending.providerId`, because the pending request names the primary provider by design. The fallback is a trusted engine-owned exception that must be explicit and narrowly scoped.

Clarify identifier semantics:

```text
providerId  = the decision authority authorized to answer the request
transportId = the gateway or process that delivered the response, when useful
```

A gateway acting on behalf of a provider should preserve the request's `providerId`. A separate `transportId` may be recorded as diagnostic transport metadata without affecting `worldStateHash`.

Consider including `providerId` in `DecisionResponseAccepted` and `DecisionResponseRejected`, or ensure import validation joins those events to the preceding `DecisionResponseReceived` event by `responseId` and verifies provider consistency.

### Required tests

Add engine-path tests proving:

1. A response with a valid request ID and offered action but the wrong `providerId` is rejected as `provider-mismatch`.
2. The rejected response creates no `ActionProposed` event.
3. The request remains pending after a provider mismatch and may still receive a valid response.
4. A response with the correct provider is accepted.
5. The internal fallback provider is accepted only through the explicit fallback path.
6. A normal external response spoofing `run.fallback.id` is not treated as an authorized fallback.
7. Import validation rejects a ledger whose received and accepted response records imply different providers.

**Release gate:** Do not connect an external model until this finding is closed.

---

## 2. Medium — Ledger import is payload-exact but not fully semantically cross-checked

### What is implemented correctly

The new import path is materially stronger than the original implementation. It now performs, before storing a file:

1. JSON parsing
2. Strict ledger-file schema validation
3. Exact per-event payload validation
4. Event ordering and reference checks
5. Isolated reducer replay into fresh state
6. Structural invariant checks
7. Recomputed `worldStateHash`
8. Recomputed `canonicalLedgerHash`
9. Field-by-field final-summary reconstruction

A malformed or inconsistent file no longer becomes a valid import and then fails only during a later replay request. Rejected imports do not mutate the live run or replace a previously valid imported ledger.

Relevant files:

- `src/sim/events/eventSchemas.ts`
- `src/sim/replay/validateLedger.ts`
- `src/sim/invariants.ts`
- `src/shared/ledgerFile.ts`
- `tests/unit/ledger-import.test.ts`

### Remaining semantic gaps

#### 2.1 File metadata is not reconciled with `ScenarioStarted`

The ledger file records:

- Scenario ID
- Scenario version
- Seed
- Configuration version
- Provider ID

`ScenarioStarted` independently records the same categories of information. The validator compares file metadata with local scenario definitions, but it does not require the first event's metadata to match the file metadata.

A completely rehashed but internally contradictory file could therefore claim one scenario or provider in its envelope and another in `ScenarioStarted`.

#### 2.2 Event envelopes are not comprehensively reconciled with payload identities

The exact schemas correctly validate the types and shapes of `actorId`, `targetId`, `causationId`, `correlationId`, and payload fields. Cross-event validation checks some envelope-to-payload relationships, especially events carrying `payload.npcId`, but does not cover all event families.

Examples that should be enforced include:

```text
TreatmentStarted.actorId == healerId
TreatmentStarted.targetId == patientId

TreatmentCompleted.actorId == healerId
TreatmentCompleted.targetId == patientId

ResourceReserved.actorId == holderNpcId
ResourceReserved.targetId == resourceId

CommitmentCreated.actorId == debtorId
CommitmentCreated.targetId == creditorId

RelationshipChanged.actorId == fromNpcId
RelationshipChanged.targetId == toNpcId
```

Equivalent checks should be defined for transfer, ownership, social-signal, and commitment-resolution events.

#### 2.3 Accepted decisions are not fully reconciled with their original offers

The validator confirms that a decision resolution references a prior request. It should additionally verify that:

- A matching `DecisionResponseReceived` exists for the accepted response ID.
- The received response belongs to the same request, NPC, scenario, and authorized provider.
- The selected affordance was in the request's exact offered set.
- `DecisionResponseAccepted` agrees with `DecisionResponseReceived` on selection and diagnostic fields.
- The ensuing `ActionProposed` descriptor matches the originally offered descriptor.
- Action mode and category agree with `MODE_TO_CATEGORY`.
- A continuation response refers to the correct existing action.

### Required remediation

Maintain structured maps while validating the event stream:

```text
requestsById
responsesById
actionsById
commitmentsById
transferRequestsById
proposalsById
```

For every `DecisionRequested`, retain its exact provider, actor, scenario, expiry, fingerprint, offered IDs, and offered descriptors. Use those records to validate the full received → accepted/rejected → action lifecycle.

Add a per-event envelope-consistency table rather than relying on a few general cases. The mapping should be explicit, exhaustive, and tested.

Require:

```text
file metadata == ScenarioStarted payload
ScenarioEnded task outcome == replayed outcome == final summary outcome
ScenarioEnded world hash == file world hash == recomputed world hash
```

Scenario expectation differences may remain warnings for alternate genuine providers. Structural and lifecycle contradictions should remain hard errors.

### Required tests

Create tampered files, recompute their hashes where necessary, and prove import still rejects:

- `ScenarioStarted.scenarioId` differs from file metadata.
- `ScenarioStarted.providerId` differs from file metadata.
- Treatment actor/target fields disagree with healer/patient payload fields.
- Commitment actor/target fields disagree with debtor/creditor payload fields.
- An accepted decision selects an affordance not offered by its request.
- An accepted response has no matching received response.
- Received and accepted response IDs match but provider or selection differs.
- `ActionProposed` differs from the accepted offered descriptor.
- A mode/category pair violates `MODE_TO_CATEGORY`.

These tests should remain import-time failures, not later replay failures.

---

## 3. Medium — `worldStateHash` has ambiguous semantics for nonterminal states

### What is implemented correctly

The semantic hash now excludes provider explanations, confidence values, event counters, counter-minted IDs, and other diagnostics while retaining consequential world, cognitive, and decision-cadence state. This resolves the original final-hash defect for completed runs.

Relevant files:

- `src/sim/replay/worldHash.ts`
- `src/sim/replay/ledgerHash.ts`
- `tests/unit/world-hash.test.ts`

### Remaining ambiguity

Pending decisions contain behaviorally relevant data including:

- Authorized provider
- Complete offered-affordance descriptors
- Processed response IDs
- Commitment and proposal semantics
- Proposed terms
- Preconditions and reservations

The current hash projection retains the request window and only part of each offer. It omits provider identity, seen-response state, proposed terms, reservations, preconditions, and some commitment/proposal details.

Two live states can therefore share a `worldStateHash` while reacting differently to the same future response. Examples:

- Different providers are authorized to answer.
- A response ID is a duplicate in one state and unseen in the other.
- Two apparently similar renegotiation actions contain different proposed terms.

The exported terminal hashes are not presently affected because pending requests are resolved or expired before the final hash is produced. The ambiguity becomes important if this hash is later used for:

- Mid-run snapshots
- Policy-cache keys
- Shadow simulations
- State deduplication
- Distributed simulation synchronization
- Save-state equivalence

### Recommended remediation

Choose and document one of two contracts.

#### Option A — Terminal semantic hash only

Make `worldStateHash` explicitly terminal-only:

```text
worldStateHash(state) throws unless state.terminal == true
```

Use a separate purpose-built fingerprint for live decisions and cache keys.

This is the simplest and least ambiguous choice for the current slice.

#### Option B — Complete live semantic hash

Include the full behaviorally relevant content of pending requests while continuing to normalize counter-derived identifiers.

Provider identity must be included once provider binding is authoritative. Proposed terms, reservations, preconditions, and other semantic offer data should be included directly rather than through their generated IDs.

Processed response identities present a design tradeoff: exact response IDs are transport-derived, but duplicate history changes future behavior. If live-state equivalence matters, define a separate runtime hash that intentionally covers response-deduplication state rather than forcing one hash to serve both terminal-world and transport-runtime purposes.

### Recommended tests

- Two nonterminal states with different authorized providers do not share the live-runtime hash.
- Two pending renegotiation offers with different terms do not share the live-runtime hash.
- Two states with different response-deduplication histories are distinguished by the runtime decision-state fingerprint.
- Terminal `worldStateHash` remains invariant to diagnostics and counter IDs.

---

## 4. Low — Direct Node versus worker-command stream parity is tested for only one scenario

The complete canonical event stream is now compared across tick-batch sizes 1, 5, and 20 for all seven scenarios. Repeat-run and pause/resume invariance are also substantially stronger than before.

However, direct-host versus worker-command complete-stream equality is currently tested only with Scenario C in `tests/integration/command-parity.test.ts`.

### Recommended remediation

Parameterize the direct-versus-worker test over all `SCENARIO_IDS`.

For each scenario, compare:

- `worldStateHash`
- `canonicalLedgerHash`
- Complete serialized canonical event stream
- Final summary

Add at least one worker-path asynchronous sequence once the worker test harness can select or inject a deferred provider configuration.

---

## 5. Low — Supersession diagnostics retain only the most recent superseded request

`NpcState` retains `lastSupersededRequestId`, and the response gate uses that one ID to distinguish `superseded-request` from `unknown-request`.

A response to an older superseded request is safely rejected, but it is reported as `unknown-request` after another request has subsequently been superseded. This weakens observability for long-latency, retried, or duplicated provider traffic.

### Recommended remediation

Maintain a bounded resolved-request registry:

```text
requestId -> accepted | expired | superseded
resolutionTick
resolutionReason
```

Retain entries through at least the maximum external-delivery and retry window. This registry may be canonical audit state or a replayable projection derived from lifecycle events.

The behavioral outcome is already safe; this change improves diagnosis and metrics.

---

## 6. Low — Outbound decision requests receive only envelope-level main-thread validation

Externally submitted responses have a detailed runtime Zod schema. Worker responses are initially validated only by protocol version and discriminant, and the `decision-request` branch stores the request without an exact request-payload parse.

The worker is currently trusted local code, so this is not an immediate safety defect. It becomes important when an external gateway consumes the requests.

### Recommended remediation

Define and export an exact shared `decisionRequestSchema` covering:

- Request identity and bounds
- Scenario and NPC IDs
- Provider ID
- Request and expiration ticks
- World revision
- Dependency fingerprint
- Exact offered descriptors
- Offered-ID agreement

Validate it:

- When the engine constructs the request
- At the worker output boundary
- In the main-thread client
- At any future gateway input boundary

Do not permit the gateway integration to introduce a separate incompatible schema.

---

# Status of the original seven audit findings

| Original finding | Re-audit status |
| --- | --- |
| Provider architecture was synchronous | **Mostly resolved; provider binding remains a high-severity blocker** |
| Hard constraints could be bypassed by another provider | **Resolved** |
| Ledger payload validation was too weak | **Substantially resolved; cross-field and lifecycle semantics remain incomplete** |
| Provider diagnostics contaminated the final hash | **Resolved for completed runs; live-state hash semantics need clarification** |
| Determinism tests compared only shallow fingerprints | **Resolved except all-scenario Node/worker parity coverage** |
| Memory behavior depended on exact fixture IDs | **Resolved** |
| Individuality traces were confounded by fixed roles and seed-derived labels | **Resolved** |

## Confirmed strengths

### Provider-independent constraints

The shared constraint implementation is now consumed by:

- The deterministic provider
- The fallback provider
- The authoritative decision-response gate

This successfully prevents a provider from bypassing survival overrides or hard identity boundaries while retaining physically possible norm violations for NPCs whose identities permit them.

### Exact schemas and isolated import replay

Every event type has an exact strict runtime schema, and imports are validated through a full isolated replay before storage. This is a material reliability improvement.

### Dual hash model

The repository now distinguishes:

- `worldStateHash` for consequential semantic state
- `canonicalLedgerHash` for exact canonical audit history

That is the correct conceptual separation for comparing different decision systems that can produce the same world through different reasoning traces.

### Complete deterministic stream comparison

The deterministic batch now compares complete canonical event streams, not only event counts or shallow fingerprints. It also reports the first divergent event and field.

### Generic memory appraisal

Decision logic now reads typed memory themes, social targets, confidence, and importance rather than exact memory IDs or prose. Runtime memories can influence later decisions through the same general mechanism.

### Individuality evaluation

The repository now provides:

- Context-rich traces explicitly labeled unsuitable for role-independent measurement
- Behavior-only blinded traces
- Cryptographically randomized labels outside the simulation core
- Separate reviewer packages and answer keys
- Six balanced identity-role permutations per scenario

This resolves the primary confounds in the original individuality test design.

---

# CI assessment

The actual workflow definitions are strong.

## Push and pull-request workflow

`.github/workflows/ci.yml` runs from a clean checkout:

```text
npm ci
npm run typecheck
npm run lint
npm run validate
npm run test:run
npm run build
npm run test:e2e:install
npm run test:e2e
npm run batch
```

The current workflow runs the full default 100-runs-per-scenario batch on every push to `main` and every pull request. This is stronger than the minimum ten-run CI gate described in the remediation brief and stronger than the stale summary in part of `AUDIT_REMEDIATION_REPORT.md`.

## Scheduled deterministic workflow

`.github/workflows/deterministic-batch.yml` runs the explicit 100-runs-per-scenario batch weekly and on manual dispatch, then uploads reports and ledgers.

## Verification caveat

The workflow files are correctly defined, but this re-audit did not independently observe a completed GitHub Actions run for the audited head commit through the available connector. The repository's clean-clone command results should therefore be treated as reported evidence until a visible green workflow run is confirmed.

---

# Recommended implementation order

1. **Bind responses to the authorized provider.** This is the only remaining blocker to external-model integration.
2. **Complete semantic import validation.** Reconcile file metadata, event envelopes, decision lifecycles, offers, responses, and action descriptors.
3. **Define the live-state hash contract.** Prefer a terminal-only `worldStateHash` plus a separate live decision-state fingerprint.
4. **Expand Node/worker parity to all scenarios.**
5. **Add exact outbound request validation.**
6. **Replace the single superseded-request field with a bounded resolved-request registry.**
7. **Confirm a green GitHub Actions run for the final remediation commit.**

---

# Definition of ready for one model-backed NPC

The repository is ready for the next controlled milestone when all of the following are true:

- A wrong-provider response is rejected as `provider-mismatch` through the engine gate.
- Correct-provider delayed responses, internal fallbacks, duplicates, expirations, supersessions, stale dependencies, and constraint violations all remain correctly distinguished.
- Imported ledgers prove full request → response → action semantic consistency.
- The live versus terminal hash contract is explicit and tested.
- Direct Node and worker-command execution produce identical complete canonical streams for every frozen scenario.
- `decision-request` and `submit-decision-response` payloads are exact-schema validated at all process boundaries.
- CI passes from a clean checkout, including Playwright and the full deterministic batch.
- The model gateway lives outside the browser, with no model key or SDK in client code.
- The deterministic fallback remains fully functional during gateway or model failure.

At that point, the model should be connected to only one NPC and one decision provider configuration. It should initially return structured selections over offered affordances, not create world state, actions, objects, or consequences directly.

# Final judgment

The remediation release establishes a credible deterministic foundation for the proposed research program. The original architectural weaknesses have largely been addressed, and the implementation now supports replayable delayed decisions, authoritative constraints, exact event schemas, dual hashes, stronger determinism proofs, generic memory effects, and substantially cleaner individuality measurement.

The remaining high-severity issue is narrow but fundamental: **a decision response must be authorized for the provider named by its request**. Close that gap before attaching a real model. After provider binding and the remaining semantic-ledger checks are complete, the system will be ready for the next experiment: one genuinely asynchronous model-backed NPC operating through the same affordance, constraint, staleness, fallback, event, and replay machinery as the deterministic baseline.
