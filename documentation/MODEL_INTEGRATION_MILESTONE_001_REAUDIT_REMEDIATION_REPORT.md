# Model Integration Milestone 001 — Re-Audit Remediation Report (1.4.0)

**Implements:** `documentation/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_BRIEF.md` (PR #3)
**Base commit:** `3f5aa06c84af226927928edcaa29ea5adb51d3f9` (milestone 001, tagged `v1.3.0`); brief landed on `main` at `5c0daf7`
**Final commit:** tagged `v1.4.0` (annotated tag on this release commit — a report cannot embed its own SHA; `git rev-parse v1.4.0` resolves it)
**Package version:** 1.3.0 → **1.4.0** · **Experiment:** `model-backed-npc-001` v `1.0.0` (unchanged)
**Frozen experiment:** Vertical Slice 001 v1.0 (`vs001-1.0.0`) — unchanged
**Versions:** SCHEMA 2 (unchanged) · LEDGER FORMAT 2 (unchanged) · PROTOCOL 3 (unchanged) · gateway trace schema 1 → **2** · client trace schema **1** (new) · run bundle schema **1** (new) · finalized trace schema **1** (new) · final manifest schema **1** (new)
**Prompt:** `mara-action-selection-1.0.0` (unchanged) · **External provider:** `openai-mara-action-v1` (unchanged)

This release makes the model-run artifact layer self-contained and auditable,
pins the pre-registered contract at the browser handshake, adds gateway
idempotency and origin/host enforcement, and delivers the formal
prepare/finalize pipeline — without touching any canonical event, ledger
byte, golden hash, or worker protocol shape. **The live milestone remains
open:** no live run has been executed, and
`MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md` is a PENDING
template.

## What was implemented, per brief section

### §5.1 / §8.1 — Gateway idempotency (reduced form)

Implemented in `gateway/server.ts`. Each run's budget state now carries a
`results` map keyed by `requestId`, holding `{contextHash}` plus either an
in-flight shared promise or the cached terminal `{statusCode, body}`. The
dispatch region was refactored into a value-returning
`dispatchDecision(envelope)` that owns the sidecar write, budget/spend-cap/
concurrency checks, the adapter call, identity-copying response
construction, and the trace write; the HTTP handler serializes the terminal
result per waiter. Lookup happens AFTER full validation and BEFORE any
budget/concurrency accounting:

- duplicate with the SAME `contextHash` — in-flight duplicates await the
  shared promise, completed duplicates get the cached result; no adapter
  call, no budget unit, no trace row, no sidecar write; the response carries
  `x-idempotent-replay: true` and a `console.warn` duplicate counter;
- the same `requestId` with a DIFFERENT `contextHash` — 400
  `{error: 'idempotency-conflict'}` (a same-id different-content submission
  is a forgery or bug, never a duplicate).

Retention is deliberately best-effort: the results map rides inside
`RunBudgetState`, so the existing 64-run FIFO evicts budget and idempotency
together, and a completion write-back never resurrects an evicted run (an
evicted run forgets its results — documented in a code comment).

### §5.2 / §8.2 — Origin enforcement (extended to Host)

`route()` in `gateway/server.ts` enforces, for ALL routes and before any
dispatch: a present `Origin` header must be equivalent to the configured
`allowedBrowserOrigin` (403 `origin-forbidden` otherwise), and a present
`Host` header must name a loopback host — localhost / 127.0.0.1 / [::1],
any port (403 `host-forbidden` otherwise; the Host check goes beyond the
brief). Equivalence lowercases scheme+host, strips trailing slashes, and
treats the three loopback hostnames as interchangeable when scheme and port
match; `gateway/config.ts` normalizes the configured origin on load. An
absent Origin remains allowed for loopback CLI clients and tests. The 403s
do not set `connection: close`, and the server-header comment now describes
what is actually enforced (the pre-1.4.0 comment falsely claimed origin
checking).

### §5.3 / §7.4 — Result-to-request reconciliation

`validateGatewayResultForRequest(result, request)` is a new pure function in
`src/sim/decisions/externalSchemas.ts`: a response must carry the dispatched
request's `requestId`/`npcId`/`scenarioId`/`providerId` and select an
affordance the request actually offered; a failure must match on the four
identity fields. It deliberately does NOT validate `responseId`/`failureId`
format — `gw-`/`gwf-` prefixes are one gateway's convention, not contract.
`ModelGatewayClient` runs it immediately after the result schema parses and
BEFORE any counter increments, on BOTH branches; a mismatch becomes a typed
`invalid-gateway-response` failure for the ORIGINAL request and the
mismatched identity is never forwarded to the worker.

### §6.1 — Client trace (slim — deviation D3)

`src/app/modelClientTraceRecorder.ts` (new): an in-memory recorder owned by
`ModelGatewayClient`, reset on `newRun()`. One entry per external request the
client ever sees — including queue-overflow and budget-exhausted requests
that never dispatched, gateway-unavailable and timeout failures,
contract-mismatch fast-fails, and results discarded by the stale-runId check
(`clientOutcome: 'discarded-stale-run'`). Entries
(`clientTraceSchemaVersion` 1) carry identity, `contextHash`, wall-clock
queue/dispatch/completion timestamps, client outcome/failure code,
response/failure IDs, and client latency — but NO request payload and no
secrets/environment (see deviation D3). Wall-clock values are noncanonical
diagnostics; joins are by `requestId`.

### §6.2 — Raw gateway trace v2 (name kept — deviation D1)

The raw gateway trace KEEPS its `model-trace.jsonl` name and gains schema
version 2 with additive fields: explicit `responseId` (`gw-<requestId>` on
responses) and `failureId` (`gwf-<requestId>` on failures),
`offeredAffordanceIds` from the validated envelope, and `rawModelOutput` —
the first 2048 characters of the raw model text, persisted ONLY on
`invalid-model-output` and `upstream-refusal` outcomes and null on every
other outcome including success. `AdapterResult`/`AdapterFailure` gained an
optional `rawOutput`; the fake adapter supplies it for its invalid-output and
refusal behaviors, and the OpenAI adapter captures refusal text and non-JSON
output text. The `ModelTraceEntry` type and all artifact schemas moved to
the new shared module `src/shared/modelArtifacts.ts` (pure types + strict
zod schemas, no node imports; six schemas: gateway trace row, manifest seed,
client trace entry, run bundle, finalized trace row, final manifest);
`gateway/tracing/modelTraceWriter.ts` keeps only the writer classes.
Additionally (brief §6, "exact validated request envelope"): after full
validation, every non-duplicate dispatch persists the exact validated
envelope as `requests/<requestId>.json` under the run directory
(`ModelTraceWriter.writeRequest`; `MemoryTraceWriter` stores them in a map
for tests). Duplicates and pre-validation rejects never write a sidecar.

### §6.3 — Finalized model trace

`scripts/model/finalize.ts` writes `finalized-trace.jsonl`
(`finalizedTraceSchemaVersion` 1) — a NEW file; the raw trace is never
overwritten (deviation D1). One strict-schema row per `requestId`, joining
the client entry (0..1), gateway rows (0..n; the last row wins with a note
when duplicates exist), and the engine lifecycle from the ledger:
`engineOutcome` accepted/rejected(+reason)/expired via the gw-filtered
response-id join, `logicalSubmittedTick` from `DecisionResponseReceived`
(responses that entered the engine) or `DecisionProviderFailed` (explicit
failures) and null when the result never reached the engine, plus
`engineResolutionEventId`. Instead of embedding the exact request payload,
each row carries `requestEnvelopeFile` pointing at the sidecar (deviation
D3). With a client trace present, an unexplained unresolved gateway response
row (no engine event AND no client discard/failure explanation) is a hard
error; without one it degrades completeness with a warning note.

### §6.4 — Finalized run manifest

The finalizer writes `run-manifest.final.json` (`manifestFinalSchemaVersion`
1, `status: 'completed'`) NEXT TO the gateway's write-once seed
`run-manifest.json` — the seed is never mutated. It contains the experiment/
condition/run/scenario identifiers, `scenarioVersion` + `seed` +
`configVersion` from the ledger, provider plan and provider IDs, prompt
version, `requestedModelId` (seed) and `returnedModelIds` (distinct non-null
model IDs actually observed in trace rows), model settings, start/finalize
timestamps, both terminal hashes, request/call/acceptance/rejection/token
totals, and a `completeness` object (`sources` ⊆ [gateway, ledger, client] +
notes). Any disagreement between present sources on run, scenario,
experiment, condition, provider, prompt, or hashes is a contradiction and
exits nonzero (deviation D2 governs ABSENCE of the client bundle). The
ledger-to-run binding comes solely from the client handoff (runId plus hash
equality): ledgers carry no runId, so with no client bundle completeness
`['gateway','ledger']` means the ledger's membership in the run is
operator-asserted, not proven — the finalizer records this as an advisory
completeness note, and additionally warns when the gateway trace and the
staged ledger share zero requestIds.

### §6.5 — Formal bundle

`bundle-manifest.json` now covers EVERY file in the run directory except
itself — ledger, `model-trace.jsonl`, `requests/*`, `client-bundle.json`,
`finalized-trace.jsonl`, `run-manifest.json`, `run-manifest.final.json`,
`model-summary.json` — with per-file SHA-256 hashes plus `aggregateSha256`
over the sorted `<fileName>:<sha256>` lines.

### §7.1 — Central registered contract

`src/shared/modelExperiment.ts` (new) is the single source of the experiment
literals (experiment ID/version, both condition IDs, target NPC, provider ID,
prompt version, model-condition scenario list). The previous homes became
import + re-export shims with stable public APIs:
`src/sim/decisions/conditions.ts` (re-exports its historical names and builds
`CONDITION_IDS` from the shared constants),
`src/sim/decisions/externalDeferredProvider.ts` (re-exports
`EXTERNAL_MARA_PROVIDER_ID`), and `gateway/prompts/maraActionSelection.ts`
(`PROMPT_VERSION = MODEL_PROMPT_VERSION`, keeping the version-and-text-change-
together comment). `src/app/modelGatewayClient.ts` and
`src/sim/decisions/externalSchemas.ts` import from the shared module rather
than from `conditions.ts`, dropping providers/scenarios from the browser
import graph. The gateway's manual identity-check literals
(`gateway/server.ts`) were replaced with the shared imports (same behavior,
same 400 codes). No duplicate literal of any of these values remains.

### §7.2 — Condition-specific validation (deviation D4)

Implemented as a plan-carried validator rather than a Mara-pinned schema at
the engine/worker boundary. `ProviderPlan` gained optional
`validateExternalRequest?(request): string | null`; `planForCondition` for
`mara-model-per-decision-v1` supplies one enforcing npcId `mara`, providerId
`openai-mara-action-v1`, and scenario ∈ {A, B1, B2, C, D, E};
`singleProviderPlan` (and the baseline condition) carries none. The engine's
deferral path runs it AFTER the existing generic-schema validation and
throws `external-request-condition-violation` on a non-null return — a path
unreachable in deterministic scenarios, hence hash-neutral. The worker
boundary keeps the generic schema only; `PROTOCOL_VERSION` stays 3.

### §7.3 — Provider-config handshake pinning

`/v1/provider-config` (and `/health`) now additionally advertise
`experimentId` and `conditionId`, so the payload is
`{status, experimentId, experimentVersion, conditionId, providerId,
promptVersion, requestSchemaVersion, modelId}`. The client's strict
`providerConfigSchema` was extended accordingly and `connect()` is
tri-state: `'ok' | 'unreachable' | 'contract-mismatch'`. Any advertised
field other than `modelId` differing from the pinned constants is
`'contract-mismatch'`; that verdict LATCHES for the current run (cleared by
`newRun()`) — every subsequent request fails immediately with the typed
`invalid-gateway-response` code through the existing `failRequest` path (so
`failedRequestIds` dedup applies) and the config endpoint is NOT re-polled
per request. `'unreachable'` keeps the 1.3.0 behavior (per-dispatch connect
retry, `gateway-unavailable`). The outgoing envelope's `promptVersion` is
now the pinned constant, never copied from the gateway-advertised value. The
model panel shows `incompatible (<field>)` distinctly from `unavailable`,
with the first mismatched field recorded in the client status for display.

### §9 — Operator workflow: bundle export, prepare-run, finalizer

- **UI (one button — see deviations):** the model panel gained _Export run
  bundle_, enabled only when the run is terminal AND the selected condition
  is the model condition. It downloads `model-run-bundle-<runId>.json`
  (`bundleSchemaVersion` 1): a `handoff` block (run/condition/scenario/
  provider/prompt/experiment identifiers, `worldStateHash` and
  `canonicalLedgerHash` from the existing terminal snapshot/store surface —
  null when genuinely unavailable — call/response/acceptance/failure
  counters, export timestamp) plus the slim client trace. No worker command
  or protocol message was added.
- **`npm run model:prepare-run -- --run-id <id> --ledger <path>
  [--bundle <path>]`** (`scripts/model/prepareRun.ts`, new): validates
  BEFORE copying — ledger parses against the strict ledger schema, bundle
  (when given) against the strict bundle schema, handoff runId === --run-id,
  ledger scenario === handoff scenario, ledger hashes === non-null handoff
  hashes — then copies the ledger (original filename kept) and the bundle
  (as `client-bundle.json`) into `artifacts/model-runs/<runId>/`. Any
  mismatch exits nonzero with NO partial copy.
- **`npm run model:finalize -- --run-id <id>`** (`scripts/model/finalize.ts`,
  new): strict-loads manifest seed, v2 trace rows, sidecars (each re-parsed
  with the envelope schema and its contextHash recomputed), the optional
  client bundle, and the ledger (the UNIQUE `ledger-*.json` in the run
  directory — zero, or two or more, is a hard error, never first-match;
  resolve ambiguity by removing the extra ledger from the run directory —
  the strict run-bundle handoff carries no filename designation); runs the
  consistency matrix; joins per
  requestId; writes the four output files; exits nonzero on any
  contradiction and prints a completeness + counts summary line on success.
  `model:summarize` stays as the informal, non-gating tool and shares its
  join/metric/hash helpers with the finalizer.
- `package.json` gained exactly the `model:prepare-run` and `model:finalize`
  scripts; nothing else in `package.json` changed besides version and
  description lineage.

### §10 — Metrics

- `model-summary.json` gains `requestedModelId` (seed manifest) and
  `returnedModelIds` (distinct non-null model IDs from trace rows) — the
  seed's single model ID is what was requested, not proof of what answered.
- `joinEngineOutcomes` now matches acceptances on the gateway RESPONSE id
  (same `gw-` filter the engine-lifecycle metrics use) instead of the bare
  requestId, so a non-model acceptance for the same requestId can never mark
  a model call accepted; v2 rows' explicit `responseId`/`failureId` are
  preferred over reconstructed prefixes.
- When a client trace is present the finalizer adds §10.1 client/engine
  demand metrics to the summary: requests emitted by the engine (ledger),
  seen by the client, dispatched to the gateway, and failed before dispatch
  (with a per-code breakdown). Upstream-activity and engine-lifecycle
  metrics keep their 1.3.0 sources (gateway trace / ledger); client-only
  failures are never counted as upstream calls.
- `bundle-manifest.json` gains `aggregateSha256`.

### §11 / §13.9 — B1/B2 ablation preflight

`tests/integration/model-ablation-context.test.ts` (new): using only public
1.3.0 APIs, both arms are advanced under the model condition to their first
external Mara request (asserting exactly one request, Mara, the registered
provider — guarding vacuous passes) with equal requestedAtTick and requestId
across arms; the criticism memory is identified structurally as the unique
B1 memory whose canonicalFact is absent from B2, proven to survive
truncation; B1's context minus that memory deep-equals B2's context with
memories compared as multisets keyed on canonicalFact (never by index);
the two envelope contextHashes differ (the ablation is visible to the
gateway's hash check) and truncationCounts are identical. A second test
sweeps BOTH full runs without submitting responses and proves every paired
request differs only in the criticism memory. The file documents that this
proves request-time snapshot cleanliness only — once model responses arrive
the arms legitimately diverge.

### §12 — Documentation

This report; the README header/lineage fix, new command rows,
bundle-export/origin/host/spend-cap/idempotency prose, the explicit
artifacts-git-ignored statement, the explicit live-milestone-pending
statement, and repaired links to both briefs (now on `main`); the PENDING
live acceptance template
(`MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`); and
additive-only corrections to the 1.3.0 implementation report (implementation
commit line; Known-limitations extension stating what the 1.3.0 artifact
layer actually lacked).

### §13 — Tests

New suites: `tests/gateway/gateway-idempotency.test.ts` (sequential
duplicate → one adapter call/one trace row/one budget unit/identical bodies/
replay header; concurrent duplicate via a slow adapter; idempotency-conflict;
eviction bound without resurrection),
`tests/integration/model-bundle.test.ts` (fixture-driven prepare/finalize:
success path with ledger-sourced submitted ticks and full completeness, the
contradiction matrix — runId/scenario/tampered sidecar/tampered hashes/two
ledgers/unexplained unresolved row — and the absence matrix including
finalization without a client bundle at completeness gateway+ledger),
`tests/integration/model-ablation-context.test.ts` (§11), and
`tests/integration/model-reconciliation-gap.test.ts` (documents, with the
engine UNCHANGED, that the acceptance gate accepts a schema-valid response
naming a successor request — the hole that client-side reconciliation F3
closes). Extended suites: `tests/unit/model-gateway-client.test.ts`
(per-field contract-mismatch latching with a config-fetch count that stays
at 1 across N requests, unreachable-vs-mismatch code separation, all three
reconciliation cases, mixed-run client-trace coverage incl. newRun() reset),
`tests/unit/provider-plan.test.ts` (plan validator accept/reject; baseline
and single-provider plans carry none; engine throw),
`tests/gateway/gateway.test.ts` (origin/host matrix incl. loopback
equivalence and zero-adapter-call 403s, ~4MB clean 413, spend cap, v2 trace
exactness, sidecar persistence, budget test on distinct requestIds,
prompt-injection test asserting the adapter actually ran), and
`tests/gateway/summarize-and-scan.test.ts` (v2 fixtures; the S2 gw-filter
regression). No test requires a live API key; `fileParallelism` stays false.

## Deliberate deviations from the brief (with rationale)

The four architectural deviations were decided at specification time and are
implemented exactly as specified:

1. **D1 — no trace-file rename.** The brief (§6.2/§6.3) renames the raw
   gateway trace to `gateway-trace.jsonl` and reuses `model-trace.jsonl` for
   the finalized join. A rename-then-reuse of an existing filename is a
   data-loss hazard: any tool, script, or operator habit that still reads or
   writes `model-trace.jsonl` would silently see (or clobber) a DERIVED file
   where raw evidence used to live, and a partially executed migration could
   overwrite the only raw record of a paid run. The raw trace therefore
   KEEPS its name (now schema v2), and the finalized join is the NEW
   `finalized-trace.jsonl`. A derived artifact never overwrites a raw one —
   the same reasoning gives the finalized manifest its own
   `run-manifest.final.json` beside the write-once seed.
2. **D2 — finalization does not hard-fail on a missing client bundle.** The
   brief implies a completed-run bundle requires the client trace (§13.1).
   But the client bundle is exported by a HUMAN from a browser; losing it
   (crashed tab, misplaced download) after a completed 45-minute paid live
   run must not render the run's gateway trace + ledger formally worthless.
   The cost of absence is more than lost metrics, and is recorded as such:
   the handoff is the ONLY artifact that binds the copied ledger to the run
   (ledgers carry no runId by frozen invariant), so without it the ledger's
   membership in the run is operator-asserted rather than proven, and the
   finalizer says so in advisory completeness notes (plus a warning when
   the gateway trace and the staged ledger share zero requestIds). The
   finalizer fails hard on CONTRADICTION between present sources, and
   degrades on ABSENCE: the final manifest records `completeness.sources`
   (e.g. `['gateway', 'ledger']`) with explanatory notes, and analyses can
   require full completeness where they need it.
3. **D3 — the client trace is slim; exact envelopes are gateway sidecars.**
   The brief (§6.1) wants the complete request payload in every client-trace
   entry. The GATEWAY already holds the exact validated envelope at the only
   moment that matters (it validated and hashed it before dispatch), so it
   persists each one as `requests/<requestId>.json`; duplicating multi-
   kilobyte payloads into a browser-memory trace adds redundancy and memory
   pressure without adding evidence — agreement is already provable through
   the recomputable `contextHash` chain (client entry == sidecar ==
   recomputed), which the finalizer enforces. The client trace records
   identity + timing + outcome, which is the part only the client can know.
4. **D4 — no Mara-pinned schema at the engine/worker boundary.** The brief
   (§7.2) wants a condition-specific request schema enforced at engine,
   worker, browser, and gateway. Pinning Mara literals into the engine or
   worker protocol would make the simulation core experiment-AWARE —
   exactly what the architecture forbids — and would have required worker
   protocol changes (PROTOCOL_VERSION is frozen at 3). Instead the
   condition-specific constraints ride as DATA on the ProviderPlan
   (`validateExternalRequest`), enforced by the engine generically after the
   generic schema; the browser client filters on the pinned constants, and
   the gateway enforces the registered identity checks. The generic schema
   remains the structural contract at the engine and worker.

Further deviations and brief-level differences, recorded explicitly:

5. **No separate `test:model:bundle` npm script or CI step** (brief §13.10/
   §15.1). The fixture-bundle gate exists as
   `tests/integration/model-bundle.test.ts` and runs inside the ordinary
   Vitest suite that CI already executes — a separate script would re-run
   the same cases and add a CI step for no additional coverage.
   `.github/workflows/ci.yml` is untouched in this release.
6. **Idempotency-test hazards addressed by construction.** A naive
   replay cache can silently neuter existing tests (a repeated envelope no
   longer reaches the adapter or the budget). The per-run budget test now
   uses DISTINCT requestIds (byte-identical repeats are replays by design),
   and the prompt-injection resistance test uses a distinct requestId AND
   asserts via an adapter-call counter that the hostile envelope really
   reached the adapter — a cache hit can never fake a pass. The old
   in-flight-duplicate `budget-exhausted` trace row no longer exists;
   duplicates add no rows.
7. **One export button instead of two** (brief §9.1 suggested _Export client
   trace_ + _Export run handoff manifest_). The handoff facts and the client
   trace are only ever consumed together by `model:prepare-run`, so they
   ship as ONE `model-run-bundle-<runId>.json` (schema-versioned handoff +
   clientTrace array) — one file to lose track of instead of two, and one
   atomic validation surface. Consequently `model:prepare-run` takes
   `--bundle` rather than the brief's `--client-trace`.
8. **Additions beyond the brief:** loopback `Host`-header enforcement and
   the process-wide `MODEL_MAX_TOTAL_CALLS` spend cap (default 400,
   documented in `.env.gateway.example`); the client-side contract-mismatch
   LATCH (the brief asked for refusal; the latch additionally prevents a
   config re-poll storm and is released only by `newRun()`).
9. **Naming detail:** client-trace entries record `requestedAtTick`
   (matching the engine request field) rather than the brief's
   `requestedAtLogicalTick` spelling; the schema version rides once on the
   recorder/bundle (`clientTraceSchemaVersion` 1 / `bundleSchemaVersion` 1)
   rather than on every entry.

## Verified findings driving this release

Per project practice, the remediation plan was adversarially reviewed before
implementation (independent finder agents; every finding independently
verified at Opus/xhigh effort). Eight findings survived verification; each is
addressed in this release:

1. **Trace rename is a data-loss hazard** — reusing `model-trace.jsonl` for
   the finalized join lets a derived file shadow or clobber raw evidence.
   → Deviation D1 (raw name kept; new `finalized-trace.jsonl`;
   `run-manifest.final.json` beside the untouched seed).
2. **Hard-failing finalization on a missing client bundle destroys completed
   paid runs** — a browser-export mishap would void self-consistent
   gateway + ledger evidence. → Deviation D2 (contradiction fails, absence
   degrades completeness).
3. **Full request payloads in the client trace are redundant** — the gateway
   already holds the exact validated envelope; browser-side duplication adds
   bulk, not evidence. → Deviation D3 (slim client trace + gateway sidecars
   + enforced contextHash chain).
4. **A Mara-pinned schema at the engine/worker boundary breaks engine
   agnosticism** and would force worker-protocol changes against the
   PROTOCOL 3 freeze. → Deviation D4 (plan-carried validator as data).
5. **A naive idempotency cache silently neuters existing gateway tests** —
   the per-run budget test and the prompt-injection test would pass via
   replays without exercising anything. → G3 test adjustments: distinct
   requestIds plus adapter-invocation-count assertions.
6. **The 1.3.0 413 path (`connection: close` + `req.resume()`) ECONNRESETs
   multi-megabyte uploads** — empirically clean up to 16MB once removed.
   → G4: respond 413 and let Node dump the body; regression test posts a
   ~4MB body and asserts a clean 413 with no socket error.
7. **The engine acceptance gate accepts a schema-valid response naming a
   SUCCESSOR request** (identity fields valid, affordance offered by the
   successor) — so client-side reconciliation is a required control, not
   defense-in-depth garnish. → F3 reconciliation before submission, plus
   `tests/integration/model-reconciliation-gap.test.ts` documenting the
   unchanged engine behavior that motivates it.
8. **`joinEngineOutcomes` could mark a model call accepted from a NON-model
   acceptance** sharing the requestId (it matched on bare requestId instead
   of the gw- response id). → S2 fix with a dedicated regression test;
   explicit v2 response/failure IDs preferred over reconstructed prefixes.

### Second adversarial review round (post-implementation)

The implemented 1.4.0 working tree was then adversarially reviewed again:
46 agents (9 independent finders + 37 verifiers, all Opus 5 at xhigh
effort). Of the 37 candidate findings, 16 were CONFIRMED — all fixed in
this tree — and 21 were refuted. The confirmed findings, one line each:

1. **F1** — _Export run bundle_ could be clicked while gateway work was
   still in flight, emitting a client trace missing the tail requests → the
   button now also requires an idle client and settles the gateway before
   snapshotting; the finalizer notes a client trace shorter than the
   engine's demand.
2. **F2** — CORS `access-control-allow-origin` never reflected an accepted
   loopback-alias origin (127.0.0.1 / [::1]), making the origin equivalence
   a browser no-op → the gateway now echoes the validated request `Origin`
   with `Vary: origin`.
3. **F3** — oversized chunked bodies (no `content-length`) got an
   ECONNRESET instead of the promised 413 → the in-stream body guard now
   drains instead of destroying the socket, so the 413 is actually written.
4. **F4** — `model:summarize` silently overwrote the finalizer's
   authoritative `bundle-manifest.json` → it now refuses to run on a
   finalized directory, and both manifests carry a producer discriminator.
5. **F5** — `requestedModelId` recorded the upstream-REPORTED model (or
   stayed null for the whole run after an early failure) → the manifest
   seed now records the CONFIGURED model, making the requested-vs-returned
   cross-check meaningful.
6. **F6** — a zero-byte or truncated `model-trace.jsonl` was reported as a
   COMPLETE gateway source → completeness is now content-aware, and
   client/ledger evidence of gateway results is reconciled against trace
   rows (proven-missing rows drop `gateway` from the sources with a note).
7. **F7** — running `model:summarize` after `model:finalize` destroyed the
   finalizer's bundle manifest and `clientDemand` metrics → covered by the
   same refusal + discriminator as F4.
8. **F8** — `model:prepare-run` accepted a ledger filename the finalizer's
   `ledger-*.json` glob could never find, deferring the failure to a
   misleading finalize error → a pre-copy filename guard rejects it with an
   actionable message.
9. **F9** — the run-bundle exporter (sole producer of `client-bundle.json`)
   had zero test coverage and an untyped bundle literal → the assembly is
   now a typed, schema-bound `buildRunBundle` (`src/app/runBundle.ts`)
   under node unit tests, with the client-trace type unified with the
   shared schema.
10. **F10** — the §10.1 engine-demand assertion was a `>=` that a broken
    external-provider filter still satisfied → replaced with exact
    assertions proving the fixture ledger genuinely exercises the filter.
11. **F11** — README and this report overstated finalize's guarantees when
    the client bundle is absent (nothing else binds the ledger to the run)
    → docs corrected (§6.4 and D2 above; README) and the finalizer emits
    advisory binding notes.
12. **F12** — the live-run setup asserted the dev server is on port 5173
    while the origin policy makes a port mismatch a silent, misdiagnosable
    403 → README and `.env.gateway.example` now document the coupling.
13. **F13** — the live acceptance template asked Run 6 to record a
    "degraded completeness" the finalizer does not emit for that shape →
    replaced with neutral fillable rows plus a clarifying paragraph on the
    actual finalizer behavior.
14. **F14** — this report described a handoff-designated ledger filename
    the strict bundle schema makes impossible → the dead selection branch
    was removed and §9 above now states the uniqueness rule and its escape
    hatch.
15. **F15** — the README walkthrough named a nonexistent control ("Replay
    live/imported") → corrected to _Replay latest_.
16. **F16** — the summarize-clobber of F4/F7 graded as an evidence-
    integrity hazard (the recorded aggregate hash stopped describing the
    delivered bundle) → same refusal + discriminator fix.

Gate results at the final commit are recorded by the orchestrator
placeholders in "Test evidence" below.

## Frozen invariants — statement of compliance

- No new field on any canonical event, ledger file, or FinalSummary; runId
  never enters an event payload. All artifact additions are noncanonical
  (gateway/client traces, sidecars, manifests, bundles).
- The engine change (plan-carried validation) is unreachable in
  deterministic scenarios; acceptance-gate semantics are unchanged; no
  retries were added anywhere; PROTOCOL_VERSION stays 3 with no command or
  message shape changes.
- No OpenAI SDK/key/host reference under `src/`; no presentation import
  under `gateway/`; Scenario F stays deterministic-only; Vitest
  `fileParallelism` stays false; no test requires a live key.
- All fourteen golden hashes and every deterministic event stream:
  byte-identical at the final commit (batch PASSED, 100 runs/scenario —
  A `8bf6de492261aa78`/`2b37e828af8d8b30`, B1 `7e06428489f9020f`/`7db80afdf2565999`,
  B2 `19f9352327928f64`/`7e7bfb303b11655f`, C `dc9e39d03bbdf240`/`a155bf545ed70250`,
  D `f1837eb45f154f26`/`ce705feae7451f0a`, E `72c9d8d32e575df8`/`0da42ae4ea8cf2f0`,
  F `099557a99bde1fb4`/`36daff45eae4fcd3`; replay=match on every scenario).

## Test evidence

Every command below was actually executed against the final tree, twice: once
after the implementation round and again after the review-fix round. Results
are from the final (post-fix) run.

- `npm run typecheck` / `npm run typecheck:gateway` — both clean
- `npm run lint` / `npm run validate` — clean (eslint + prettier); validation PASSED, 0 errors / 0 warnings
- `npm run test:run` — 356 passed (356) across 44 files
- `npm run test:gateway` — 37 passed (37) across 3 files
- `npm run build` + `npm run check:dist` / `npm run build:gateway` — both builds clean; dist secret scan PASSED
- `npm run test:e2e` — 9 passed (9)
- `npm run batch` (100 runs/scenario, fourteen golden hashes) — PASSED in 54.3s, all hashes byte-identical, replay=match everywhere
- Live runs: **none executed** — see the PENDING live acceptance report.

## Exact files changed in this release

Modified: `.env.gateway.example`, `README.md`, `package.json`,
`gateway/adapters/fakeDecisionAdapter.ts`,
`gateway/adapters/modelDecisionAdapter.ts`,
`gateway/adapters/openaiResponsesAdapter.ts`, `gateway/config.ts`,
`gateway/prompts/maraActionSelection.ts`, `gateway/schemas.ts`,
`gateway/server.ts`, `gateway/tracing/modelTraceWriter.ts`,
`scripts/model/liveSmoke.ts`, `scripts/model/summarize.ts`,
`src/app/main.ts`, `src/app/modelGatewayClient.ts`, `src/app/store.ts`,
`src/app/workerClient.ts`, `src/sim/decisions/conditions.ts`,
`src/sim/decisions/externalDeferredProvider.ts`,
`src/sim/decisions/externalSchemas.ts`, `src/sim/decisions/providerPlan.ts`,
`src/sim/runtime/engine.ts`, `src/ui/modelPanel.ts`,
`tests/gateway/gateway.test.ts`, `tests/gateway/summarize-and-scan.test.ts`,
`tests/unit/model-gateway-client.test.ts`, `tests/unit/provider-plan.test.ts`,
`documentation/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md`
(additive only).

Added: `src/shared/modelExperiment.ts`, `src/shared/modelArtifacts.ts`,
`src/app/modelClientTraceRecorder.ts`, `scripts/model/prepareRun.ts`,
`scripts/model/finalize.ts`, `tests/gateway/gateway-idempotency.test.ts`,
`tests/integration/model-ablation-context.test.ts`,
`tests/integration/model-bundle.test.ts`,
`tests/integration/model-reconciliation-gap.test.ts`,
`documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`,
`documentation/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_REPORT.md`
(this file).

Deliberately untouched: `.github/workflows/ci.yml` (no new CI steps — the
bundle tests ride the existing suites), all canonical event/reducer/replay
modules, the worker protocol, and every frozen experiment datum.
