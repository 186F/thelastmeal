# Model-Run Artifact Integrity, CI Verification, and Keyless Rehearsal — Implementation Report (1.5.0)

**Implements:** [`documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md`](MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md), as amended by the ten recorded amendments A1–A10 in section 4 of this report.
**Base commit:** `5c1f755` (`main`, release 1.4.0) — the brief was cherry-picked onto the working branch at `55afa2b`.
**Branch:** `agent/model-artifact-integrity-1.5.0`
**Final implementation commit:** `<<TO BE FILLED BY ORCHESTRATOR>>`
**Merge commit on `main`:** `<<TO BE FILLED BY ORCHESTRATOR>>`
**Package version:** 1.4.0 → **1.5.0**
**Frozen identifiers (all unchanged):** experiment `Vertical Slice 001 — v1.0`, configuration version `vs001-1.0.0`, model experiment `model-backed-npc-001` v `1.0.0`, condition `mara-model-per-decision-v1`, external provider `openai-mara-action-v1`, prompt version `mara-action-selection-1.0.0`, `SCHEMA_VERSION` 2, ledger format 2, `PROTOCOL_VERSION` 3.

**No live OpenAI call was made in the course of this release.** See section 12.

---

## 1. Summary

1.4.0 made the model-run artifact layer self-contained. 1.5.0 makes it
**provable**, and closes the three defects the brief identified:

1. **Requests that never reached the gateway had no exact payload anywhere.**
   The browser client now archives the complete prospective request envelope
   for every request it sees, *before* any dispatch decision, and version-2
   run bundles carry that archive. A queue-overflow, budget-exhausted,
   contract-latched, timed-out, or post-gateway-stop request now leaves the
   exact bytes it would have sent.
2. **Neither model CLI ran the full ledger validator.** `model:prepare-run`
   and `model:finalize` now each run `validateLedgerFile` (exact per-event
   payload schemas, ordering and causation integrity, decision/action
   lifecycle joins, isolated reducer replay, structural invariants,
   recomputed `worldStateHash` and `canonicalLedgerHash`, rebuilt final
   summary). A semantically corrupt but schema-valid ledger can no longer be
   staged or finalized.
3. **`status` could only ever be `completed`.** Finalization is now **strict
   by default**: `completed` is written only when every strict criterion
   holds, and a missing optional evidence source exits nonzero having written
   nothing. `--allow-degraded` is an explicit archival mode that writes
   `status: 'degraded'` with `failedCriteria` populated; it is never
   acceptable as milestone evidence.

Around those: run-level `runCompletedAtUtc` plumbed browser → bundle →
manifest with a monotonic non-decreasing ordering proof; graceful gateway
shutdown and seed-at-first-sight; a Windows-safe, interruption-detectable
finalization commit; a keyless three-case rehearsal (`npm run model:rehearse`)
that drives the real modules end to end; and CI steps that make both the
formal artifact gate and the rehearsal visible on every push and pull request.

Nothing canonical moved. No canonical event, reducer, ledger byte, golden
hash, scenario datum, worker-protocol shape, or prompt was touched.

---

## 2. Artifact schema versions

| Artifact | 1.4.0 | 1.5.0 | Change |
| --- | --- | --- | --- |
| Run bundle (`client-bundle.json` / `model-run-bundle-<runId>.json`) | 1 | **2** | `handoff.runCompletedAtUtc`, `exactRequestEnvelopes`, `archiveDiagnostics` |
| Client trace entry (`clientTraceSchemaVersion`) | 1 | **2** | `gatewayResultObserved: boolean` (A2) |
| Finalized trace row (`finalizedTraceSchemaVersion`) | 1 | **2** | `exactRequestSources`, `envelopeSha256`, `clientEnvelopeIndex`, `strictDisposition`; `engineOutcome` gains `superseded` (A1); `requestEnvelopeFile` retained (A3) |
| Final manifest (`manifestFinalSchemaVersion`) | 1 | **2** | `status` widened to `completed \| degraded`; `runCompletedAtUtc`, `exportedAtUtc`, `requestsSeenByClient`, `requestsWithGatewayResult`, `requestsDispatchedToGateway`, `failedCriteria`; `externalRequestsEmitted` re-documented as the ENGINE-emitted count |
| Bundle manifest (`bundleManifestSchemaVersion`) | 1 | **2** | `status` field added; both writers (`model:finalize`, `model:summarize`) now emit v2 and parse through one shared zod schema |
| Gateway trace (`traceSchemaVersion`) | 2 | **2 (unchanged)** | The seed's open `modelSettings` record additively gained `maxTotalCalls` (the RESOLVED cap) and `maxRequestBodyBytes`; adding keys to an open record is not a shape change, so the version stays 2 |
| Canonical event schema (`SCHEMA_VERSION`) | 2 | **2 (unchanged)** | — |
| Ledger file format | 2 | **2 (unchanged)** | — |
| Worker protocol (`PROTOCOL_VERSION`) | 3 | **3 (unchanged)** | `runCompletedAtUtc` is stamped browser-side on the EXISTING `run-complete` message; no command or message shape changed |

---

## 3. What was implemented

### 3.1 Client and shared contracts (package C)

- **`src/shared/modelArtifacts.ts`** — v2 schemas for the client trace entry,
  run bundle, finalized trace row, and final manifest; a new shared
  `bundleManifestSchema` (discriminated on `producer`) at version 2; version
  constants updated. The module stays a **leaf** (imports only `zod`,
  `./ids`, `./decisionContracts`) — `exactRequestEnvelopes` is typed
  `z.array(z.unknown())` and per-envelope validation lives in the producer
  and the finalizer (A7).
- **`src/app/modelGatewayClient.ts`** — the exact-request archive. A private
  `buildEnvelope(external)` is the single construction path shared by the
  archive and the dispatch POST, so archived and dispatched bytes cannot
  diverge. `archiveRequest()` runs at the top of `handleDecisionRequest`,
  after the schema/Mara/provider filter and **before** the contract latch,
  budget check, queue cap, connect, and dispatch. A duplicate `requestId`
  with a canonically identical envelope coalesces (first kept); a **differing**
  duplicate never throws — the handler runs inside `worker.onmessage` with no
  catch — it records a diagnostic into `archiveDiagnostics` and sets a
  poison flag that blocks export. `newRun()` clears archive, diagnostics, and
  the flag. New accessors: `exactRequestEnvelopes()` (deep-copied, sorted by
  `requestId`), `archiveDiagnostics()`, `archivePoisoned()`.
  `gatewayResultObserved` is stamped **explicitly at the result-parse sites**
  (`true` for a parsed gateway response and for a parsed gateway failure
  body; `false` for client-minted `cf-` failures and stale discards) — never
  inferred from an id prefix. `ModelGatewayStatus` gained `busy`
  (`pumping || inFlight !== null || queue.length > 0`) and `archivePoisoned`,
  and `pump()` publishes once more in its `finally` so the idle transition is
  observable.
- **`src/app/workerClient.ts` / `src/app/store.ts`** — `ViewState.runCompletedAtUtc`,
  stamped in the existing `run-complete` case through an injectable
  `now?: () => string` constructor option (mirroring the gateway client's
  `makeRunId` seam) and cleared in `resetRunViews()`.
- **`src/app/runBundle.ts`** — `buildRunBundle` emits `bundleSchemaVersion: 2`
  with the archive, diagnostics, and `runCompletedAtUtc`; the client trace
  stays **complete** (foreign-runId discards included) because runId scoping
  belongs to consumers (A6). `canExportRunBundle` additionally requires
  `runCompletedAtUtc !== null` and an unpoisoned archive. New
  `validateRunBundle(bundle)` is the producer-side proof: whole-bundle
  schema, per-envelope `externalDecisionRequestEnvelopeSchema` parse, pinned
  contract literals (runId/condition/provider/prompt), `externalContextHash`
  recompute, unique request ids, runId-scoped trace↔archive coverage
  equality, and empty diagnostics.
- **`src/ui/modelPanel.ts`** — the F1 settle-then-snapshot flow is preserved;
  the click handler now calls `validateRunBundle` after assembly and
  **refuses the download** (console error + `lastError` status, button stays
  disabled) rather than shipping a bad bundle. The idle predicate uses the
  new `busy` flag, closing the false-idle window between `queue.shift()` and
  `pendingRequestId` being set.

### 3.2 Gateway (package G)

- **`gateway/server.ts`** — `seedRunManifest(envelope)` was split out of
  `writeTrace` and now fires alongside `trace.writeRequest`, at first sight
  of a validated non-duplicate envelope. `startedAtUtc` is therefore
  first-validated-envelope time (documented at the schema, the trace writer,
  and in the README), and a first request killed mid-adapter still leaves a
  manifest. `modelSettings` gained `maxTotalCalls` — the **resolved local**,
  never `config.maxTotalCalls`, which JSON-drops when undefined — and
  `maxRequestBodyBytes`. New exported `stopWithFallback(gateway, fallbackMs = 2000)`
  races `stop()` against a `closeAllConnections()` fallback.
- **`gateway/main.ts`** — idempotent SIGINT/SIGTERM handlers await
  `stopWithFallback(gateway)` and then `process.exit(0)`, converting a live
  gateway stop from a hard kill into a deterministic drain-then-refuse.

### 3.3 Validation and the strict/degraded finalizer (package V)

- **`scripts/model/prepareRun.ts`** — `ledgerFileSchema.parse` replaced with
  `validateLedgerFile(rawText)`; `ok === true` and a non-null file are
  required, warnings are tolerated, and every error is fatal *before* any
  `mkdirSync`/`copyFileSync`. Version-1 bundles are hard-rejected with the
  A8 message.
- **`scripts/model/finalize.ts`** — independently re-validates the staged
  ledger before any derived write and threads the validated `LedgerFile`
  through `indexLedger`, `engineLifecycle`, and `buildModelSummary`. Strict
  is the default; `--allow-degraded` is opt-in. The **strict criteria** are
  emitted as named strings into `failedCriteria`: `client-bundle-present`,
  `client-trace-coverage`, `exact-envelope-coverage`,
  `gateway-result-evidence`, `engine-resolution`, `strict-disposition`,
  `monotonic-timestamps`. **Contradictions** (ledger validation errors, hash
  or deep-equality mismatches, orphan ids in any direction, duplicate client
  rows, identity disagreements, a poisoned archive, multiple engine
  resolutions for one request) throw in **both** modes. The commit sequence
  is Windows-safe: everything is computed first and staged in
  `<runDir>/../.<runId>.finalize-tmp` (same volume, outside the directory
  `walkFiles` sweeps), stale staging is removed first, renames retry 3× on
  EPERM with 50/100/200 ms backoff and an actionable final message,
  `bundle-manifest.json` is **deleted first and written last** — so a run
  directory without a bundle manifest is an unambiguous not-finalized signal.
  A `completed` final manifest is never overwritten by a degraded one;
  degraded → completed upgrades are allowed. Per-row `strictDisposition` is
  classified from the V4 taxonomy (section 4, A2/V4). All evidence counters
  come from one shared `computeEvidenceCounters` helper feeding both the
  manifest and `model-summary.json`'s `clientDemand`.
- **`scripts/model/summarize.ts`** — the `readdirSync(...).find(...)`
  first-match ledger re-read is gone. A new exported `selectLedgerName(dir)`
  enforces the unique-match rule for both CLIs, and `buildModelSummary` takes
  an optional pre-parsed `ledgerFile` so a validated caller's ledger is never
  re-read behind its back. The bundle manifest is emitted through the shared
  schema at version 2 with `status: null`.

### 3.4 Rehearsal and CI (package R)

- **`scripts/model/rehearse.ts`** (new, ~900 lines) — three complete Scenario A
  model-condition runs through the REAL modules: `WorkerSession` →
  `ModelGatewayClient` → `createGateway` with `FakeDecisionAdapter` on an
  ephemeral loopback port → real `ModelTraceWriter` → real `buildRunBundle`
  over a Node `ViewStore` → `prepareRunDirectory` → **strict**
  `finalizeRunDirectory` → `validateLedgerFile` import/replay. Cases:
  `normal`, `gateway-stop` (stopped only after ≥1 accepted response and with
  the client settled), and `latency` (A9, the supersede regime). Layout
  `<out>/<case>/<runId>/` with `traceDir = <out>/<case>` (finalize requires
  `basename(dir) === runId`); run ids are fixed and hyphen-only
  (`rehearsal-normal-0001`, `rehearsal-gateway-stop-0001`,
  `rehearsal-latency-0001`; `rehearsal-ci-*` under `--ci`). Client and
  gateway `maxCallsPerRun` are pinned to 200. `report.json` + `report.md` are
  written even on failure; all four timestamps come from their four real
  producers and are never minted by the harness. The script **never** calls
  `loadGatewayConfig` — it builds a `GatewayConfig` literal with
  `openaiApiKey: null` — and closes every server in `finally`.
- **`package.json`** — added `model:rehearse` and `test:model:bundle` (nine
  suites), version 1.5.0, lineage appended to the description.
- **`.github/workflows/ci.yml`** — every existing step and name preserved.
  Added `workflow_dispatch`, `concurrency: {group: ci-${{ github.ref }}, cancel-in-progress: true}`,
  `permissions: {contents: read}`, the step **“Formal model-bundle tests”**
  after “Gateway tests”, the step **“Keyless formal model-run rehearsal”**
  AFTER `npm run batch`, and the `model-rehearsal-report` upload with
  `if: always()` and `if-no-files-found: error`. The `pull_request` trigger
  was already present and was not touched (A10).

---

## 4. Recorded deviations from the brief (amendments A1–A10)

Each amendment was driven by an adversarial verifier probe against the real
1.4.0 tree. Where this report and the brief disagree, **this report describes
what was built**.

### A1 — The engine's request resolutions are `accepted | expired | superseded`

**Brief:** §4.7/§6.3 require each external request to resolve to exactly one
of `accepted | rejected | expired`, and treat a client terminal failure with
no engine failure/expiry lifecycle as a strict failure.

**Built:** `finalizedTraceEntrySchema.engineOutcome` gained `'superseded'`,
and the finalizer's `resolutionCount` counts `{accepted, expired, superseded}`.
A request whose only resolution is `superseded` is COMPLETE evidence. A
client terminal failure whose request was already resolved (the engine's
moot-failure drop, `src/sim/runtime/engine.ts` ~1109–1123, pinned by
`tests/integration/model-condition.test.ts`) is classified
`moot-after-resolution` — explained evidence, never a strict failure.

**Rationale:** `DecisionRequestSuperseded` is a first-class canonical
resolution (`engine.ts` ~863–878; `validateLedger.ts` treats
Accepted/Expired/Superseded as the resolution set); `DecisionResponseRejected`
is a per-**response** verdict, not a request resolution — the brief conflated
the two. The verifier probe drove Scenario A under the model condition with
answers returned N ticks late: at N = 1 all 47 requests were `accepted`, but
at **N = 400 ticks — the client's default 20 s timeout at 20× speed — 75
requests produced 74 supersedes and 12 requests with no
accepted/rejected/expired resolution at all**. Under the brief's enum, strict
mode would refuse to mark any live run with >60-tick model latency
`completed`. `MAX_REEVALUATION_INTERVAL_TICKS` and `DECISION_REQUEST_TTL_TICKS`
are both 60, so at 20× that regime begins at a 3-second round trip: it is the
normal live regime, not an edge case.

### A2 — The strict gateway-evidence predicate is `gatewayResultObserved`, not “dispatched”

**Brief:** §4.5 — “a request the client reports as dispatched must have
gateway evidence”; §6.3 — “every dispatched request has exactly one effective
gateway terminal result”.

**Built:** a new explicit client-trace field
`gatewayResultObserved: boolean`, stamped at the result-parse call sites:
`true` only when the client parsed an HTTP result the gateway produced (a
response, or a failure body the gateway minted, carrying a `gwf-` id);
`false` for client-minted `cf-` failures (timeout, unreachable, budget,
contract latch, invalid transport result) and for `discarded-stale-run`
entries. Strict mode requires a trace row **and** a deep-equal sidecar only
for `gatewayResultObserved === true` entries. `requestsDispatchedToGateway`
survives in the manifest but is explicitly documented as “POST attempted”,
never as evidence. Sidecar-present-with-no-trace-row is given the typed
disposition `gateway-interrupted` (V4) instead of being fatal.

**Rationale:** `dispatchedAtUtc` is stamped **before** the POST
(`modelGatewayClient.ts` ~412), so a refused connection still records it. The
verifier probe ran a real localhost gateway, stopped it after the first
accepted response, and measured **74 of 75 requests reporting as dispatched
with no gateway contact at all** (1 sidecar, 1 trace row, 74
`gateway-unavailable` failures with `cf-` ids). Implementing §4.5/§6.3
against `dispatchedAtUtc` would deterministically fail the very gateway-stop
run that §6.5 and §10.4 require to strict-complete. A second probe (hanging
adapter) showed a refused connect and a socket dropped by a dying gateway
produce byte-identical client evidence, so “never reached the gateway” is
provable only from the **absence of a sidecar** — hence the disposition
taxonomy rather than a client-side inference.

**V4 disposition taxonomy as built** (`strictDisposition`, one per finalized
row; anything unclassifiable is the `strict-disposition` failed criterion):

| Value | Meaning |
| --- | --- |
| `gateway-answered` | `gatewayResultObserved` true, one trace row, sidecar present |
| `never-dispatched` | no sidecar, no trace row, the typed failure entered the engine as `DecisionProviderFailed` |
| `gateway-interrupted` | sidecar present, NO trace row, client outcome `request-timeout` or `gateway-unavailable`, exactly one engine resolution — legal and complete |
| `moot-after-resolution` | client terminal failure whose request was already resolved (A1 carve-out) |
| `stale-run-discard` | foreign-runId discard entry |

### A3 — No envelope triplication in finalized rows

**Brief:** §4.6 — every finalized trace row embeds the complete reconciled
request envelope.

**Built:** rows carry `exactRequestSources` (`'client' | 'gateway'`, max 2),
`envelopeSha256` (sha256 of the canonical compact JSON of the reconciled
envelope, nullable), `requestEnvelopeFile` (the gateway sidecar's relative
path, retained), and `clientEnvelopeIndex` (index into the bundle's
`exactRequestEnvelopes`). Envelopes exist exactly once per source: gateway
sidecars, and the client bundle.

**Rationale:** measured envelope sizes — mean 6,474 B compact / 7,278 B in
the heaviest scenario, up to 10,731 B pretty-printed. The verifier costed a
134-request run at **≈3.7 MB across three byte-identical copies** (client
bundle ≈1.37 MB + gateway sidecars ≈1.37 MB + inlined finalized rows ≈0.93 MB)
versus ≈1.4 MB today, all bound by the same `bundle-manifest.json` aggregate
hash and all landing in the CI rehearsal artifact upload. Inlining also
silently drops `requestEnvelopeFile` — the pointer saying *which* on-disk
artifact was compared — and creates an unspecified obligation when row-level
and embedded fields disagree. The row now names both sources, the file, the
array index, and the hash of what was compared: same auditability, no third
copy.

### A4 — The run-level completion timestamp is `runCompletedAtUtc`

**Brief:** §4.3/§6.2/§7.1 name the run-level field `completedAtUtc`.

**Built:** `runCompletedAtUtc` in `ViewState`, `handoff`, and the final
manifest.

**Rationale:** `completedAtUtc` already exists as a **per-request**
client-trace field (`modelArtifacts.ts`, set in the client's `traceEntry`),
with fixtures and assertions pinning it. A v2 bundle would otherwise contain
`handoff.completedAtUtc` (run-level) next to `clientTrace[].completedAtUtc`
(per-request) in the same file, and an auditor reading `finalized-trace.jsonl`
beside `client-bundle.json` would conflate them. The client-trace entry shape
could not be renamed without breaking the frozen per-request field.

### A5 — Timestamps are monotonic NON-DECREASING, never asserted distinct

**Brief:** §6.3 — “the run has distinct completion, export, and finalization
timestamps”.

**Built:** strict finalization asserts
`runCompletedAtUtc <= exportedAtUtc <= finalizedAtUtc`, with equality legal.
`startedAtUtc` is gateway-first-sight and is **excluded** from the ordering
check. `runCompletedAtUtc` must be non-null in strict mode.

**Rationale:** the verifier's live gateway-stop probe measured
`runCompletedAtUtc → exportedAtUtc` at **4 ms** and
`exportedAtUtc → finalizedAtUtc` at 38 ms. `toISOString()` is
millisecond-resolution, so on a faster machine or a shorter scenario equality
is entirely reachable and a strict-inequality gate would fail
nondeterministically in CI. The brief's own §11.6 already said “later than or
equal to”, contradicting §6.3.

### A6 — Coverage checks are runId-scoped

**Brief:** §4.3/§7.3 speak of “every current-run client trace entry” without
providing a filter.

**Built:** every trace↔archive equality — the producer's `validateRunBundle`,
the export-gate assertion, and the finalizer's coverage criteria — filters
`entry.runId === handoff.runId` first. The bundle's `clientTrace` itself
stays complete, including foreign-runId entries.

**Rationale:** `recordDiscardedStaleRun` deliberately records a discard keyed
by the **old** runId into the **current** recorder, which `newRun()` has just
cleared; the archive resets with `newRun()`, so it can never contain that
requestId. Comparing naively yields N+1 trace rows against N envelopes, and
the export button would never enable again for the rest of the session.
Archive coverage was also deliberately kept **out** of the enable predicate
and left as a post-settle assertion, for the same flapping reason.

### A7 — `src/shared/modelArtifacts.ts` stays a leaf module

**Brief:** §4.3 asks for pinned-contract and hash-recompute proofs as zod
refinements on the run-bundle schema.

**Built:** `runBundleSchema` v2 validates `exactRequestEnvelopes` as
`z.array(z.unknown())`. Per-envelope validation
(`externalDecisionRequestEnvelopeSchema` + pinned-contract literals +
`externalContextHash` recompute) lives in the PRODUCER
(`src/app/runBundle.ts`'s `validateRunBundle`) and in the FINALIZER.

**Rationale:** the module's header contract is “no node imports: usable from
browser, worker, gateway, and script code alike”, and it imports only `zod`,
`./ids`, `./decisionContracts`. Adding `externalContextHash`,
`modelExperiment`, and `externalSchemas` would drag the sim decision core
into a module the gateway and the browser both load. Several of the demanded
refinements are already enforced elsewhere (descriptor-ID equality in
`externalSchemas.ts`, contextHash recompute in `gateway/server.ts` and
`scripts/model/finalize.ts`).

### A8 — Three items dropped from the brief

1. **No version-1 bundle legacy import path.** `model:prepare-run` and
   `model:finalize` hard-reject `bundleSchemaVersion: 1` with the exact
   message *“run-bundle schema version 1 is not supported — re-export the run
   bundle under release 1.5.0”*. **Rationale:** zero v1 bundles exist
   anywhere — `artifacts/model-runs/` is empty and no v1 fixture exists — so
   a legacy importer would be untested code guarding an empty set. The
   strict `.strict()` v2 schema already refuses to reinterpret a v1 bundle.
2. **No queue-overflow-vs-client-budget failure-code split.** Both paths
   legitimately emit `budget-exhausted`; the tests distinguish them **by
   construction** (queue cap vs an injected `maxCallsPerRun: 2` — the default
   80 is not naturally reachable, a worst-case Scenario A run emitting 75
   requests), not by artifact content. **Rationale:** adding a distinguishing
   code would widen the worker-protocol failure enum, which is frozen at
   `PROTOCOL_VERSION` 3. Documented instead, here and in the README.
3. **§9.8 branch protection was NOT applied.** It is a repository setting
   owned by the repository owner. See section 10 for the verified state and
   the prepared command.

### A9 — A third rehearsal case, and a settled-before-stop rule

**Brief:** §10 defines two rehearsals (normal, gateway-stop) and says only
“stop the gateway process deliberately”.

**Built:** a third `latency` case exercising the supersede regime, and
rehearsal B stops the gateway only after ≥1 accepted response **with the
client fully settled**, via `stopWithFallback` (graceful stop +
`closeAllConnections()` fallback).

**Rationale:** the verifier measured a mid-flight stop **blocking ~3.7 s and
still delivering one more accepted response** — nondeterministic, and fatal
to the `notes: []` assertion. Separately, the brief's rehearsal A pins the
1-tick-latency regime (47 requests, 0 supersedes) — the one case that already
worked — so it would have been a green light that says nothing about the
live regime A1 describes.

**Implementation-level refinement of A9:** the spec suggested ~100 unsettled
ticks per drive chunk; the built harness uses **150**
(`LATENCY_CHUNK_TICKS`). At 100 the chunk length phase-locks against the
engine's 60-tick re-evaluation cadence — the accept drains at the chunk
start, the next emission lands 60 ticks in, and its answer is only ~40 ticks
late, so every request is accepted and **zero** supersedes are produced. At
150 the steady state emits twice per chunk and the first emission is always
superseded in-chunk. The harness additionally drives the tail past 2,400
ticks without settling, so the final answers arrive post-terminal, are
dropped at the worker gate, and those requests' only resolution is the
supersede/scenario-end record — which is exactly the A1 evidence class the
case exists to prove.

### A10 — CI ordering, upload strictness, and the trigger that already existed

**Brief:** §9.2 reads as though the `pull_request` trigger must be added;
§9.5 orders the rehearsal **before** `npm run batch`; §9.6 copies the repo's
`if-no-files-found: ignore` convention.

**Built:** the rehearsal step runs **after** `npm run batch`; the rehearsal
upload uses `if-no-files-found: error`; `workflow_dispatch`, a per-ref
`concurrency` group with `cancel-in-progress`, and
`permissions: {contents: read}` were added. **The `pull_request` trigger was
already present and is not claimed as new.**

**Rationale:** the verifier established that `pull_request` has been in
`ci.yml` since commit `ab54106` (release 1.1.0), that the README already
documented it, and that **four recent CI runs with `event: "pull_request"`
all concluded `success`** (run IDs 30285429699, 30267806284, 30240965719,
30227581766) — so there was no chicken-and-egg problem and no trigger to add.
Ordering: with default step semantics, a failure in the brand-new, least
mature step would abort the job before the authoritative 125 s frozen
determinism gate ever ran. Upload strictness: the repo's existing
`if-no-files-found: ignore` convention would let a path drift produce a green
step uploading zero bytes, silently defeating the “independently visible CI
evidence” the rehearsal exists to provide.

---

## 5. Additional recorded deviations (beyond A1–A10)

| # | Deviation | Rationale |
| --- | --- | --- |
| D-1 | Corrupt-ledger fixture helpers were extracted into a **new non-test module** `tests/ledgerCorruption.ts` rather than exported from `tests/unit/ledger-import.test.ts` as the spec's V6 text suggested. | Importing one `*.test.ts` from another re-registers the imported file's entire `describe` tree inside the importing suite, double-counting and double-running those tests. |
| D-2 | Package G's shutdown/seed tests landed in a **new file** `tests/gateway/gateway-shutdown.test.ts` rather than inside `tests/gateway/gateway.test.ts`. | Within the package's `tests/gateway/**` ownership; keeps the SIGINT/fallback and seed-at-first-sight matrices legible instead of appending ~230 lines to an already-large suite. |
| D-3 | `bundleManifestSchema` is a **new shared zod schema** in `modelArtifacts.ts` and both writers now `parse` through it; the spec only required a `status` field and a version bump. | The bundle manifest was previously written as an unvalidated object literal in two places. One schema makes the producer discriminator, the version, and the `status` nullability machine-checked in both writers. |
| D-4 | `finalizeRunDirectory` gained an injectable `now?: () => string` in `FinalizeOptions`. | The A5 monotonic-ordering criterion is otherwise only testable with wall-clock races; this mirrors the `makeRunId`/`WorkerClient.now` injection pattern the brief's §11.6 asks for. |
| D-5 | `CLIENT_TRACE_SCHEMA_VERSION` moved from `src/app/modelClientTraceRecorder.ts` to `src/shared/modelArtifacts.ts` and is re-exported from its old location. | Two independently-declared copies of one schema version is exactly the drift the v2 bump exists to prevent; the re-export keeps every existing import site working. |
| D-6 | `selectLedgerName(dir)` was added to `summarize.ts` and is used by both CLIs. | The verifier found `summarize.ts` re-selecting the ledger with `readdirSync(...).find(...)` — **first match**, not the unique-match rule the finalizer enforces — and then bare-`JSON.parse`ing it with no schema. Bolting validation onto `finalize.ts` alone would have left a second unvalidated read path able to bind to a *different* `ledger-*.json` than the one that was validated. |
| D-7 | `model:finalize`'s `--allow-degraded` refuses to overwrite an existing `status: 'completed'` manifest with a degraded one. | Not in the brief; without it a stray degraded re-finalize silently downgrades a formally complete run in place. degraded → completed upgrades remain allowed. |
| D-8 | The README's own §15.1 checklist item “`completedAtUtc`, `exportedAtUtc`, and `finalizedAtUtc` have distinct meanings” is documented under the A4 name `runCompletedAtUtc`. | Consequence of A4; the README states all four timestamps (including `startedAtUtc`) and their producers explicitly. |

---

## 6. Exact files changed

**Modified (22):**
`.github/workflows/ci.yml`, `README.md`, `package.json`,
`gateway/main.ts`, `gateway/server.ts`, `gateway/tracing/modelTraceWriter.ts`,
`scripts/model/finalize.ts`, `scripts/model/prepareRun.ts`,
`scripts/model/summarize.ts`, `src/app/modelClientTraceRecorder.ts`,
`src/app/modelGatewayClient.ts`, `src/app/runBundle.ts`, `src/app/store.ts`,
`src/app/workerClient.ts`, `src/shared/modelArtifacts.ts`,
`src/ui/modelPanel.ts`, `tests/gateway/gateway.test.ts`,
`tests/gateway/summarize-and-scan.test.ts`,
`tests/integration/model-bundle.test.ts`, `tests/unit/ledger-import.test.ts`,
`tests/unit/model-gateway-client.test.ts`, `tests/unit/run-bundle.test.ts`.

**Added (7):**
`scripts/model/rehearse.ts`, `tests/ledgerCorruption.ts`,
`tests/gateway/gateway-shutdown.test.ts`,
`tests/integration/model-corruption.test.ts`,
`tests/integration/model-rehearsal.test.ts`,
`tests/unit/model-artifact-schemas.test.ts`,
`documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md`
(this file).

**Additively amended (documentation only):**
`documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md` —
a single prerequisite note; every live evidence field remains `PENDING` and
the overall verdict remains PENDING.

**Already on the branch from the brief cherry-pick (`55afa2b`), not part of
this work:**
`documentation/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md`.

**Deliberately untouched:** every module under `src/sim/**` (events,
reducers, replay, scenarios, engine, decision providers),
`src/shared/workerProtocol.ts`, `src/shared/versions.ts`,
`src/shared/modelExperiment.ts`, `gateway/prompts/**`,
`gateway/adapters/openaiResponsesAdapter.ts`,
`.github/workflows/deterministic-batch.yml`, and every frozen experiment
datum.

---

## 7. Rehearsal results

Command: `npm run model:rehearse` (local) / `npm run model:rehearse -- --ci`
(CI). No key, no `.env.gateway` read, fake adapter, ephemeral loopback port.

| Field | A — `normal` | B — `gateway-stop` | C — `latency` |
| --- | --- | --- | --- |
| Run id | `rehearsal-normal-0001` | `rehearsal-gateway-stop-0001` | `rehearsal-latency-0001` |
| Final manifest `status` | `completed` | `completed` | `completed` |
| `failedCriteria` | `[]` | `[]` | `[]` |
| completeness sources / notes | `gateway+ledger+client` / 0 notes | `gateway+ledger+client` / 0 notes | `gateway+ledger+client` / 0 notes |
| External requests emitted (engine) | 47 | 75 | 52 |
| Client trace rows / archived envelopes | 47 / 47 | 75 / 75 | 52 / 52 |
| Requests with a gateway result | 47 | 1 | 46 |
| Accepted responses / failures by code | 47 / `{}` | 1 / `{gateway-unavailable: 74}` | 16 / `{budget-exhausted: 6}` |
| Superseded resolutions | 0 | 0 | 30 |
| `worldStateHash` / `canonicalLedgerHash` | `0630e588c97877cc` / `6ddb0bdce0746e9b` | `8e7cc343a9ba2496` / `45aa3b622337c821` | `33d5c7e59116ad7b` / `b3180b92ae885b8e` |
| Import + replay hash match | yes | yes | yes |
| Only Mara generated external requests | yes | yes | yes |
| **`bundle-manifest.json` aggregate SHA-256** | `a4d50f5e1c26cbab7900cc2cb36ccaf62be48ed9a33abf5b1f51ca0d18516e74` | `ecf52973c195761ccc7a86e3d79498b57de03a7f664a2fddea51cdb777d8a45e` | `c08f0f3b4dcf1001b96b7b2ea439c00bac02e5bae6ad1e37768d0edf0e35be97` |

Rehearsal wall clock (all three cases, including prepare, strict finalize,
and replay): under 10 seconds total.

Case B is the decisive one for the root defect this release closes: 74 of its
75 requests never reached the gateway, yet all 75 carry an exact request
envelope in the client bundle. Case C is the decisive one for amendment A1:
30 superseded resolutions strict-complete, where the brief's original
`accepted | rejected | expired` enum would have hard-failed the run.

**These are fake-adapter results. They are infrastructure evidence only and
must never be transcribed into the live acceptance report.**

---

## 8. Deterministic baseline — all fourteen golden hashes

The pinned values below are the frozen baseline
(`tests/integration/golden-hashes.test.ts`); the observed column records the
full 100-runs-per-scenario `npm run batch` at the final commit.

| Scenario | Pinned `worldStateHash` | Pinned `canonicalLedgerHash` | Observed at final commit |
| --- | --- | --- | --- |
| A | `8bf6de492261aa78` | `2b37e828af8d8b30` | byte-identical |
| B1 | `7e06428489f9020f` | `7db80afdf2565999` | byte-identical |
| B2 | `19f9352327928f64` | `7e7bfb303b11655f` | byte-identical |
| C | `dc9e39d03bbdf240` | `a155bf545ed70250` | byte-identical |
| D | `f1837eb45f154f26` | `ce705feae7451f0a` | byte-identical |
| E | `72c9d8d32e575df8` | `0da42ae4ea8cf2f0` | byte-identical |
| F | `099557a99bde1fb4` | `36daff45eae4fcd3` | byte-identical |

Batch verdict (byte-identical canonical event streams, `replay=match` on
every scenario): **PASSED** in 55.1s — 700 runs, all fourteen hashes byte-identical.

---

## 9. Test evidence — commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run typecheck:gateway` | clean |
| `npm run lint` (eslint + prettier) | clean |
| `npm run validate` | PASSED — 0 errors, 0 warnings |
| `npm run test:run` | **420 passed (420)** across 48 files |
| `npm run test:gateway` | **44 passed (44)** across 3 files |
| `npm run test:model:bundle` | **92 passed (92)** |
| `npm run build` + `npm run check:dist` | built clean; dist secret scan PASSED |
| `npm run build:gateway` | built clean |
| `npm run test:e2e` | **9 passed (9)** |
| `npm run batch` (100 runs × 7 scenarios) | **PASSED** in 55.1s; fourteen golden hashes byte-identical |
| `npm run model:rehearse` | all three cases `status: completed`, 0 failed criteria, 0 notes |
| `RUN_LIVE_MODEL_TESTS=1 npm run test:model:live` | **not run** — opt-in only, never in CI, and no key was used in this release |

New and extended suites in this release:

- `tests/unit/model-artifact-schemas.test.ts` (new) — strict matrix over every
  v2 schema: valid parses; missing, extra, mistyped, and fractional fields
  rejected; `engineOutcome: 'superseded'` accepted; the `status` enums; a v1
  bundle rejected by the v2 schema.
- `tests/integration/model-corruption.test.ts` (new) — six §5.4 corruption
  classes (dangling causation; accepted response selecting an unoffered
  affordance, resealed; mismatched provider in an accepted lifecycle,
  resealed; final summary inconsistent with replayed state; reducer replay
  aborts; top-level hashes resealed to each other but not to the stream).
  Each is first proven to pass the bare `ledgerFileSchema` — the 1.4.0 hole —
  then asserted to be rejected by BOTH `prepareRunDirectory` and
  `finalizeRunDirectory` (in both strict and `--allow-degraded` modes) with
  zero writes at the destination. A genuine export is the control case.
- `tests/integration/model-rehearsal.test.ts` (new) — runs the exported
  rehearsal cases against a temporary `--out`; asserts all three
  strict-complete, that both reports parse, that a deliberately induced
  evidence gap makes the rehearsal fail, and that every server is closed
  after success **and** after failure.
- `tests/gateway/gateway-shutdown.test.ts` (new) — `stopWithFallback` on an
  idle gateway and against a hung in-flight request; seed-at-first-sight
  (manifest + sidecar exist before any trace row when the adapter hangs); a
  pre-validation reject never seeds; the seed is written once per run and
  `startedAtUtc` never moves.
- `tests/unit/model-gateway-client.test.ts`, `tests/unit/run-bundle.test.ts`,
  `tests/integration/model-bundle.test.ts`,
  `tests/gateway/gateway.test.ts`,
  `tests/gateway/summarize-and-scan.test.ts` (extended) — archive population
  across every non-dispatch path, `gatewayResultObserved` stamping,
  duplicate coalesce/poison, v2 producer output, the strict success path, the
  strict failure matrix with zero-derived-write assertions, the
  `--allow-degraded` matrix, the refused completed→degraded downgrade, and
  the superseded / `gateway-interrupted` strict-complete paths.

---

## 10. Continuous integration and repository settings

**GitHub CI is the authoritative merge gate.** The required check is the job
named `Required checks (clean checkout)` in `.github/workflows/ci.yml` — the
job name is the check-run name and must not change.

| Item | Value |
| --- | --- |
| PR number | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| PR head SHA | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| PR workflow run ID / URL | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| PR workflow conclusion | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| Merged-`main` workflow run ID / URL | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| Merged-`main` workflow conclusion | `<<TO BE FILLED BY ORCHESTRATOR>>` |
| `model-rehearsal-report` artifact present on both runs | `<<TO BE FILLED BY ORCHESTRATOR>>` |

### Branch protection — NOT applied

Verified state at the time of writing:
`gh api repos/186F/thelastmeal/branches/main/protection` returns **404
“Branch not protected”**, and `gh api repos/186F/thelastmeal/rulesets`
returns `[]`. Branch protection is a repository administrative setting owned
by the repository owner; **it was deliberately not applied by this work**
(amendment A8, item 3). The prepared command, should the owner choose to
apply it:

```bash
cat > protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Required checks (clean checkout)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
gh api --method PUT repos/186F/thelastmeal/branches/main/protection --input protection.json
gh api repos/186F/thelastmeal/branches/main/protection   # verify
```

Constraints that make the values above non-negotiable on this repository:
all four top-level keys are mandatory (nullable) on that endpoint;
`restrictions` MUST be `null` because push allow-lists are organization-only
and this repository is owned by a **User** account; `required_approving_review_count`
MUST be `0` because the repository has exactly one collaborator and nobody
can approve their own pull request; `enforce_admins: false` preserves the
administrator escape hatch; `strict: true` is “require branches to be up to
date before merging”.

---

## 11. Known limitations

1. **Recomputability is proven but untooled.** A validated ledger fully
   determines every request envelope — the verifier replayed a real
   model-condition ledger and rebuilt **75 of 75** context hashes exactly —
   but no shipped tool reconstructs a context from a ledger
   (`buildDecisionContext` is not exported), and recomputation would require
   running this exact repository revision. The archive is therefore an
   auditability-without-re-execution win, not a new integrity property, and
   the run bundle still records no repository commit.
2. **Artifact recoverability is coupled to the build.** `validateLedgerFile`
   hard-errors on `wrong-experiment`, `config-version-mismatch`,
   `scenario-version-mismatch`, and `seed-mismatch` against the *locally
   compiled* tables. Both are frozen today, but after any future
   `CONFIG_VERSION` or scenario-version bump, previously archived run
   directories become permanently un-preparable and un-finalizable.
3. **Ledger integrity is non-negotiable at staging.** `model:prepare-run` has
   no degraded flag: a non-terminal or truncated ledger cannot be staged at
   all, so `--allow-degraded` cannot rescue it. Degraded mode covers missing
   **optional** sources (a lost client bundle), never a damaged ledger. This
   is the deliberate resolution of the brief's §5.2-vs-§6.4 contradiction.
4. **Strict mode's dominant real-world failure is a lost browser bundle.**
   The client bundle is still a one-shot `downloadTextFile` from a button
   click, with no persistence and no re-export after a tab crash. Losing it
   after a long paid live run now costs the run's milestone eligibility (the
   run survives only as `degraded`). Persisting the assembled bundle to
   IndexedDB at `run-complete` and keeping the export re-clickable for a
   terminal run remain unimplemented mitigations.
5. **True multi-file atomicity is unattainable**, and is not claimed. The
   commit gives *detectability* instead: a crash mid-commit leaves no
   `bundle-manifest.json`, which is the unambiguous not-finalized signal.
6. **The three request-dedupe policies still differ.** The archive hard-fails
   a differing duplicate (poison), `trace.record` keeps the first entry per
   `(runId, requestId)`, and `failedRequestIds` is a 512-entry FIFO. That is
   intentional but should not be mistaken for one uniform policy.
7. **`queue-overflow` and `client-budget` remain indistinguishable in the
   artifact** — both emit `budget-exhausted` (A8). Likewise, the gateway's
   per-run cap, process-wide cap, and concurrency limit all surface as
   `budget-exhausted`; recording `maxTotalCalls` in the seed tells an analyst
   the ceiling, not which ceiling fired.
8. **`test:model:bundle` is a deliberate re-run.** `fileParallelism` is
   `false`, so the named gate serially re-executes suites `test:run` already
   ran. That is the cost of a separately-visible required gate, and it
   compounds as new model suites land.
9. **`workflow_dispatch` cannot be used before merge.** GitHub only offers a
   manual dispatch for a workflow whose file carries the trigger on the
   default branch, so the added trigger becomes usable only after this branch
   merges.
10. **1.4.0-era artifacts can never strict-complete.** They are v1 bundles
    with no `runCompletedAtUtc` and no exact-request archive, and v1 bundles
    are hard-rejected (A8). Any pre-1.5.0 run directory is archival only.
11. **The rehearsal proves the pipeline, not the model.** Every rehearsal
    result comes from `FakeDecisionAdapter`. It de-risks the live sequence; it
    is not evidence about live model behavior.

---

## 12. Frozen invariants — statement of compliance

- No canonical event type, payload field, reducer, hashing rule, ledger byte,
  scenario datum, seed, weight, or `FinalSummary` field was added or changed.
  All fourteen golden hashes and the deterministic streams are unchanged
  (section 8).
- No API key exists outside the gateway process, and none was used at all.
  `scripts/model/rehearse.ts` never calls `loadGatewayConfig` — the only
  reader of `.env.gateway` / `OPENAI_API_KEY` — and builds a `GatewayConfig`
  literal with `openaiApiKey: null` and the fake adapter.
- Engine gate semantics are unchanged; no retries were added anywhere;
  `PROTOCOL_VERSION` stays 3 with no worker command or message shape change
  (`runCompletedAtUtc` is stamped browser-side on the existing `run-complete`
  message).
- Experiment, condition, provider, and prompt versions are unchanged.
  Scenario F stays deterministic-only. Vitest `fileParallelism` stays `false`.
- The 1.4.0 review fixes were preserved, not reversed: settle-before-snapshot
  export (F1), client-side result reconciliation (F3), content-aware gateway
  completeness scoring (F6), the `discarded-stale-run` carve-out,
  `model:summarize`'s refuse-on-finalized guard, and the bundle-manifest
  producer discriminators.
- No OpenAI SDK, key, or host reference under `src/`; no presentation import
  under `gateway/`; no test requires a live key.

### No live model call was made

**No live OpenAI call was made during this release.** Every result in this
report comes from deterministic fixtures, the local fake adapter, or the
keyless rehearsal. The live milestone remains **open**:
[`documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`](MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)
is still a PENDING template, and no fake-adapter or rehearsal result may ever
be transcribed into it as live evidence.
