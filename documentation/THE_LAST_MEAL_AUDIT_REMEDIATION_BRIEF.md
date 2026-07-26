# The Last Meal — Audit Remediation Brief

## Instructions for the coding agent

Implement the remediation work in this document against the repository:

- Repository: `186F/thelastmeal`
- Starting branch: `main`
- Audited commit: `ece5947e7c46d356ceab4ff54a92a163e098b850`
- Existing experiment: **Vertical Slice 001 — “The Last Meal” v1.0**

Read this document completely before changing code.

The current repository is a strong deterministic vertical slice. Preserve its central architecture:

- The pure TypeScript simulation remains authoritative.
- Three.js remains presentation-only.
- Canonical mutations continue to flow through typed events and the reducer.
- Browser and Node execution continue to share the same simulation modules.
- The fixed scenario data, NPC traits, initial needs, repair rates, injury timing, meal ownership, commitment terms, duration, and ten action categories must not be changed.
- Do not connect an external model, add a model SDK, add a backend, or add network calls in this task.

This task hardens the architecture so a later model-backed decision source can be added safely.

---

# 1. Required outcomes

Complete all seven remediation areas:

1. Add a genuinely asynchronous decision lifecycle without making the simulation clock await a provider.
2. Move survival and hard identity constraints into a provider-independent enforcement gate.
3. Add exact runtime schemas for every event payload and reject corrupted ledgers during import, before they are accepted.
4. Separate semantic world-state hashing from provider diagnostics and transport bookkeeping.
5. Strengthen determinism tests to compare complete canonical event streams, not only hashes, counts, event types, and ticks.
6. Replace exact memory-ID behavior rules with a generic, typed memory-appraisal system.
7. Harden the individuality-test export so role assignment and public seeds cannot trivially reveal identity.

Also add continuous integration so the repository’s required checks run from a clean GitHub checkout.

---

# 2. Scope and non-goals

## In scope

- Refactoring decision orchestration.
- New serializable decision-request and decision-response contracts.
- A logical-tick-based simulated asynchronous provider for tests.
- Response timeout, duplication, ordering, expiration, and staleness handling.
- A provider-independent constraint evaluator.
- New decision lifecycle events.
- Exact Zod schemas for every event type and payload.
- Isolated replay validation during ledger import.
- Separate world-state and canonical-ledger hashes.
- Stronger integration and browser tests.
- Generic memory appraisal and influence calculations.
- Improved blinded individuality exports and a separate role-counterbalancing evaluation harness.
- CI workflows.
- Documentation and migration notes.

## Explicitly out of scope

- OpenAI, Anthropic, local-model, or other model API integration.
- API keys, prompts, embeddings, vector stores, or natural-language dialogue.
- WebSocket, HTTP, or backend-server implementation.
- New gameplay systems.
- More NPCs, maps, resources, emergencies, or scenario mechanics.
- Rebalancing the frozen experiment to make desired outcomes easier to obtain.
- Replacing TypeScript, Vite, Three.js, Vitest, Playwright, or the Web Worker architecture.

---

# 3. Change control and versioning

This is an implementation hardening release, not a new experimental condition.

Keep these unchanged:

- Scenario IDs and scenario version `1.0.0`.
- Seeds.
- NPC identity values.
- Initial need values.
- Repair and treatment values.
- Scenario timelines.
- The ten action categories.
- Pre-registered success criteria.

Update version identifiers where compatibility changes:

- Bump the package version to `1.1.0`.
- Increment `PROTOCOL_VERSION` because worker commands and responses will change.
- Increment `SCHEMA_VERSION` because event types and payload schemas will change.
- Increment `LEDGER_FILE_FORMAT_VERSION` because exported ledger metadata and hashes will change.
- Keep the experiment label **Vertical Slice 001 — v1.0**.
- Add an implementation label such as **remediation release 1.1.0** to the README.

Old exported ledgers may be rejected as unsupported. Do not silently reinterpret them as the new format. Document the compatibility break.

Do not change fixed decision weights merely to restore a preferred scripted outcome. The generic-memory refactor may require mathematically equivalent restructuring, but preserve the intended baseline tendencies and rerun every scenario.

---

# 4. Required implementation order

Implement in this order:

1. Add world-revision and decision-lifecycle domain types.
2. Extract and enforce provider-independent constraints.
3. Route the existing deterministic provider through the new lifecycle.
4. Add the simulated asynchronous provider and lifecycle tests.
5. Add exact event schemas and hardened import validation.
6. Split semantic world-state hashing from canonical-ledger hashing.
7. Strengthen determinism tests.
8. Generalize memory appraisal.
9. Harden individuality exports and add the role-counterbalancing harness.
10. Add CI and update documentation.
11. Run every required command from a clean checkout.

Do not begin by integrating network or model code.

---

# 5. Remediation 1 — asynchronous decision lifecycle

## 5.1 Problem to solve

The current `DecisionProvider` returns synchronously from `decide(ctx)`. The engine calls it inline and immediately launches the selected action.

That design cannot safely support a future response that is:

- Delayed.
- Duplicated.
- Out of order.
- Returned after relevant world state changed.
- Returned after the NPC began another action.
- Never returned.

Do not solve this by making `stepTick`, the reducer, or the simulation loop `async`. The simulation must never await a provider or a network request.

## 5.2 Target architecture

Use an event-driven decision coordinator:

```text
Decision opportunity
        ↓
Generate concrete affordances
        ↓
Apply provider-independent constraints
        ↓
Create immutable DecisionRequest
        ↓
Local provider: immediate response
External-capable provider: pending request emitted to host
        ↓
Simulation continues using current action or deterministic fallback
        ↓
DecisionResponse arrives later as an explicit command
        ↓
Validate request, response, age, dependencies, constraints, and action
        ↓
Accept, reject, or expire response
```

The simulation core remains synchronous and deterministic. “Asynchronous” means that a response can be submitted on a later logical tick through a separate command; it does not mean that canonical simulation code awaits a `Promise`.

## 5.3 Separate event order from world relevance

The current `stateVersion` advances for almost every canonical event, including decision instrumentation. Do not use that counter as the sole stale-response test.

Add a separate monotonic `worldRevision` to canonical state.

`worldRevision` must advance only when state relevant to action legality, decision context, or future behavior changes. It must not advance for pure decision diagnostics or operator markers.

### Events that should advance `worldRevision`

At minimum:

- Time and need changes.
- Location and movement state.
- Current and pending action state.
- Repair progress and task outcome.
- Injury and treatment state.
- Resource existence, ownership, reservations, and transfer requests.
- Commitment terms, status, proposals, fulfillment, and breach.
- Beliefs, memories, relationships, and actionable social signals.
- Scenario terminal state.

### Events that should not advance `worldRevision`

At minimum:

- `DecisionRequested`.
- A received decision response before it is accepted.
- Provider failure diagnostics.
- Response rejection diagnostics.
- Fallback diagnostics.
- `SimulationPaused` and `SimulationResumed`.
- Other purely observational or transport bookkeeping that does not alter future behavior.

Retain the existing ledger sequence and event IDs. `worldRevision` is a separate field with separate semantics.

## 5.4 Required decision contracts

Create serializable contracts similar to the following. Exact type names may differ, but all information is required.

### Decision request

```text
DecisionRequest
- requestId
- npcId
- scenarioId
- requestedAtTick
- expiresAtTick
- worldRevisionAtRequest
- providerId
- offeredAffordances: immutable structured descriptors
- offeredAffordanceIds
- hardDependencyFingerprint
- decisionContextSummary or context reference needed for diagnostics
```

The stored affordance descriptors must contain enough information to revalidate and launch the original proposal later. Do not rely on regenerating an affordance with the same ID at a later tick; current affordance IDs contain the original decision tick.

### Decision response

```text
DecisionResponse
- responseId
- requestId
- npcId
- scenarioId
- providerId
- selectedAffordanceId
- confidenceBp
- reasonCode
- optional structured score records
```

### Pending decision state

Track, per NPC or in a dedicated request registry:

```text
PendingDecision
- request
- status: pending | accepted | rejected | expired | superseded
- responseIdsAlreadySeen
- resolutionTick
- resolutionReasonCode
```

This state must be replayable from decision lifecycle events. Do not keep behaviorally significant pending-request state only in an unrecorded in-memory map.

## 5.5 Hard dependency fingerprint

A global revision equality test would make every delayed response stale because hunger and fatigue change each tick. Use both:

- `worldRevisionAtRequest` for auditability.
- A `hardDependencyFingerprint` for acceptance.

The fingerprint must cover conditions whose change should invalidate the original action, including as applicable:

- Actor identity and incapacity.
- Actor location or transit state.
- Current action and interruptibility.
- Target NPC existence, injury, location, transit, and treatment status.
- Target resource existence and reservation owner.
- Bench occupancy.
- Task-completion state.
- Commitment status, terms, and pending proposal.
- Scenario terminal status.
- Any other structured precondition carried by the affordance.

Do not include exact soft utility inputs such as every incremental hunger or fatigue change in the hard fingerprint. Soft context drift is bounded by response expiration and the final constraint and action revalidation gates.

At response time:

1. Recompute the hard dependency fingerprint.
2. Reject the response if it differs.
3. Independently rerun provider-independent constraints.
4. Independently rerun action validation against current state.

## 5.6 Response lifecycle semantics

Implement these outcomes explicitly:

- **Accepted** — request is pending, response is unique, unexpired, matches the NPC/scenario/provider, selects an originally offered affordance, dependencies remain valid, constraints pass, and the action can still begin.
- **Rejected: duplicate-response** — `responseId` was already processed.
- **Rejected: unknown-request** — no such pending request exists.
- **Rejected: superseded-request** — a later request replaced it.
- **Rejected: response-expired** — current tick exceeds `expiresAtTick`.
- **Rejected: unoffered-affordance** — selected ID was not in the original offer.
- **Rejected: stale-dependencies** — hard dependency fingerprint changed.
- **Rejected: constraint-violation** — provider-independent rules disallow it.
- **Rejected: action-no-longer-valid** — current action validation fails.
- **Rejected: actor-busy-noninterruptible** — accepting would require interrupting a protected action.
- **Provider timeout/failure** — request expires or provider explicitly fails; deterministic fallback remains available.

Add typed events for the lifecycle. Recommended additions:

- `DecisionResponseReceived`
- `DecisionResponseAccepted`
- `DecisionResponseRejected`
- `DecisionRequestExpired`
- `DecisionRequestSuperseded`
- `ProvisionalDecisionUsed` if provisional fallback behavior is distinguished from ordinary fallback

The existing `DecisionReturned` event may be replaced or redefined, but do not leave ambiguous duplicate concepts.

## 5.7 Non-blocking NPC behavior

A pending external-capable request must never freeze the NPC or the world.

Use these rules:

- If the NPC already has an interruptible action, it continues while the request is pending.
- If the NPC is idle, execute the deterministic fallback immediately.
- A late accepted response may preempt only an action explicitly marked interruptible.
- Never preempt movement, eating, treatment, scripted delivery, or another non-interruptible action.
- If the actor is busy with a non-interruptible action, reject the response as `actor-busy-noninterruptible`; do not silently queue it indefinitely.
- A new decision request supersedes an older pending request for the same NPC.

## 5.8 Local deterministic provider parity

Route the existing deterministic provider through the same coordinator and acceptance gate.

For the local provider:

- Create the request.
- Produce the response on the same logical tick.
- Validate and accept it through the exact same response path used by delayed responses.

Do not preserve a private fast path that bypasses lifecycle validation.

## 5.9 Worker and host protocol

Add worker commands and responses for the future external-provider seam.

Required command:

```text
submit-decision-response
- complete DecisionResponse payload
```

Required worker output or host-accessible message:

```text
decision-request
- complete DecisionRequest payload intended for an external gateway
```

For this task, do not forward it to a network service. The browser UI may expose a diagnostics-only view, but no manual response UI is required.

Commands remain:

- Versioned.
- Schema-validated.
- Sequence-checked.
- Idempotent or explicitly rejected when duplicated.

## 5.10 Simulated asynchronous provider

Add a deterministic test provider or harness that can schedule responses by logical tick.

It must support test cases such as:

- Respond after 1, 5, or 30 logical ticks.
- Never respond.
- Return the same response twice.
- Return responses out of order.
- Return an unoffered action.
- Return after the meal is removed.
- Return after a reservation changes.
- Return after an injury changes the mandatory action set.

Do not use `setTimeout`, `Date.now`, or real network latency to test canonical behavior. Schedule test responses by logical tick.

---

# 6. Remediation 2 — provider-independent safety and identity constraints

## 6.1 Problem to solve

The current deterministic provider filters hard boundaries internally. A future provider could return an offered but forbidden action, and the engine would accept it because physical affordances intentionally include norm violations.

Hard constraints must not depend on provider cooperation.

## 6.2 Required constraint layer

Create a pure simulation module such as:

```text
src/sim/decisions/constraints.ts
```

It must accept the current structured decision context and offered affordances and return:

```text
ConstraintEvaluation
- allowedAffordanceIds
- forbiddenAffordances with reason codes
- mandatoryAffordanceIds or mandatory modes when an override applies
- active constraint reason codes
```

Use one shared implementation in:

- The deterministic provider, to avoid scoring prohibited choices.
- The decision-response acceptance gate, to enforce constraints authoritatively.
- The fallback path, to guarantee fallback also remains legal.

## 6.3 Constraints that must be enforced

At minimum preserve the existing semantics:

### Survival overrides

- An untreated serious personal injury restricts a conscious NPC to appropriate care-seeking actions when such actions are available.
- Critical hunger with a legally available meal restricts the NPC to eating, unless a higher-priority personal injury rule applies.
- Incapacitated NPCs make no decisions.

### Hard identity boundaries

- Jonas never knowingly chooses `eat-violation` against another NPC’s reservation.
- Rin does not voluntarily transfer or release essential food while medically or nutritionally vulnerable.
- Mara does not ignore an incapacitating injury when she is the sole capable helper according to her valid beliefs and the current situation.

The engine must still allow physically possible norm violations for NPCs whose constraints permit them. Do not make `eat-violation` globally illegal.

## 6.4 Rejection behavior

When any provider selects a constraint-forbidden action:

1. Record `DecisionResponseRejected` with `constraint-violation` and specific constraint codes.
2. Do not create `ActionProposed` for that choice.
3. Invoke the deterministic fallback through the same constraint gate.
4. Continue the simulation.

## 6.5 Required tests

Add tests proving that a malicious or incorrect provider cannot cause:

- Jonas to steal Rin’s meal.
- Rin to surrender her meal while vulnerable.
- A critically hungry NPC with a legal meal to select unrelated routine work.
- A seriously injured NPC to ignore care-seeking when valid care actions exist.
- Mara to ignore the sole-helper emergency boundary.

These tests must call the engine’s response-acceptance path, not only the deterministic provider directly.

---

# 7. Remediation 3 — exact event schemas and hardened ledger import

## 7.1 Problem to solve

The current runtime schema validates only the event envelope. `payload` is effectively `Record<string, unknown>`. A payload-corrupted ledger can be accepted as valid and fail only when replay is requested.

Import must be all-or-nothing and must prove internal consistency before the file is stored as a valid import.

## 7.2 Exact event schemas

Create a Zod discriminated union for every supported event type.

For each event:

- Validate the event type.
- Validate the exact payload fields.
- Use `.strict()` for payload objects.
- Validate integer ranges and enums.
- Validate nullable fields explicitly.
- Reject unknown payload properties.
- Validate stable ID formats where practical.

Infer or cross-check the TypeScript `SimEvent` union from these schemas so runtime and compile-time definitions cannot silently drift.

The union must cover all existing and newly added decision-lifecycle events.

## 7.3 Cross-event integrity validation

After schema parsing, validate at minimum:

- Contiguous ledger sequence numbers.
- Correct canonical and operator event ID sequences.
- Monotonic logical ticks.
- Exactly one `ScenarioStarted` at the beginning.
- Exactly one `ScenarioEnded` at the end.
- No events after `ScenarioEnded`.
- Every non-null `causationId` references an earlier event.
- Correlation IDs are well-formed and consistent for an action lifecycle.
- An `ActionStarted`, `ActionCompleted`, `ActionInterrupted`, or `ActionRejected` references a previously proposed or scripted action where required.
- Decision responses reference a prior request.
- Accepted/rejected/expired decision outcomes do not contradict one another.
- Resource, NPC, commitment, and scenario IDs are known.
- Event actor and target fields agree with payload IDs where the schema defines both.

## 7.4 Isolated replay during import

`validateLedgerFile` must perform this complete sequence before returning `ok: true`:

1. Parse JSON.
2. Validate the ledger-file schema.
3. Validate every exact event schema.
4. Validate ordering and references.
5. Replay the entire ledger into a fresh isolated state.
6. Run invariant checks on the replayed result.
7. Recompute the semantic world-state hash.
8. Recompute the canonical-ledger hash.
9. Rebuild the final summary from the replayed state and events.
10. Compare both hashes and every summary field with the file metadata.
11. Accept and store the import only if every step succeeds.

A replay exception is an import-validation error, not a later replay result.

A rejected file must not replace a previously valid imported file unless the product explicitly clears it first. Document the chosen behavior and test it.

## 7.5 Tamper-model limitation

This validation proves internal consistency, not cryptographic authorship. A sophisticated party could modify a ledger and recompute every unsigned field. Document that signed authenticity is outside this task.

## 7.6 Required regression changes

Update the existing corrupted-payload regression test:

- The corrupted `RepairProgressed` ledger must be rejected during import.
- `importLedger(...).ok` must be `false`.
- No imported ledger becomes available for replay.
- The active live run remains unchanged.

Add equivalent tests for malformed commitment, reservation, treatment, and decision-response payloads.

---

# 8. Remediation 4 — semantic world hash and canonical ledger hash

## 8.1 Problem to solve

The current final-state hash serializes the full runtime state, including provider confidence, reason codes, request IDs, fallback status, and other diagnostic information.

Two providers that produce the same consequential world and cognitive state should not receive different semantic world hashes merely because their explanation strings or confidence values differ.

## 8.2 Required hashes

Create two explicit hashes.

### A. Semantic world-state hash

Recommended name:

```text
worldStateHash
```

Build it from an explicit projection function such as:

```text
buildWorldStateHashProjection(state)
```

Include behaviorally and narratively persistent state, including:

- Scenario identity, version, and seed.
- Logical tick and terminal/task outcome.
- Purifier state.
- Meal state.
- NPC location, transit, needs, injury, incapacity, and current consequential action state.
- Persistent beliefs and memories.
- Resource reservations and transfer requests.
- Commitments and proposals.
- Relationships.
- Actionable social signals and cooldowns when they could affect future behavior.

Exclude transport, diagnostics, and counters, including:

- `lastDecision` explanation, confidence, provider, and request metadata.
- Response IDs.
- Pending external transport bookkeeping after it no longer affects behavior.
- `stateVersion` and `worldRevision` counters.
- Snapshot sequence numbers.
- UI or renderer state.
- Operator pause/resume markers.
- Debug score decompositions.

If any excluded field can affect future decisions, first move or duplicate the actual behaviorally relevant part into an explicitly persistent field. Do not exclude behaviorally significant state merely to make hashes match.

### B. Canonical ledger hash

Recommended name:

```text
canonicalLedgerHash
```

Hash a canonical projection of the authoritative event stream.

- Exclude `SimulationPaused` and `SimulationResumed`.
- Exclude raw ledger sequence positions that shift solely because operator markers were inserted, or normalize canonical sequence numbers after filtering.
- Include all canonical event IDs, types, ticks, actors, targets, causation, correlation, and exact payloads.
- Use the same canonical serializer in Node and browser.

Provider diagnostics that are recorded as canonical audit events may affect `canonicalLedgerHash`; that is acceptable. They must not affect `worldStateHash` unless they change persistent state.

## 8.3 Export format

The new ledger file must include both hashes:

```text
worldStateHash
canonicalLedgerHash
```

For compatibility, either:

- Replace `finalStateHash` with `worldStateHash`, or
- Retain `finalStateHash` as a documented alias of `worldStateHash` for one release.

Do not leave ambiguous hash semantics.

Update:

- Browser panels.
- Export files.
- Batch JSON and Markdown reports.
- Replay results.
- Tests.
- README documentation.

## 8.4 Required tests

Add tests proving:

- Two runs with identical consequential state but different provider reason codes and confidence values have the same `worldStateHash`.
- Those runs may have different `canonicalLedgerHash` values.
- Replay reproduces both hashes for the same ledger.
- Pause/resume markers do not change either canonical hash.
- A meaningful belief, memory, relationship, resource, injury, or commitment change changes `worldStateHash`.

---

# 9. Remediation 5 — complete ledger determinism tests

## 9.1 Problem to solve

Current determinism tests compare final hashes, ledger length, and a `seq:type:tick` fingerprint. They do not prove that payloads, actors, targets, causation, correlation, and IDs are identical.

## 9.2 Required comparison

Add a shared canonical-event-stream serializer.

For each scenario, compare complete canonical streams across:

- Tick batch size 1.
- Tick batch size 5.
- Tick batch size 20.
- Direct Node host execution.
- Worker-command semantics.
- Repeated clean runs.

The comparison must include every canonical field after filtering or normalizing operator-only markers.

On mismatch, the test failure must report:

- Scenario ID.
- Seed.
- First differing canonical event index.
- Both event IDs and types.
- A field-level or serialized diff.
- Logical tick.

## 9.3 Hundred-run batch

The 100-run batch must verify, per scenario:

- Stable `worldStateHash`.
- Stable `canonicalLedgerHash`.
- Complete canonical event-stream equality, not only length.
- Zero invariant violations.
- Replay equality.

Do not weaken this to sampled runs unless separately documented as a fast CI mode.

## 9.4 Pause and operator controls

Retain a distinct test proving that inserting pause/resume markers and processing ticks through different operator commands does not change the canonical event projection or semantic world state.

---

# 10. Remediation 6 — generic memory appraisal

## 10.1 Problem to solve

The deterministic provider currently checks exact IDs such as:

- `mem-mara-criticism`
- `mem-jonas-shift-covered`
- `mem-rin-supply-taken`

That proves those fixtures are connected, but not that the memory system generalizes.

## 10.2 Extend memory data

Retain the existing fact/perception/interpretation separation. Add typed appraisal fields.

A suitable structure should represent at least:

```text
MemoryAppraisal
- themes: one or more typed semantic themes
- socialTargetId: NPC, player, group, or null
- valenceMicro
- selfRelevanceMicro
- confidenceMicro
- importanceMicro
- createdTick
- optional decay or persistence category
```

Required initial themes should be generic concepts such as:

- `competence-threat`
- `reciprocity-debt`
- `ownership-violation`
- `care-received`
- `promise-broken`

Do not encode a scenario name or action outcome in the memory ID.

## 10.3 Generic influence calculation

Create a shared memory-influence function that:

- Does not inspect exact memory IDs.
- Reads typed themes, target, confidence, importance, and relevant identity traits or values.
- Produces separately inspectable score components.
- Scales effects by confidence and importance.
- Applies target-specific effects only to the relevant person.
- Allows multiple memories to combine through a documented bounded rule.

Examples of intended generic behavior:

- A high-importance competence threat combined with pride and diligence increases work persistence and decreases help-seeking.
- A reciprocity-debt memory toward Mara increases Jonas’s pressure to keep or renegotiate his commitment to Mara.
- An ownership-violation memory attributed to Jonas decreases Rin’s willingness to transfer resources to Jonas and increases refusal pressure.
- A care-received memory can improve later cooperation without deleting a separate suspicious memory.

The exact arithmetic must be centralized and documented. Avoid unbounded stacking.

## 10.4 Preserve the B1/B2 ablation

B1 and B2 must still differ only by the presence of Mara’s criticism memory. The behavior difference must emerge through generic appraisal, not an exact ID conditional.

## 10.5 Required tests

Add tests proving:

- Changing only a memory’s ID does not change behavior.
- Two memories with the same appraisal but different text and IDs produce equivalent influence.
- Lower confidence or importance reduces influence monotonically.
- A target-specific ownership memory about Jonas does not affect an otherwise equivalent transfer decision involving Mara.
- Removing the appraisal removes the behavioral effect even if the prose fact remains.
- B1/B2 still produce a measurable difference without exact ID checks.
- Existing safety and legality rules still override memory influence.

Search the simulation source for exact seed-memory ID checks and remove them from decision logic.

---

# 11. Remediation 7 — individuality-test hardening

## 11.1 Problem to solve

The current anonymized traces can reveal identity through unique role facts:

- Only Rin owns the meal.
- Only Jonas is the promise debtor.
- The label permutation is derived from the public scenario seed.

A reviewer could identify actors from assignments rather than behavioral style.

## 11.2 Two review exports

Produce two distinct trace modes.

### Context-rich trace

Retain the existing contextual information for qualitative debugging. Clearly label it as unsuitable for measuring personality recognition independently of role.

### Behavior-only blinded trace

Remove or normalize uniquely identifying role information.

Do not include:

- Meal-owner identity.
- Exact debtor/creditor role.
- NPC names.
- Trait names.
- Biography text.
- Exact memory wording.
- Scenario-public actor permutation.

Retain:

- Logical time.
- Needs and health.
- Available action categories.
- Chosen category and mode.
- Generalized context such as `resource-conflict-present`, `obligation-present`, or `other-agent-injured` without exposing the unique role assignment.
- Outcome.

## 11.3 Blinding map

Do not derive actor labels from the public scenario seed.

Generate the blinding map outside canonical simulation using Node or browser cryptographic randomness. This randomness is presentation/evaluation metadata and must never affect simulation state or hashes.

Support two files:

- Reviewer package: opaque actor labels and traces only.
- Answer key: label-to-NPC mapping, exported separately and only through an explicit operator or CLI option.

The standard deterministic batch report must not require random blinding and must remain reproducible.

## 11.4 Role-counterbalancing evaluation harness

Do not alter Vertical Slice 001 v1.0 scenarios.

Create a separate evaluation-only harness, with its own explicit version, that rotates identity profiles across structural roles such as:

- Initial bench worker.
- Promise debtor.
- Promise creditor.
- Meal owner.

Use balanced permutations so identity-recognition performance cannot be explained solely by one role assignment.

Requirements:

- Keep these evaluation runs out of the v1.0 experimental report.
- Label them clearly as `individuality-eval` or equivalent.
- Reuse the same deterministic engine and action vocabulary.
- Export behavior-only traces and answer keys separately.
- Do not tune identity behavior after seeing reviewer results without a new evaluation version.

## 11.5 Required tests

Add tests proving:

- Behavior-only traces contain no NPC names or unique role flags.
- Reviewer labels cannot be reconstructed from the scenario seed.
- The answer key is absent from reviewer exports.
- Context-rich and behavior-only exports are distinct and correctly labeled.
- Role permutations cover each identity in each structural role an equal number of times, or document the exact balanced design if perfect equality is impossible.

---

# 12. Recommended file and module changes

Exact organization may vary, but keep responsibilities explicit.

Likely additions or modifications:

```text
src/shared/
  events.ts                         exact event discriminated union
  workerProtocol.ts                 response-submission command and request output
  ledgerFile.ts                     dual hashes and new format version
  decisionContracts.ts              serializable request/response contracts

src/sim/domain/
  state.ts                          worldRevision and replayable pending decisions
  identities.ts                     typed memory appraisals

src/sim/decisions/
  provider.ts                       local provider contract or adapter
  coordinator.ts                    request creation and response resolution
  constraints.ts                    shared mandatory/forbidden rules
  dependencyFingerprint.ts          hard dependency projection and hash
  deterministicProvider.ts          uses constraints and generic memory effects
  fallbackProvider.ts               uses constraints
  memoryInfluence.ts                generic appraisal-to-score calculation
  simulatedAsyncProvider.ts         logical-tick test harness

src/sim/events/
  types.ts                          aligned with runtime schemas
  reduce.ts                         lifecycle state and worldRevision semantics

src/sim/runtime/
  engine.ts                         non-blocking lifecycle orchestration
  host.ts                           submit-response API and request output

src/sim/replay/
  worldHash.ts                      explicit semantic projection
  ledgerHash.ts                     canonical event projection
  validateLedger.ts                 exact schema, replay, invariant, hash validation

src/sim/evaluation/
  individuality.ts                  role-counterbalancing harness

src/worker/
  commandProcessor.ts               submit-response handling
  simWorker.ts                      request forwarding; no network

src/app/
  workerClient.ts                   validates new messages

scripts/
  batch/run.ts                      both hashes and stronger equality
  evaluation/individuality.ts       reviewer and key package generation

.github/workflows/
  ci.yml
  deterministic-batch.yml          optional scheduled/manual 100-run workflow
```

Do not introduce circular dependencies between shared schemas, simulation state, and worker code.

---

# 13. Continuous integration

Add GitHub Actions.

## Pull-request and push workflow

From a clean checkout, run:

```text
npm ci
npm run typecheck
npm run lint
npm run validate
npm run test:run
npm run build
npm run test:e2e:install
npm run test:e2e
npm run batch -- --runs=10
```

Use dependency caching where appropriate, but never cache generated source or test results as authoritative inputs.

## Full deterministic workflow

Add a scheduled and manually dispatchable workflow that runs:

```text
npm ci
npm run batch -- --runs=100
```

Upload batch reports and failing Playwright artifacts when useful. Do not commit generated `artifacts/`, coverage, or browser reports.

A failing required command must fail the workflow.

---

# 14. Required tests summary

The finished repository must add or update tests covering all of the following.

## Async lifecycle

- Same-tick local provider response.
- Delayed response accepted when hard dependencies are unchanged.
- Response rejected after meal removal.
- Response rejected after reservation transfer.
- Response rejected after injury changes mandatory choices.
- Duplicate response rejected without duplicate action.
- Out-of-order response rejected or correctly matched by request ID.
- Expired response rejected.
- Superseded request rejected.
- Invalid provider response triggers fallback.
- Simulation advances while a request is pending.
- Non-interruptible actions are never preempted.

## Constraint gate

- All five hard-boundary and survival cases described in section 6.
- Same enforcement for deterministic, simulated external, and fallback providers.

## Ledger schemas and import

- Exact valid event payloads accepted.
- Missing, extra, mistyped, out-of-range, and unknown fields rejected.
- Invalid causation and correlation references rejected.
- Corrupted payload import rejected before replay is offered.
- Rejected import leaves live run unchanged.
- Recomputed summary mismatch rejected.
- World-hash mismatch rejected.
- Canonical-ledger-hash mismatch rejected.

## Hashing and determinism

- Diagnostics do not affect `worldStateHash`.
- Persistent cognitive or world changes do affect `worldStateHash`.
- Complete canonical ledger equality across batch sizes.
- Complete canonical ledger equality across Node and worker command semantics.
- 100-run stability of both hashes and full canonical streams.
- Pause/resume invariance.

## Memory appraisal

- ID invariance.
- Semantic equivalence across differently worded memories.
- Confidence/importance scaling.
- Target specificity.
- B1/B2 measurable difference.
- Safety override dominance.

## Individuality exports

- No name, trait, exact role, or answer-key leakage.
- Private blinding mapping independent of scenario seed.
- Balanced role permutations.

## Existing coverage

All prior tests for scenarios A–F, B1/B2, replay, stale actions, provider failure, Three.js smoke behavior, UI controls, exports, imports, and browser operation must continue to pass after updates or be replaced by stricter equivalent tests.

---

# 15. Manual verification

After implementation, from a clean checkout:

```bash
npm ci
npm run test:e2e:install
npm run typecheck
npm run lint
npm run validate
npm run test:run
npm run test:e2e
npm run build
npm run batch -- --runs=100
```

Then run:

```bash
npm run dev
```

Manually verify:

1. Every v1.0 scenario remains selectable and reaches a terminal state.
2. Both world-state and canonical-ledger hashes are visible after completion.
3. Live replay reproduces both hashes.
4. A valid exported ledger imports and replays.
5. A payload-corrupted ledger is rejected at import, not accepted for later failure.
6. Scenario E still rejects the stale meal action.
7. Scenario F still records provider failure and deterministic fallback.
8. Decision diagnostics expose request ID, request age, request status, world revision, and response-rejection reason where relevant.
9. No simulation pause occurs while the simulated asynchronous provider has a pending request.
10. The browser console has no uncaught errors.
11. The Three.js view remains presentation-only.
12. The reviewer individuality package does not contain the answer key.

---

# 16. Documentation requirements

Update `README.md` with:

- The new decision lifecycle diagram.
- The distinction between local synchronous decision production and asynchronous response submission.
- `worldRevision` semantics.
- Hard dependency fingerprint semantics.
- Provider-independent constraint enforcement.
- The distinction between `worldStateHash` and `canonicalLedgerHash`.
- New ledger-format compatibility notes.
- New worker commands and messages.
- How to run the simulated asynchronous tests.
- How to generate context-rich and behavior-only individuality packages.
- How to run the role-counterbalancing evaluation harness.
- CI behavior.

Add:

```text
documentation/AUDIT_REMEDIATION_REPORT.md
```

The report must contain:

- A section for each of the seven audit findings.
- Files changed.
- Design decisions.
- Tests added.
- Any deviations from this brief and why.
- Final command results.
- The seven scenario hashes and ledger hashes after remediation.
- Confirmation that fixed experiment data was not changed.

Do not claim a command passed unless it was actually executed successfully.

---

# 17. Definition of done

The remediation is complete only when all conditions below are true.

## Architecture

- The simulation never awaits a provider or network request.
- Delayed decision responses enter through an explicit command and lifecycle.
- The existing deterministic provider uses the same request/acceptance path.
- Pending requests are replayable and cannot silently mutate the world.
- `worldRevision` is distinct from ledger ordering and diagnostic event count.
- Relevant dependency changes invalidate late responses.
- Survival and hard identity constraints are enforced independently of the provider.
- The engine remains authoritative over all objective outcomes.

## Ledger and replay

- Every event type has an exact runtime payload schema.
- Corrupted ledgers are rejected during import.
- Import performs isolated replay, invariant checks, summary reconstruction, and both hash comparisons.
- Replay remains reducer-based and uses no decision provider.

## Hashing and determinism

- Provider explanations and confidence do not affect the semantic world-state hash.
- Canonical event history has a separate hash.
- Complete canonical event streams match across batch sizes and execution hosts.
- One hundred runs per scenario produce stable hashes, stable event streams, and zero invariant violations.

## Behavior

- Memory behavior no longer depends on exact seed-memory IDs.
- B1/B2 still produce a measurable controlled difference.
- Safety overrides remain stronger than traits and memories.
- Existing scenario outcomes remain valid under the frozen specification.

## Evaluation

- Reviewer individuality traces do not leak unique role assignments or answer keys.
- Blinding is independent of the public scenario seed.
- Role-counterbalanced evaluation runs are separate from Vertical Slice 001 v1.0 results.

## Tooling

- All required npm commands succeed from a clean checkout.
- GitHub Actions run required checks.
- The production build works.
- The browser app has no uncaught console error in the covered flows.
- No external model, backend, API key, database, or unrelated gameplay feature has been added.

---

# 18. Final instruction

Treat the existing implementation as a valuable baseline, not disposable scaffolding. Make the smallest coherent architectural changes that satisfy this brief.

Do not hide failures by weakening tests, loosening schemas, removing invariants, changing frozen scenario data, or excluding behaviorally meaningful state from verification.

The goal of this remediation is precise:

> Make the deterministic vertical slice safe for a future delayed, fallible, and untrusted decision source without allowing that source to block the simulation, bypass identity constraints, corrupt world state, or undermine replay and experimental validity.
