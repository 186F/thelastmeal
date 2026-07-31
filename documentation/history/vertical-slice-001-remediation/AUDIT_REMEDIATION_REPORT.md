# Audit Remediation Report — The Last Meal, remediation release 1.1.0

Remediates the seven findings of
[`THE_LAST_MEAL_AUDIT_REMEDIATION_BRIEF.md`](THE_LAST_MEAL_AUDIT_REMEDIATION_BRIEF.md)
against audited commit `ece5947e7c46d356ceab4ff54a92a163e098b850`
(Vertical Slice 001 — "The Last Meal" v1.0).

- Experiment label: **Vertical Slice 001 — v1.0** (unchanged).
- Implementation label: **remediation release 1.1.0** (`package.json` 1.1.0).
- `SCHEMA_VERSION` 1 → 2, `PROTOCOL_VERSION` 1 → 2, `LEDGER_FILE_FORMAT_VERSION` 1 → 2.
- `CONFIG_VERSION` **unchanged** (`vs001-1.0.0`): no frozen experiment data changed.
- Format-1 ledger exports are rejected at import with `unsupported-format-version`
  — never silently reinterpreted.

## Confirmation: fixed experiment data unchanged

Scenario IDs, versions (`1.0.0`), seeds (A=1001, B1=B2=1002, C=1003, D=1004,
E=1005, F=1006), scripted timelines, NPC identity traits/values/skills, initial
needs, repair/treatment/injury values, commitment terms, relationship deltas,
the ten action categories, and the pre-registered success criteria are all
byte-identical to v1.0 (`src/sim/config.ts`, `src/sim/domain/identities.ts`
trait/value data, `src/sim/scenarios/definitions.ts`). The decision weights in
`src/sim/decisions/weights.ts` were not re-tuned; the memory constants were
*restructured* into theme base weights that are mathematically equivalent at
the frozen fixture appraisals (see finding 6), which is pinned by tests. The
seed-memory IDs were renamed to neutral slugs (`mem-mara-001` etc.) as the
audit requires; IDs are bookkeeping, not experiment data, and behavior is
proven ID-independent.

---

## Finding 1 — Asynchronous decision lifecycle

**Design.** The provider contract now returns either a same-tick result or
`{ deferred: true }`; the simulation core contains no `async`/`await`/`Promise`.
Every decision opportunity creates an immutable, serializable `DecisionRequest`
(`src/shared/decisionContracts.ts`) recorded verbatim in the extended
`DecisionRequested` payload: request ID, expiry (`DECISION_REQUEST_TTL_TICKS`
= 60), `worldRevision` at request time, a hard dependency fingerprint, and the
**complete offered-affordance descriptors** (stored, never regenerated —
affordance IDs embed the decision tick). Pending requests live in canonical
state (`NpcState.pendingDecision`) and every transition is a typed event
(`DecisionResponseReceived` / `Accepted` / `Rejected`,
`DecisionRequestExpired` / `Superseded`), so the registry is fully replayable.
`DecisionReturned` was replaced by the Received→Accepted pair (allowed by
audit §5.6).

`worldRevision` advances via a static per-event-type map
(`ADVANCES_WORLD_REVISION` in `src/sim/events/reduce.ts`) — a pure function of
the event type, never payload or engine context, so replay agrees with live
execution by construction. The whole decision-lifecycle family, provider
diagnostics, `PerceptionRecorded` (whose only mutation is the re-evaluation
flag), and pause/resume markers do not advance it.

Acceptance is gated on the **hard dependency fingerprint**
(`src/sim/decisions/dependencyFingerprint.ts`): meal existence/ownership,
bench occupancy, task completion, commitments/proposals, pending transfer
requests, all NPCs' injury/treatment/incapacity, and other NPCs'
locations/transits/actions. Soft needs are excluded (audit §5.5). The
**actor's own location/transit/current action are also excluded** — a
documented deviation, see "Deviations" below.

All response outcomes of §5.6 are implemented with those exact reason codes.
Non-blocking rules of §5.7: busy NPCs continue; idle NPCs run the
deterministic fallback immediately as a *provisional* action
(`FallbackDecisionUsed` with a `provisional:` reason prefix) without consuming
the request; late acceptance preempts only interruptible actions; movement and
non-interruptible actions reject with `actor-busy-noninterruptible`; a new
decision opportunity supersedes the outstanding request. The local
deterministic provider and the fallback are routed through the **same**
`processDecisionResponse` gate (§5.8) — no private fast path exists (under
test). External responses enter via the worker command
`submit-decision-response` (zod-validated, versioned, sequence-checked) and
drain at exactly one fixed point inside `stepTick` (pipeline step 9), so
canonical outcomes are independent of operator tick-batch sizes; pending
requests surface as diagnostics-only `decision-request` worker messages, never
forwarded to any network. The `SimulatedAsyncProvider`
(`src/sim/decisions/simulatedAsyncProvider.ts`) schedules responses by logical
tick only.

**Files.** `src/shared/decisionContracts.ts` (new),
`src/sim/decisions/dependencyFingerprint.ts` (new),
`src/sim/decisions/simulatedAsyncProvider.ts` (new),
`src/sim/decisions/provider.ts`, `src/sim/events/{types,reduce,eventSchemas}.ts`,
`src/sim/domain/state.ts`, `src/sim/runtime/{engine,host,snapshot}.ts`,
`src/shared/{ids,workerProtocol,snapshots,snapshotSchema}.ts`,
`src/worker/commandProcessor.ts`, `src/app/{workerClient,store}.ts`,
`src/ui/{inspector,eventLog,globalPanel}.ts`, `src/sim/config.ts`.

**Tests.** `tests/integration/async-lifecycle.test.ts` (16 tests: same-tick
parity, delayed acceptance, unoffered/duplicate/expired/superseded/stale
rejections, meal-removal span, non-interruptible and transit protection,
scheduled out-of-order arrival, tick-batch-size independence with scheduled
responses, never-responding timeout to a valid terminal state, malicious
synchronous provider → gate rejection → fallback),
`tests/unit/world-revision.test.ts`.

## Finding 2 — Provider-independent constraints

**Design.** `src/sim/decisions/constraints.ts` is a pure module returning
`{ allowedAffordanceIds, forbidden (with reason codes), mandatoryModes,
activeConstraintCodes }`, ported bit-exactly from the v1.0 provider-internal
`applyHardLayers` in the same order (L1a injury-care with its safety
fall-through → L1b critical-hunger-eat → L2 boundaries; Mara's sole-helper
rule stays belief-scoped). It is consumed in three places: the deterministic
provider (forbidden choices never scored), the fallback provider (fallback
choices legal — this is what changes Scenario F, see below), and the engine's
acceptance gate (authoritative). A provider selecting an offered-but-forbidden
affordance gets `DecisionResponseRejected` with `constraint-violation` plus
the specific constraint codes, no `ActionProposed` is created, one bounded
fallback retry runs through the same gate, and the simulation continues.
`eat-violation` remains legal for permitted NPCs (verified by an engine-path
test in which Mara executes it).

**Scenario F behavioral change (documented, intentional).** v1.0's fallback
bypassed the survival layer: after the provider failure at tick 600 and Rin's
injury at 720, she waited (100 × `wait`), treatment never started, and her
injury worsened to incapacitation at tick 1320 (v1.0 `finalStateHash`
`22dfdbed2781b41a`, 135 provider failures). Under the constrained fallback her
post-injury decisions are exclusively care-seeking (`ask-help`,
`stay-at-cot`); nobody treats her (Jonas's fallback is not *mandated* to
treat), so the worsening at tick 1320 still occurs, the promise still breaks,
and the purifier still completes — the scenario's pre-registered purpose
(provider failures recorded, fallback keeps the run valid) is unchanged, now
with 127 provider failures under the new decision cadence. Scenario data and
version stay frozen; this is an engine-policy correction under the remediation
release, pinned by a new baseline test. It cannot be slipped in silently: the
old event stream fails the new stream-equality suite.

**Files.** `src/sim/decisions/{constraints,deterministicProvider,fallbackProvider}.ts`,
`src/sim/runtime/engine.ts`.

**Tests.** `tests/integration/constraint-gate.test.ts` — all five §6.5 cases
through the ENGINE acceptance path (Jonas cannot steal, vulnerable Rin cannot
surrender, critical hunger cannot be steered off eating, injured NPC cannot be
steered off care, Mara cannot ignore the sole-helper emergency), plus the
permitted-violation case and constraint-module order/fall-through units;
`tests/integration/scenarios.test.ts` pins the new F baseline.

## Finding 3 — Exact event schemas and hardened import

**Design.** `src/sim/events/eventSchemas.ts`: one `.strict()` schema per event
type (all 46), with enums for every bounded vocabulary, integer ranges derived
from `src/sim/config.ts` constants (never re-stated magic numbers), structured
ID patterns, and explicit nullability. Drift control is a cross-check, not
inference (inferring `SimEvent` from zod would widen the domain types the
reducer's exhaustive switch relies on — audit-noted risk): a module-load
completeness check over `EVENT_TYPES`, `parseSimEvent` output typing, and
round-trip tests over every event of all seven live scenario ledgers.

`validateLedgerFile` is now all-or-nothing: JSON → file schema (with an
explicit `unsupported-format-version` rejection for v1 files) → exact
per-event schemas → ordering/reference integrity (contiguous seq, recomputed
canonical/operator ID counters, monotonic ticks, single start/end framing,
causation must reference an earlier event, correlation must agree with payload
action IDs, action lifecycle references, decision resolutions must reference a
prior request and never contradict, commitment references) → **isolated
replay** into a fresh state (a reducer throw is an import error with the
reducer's message, never a later replay surprise) → invariants → recomputed
`worldStateHash` (vs file and vs the `ScenarioEnded` payload), recomputed
`canonicalLedgerHash`, and a field-by-field rebuilt `finalSummary`. Failures
carry forensic detail (event ID/index, computed vs expected values). A
rejected file never replaces a previously valid import; a live run is
untouched. The worker surfaces an `importing` run status for the (now heavier)
validation, mirroring `replaying`.

Deviation from §7.4 step 6 (per the accepted amendment): only STRUCTURAL
invariants hard-reject; scenario expectation codes (e.g.
`provider-failures-recorded`) are reported as warnings, because a genuine
ledger from a different provider may legitimately differ behaviorally without
being corrupt. Tamper-model limitation documented in the module header:
internal consistency, not authorship — signing is out of scope.

**Files.** `src/sim/events/eventSchemas.ts` (new),
`src/sim/replay/validateLedger.ts` (rewritten), `src/sim/invariants.ts`
(structural/expectation split), `src/shared/ledgerFile.ts`,
`src/worker/commandProcessor.ts`, `src/sim/runtime/host.ts`.

**Tests.** `tests/unit/event-schemas.test.ts` (completeness, per-scenario
round-trips, unknown/extra/missing/mistyped/out-of-range/bad-ID/nullability
rejections), `tests/unit/ledger-import.test.ts` (19 tests: v1 rejection,
malformed reservation/commitment/treatment/decision-response payloads,
dangling causation, decision-resolution references, corrupted
`RepairProgressed` rejected AT IMPORT, tampered world/ledger hashes and
summary, rejected import preserves the prior valid import and the live run),
`tests/unit/review-regressions.test.ts` (upgraded: import-time rejection +
the live-replay error boundary retained).

## Finding 4 — Semantic world hash and canonical ledger hash

**Design.** `src/sim/replay/worldHash.ts` builds an explicit projection of
behaviorally/narratively persistent state: scenario identity, tick/terminal/
outcome, purifier, meal, reservations, commitments (proposals by
terms+proposer+tick), transfer requests (by parties), relationships, social
signals (by kind+parties+tick), and per-NPC location/transit/needs/injury/
incapacity/actions (by mode/category/target/timing), cognition (beliefs by
subject+value+confidence+provenance kind+tick; memories by full content +
typed appraisal + createdTick), decision-relevant cadence fields
(`lastDecisionTick`, `needsReevaluation`, cooldowns), and an active pending
decision's behavioral surface (window + offered modes/targets). Excluded:
`stateVersion`/`worldRevision`, `lastDecision` diagnostics, and — per the
accepted amendment — **every counter-minted identifier** (event/memory/action/
affordance/request/proposal/signal IDs and provenance links), because two
decision sources emitting different event counts would otherwise never hash
equal even with identical consequential worlds. In each exclusion the
behaviorally relevant content is projected directly, satisfying the audit's
"move the relevant part, don't just drop it" rule.

`src/sim/replay/ledgerHash.ts` hashes the canonical event stream: pause/resume
markers filtered, raw `seq` omitted entirely (markers shift seq while
canonical IDs come from a marker-independent counter; renumbering would
conflict with the exported `seq === index` integrity check), constant
`schemaVersion` omitted, everything else verbatim including exact payloads.
`worldStateHash` is computed before the `ScenarioEnded` append and embedded in
its payload; `canonicalLedgerHash` covers the complete stream including
`ScenarioEnded` and therefore lives at run/file level only (a hash cannot be
embedded in an event it covers). Ledger files carry both; `finalStateHash` was
replaced (not aliased) and the break is documented. Browser panels, exports,
batch JSON/Markdown reports, replay results, and the README were updated.

**Files.** `src/sim/replay/{worldHash,ledgerHash}.ts` (new),
`src/sim/replay/replay.ts`, `src/sim/runtime/{engine,host,ledgerFileBuilder,snapshot}.ts`,
`src/shared/{ledgerFile,reports,workerProtocol,snapshots,snapshotSchema}.ts`,
`src/sim/{batch,reporting}.ts`, `src/ui/globalPanel.ts`, `scripts/batch/run.ts`.

**Tests.** `tests/unit/world-hash.test.ts`: identical consequential world with
different reason codes/confidences → same `worldStateHash`, different
`canonicalLedgerHash`; shifting every counter-derived ID → hash unchanged;
meaningful belief/memory/relationship/resource/injury/commitment/cadence
changes → hash changed; ledger hash ignores seq/markers but covers payloads.
Replay reproduction and pause-invariance for both hashes:
`tests/integration/{replay,determinism}.test.ts`.

## Finding 5 — Complete ledger determinism tests

**Design.** A shared canonical event-stream serializer
(`serializeCanonicalEventStream`, same projection as the ledger hash) plus a
rich mismatch reporter (`src/sim/replay/streamDiff.ts`: scenario, seed, first
differing canonical index, both event IDs/types, logical tick, field-level
payload diff). The determinism suite compares COMPLETE canonical streams —
every field — across tick-batch sizes 1/5/20 for all seven scenarios, across
direct Node host execution vs worker-command semantics, across repeated clean
runs, and across pause/resume operator interleavings. The 100-run batch
(`src/sim/batch.ts`) verifies, per scenario: stable `worldStateHash`, stable
`canonicalLedgerHash`, **complete canonical event-stream equality for every
repeat run** (string comparison against run 1's serialized stream, with the
diff reporter on mismatch), zero invariant violations, and replay equality.
The authoritative 100-run gate is the standalone `npm run batch` runner,
which CI executes IN FULL on every push and the scheduled workflow re-runs
weekly; the Vitest suite carries a lighter in-suite batch check because long
CPU-bound batches inside a Vitest worker trip the runner's internal
worker-RPC timeout on slow CI machines even when every test passes. Replay
verifies `worldStateHash` (re-simulating, not replaying, is the axis that
verifies the ledger hash — replay "reproducing" a hash of its own input would
be circular).

**Files.** `src/sim/replay/streamDiff.ts` (new), `src/sim/batch.ts`,
`src/shared/reports.ts`, `tests/integration/{determinism,command-parity,hundred-runs}.test.ts`.

## Finding 6 — Generic memory appraisal

**Design.** Memories now carry a typed appraisal: `themes`
(`competence-threat`, `reciprocity-debt`, `ownership-violation`,
`care-received`, `promise-broken`), `socialTargetId`, `valenceMicro`,
`selfRelevanceMicro`, alongside the existing fact/perception/interpretation/
confidence/importance/createdTick separation. Seed memories were renamed to
neutral slugs (`mem-mara-001`, `mem-jonas-001`, `mem-rin-001`) with appraisals;
runtime memories (ownership violation, care received, promise broken) get
payload-derived appraisals in the reducer — which means runtime memories now
influence future behavior generically (in v1.0 they were behaviorally inert),
scoped so no frozen scenario outcome changes (verified: all scenario
signatures identical).

`src/sim/decisions/memoryInfluence.ts` is the ONLY path from memories to
scores: it never reads IDs or prose; effects scale by
`round(base × confidence/1e6 × importance/1e6)` with one rounding point;
target-specific themes apply only when the counterparty matches; same-code
contributions sum and clamp at ±2× base (documented bounded stacking). All
exact-ID checks were removed from decision logic; the only remaining ID
reference is the B1/B2 ablation switch in scenario setup
(`MARA_CRITICISM_MEMORY_ID`), which selects WHICH fixture to remove — data
plumbing, not decision logic.

**Equivalence at fixture values** (change-control: weights not re-tuned): the
theme base weights are derived so the scaled values at the frozen fixture
appraisals reproduce the v1.0 constants exactly —
185_185/493_827/123_457/185_185 × .81 → 150k/400k/100k/150k;
95_238 × .63 → 60k; 147_059/294_118 × .68 → 100k/200k — pinned by regression
tests, and the B1/B2 ablation deltas are bit-identical to v1.0
(work ticks 2169 vs 960; break requests 0 vs 2; first break request
never vs recorded).

Deviation from the audit's illustrative trait-product formulas ("competence
threat combined with pride and diligence"): trait sets are frozen AND disjoint
per NPC (Rin has no pride/diligence), so trait products are unimplementable
without changing frozen identity data. Generalization is delivered through
themes + targets + confidence/importance scaling instead, which satisfies
every required §10.5 property.

**Files.** `src/sim/decisions/{memoryInfluence,weights,deterministicProvider}.ts`,
`src/sim/domain/{state,identities}.ts`, `src/sim/events/reduce.ts`,
`src/sim/scenarios/initialState.ts`, `src/sim/validation/validateData.ts`,
`src/shared/{ids,snapshots,snapshotSchema}.ts`, `src/ui/inspector.ts`.

**Tests.** `tests/unit/memory-appraisal.test.ts` (fixture-value equivalence,
ID invariance, semantic equivalence across wordings, monotonic
confidence/importance scaling, target specificity Jonas-vs-Mara, appraisal
removal, stacking cap, safety-override dominance),
`tests/integration/memory-ablation.test.ts` (B1/B2 still measurably distinct).

## Finding 7 — Individuality-test hardening

**Design.** Two labeled trace modes (`src/shared/traces.ts`,
`src/sim/traces.ts`): CONTEXT-RICH (real NPC ids, full context, explicit
"unsuitable for role-independent measurement" note; browser export and the
reproducible deterministic batch) and BEHAVIOR-ONLY (no names, no
meal-owner/commitment-role facts, no trait names/biography/memory prose, no
scenario ID or seed, injuries banded — the identifying scripted 550_000 no
longer appears — and generalized flags only: `resource-conflict-present`,
`obligation-present`, `other-agent-injured`, `meal-gone`). The seed-derived
label permutation was deleted; the sim core contains no blinding logic at all.
Blinding maps are generated with `node:crypto` rejection-sampled shuffles in
`scripts/evaluation/individuality.ts` (outside the ESLint/validate purity
boundary) and injected as parameters; reviewer packages carry opaque session
and agent labels only, and the label→NPC + session→scenario mapping exists
solely in the separate answer key written only under `--answer-key`.

Role counterbalancing: the engine's tick-0 wiring is parameterized by a
`RoleAssignment` (`src/sim/scenarios/roles.ts`) — bench worker/creditor,
promise debtor, meal owner/injury target — with `V1_ROLES` as the default on
every v1.0 path; the default is proven byte-identical to v1.0 (world hash,
ledger hash, and full canonical stream). The evaluation harness
(`src/sim/evaluation/individuality.ts`, `individuality-eval-1.0.0`) runs all
six permutations per scenario (each identity in each role exactly twice),
reuses the same engine and action vocabulary, and never enters the v1.0
report. Incidental generalizations required by role wiring: the ask-help
healer target is now derived from treatment capability (identity data) rather
than a hardcoded name, and the commitment ID derives from the role pair
(default `cmt-jonas-relieves-mara`, unchanged); `npm run validate` cross-checks
scenario data against `V1_ROLES`.

**Files.** `src/shared/traces.ts`, `src/sim/traces.ts`,
`src/sim/scenarios/{roles,initialState}.ts` (roles new),
`src/sim/evaluation/individuality.ts` (new),
`scripts/evaluation/individuality.ts` (new), `src/sim/runtime/{engine,host}.ts`,
`src/sim/actions/affordances.ts`, `src/sim/{batch}.ts`,
`src/sim/validation/validateData.ts`, `package.json` (`eval:individuality`).

**Tests.** `tests/unit/traces.test.ts` (no name/trait/role/scenario/seed
leakage, injury banding, injected-blinding independence from the seed,
generalized flags only), `tests/unit/individuality-eval.test.ts` (six distinct
permutations, 2×2×2 balance, byte-identical default proof, rotated-role
rewiring, eval-version separation).

## Continuous integration

`.github/workflows/ci.yml` (push/PR): `npm ci`, typecheck, lint, validate,
`test:run`, build, Playwright install + e2e, `batch --runs=10`; artifacts
uploaded; any failing required command fails the workflow. Dependency caching
only. `.github/workflows/deterministic-batch.yml`: weekly + manual 100-run
batch with artifact upload.

---

## Deviations from the remediation brief, and why

1. **Actor's own action/location/transit excluded from the hard dependency
   fingerprint** (brief §5.5 lists "Current action and interruptibility" and
   "Actor location or transit state"). Including them makes §5.7 unsatisfiable:
   the provisional fallback action (or any continued activity) would change the
   actor's own fingerprint and permanently invalidate the very request it
   bridges, so no late response could ever be accepted or preempt an
   interruptible action. The actor's own occupancy is enforced authoritatively
   by the gate's dedicated `actor-busy-noninterruptible`/transit/continue
   checks; the actor's own incapacity and injury/treatment status remain in
   the fingerprint.
2. **Scenario expectation codes warn instead of hard-rejecting at import**
   (brief §7.4 step 6). Structural invariants (meal-once, exclusive
   reservations, promise consistency, single outcome, terminal state,
   rejected-action immutability) hard-reject; expectation codes encode the
   frozen v1.0 provider's behavior, and a genuine ledger from the async or a
   future external provider may legitimately differ without being corrupt.
3. **`finalStateHash` replaced rather than aliased** (§8.3 allowed either).
   An alias with silently different semantics is exactly the ambiguity the
   audit prohibits; the format-version gate makes the break explicit.
4. **Schema/type cross-check instead of zod inference** (§7.2 allowed either).
   Inference would widen `NpcId`/`ActionMode`/... to `string` in the reducer's
   exhaustive switch — the audit itself flags this risk.
5. **No trait-product appraisal arithmetic** (§10.3 examples). Trait sets are
   frozen and disjoint per NPC; theme/target/confidence/importance scaling
   delivers every required generalization property without touching frozen
   identity data.
6. **Supersession precedes TTL expiry under normal cadence.** With
   `DECISION_REQUEST_TTL_TICKS` equal to the 60-tick re-evaluation interval, an
   unanswered request is usually superseded by a fresh one; pure TTL expiry
   covers NPCs that stop deciding (incapacitated, no affordances) and scenario
   end. Both are explicit recorded outcomes; timeouts never block anything.
7. **Scenario F's outcome changed** (unavoidable consequence of §6.2's
   requirement that the fallback share the constraint layer). Documented above
   with the v1.0 baseline for comparison; scenario data and pre-registered
   purpose unchanged; new baseline pinned by test.

## Adversarial review of the remediation itself

A two-pass adversarial review (8 finder dimensions, then refutation
verifiers on every deduped finding; 26 agents total) ran over the remediation
commit. 11 findings survived adversarial verification and were fixed with
regression tests (`tests/integration/review-regressions-2.test.ts`,
`tests/integration/golden-hashes.test.ts`, plus additions to the traces and
individuality-eval suites); 7 were refuted with grounded rebuttals; 12
low-severity unverified candidates were triaged as non-blocking.

Confirmed and fixed:

1. **Response-payload poisoning** — an externally submitted (and correctly
   rejected) response with gateway-internal score IDs was recorded verbatim in
   `DecisionResponseReceived`, whose score schema was stricter than the
   protocol boundary, making the run's own export un-importable while the
   worker acked success. Fix: the Received event's score records tolerate
   opaque bounded IDs (consistent with its deliberately loosened sibling
   fields) and both layers bound score/component array sizes (≤64).
2. **Interrupt-in-transit lifecycle** — actions interrupted while still in
   their moving phase (scenario end, injury worsening) have no
   `ActionStarted`; the import validator rejected such genuine ledgers. Fix:
   the validator tracks `MovementStarted` and accepts `ActionInterrupted` for
   in-transit actions (completions still require a start).
3. **Positional identity leak in blinded traces** — traces were emitted in
   fixed NPC order, so array position itself was the answer key. Fix:
   emission order follows the assigned labels.
4. **Non-preemptible provisional bridges** — constraint-mandated fallback
   choices (survival eating, care-seeking) are generated non-interruptible,
   which would have locked a deferred provider out for their whole duration.
   Fix: provisional bridge actions launch with `interruptible: true` (only
   the launched descriptor; the recorded offer is untouched), so a valid late
   response can displace them once the (never-preempted) travel leg ends.
5. **Mid-tick-transient fingerprints** — requests created inside the decision
   phase snapshotted other NPCs' momentarily-absent actions, making the
   fingerprint unreproducible at the drain point and permanently staling
   valid responses. Fix: the fingerprint covers DURABLE dependencies only
   (meal, bench, task, commitments, transfer requests, injuries/treatment/
   incapacity); transient activity is enforced by the acceptance-time and
   arrival-time validation gates. This changed `DecisionRequested` payload
   bytes, so the canonical ledger hashes below were re-baselined once
   (world-state hashes are byte-identical, proving behavior unchanged).
6. **No golden pin** — hash-projection changes could re-baseline silently.
   Fix: `golden-hashes.test.ts` pins all fourteen published hashes.
7. **Provisional trace-sample consumption** — the later accepted decision was
   dropped from traces. Fix: provisional rows no longer consume the pending
   sample; both rows are emitted.
8. **Roles not threaded into reconstruction** — replay and the trace fold
   rebuilt rotated eval runs on a V1-roles initial state. Fix: `replayLedger`
   and both trace builders take a role assignment (default `V1_ROLES` keeps
   every v1.0 caller byte-identical), the reducer takes `scenarioVersion`
   from the `ScenarioStarted` payload, eval replay round-trips are under test
   for all six permutations, and `buildLedgerFile` refuses rotated runs with
   `export-requires-v1-roles` (the file format records no role assignment).

## Final command results (remediation release 1.1.0)

Each command below was actually run and passed — first in the working tree
during development, then again end-to-end from a CLEAN CLONE of the final
commit (`git clone` → `npm ci` → all commands), on Windows 11 / Node v24:

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (ESLint + Prettier) |
| `npm run validate` | PASS — 0 errors, 0 warnings |
| `npm run test:run` | PASS — 31 files, 224 tests |
| `npm run test:e2e` | PASS — 9 tests (Chromium) |
| `npm run build` | PASS |
| `npm run batch` (100 runs/scenario) | PASS — hashes stable, complete event streams stable, 0 invariant violations, all replays match |
| `npm run test:e2e:install` | PASS |
| `npm run eval:individuality -- --scenarios=A --answer-key` | PASS — 6 sessions, balance 2/2/2 per identity/role |

## Scenario hashes after remediation (batch of 100 runs each)

| Scenario | Outcome | Events | `worldStateHash` | `canonicalLedgerHash` | Replay |
| --- | --- | --- | --- | --- | --- |
| A | 100.00% completed, meal=rin, promise fulfilled | 5715 | `8bf6de492261aa78` | `2b37e828af8d8b30` | match |
| B1 | 100.00% completed, meal=rin, promise fulfilled | 5715 | `7e06428489f9020f` | `7db80afdf2565999` | match |
| B2 | 95.61% deadline-missed, meal=rin, promise fulfilled | 5957 | `19f9352327928f64` | `7e7bfb303b11655f` | match |
| C | 100.00% completed, promise fulfilled-after-renegotiation, treatment jonas→rin @1020 | 5779 | `dc9e39d03bbdf240` | `a155bf545ed70250` | match |
| D | 92.75% deadline-missed, meal=rin, promise fulfilled, 1 rejected action | 5906 | `f1837eb45f154f26` | `ce705feae7451f0a` | match |
| E | 100.00% completed, meal=none (removed), promise fulfilled, 1 rejected action | 5733 | `72c9d8d32e575df8` | `0da42ae4ea8cf2f0` | match |
| F | 100.00% completed, promise broken, 127 provider failures, fallback care-seeking | 6139 | `099557a99bde1fb4` | `36daff45eae4fcd3` | match |

Hash values are re-baselined by definition (new hash semantics, new lifecycle
events shift every event ID); the behavioral signatures the v1.0 experiment
pre-registered are unchanged except Scenario F's documented fallback-policy
correction: A/C/D/E event timelines (treatment 780→1020, renegotiation
accepted, D refusal + stale-relieve rejection, E meal-missing rejection) and
the B1/B2 ablation deltas (2169 vs 960 work ticks, 0 vs 2 break requests)
match the v1.0 baselines exactly.
