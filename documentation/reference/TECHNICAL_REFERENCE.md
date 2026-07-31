# Technical Reference — The Last Meal (`causal-npc-lab`)

This document is the engineering contract that previously lived in the project
README. The README is now the plain-language front door; the normative
technical statements were moved here **unchanged in meaning**. Milestone-level
detail lives in the briefs and reports under `documentation/` (see the
README's documentation map).

Implementation release: **1.8.0**. Frozen experiment identity: **Vertical
Slice 001 — v1.0**, configuration version `vs001-1.0.0` (frozen identifiers
never change with the package).

---

## Compatibility break: ledger format 2

Ledger exports are format version 2 (`worldStateHash` +
`canonicalLedgerHash`, event schema 2, worker protocol 3). Version-1 exports
are rejected at import with an explicit `unsupported-format-version` error —
never silently reinterpreted. Re-export from a current run instead.

## Operator console reference

`npm run dev` starts the Vite dev server (open the URL it prints; the port
is not fixed). The page is a single desktop-oriented operator console:

- **Scenario & run control (top bar):** select one of the seven scenario
  configurations (A, B1, B2, C, D, E, F), then Start / Pause / Resume / Step
  (×1/×10/×60/×300 while paused or idle) / Reset. Speeds 1×, 5×, 20× are
  simulated seconds per wall-clock second; they never change outcomes. _Run
  to completion_ finishes the scenario immediately; _Run all scenarios_
  executes the full in-browser batch in the worker (with replay
  verification).
- **Export / import / replay:** _Export ledger_ downloads the completed
  run's JSON ledger. _Import ledger…_ opens a file picker; the file is fully
  validated before it is accepted (schema, versions, ordering, IDs, hash)
  and a rejected file changes nothing. _Replay imported_ / _Replay latest_
  fold the reducer over the recorded events — no decision provider runs —
  and report both hash comparisons in the global panel. _Export traces_
  downloads the context-rich diagnostic traces (behavior-only reviewer
  packages come from `npm run eval:individuality`); _Export batch report_
  downloads `batch-report.json` + `batch-report.md` after a batch.
- **Validate configuration** runs the same shared validation rules as
  `npm run validate`'s data layer, inside the worker.
- **Viewport:** orthographic Three.js tabletop with the four locations,
  three primitive NPCs (box Mara, sphere Jonas, cone Rin), meal marker,
  purifier progress bar, and injury rings. Click an NPC (or use the
  inspector tabs) to inspect logical state, current decision, confidence,
  reason code, beliefs, memories, and relationships. _Decision scoring_
  toggles the per-affordance score decomposition; _Event log_ toggles the
  collapsible typed-event panel (with a "tick noise" filter).

## Architecture enforcement: one pure core, two hosts

```text
DOM operator command
        ↓ typed, versioned, sequence-checked worker command (zod-validated)
Simulation Web Worker (src/worker)          Node headless runner (scripts/, tests/)
        ↓                                        ↓
        └────────── src/sim — pure TypeScript simulation core ──────────┘
                    events + read-only presentation snapshots
        ↓
Main thread: Three.js renderer + DOM inspectors (read-only)
```

- `src/sim` and `src/shared` import **no** Three.js, DOM, WebGL, Vite,
  browser storage, or worker APIs. This is enforced three ways: ESLint
  restricted imports/globals, the `npm run validate` import scan, and the
  fact that the entire unit/integration suite and batch runner execute the
  core directly under Node.
- The browser worker (`src/worker/simWorker.ts`) and the Node runner both
  drive the same `SimulationHost` through the same command semantics
  (`src/worker/commandProcessor.ts`), covered by an explicit command-parity
  test over **all seven scenarios** (world hash, ledger hash, complete
  canonical stream, final summary, with real pause/resume markers mirrored on
  both paths) plus a deferred-provider parity case (re-audit finding 4).
  Scenarios, providers, event definitions, the reducer, replay, and hashing
  are literally the same modules in both hosts.
- Canonical state mutates in exactly one place: the event reducer
  (`src/sim/events/reduce.ts`). The engine emits typed events; replay folds
  the same reducer over the recorded ledger, which is why replay is exact.
- The main thread renders snapshots and issues typed commands; it can not
  touch canonical state. Meshes carry only stable entity IDs for picking.

## Determinism specifics

- Canonical time is an integer tick count (1 tick = 1 simulated second;
  scenarios run 2700 ticks). Wall-clock time paces the worker only — a
  throttled/backgrounded tab catches up in whole ticks with identical
  outcomes.
- All canonical quantities are exact integers: normalized values in **micro
  units** (1.0 = 1,000,000), purifier progress in **repair units**
  (120,000 = 100%, so the fixed rates are exactly 20/14/7 units per tick).
- Canonical serialization: objects with sorted keys, arrays in order,
  integers only (floats/undefined/Map/Set/class instances are rejected
  loudly). Hash: FNV-1a 64-bit over the UTF-8 bytes, identical in browser and
  Node (`src/sim/replay/`).
- **Two hashes** (remediation 4): `worldStateHash` is a semantic projection
  of consequential state only — provider confidences, reason codes, fallback
  flags, and every counter-minted identifier (event/action/request/signal
  IDs) are excluded, with their behaviorally relevant content projected
  directly (memories by content + appraisal, transfer requests by parties,
  actions by mode/target/timing). Two decision sources producing the same
  consequential world get the same `worldStateHash` even if their diagnostics
  or emitted event counts differ. `worldStateHash` is **terminal-only by
  contract** (re-audit finding 3): hashing a nonterminal state throws,
  because live pending-decision transport (authorized provider,
  response-deduplication history, the stored dependency fingerprint) is
  deliberately outside the projection; a live decision-state fingerprint will
  be built when a consumer exists. `canonicalLedgerHash` covers the complete
  canonical event stream (IDs, types, ticks, actors, targets, causation,
  correlation, exact payloads) with pause/resume markers and raw `seq`
  excluded — canonical event IDs come from a marker-independent counter, so
  they are the pause-invariant ordering witness. Diagnostics DO affect the
  ledger hash (they are audit history); they never affect the world hash.
- **Import is all-or-nothing** (remediation 3; semantic cross-checks added by
  re-audit finding 2): exact per-event payload schemas
  (`src/sim/events/eventSchemas.ts`), ordering/reference integrity
  (causation, correlation, action and decision lifecycle references),
  semantic cross-checks (file metadata reconciled with the ScenarioStarted
  payload; per-type envelope actor/target reconciled with payload identities;
  the full decision lifecycle joined accepted/rejected → received → requested
  with offered-set membership and provider authorization incl. the fallback
  carve-out; accepted proposals must launch exactly the offered descriptor;
  `MODE_TO_CATEGORY` agreement), a full isolated replay, structural
  invariants, and recomputation of both hashes and every summary field — all
  before a file is accepted. Scenario expectation codes are reported as
  warnings, not rejections (a genuine ledger from a different provider may
  legitimately differ behaviorally). A forger must produce a fully
  lifecycle-coherent file, not merely recompute two hashes — though this
  still proves internal consistency, not authorship; cryptographic signing is
  out of scope.
- A seeded RNG (`src/sim/rng`) is the core's only permitted randomness
  source. This slice's deterministic provider consumes none; any future draw
  must record its outcome as an event to keep replay reducer-only.
- Operator pause/resume markers are recorded in the ledger but draw IDs from
  a separate counter and never advance the canonical state version, so
  pausing and stepping can never change outcomes or hashes (this is under
  test).

## Where the fixed data lives

| Data                                                                  | Module                              |
| --------------------------------------------------------------------- | ----------------------------------- |
| Fixed experiment values (time, needs, repair, injury, treatment, commitment terms, relationship deltas, thresholds) | `src/sim/config.ts`                 |
| Identity cards, seed memories                                          | `src/sim/domain/identities.ts`      |
| Scenario definitions (IDs, versions, seeds, scripted events, expected invariants) | `src/sim/scenarios/definitions.ts`  |
| Decision weights and scoring constants (incl. the generic memory-appraisal theme weights, derived so confidence×importance scaling at the frozen fixture appraisals reproduces the v1.0 constants exactly; derivation documented inline) | `src/sim/decisions/weights.ts`      |
| Presentation coordinates (display-only)                                | `src/shared/viewConfig.ts`          |

## The decision lifecycle (remediation 1)

The simulation clock never awaits a provider. "Asynchronous" means a response
can be submitted on a later logical tick through a separate command — never a
`Promise` inside canonical code.

```text
Decision opportunity (idle NPC / relevant change / 60-tick cadence)
        ↓
Generate concrete affordances (full physical menu, violations flagged)
        ↓
Create immutable DecisionRequest  →  recorded in DecisionRequested
  (requestId, expiry, worldRevision, hard dependency fingerprint,
   complete offered-affordance descriptors)
        ↓
Local provider: response on the same tick
Deferred provider: request stays pending (replayable canonical state);
  the NPC continues its current action, or an idle NPC acts on the
  provisional deterministic fallback immediately
        ↓
Response arrives (same tick, later tick via the tick-scheduled test
  provider, or externally via the `submit-decision-response` command;
  external responses drain at ONE fixed point inside stepTick, so
  outcomes are independent of operator tick-batch sizes)
        ↓
THE acceptance gate (single path for every response):
  unknown/superseded/already-expired request? wrong NPC/scenario?
  UNAUTHORIZED PROVIDER? (response.providerId must be the provider the
    request named; the engine-owned fallback is the one explicit,
    non-spoofable exception — re-audit finding 1)
  duplicate? expired? unoffered affordance?
  hard dependency fingerprint changed? provider-independent constraints?
  actor busy/non-interruptible/in transit? action still valid?
        ↓
DecisionResponseAccepted (may preempt only an interruptible action)
  or DecisionResponseRejected with a structured reason
```

- **`worldRevision`** is a monotonic counter that advances only for events
  that change action legality, decision context, or future behavior — never
  for decision bookkeeping, diagnostics, or pause markers. It is recorded on
  every request for audit; acceptance is gated on the **hard dependency
  fingerprint** instead, because needs drift every tick would otherwise make
  every delayed response stale.
- **Hard dependency fingerprint**
  (`src/sim/decisions/dependencyFingerprint.ts`): a canonical hash over meal
  existence/ownership, bench occupancy, task completion, commitments and
  proposals, pending transfer requests, every NPC's
  injury/treatment/incapacity, and OTHER NPCs' locations and actions. The
  actor's own location/transit/current action are excluded (own occupancy is
  enforced by the gate's interruptibility checks; otherwise the provisional
  fallback would permanently invalidate the request it bridges). Soft inputs
  (hunger, fatigue) are excluded by design and bounded by expiry plus the
  constraint/validation gates.
- A new decision opportunity **supersedes** an outstanding request;
  unanswered requests **expire** after 60 ticks
  (`DECISION_REQUEST_TTL_TICKS`) or at scenario end. Every transition is a
  typed event, so pending-request state is fully replayable. An engine-owned
  **resolved-request registry** (re-audit finding 5) keeps requestId →
  accepted/expired/superseded, so a late response to ANY past request is
  rejected with its true reason (`superseded-request`, `response-expired`)
  instead of collapsing to `unknown-request`; the registry is a pure
  projection of the event stream (`rebuildResolvedRequests`), never canonical
  state.
- Run `npx vitest run tests/integration/async-lifecycle.test.ts` for the
  simulated asynchronous suite (responses after 1/5/30 ticks, never,
  duplicated, out of order, unoffered, across world changes — all scheduled
  by logical tick, never wall clock).

## Provider-independent constraints (remediation 2)

Survival overrides and hard identity boundaries live in
`src/sim/decisions/constraints.ts` — one pure module consumed by the
deterministic provider (so forbidden choices are never scored), by the
fallback provider (so fallback choices are legal), and by the engine's
acceptance gate (authoritative: a hostile provider selecting an
offered-but-forbidden affordance gets `DecisionResponseRejected` with
`constraint-violation` + specific codes, no `ActionProposed`, and the
deterministic fallback continues the simulation). `eat-violation` remains
physically executable for NPCs whose constraints permit it — only Jonas's
boundary forbids it.

## How a future decision provider plugs in

Implement `DecisionProvider` (`src/sim/decisions/provider.ts`): receive a
structured `DecisionContext` and either return one **offered** affordance
ID + confidence + reason code + optional scores, or return
`{ deferred: true }` and submit a `DecisionResponse` later (worker command
`submit-decision-response`; the worker emits pending requests as
diagnostics-only `decision-request` messages — this build never forwards them
to any network). Every response passes the same acceptance gate regardless of
source; the world simulation never knows which provider decided. Provider
transport/SDK types stay outside `src/sim`; a model gateway belongs in a
separate Node process, never in browser code, and no API key may appear in
client code, committed files, storage, or exported ledgers.

## Model integration (milestone 001) — detailed contract

The first real external model condition: **Mara** can be driven by a language
model through a local server-side gateway while Jonas and Rin stay on the
deterministic provider. The model only ever selects among affordances the
engine offered; every response passes the same provider-binding, staleness,
constraint, and validity gate as every other decision source, and a completed
model-backed ledger replays to the same `worldStateHash` without the model.

- **Conditions** (engine-resolved; the browser can only name a registered
  condition, never a provider, prompt, or model):
  `deterministic-baseline-v1` (byte-identical to the frozen defaults) and
  `mara-model-per-decision-v1` (Mara → `openrouter-mara-action-v1`, one
  gateway call per genuine decision opportunity). Scenario F stays
  deterministic-only.
- **Gateway** (`gateway/`): exact envelope validation, context-hash
  recomputation, server-owned versioned prompt
  (`mara-action-selection-1.0.0`), and an explicit OpenRouter Responses
  adapter using the stateless `/api/v1/responses` route. Every paid request
  names one exact model slug and one exact provider slug, sends
  `require_parameters: true`, disables provider fallbacks, and opts into
  OpenRouter router metadata. The actual selected provider and opaque routing
  record are written to `routing/<requestId>.json` sidecars; they are
  noncanonical but recursively covered by the formal bundle manifest. The
  OpenRouter Responses API is beta, so one disposable live smoke request was
  executed on 2026-07-28 and passed before formal data collection.
  JSON-Schema structured output over a dynamic offered-ID enum, typed failure
  codes, per-run budget (80 calls) and single-flight concurrency, plus a
  process-wide spend cap across ALL runs (`MODEL_MAX_TOTAL_CALLS`, default
  400 — at the cap every call fails as a typed `budget-exhausted` before the
  adapter). **Origin + Host policy:** a present `Origin` header must be
  equivalent to the single configured browser origin
  (`ALLOWED_BROWSER_ORIGIN`; localhost/127.0.0.1/[::1] are interchangeable)
  and a present `Host` header must name a loopback host — anything else is a
  403 before any dispatch; an absent Origin stays allowed for loopback CLI
  clients and tests. **Idempotent replays:** a repeated POST for an
  already-seen `runId`+`requestId` with the same context hash replays the
  first terminal result (one adapter call, one trace row, one budget unit;
  the replay carries an `x-idempotent-replay` header), while the same request
  ID with different content is rejected as an `idempotency-conflict`.
  Artifacts per run under `artifacts/model-runs/<runId>/`: the raw JSONL
  gateway trace `model-trace.jsonl` (schema v2: explicit response/failure
  IDs, offered-affordance IDs, bounded raw model text on invalid-output and
  refusal outcomes), a write-once `run-manifest.json` seed, and the exact
  validated request envelope persisted as `requests/<requestId>.json` per
  dispatched request, plus `routing/<requestId>.json` whenever OpenRouter
  returns routing metadata. Since 1.5.0 the seed is written at FIRST SIGHT of
  a validated non-duplicate envelope (alongside the sidecar, before the
  adapter call), so `startedAtUtc` is first-validated-envelope time and even
  a gateway killed mid-adapter leaves a manifest; the seed's `modelSettings`
  additionally records the resolved process-wide cap (`maxTotalCalls`) and
  the request-body ceiling (`maxRequestBodyBytes`). The gateway process also
  shuts down gracefully on SIGINT/SIGTERM: in-flight requests drain, with a
  2-second force-close fallback, so a live gateway-stop is a deterministic
  drain-then-refuse rather than a hard kill.
- **Handshake pinning:** the browser client accepts a gateway only when
  `/v1/provider-config` advertises exactly the pinned experiment, condition,
  provider, prompt, and request-schema identifiers
  (`src/shared/modelExperiment.ts` is the single source of these literals). A
  gateway that answers with a different contract shows as `incompatible`
  (distinct from `unavailable`), latches for the run, and every request fails
  fast with a typed `invalid-gateway-response`. The client also reconciles
  every gateway result against the exact request it dispatched (identity
  fields + offered-affordance membership) before anything reaches the worker,
  and keeps a slim per-request client trace — identity, timing, and outcome
  for every external request it ever sees, including ones that never
  dispatched. Each v2 trace entry carries `gatewayResultObserved`: true only
  when the client parsed an HTTP result the gateway actually produced, false
  for client-minted failures (timeout, unreachable, budget, contract latch) —
  deliberately NOT the same fact as "a POST was attempted".
- **Exact-request archive (1.5.0):** before any dispatch decision — contract
  latch, budget, queue cap, connect — the client archives the complete
  prospective envelope for every request that passes the schema/Mara/provider
  filter, built by the same code path as the dispatched POST so the bytes
  cannot diverge. Requests that never reach the gateway (queue overflow,
  budget exhaustion, latched mismatch, gateway stopped) therefore still leave
  their exact model-facing payload in the run bundle. Identical duplicate
  requests coalesce; a differing duplicate poisons the archive with a
  recorded diagnostic and blocks export entirely.
- **Run bundle export (v2) + finalization:** when a model-condition run
  reaches terminal state, the model panel's _Export run bundle_ button
  downloads `model-run-bundle-<runId>.json` (bundle schema version 2) —
  terminal handoff facts (run/condition/scenario/provider/prompt identifiers,
  terminal hashes, call counters, `runCompletedAtUtc`), the slim client
  trace, AND the exact-request archive (`exactRequestEnvelopes` +
  `archiveDiagnostics`): a version-2 bundle preserves the exact bytes of
  every client request the run ever produced, dispatched or not. The export
  button enables only for a terminal, settled run whose run-complete receipt
  was stamped and whose archive is unpoisoned, and the assembled bundle is
  producer-validated (every envelope parses, carries the pinned contract
  literals, recomputes its context hash, and covers exactly the current run's
  trace) before a single byte is downloaded. `npm run model:prepare-run`
  fully validates and copies the exported ledger and bundle into the
  gateway's run directory, and `npm run model:finalize` joins the sources per
  request into `finalized-trace.jsonl`, `run-manifest.final.json`,
  `model-summary.json`, and a hash-linked `bundle-manifest.json` with an
  aggregate bundle hash. Finalized rows point at the once-per-source
  envelopes (gateway sidecar path, client bundle index, canonical sha256)
  rather than embedding another copy.
- **Finalized-trace event semantics (schema v3, release 1.6.1):** every
  `finalized-trace.jsonl` row (`finalizedTraceSchemaVersion: 3`) separates
  the three lifecycle stages the old single field conflated, as three
  canonical event-ID fields: `engineSubmissionEventId` — the
  `DecisionResponseReceived` or `DecisionProviderFailed` event that entered
  the engine, always the same event as `logicalSubmittedTick` and co-null
  with it; `responseVerdictEventId` — the `DecisionResponseAccepted` or
  `DecisionResponseRejected` verdict on THIS row's response, keyed by
  responseId; and `engineResolutionEventId` — the single canonical request
  resolution (`DecisionResponseAccepted`, `DecisionRequestExpired`, or
  `DecisionRequestSuperseded`), keyed by requestId — never a Received,
  ProviderFailed, or Rejected event. In an accepted row, verdict and
  resolution are the same acceptance event; a rejected row's request may
  resolve later (expiry), earlier (a late response to an already-superseded
  request), or through a DIFFERENT response's acceptance — the row keeps
  `engineOutcome: 'rejected'` in every one of those shapes, because the
  ladder puts the row's own verdict first, while `engineResolutionEventId`
  names whichever event terminally resolved the request. A null
  `engineOutcome` beside a non-null `engineResolutionEventId` is also legal,
  but only for a row whose own response carries NO verdict at all while the
  request was resolved by an acceptance of a different responseId (the
  moot-after-resolution family) — never for a row that was itself rejected.
  The raw gateway trace stays schema v2; only the derived finalized trace
  advanced.
- **Strict is the default; degraded is explicit and archival-only:**
  `model:finalize` writes `status: 'completed'` only when every strict
  criterion holds — full ledger validation, client bundle present, every
  engine-emitted request covered by exactly one client trace entry and one
  archived envelope, gateway evidence (trace row + sidecar deep-equal to the
  client envelope) for every request whose client observed a gateway result,
  exactly one engine resolution (`accepted`/`expired`/`superseded`) per
  request, no orphan ids, and non-decreasing run timestamps. Missing optional
  evidence makes strict mode exit nonzero and write NOTHING;
  `--allow-degraded` archives such runs as `status: 'degraded'` with the
  failed criteria recorded in the manifest — useful for preserving a run that
  lost its browser bundle, never citable as formally complete (the live
  acceptance report rejects degraded runs). Contradictions between present
  sources stay fatal in BOTH modes, and a `completed` final manifest is never
  overwritten by a degraded one without explicit operator deletion. The
  commit is Windows-safe and interruption-detectable **rather than atomic**
  (true multi-file atomicity is unattainable and is not claimed): everything
  is computed first and staged on the same volume, the derived files are
  renamed into place one at a time (retrying on Windows `EPERM`), and
  `bundle-manifest.json` is deleted first and written LAST — so a run
  directory without a bundle manifest is an unambiguous not-finalized
  signal, and re-running `model:finalize` is the remedy.
- **Run timestamps (non-decreasing, never asserted distinct):**
  `startedAtUtc` is the gateway's first-validated-envelope time (NOT run
  start; excluded from ordering checks); `runCompletedAtUtc` is the browser's
  receipt of the worker's authoritative run-complete message (named
  distinctly — `completedAtUtc` remains the per-request client-trace field);
  `exportedAtUtc` is bundle-build time at the export click; `finalizedAtUtc`
  is stamped by the finalizer. Strict finalization proves
  `runCompletedAtUtc <= exportedAtUtc <= finalizedAtUtc` — monotonic
  non-decreasing, with equality legal (millisecond timestamps measurably
  collide at Node speed).
- **Keyless rehearsal (`npm run model:rehearse`):** three complete Scenario A
  model-condition runs through the real modules — client, localhost gateway
  with the deterministic fake adapter on an ephemeral port, real bundle
  producer, prepare, STRICT finalize, full-validator import/replay: `normal`
  (every request answered and accepted), `gateway-stop` (gateway gracefully
  stopped after the first accepted response; every post-stop request fails
  typed, keeps its archived exact envelope, and the run still
  strict-completes), and `latency` (answers arrive more than 60 logical ticks
  late, exercising the supersede regime — superseded resolutions are complete
  evidence, and the run strict-completes). Writes `report.json` +
  `report.md` under `artifacts/model-rehearsal/`; exits nonzero on any
  failed assertion; never reads `.env.gateway` or any key.
- **1.5.0 scope notes (recorded amendment A8):** there is no version-1 bundle
  import path — no v1 bundle exists anywhere, so `model:prepare-run` and
  `model:finalize` hard-reject `bundleSchemaVersion: 1` with an explicit
  re-export message instead of shipping a legacy importer. Queue-overflow and
  client-budget exhaustion deliberately share the typed `budget-exhausted`
  failure code (splitting them would widen the frozen worker-protocol enum);
  tests distinguish the two paths by construction, not by artifact content.
- **Raw run artifacts are git-ignored:** everything under `artifacts/`
  (including `artifacts/model-runs/`) is regenerated output and never
  committed; formal evidence lives in finalized, hash-linked bundles you
  archive yourself.
- **Failure lifecycle:** known gateway/model failures are reported through
  `submit-decision-failure` and recorded as `DecisionProviderFailed` plus an
  `external-failure` request expiry; the NPC continues on the provisional
  fallback and re-decides on the ordinary cadence. Gateway absence, timeouts,
  malformed output, duplicates, and stale responses never stop logical time.
- **Frozen baselines are untouched:** all fourteen golden hashes and the
  complete deterministic streams are byte-identical; the 100-run batch never
  starts a gateway; CI uses only the fake adapter and no secret.

### Live-milestone status

**The live milestone is COMPLETE.** The six-run formal sequence was executed
2026-07-29 → 2026-07-30 under experiment v1.2.0 at frozen SHA
`38026cc986f59e8526053417666c921826dd34e9` and PASSED — six of six runs,
every pre-registered threshold met, every acceptance criterion checked, with
sealed evidence archives; see
[`MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`](../milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md).
The earlier live traffic is also recorded there, not erased: the disposable
smoke test of 2026-07-28 (a failed first attempt, then a pass) and the
aborted formal sequence of 2026-07-29 under experiment v1.1.0 — Run 1
(deterministic baseline) passed, and Run 2 produced a valid,
strict-finalized artifact that fell below the pre-registered acceptance
thresholds under sustained upstream rate limiting, so that sequence was
aborted per the freeze protocol and stands as non-acceptance evidence.
Fake-adapter results are infrastructure evidence only and are never reported
as live results.

## Live-run operator setup and walkthrough

Prerequisites: Node.js 22+, npm, a Chromium-based browser, and an OpenRouter
API key with sufficient credits (live runs only — the fake gateway needs
none).

```bash
npm ci
cp .env.gateway.example .env.gateway   # fill in OPENROUTER_API_KEY, OPENROUTER_MODEL, and OPENROUTER_PROVIDER
npm run gateway:dev:fake               # keyless deterministic gateway, or:
npm run gateway:dev                    # live gateway (fails fast without key/model)
npm run dev                            # browser app; Vite prints the URL
```

The gateway rejects any browser `Origin` that is not equivalent to
`ALLOWED_BROWSER_ORIGIN` (default `http://localhost:5173`; localhost /
127.0.0.1 / [::1] are interchangeable, but the **port** must match) with a
403 that carries no CORS headers, so the model panel simply reads
`unavailable` — the same word it uses for a gateway that is not running. If
Vite prints a different port (5173 already in use), either free 5173 or set
`ALLOWED_BROWSER_ORIGIN` in `.env.gateway` to the origin Vite actually
printed and restart the gateway. Confirm the panel shows the gateway
connected before starting a paid live run.

The gateway URL is nonsecret configuration (`VITE_MODEL_GATEWAY_URL`, default
`http://localhost:8787`). **No secret may ever use a `VITE_` prefix**, and
the key exists only in the gateway process — the architecture validator and
the post-build dist scan (`npm run check:dist`) enforce both.

Walkthrough: in the _Model integration_ panel select
`mara-model-per-decision-v1` (this reloads the scenario under the condition),
run Scenario A at 1×, and watch the panel's call/acceptance/failure counters
and latency. When the run completes, export the ledger, replay it (_Replay
latest_) to verify the hash match, and press _Export run bundle_ to download
`model-run-bundle-<runId>.json`. Then:

```bash
npm run model:prepare-run -- --run-id <runId> --ledger <ledger-path> --bundle <bundle-path>
npm run model:finalize -- --run-id <runId>
```

`model:prepare-run` runs the complete ledger validator and validates the pair
against each other before copying anything into
`artifacts/model-runs/<runId>/`; `model:finalize` — STRICT by default — joins
client trace, exact-request archive, gateway trace, and engine lifecycle into
`finalized-trace.jsonl` + `run-manifest.final.json` and binds every file into
`bundle-manifest.json`, or exits nonzero having written nothing when a strict
criterion fails. Add `--allow-degraded` only to archive an incomplete run
(`status: 'degraded'`), which is never acceptable as milestone evidence
(`npm run model:summarize` is the informal, non-gating summary for
pre-finalization inspection; it refuses to run on an already-finalized
directory — re-run `npm run model:finalize` instead, which regenerates
`model-summary.json` and `bundle-manifest.json`). Follow the run discipline
in the
[implementation brief](../milestones/001-model-integration/briefs/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_BRIEF.md)
and the
[re-audit remediation brief](../milestones/001-model-integration/briefs/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_BRIEF.md)
(1× speed first; never pause awaiting the model; never edit the prompt
between a paired B1/B2 comparison; a fresh `runId` every run). An opt-in live
smoke test exists as `RUN_LIVE_MODEL_TESTS=1 npm run test:model:live` — it is
skipped by default and never runs in CI.

## npm command details

The README lists the commands with one-line descriptions. The commands with
substantial semantics:

- **`npm run batch`** — headless deterministic batch: every scenario, 100
  repeat runs each, replay verification, invariant checks, and **complete
  canonical event-stream equality** across repeats; writes `artifacts/`
  (ledgers, context-rich traces, report.json, report.md); exits nonzero on
  any violation. Use `-- --runs=N` to change the repeat count.
- **`npm run eval:individuality`** — role-counterbalanced individuality
  evaluation (separate from v1.0 results): all six identity-role rotations
  per scenario, blinded behavior-only reviewer packages in
  `artifacts/individuality-eval/reviewer/`. `-- --answer-key` also writes the
  separate answer key; `-- --scenarios=A,C` restricts scenarios.
- **`npm run model:prepare-run`** — copies the operator-exported ledger and
  browser run bundle into `artifacts/model-runs/<runId>/`
  (`-- --run-id <id> --ledger <path> [--bundle <path>]`). The ledger must
  pass the COMPLETE ledger validator (exact payload schemas, lifecycle joins,
  isolated replay, recomputed hashes, rebuilt summary) before anything is
  copied — schema parsing alone is never enough; with `--bundle` it also
  validates that ledger and bundle describe the same run. Any failure exits
  nonzero with no partial copy; version-1 bundles are rejected outright
  (re-export under 1.5.0+).
- **`npm run model:finalize`** — the formal finalizer
  (`-- --run-id <id> [--allow-degraded]`); see "Strict is the default" above
  for the complete contract.
- **`npm run model:summarize`** — the informal, non-gating summary
  (`-- --run-id <id>`): builds `model-summary.json` + `bundle-manifest.json`
  for a staged model run; it refuses to run on an already-finalized
  directory — re-run `npm run model:finalize` instead, which regenerates
  both files.
- **`npm run model:rehearse`** — the keyless formal rehearsal; see "Keyless
  rehearsal" above. `-- --ci` is the CI mode (clears the output root,
  `rehearsal-ci-*` run ids); `-- --out <dir>` redirects the output root.
- **`npm run m2:orchestrate`** — the Milestone 2 unattended sequence
  orchestrator (`-- --plan <path> [--resume] [--acknowledge-live-cost]
  [--allow-sleep-risk] [--headed]`). `--resume` IS the documented resume
  command (`m2:resume` is `m2:orchestrate -- --resume`), including the
  packaging-only recovery path for sequences that failed during evidence
  packaging. See
  [`MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md`](../milestones/002-sparse-cognition/phase-03-orchestrator/MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md)
  and the operator runbook
  [`MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md`](../operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md).

## Milestone 2 phase summaries

The README describes both phases in plain terms; the delivered property
lists are recorded here.

- **Phase 2 — laboratory foundation (release 1.7.0):** versioned behavioral
  fingerprints and deterministic similarity, the general study registry with
  study-local freezes, the affordance/interruption-contract auditors with
  the VS001 known-gap registry, blinded reviewer packages for validated live
  ledgers, and the `liveSmoke.ts` shutdown-race repair (report:
  [`MILESTONE_002_PHASE2_LABORATORY_REPORT.md`](../milestones/002-sparse-cognition/phase-02-laboratory/MILESTONE_002_PHASE2_LABORATORY_REPORT.md)).
- **Phase 3 — unattended orchestrator (release 1.8.0, brief §19):** one
  command runs a complete planned sequence — strict fixed ports, a fresh
  gateway child process and fresh browser context per attempt, paced runs
  through the real operator surface, automatic downloads, in-browser replay
  gates, strict finalization with Phase 2 evidence enrichment, atomic
  resumable sequence state, failed-attempt preservation, evidence secret
  scanning, and portable versioned evidence packaging with a packaging-only
  recovery path for late packaging failures. `npm run m2:rehearse`
  self-verifies the whole pipeline keylessly, including the gateway-stop and
  packaging-recovery drills; `m2:resume` is `m2:orchestrate -- --resume`
  (report:
  [`MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md`](../milestones/002-sparse-cognition/phase-03-orchestrator/MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md)).

## Continuous integration details

GitHub Actions (`.github/workflows/`).

**GitHub CI is the authoritative merge gate.** A change is mergeable only
when the `Required checks (clean checkout)` job is green on the pull request,
and the same job must be green again on `main` after the merge. Local runs
are preparation, never the verdict — CI runs from a clean checkout with no
cached build output, no secrets, and no model provider. (The gate is
repository policy: GitHub branch protection is a repository setting owned by
the repository owner and is not currently applied; the 1.5.0 implementation
report records the prepared `gh api` command.)

- **`ci.yml`** — on every push to `main`, every pull request, and on manual
  `workflow_dispatch`, from a clean checkout: `npm ci`, typecheck (app and
  gateway), lint, validate, Playwright browser install, unit/integration
  tests, gateway tests, the named formal model-artifact gate
  (`npm run test:model:bundle`), production build, gateway build, the dist
  secret scan, Playwright e2e, the FULL 100-runs-per-scenario deterministic
  batch (complete canonical event-stream equality), the keyless model
  rehearsal (`npm run model:rehearse -- --ci`), the affordance and
  interruption-contract audit, the Phase 3 orchestrator suite
  (`npm run test:m2`), and the complete keyless unattended-orchestrator
  rehearsal (`npm run m2:rehearse -- --ci`). The model rehearsal runs AFTER
  the batch deliberately: a failure in a newer step must never pre-empt the
  frozen determinism gate. Any failing required command fails the workflow.
  The workflow declares `permissions: contents: read` and a per-ref
  concurrency group that cancels superseded runs. Batch and Playwright
  reports upload as artifacts; the model-rehearsal evidence and the complete
  m2 rehearsal evidence (versioned sealed archive, `.sha256` sidecar,
  receipt, final evidence manifest, reports, control-root state, the failure
  drill, and the packaging-recovery drill's superseded archive 001 beside its
  recovered receipted archive 002) upload with `if-no-files-found: error` —
  an evidence artifact must fail loudly rather than pass green while
  uploading zero bytes. Dependency caching covers `node_modules` sources
  only — no generated output is ever cached as an authoritative input.
- **`deterministic-batch.yml`** — scheduled weekly and manually
  dispatchable: the same full 100-run batch, uploading ledgers and reports.

Note: the authoritative 100-run gate is the standalone `npm run batch`
runner. The Vitest suite carries a lighter in-suite batch check because long
CPU-bound batches inside a Vitest worker trip the runner's internal RPC
timeout on slow machines even with all tests passing.

## Implementation assumptions not fixed by the brief

Documented choices, all deterministic and centrally configured:

- **Speeds:** 1× means real time (1 simulated second per wall second);
  5×/20× scale that. _Run to completion_ processes ticks as fast as possible.
- **Time integration split:** uniform per-tick need drift is applied by the
  reducer for `TimeAdvanced`; discrete action effects are their own events;
  repair accrues via per-tick `RepairProgressed` events for the active bench
  worker.
- **Rest or wait variants:** low-intensity duties (`routine-work`,
  `deliver-materials`, `stay-at-cot`) are structured modes of the fixed
  category "Rest or wait" — the ten-category vocabulary is unchanged.
- **Perception:** the workshop is one room; all three NPCs perceive every
  significant event (the perception layer still exists so later slices can
  restrict eligibility). Beliefs are the only channel through which providers
  see social facts.
- **Initial knowledge:** pre-scenario memories and the initial
  common-knowledge beliefs (meal exists, Rin owns it, Jonas's promise) are
  scenario data baked into the initial state; everything from tick 0 onward
  is event-sourced.
- **Relationships:** initialized to 0 for all directed pairs; documented
  range is [-1, +1] (micro units, clamped). The +0.10 treatment consequence
  is applied patient→healer for any successful treatment (the brief specifies
  the Jonas→Rin case; this generalizes it consistently).
- **Ownership violation timing:** `OwnershipViolated` (kind
  `took-reserved-meal`) and the −0.25 relationship consequence commit at the
  moment the violator takes the reserved meal (start of the eat attempt) —
  the brief classifies the taking itself as the violation. Whether
  consumption then completes is recorded separately by `MealConsumed` with
  its `violation` flag.
- **Treatment location:** the Medical Cot, unless the patient is
  incapacitated, in which case treatment happens in place. An injured,
  conscious NPC seeks the cot via its survival layer.
- **Commitment semantics:** the relief is fulfilled when the debtor holds a
  continuous bench session with `runStart ≤ graceTick`, `tick ≥ startTick`,
  and duration ≥ 5 min (i.e. the session overlaps the promised window).
  Breach is recorded exactly once when the grace deadline passes without a
  qualifying session under the then-current (possibly renegotiated) terms.
- **Renegotiation:** the engine computes proposal terms deterministically
  (earliest feasible start after the care conflict, rounded up to a whole
  minute, original 2-minute grace span, unchanged minimum duration). The
  creditor accepts or rejects through her own recorded action; silence never
  counts.
- **Scenario E** omits the injury so stale-action handling is isolated; the
  scripted meal removal happens at tick 200 (after the eat decision ≈ tick
  180, before consumption begins ≈ tick 210). **Scenario F** keeps the
  standard injury so the fallback runs under pressure.
- **Fallback policy:** continue the current action if a continue affordance
  is allowed, else wait, else the lexicographically first allowed
  affordance — where "allowed" means it passed the shared
  provider-independent constraint layer (remediation 2). **Documented
  behavioral change from the v1.0 baseline:** in Scenario F, injured Rin's
  fallback decisions are now care-seeking (`ask-help`, `stay-at-cot`) instead
  of the former wait loop; see the remediation report for the before/after
  comparison.
- **Social actions** (requests, responses, proposals, help/break signals)
  take 30 simulated seconds and are abstract room-scale communication (no
  co-location required). A refused meal request imposes a 10-minute
  re-request cooldown.
- **Decision cadence:** NPCs re-decide when idle, when flagged by a relevant
  perceived event, and at most every 60 ticks while in interruptible actions;
  eating, treating, moving, and the scripted delivery are non-interruptible.
- **Pause markers** are informational ledger events (separate ID counter, no
  canonical effect), so the brief's pause-invariance requirement holds
  exactly.
- **Traces (remediation 7):** two distinct modes. _Context-rich_ (browser
  export, batch artifacts): real NPC ids, full structured context, explicitly
  labeled unsuitable for measuring personality recognition independently of
  role. _Behavior-only_ (reviewer packages from `npm run eval:individuality`):
  no names, no meal-owner/debtor/creditor facts, no scenario id or seed,
  injuries banded, generalized context flags only; actor and session labels
  come from a cryptographically random blinding map generated OUTSIDE the
  simulation core and never derived from the public seed. The label→NPC
  mapping ships only in the separate answer key (`--answer-key`). The
  role-counterbalancing harness (`src/sim/evaluation/individuality.ts`,
  version `individuality-eval-1.0.0`) rotates the three identities through
  the three structural roles (bench worker/creditor, promise debtor, meal
  owner/injury target) in all six permutations — each identity holds each
  role exactly twice — and stays entirely outside the v1.0 experimental
  report; the default assignment is proven byte-identical to v1.0.
- **"Six seeded scenario variants":** B1/B2 form one memory-ablation pair
  sharing a seed, giving seven runnable configurations (A, B1, B2, C, D, E,
  F).
- **Ledger imports** replay against the _local_ scenario definition (matching
  ID, version, seed, and config version are required); the file supplies only
  the events and expected hash.

## Dependency roles

Runtime: `three` (presentation only), `zod` (worker-message, config, and
imported-ledger validation). Dev: `vite`, `typescript`, `vitest` +
`@vitest/coverage-v8`, `@playwright/test`, `tsx` (Node runners), ESLint +
Prettier toolchain, `@types/three`, `@types/node`. No game engine, physics,
ECS, state manager, database, pathfinding, component library, or server
framework.
