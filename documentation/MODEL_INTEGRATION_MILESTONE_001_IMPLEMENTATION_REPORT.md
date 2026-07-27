# Model Integration Milestone 001 — Implementation Report

**Implements:** `documentation/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_BRIEF.md` (PR #2)
**Base commit:** `90d39c9cc6b27db455b767daa9444d178759cbd3` (remediation release 1.2.0)
**Final commit:** recorded in the merge/commit metadata of this change-set
**Package version:** 1.3.0 · **Experiment:** `model-backed-npc-001` v `1.0.0`
**Frozen experiment:** Vertical Slice 001 v1.0 (`vs001-1.0.0`) — unchanged
**Versions:** SCHEMA 2 (unchanged) · LEDGER FORMAT 2 (unchanged) · PROTOCOL 2 → 3
**Prompt:** `mara-action-selection-1.0.0` · **External provider:** `openai-mara-action-v1`

## Pre-registered hypotheses (recorded before live evaluation)

H1 causal integrity · H2 operational continuity · H3 provider isolation ·
H4 memory sensitivity · H5 replayability · H6 measurability — exactly as
stated in brief section 3. No live-model behavioral claims are made in this
report; the live acceptance sequence (brief section 20) is the user's step.

## What was built

### Provider plans and conditions (brief §6–8)

- `src/sim/decisions/providerPlan.ts` — `ProviderPlan` (id, providerFor,
  scheduledResponseSources in ascending provider-ID order,
  externalProviderIds). The default single-provider plan reads `run.provider`
  live and its id IS the provider id, so every frozen ledger byte is
  unchanged; Scenario F keeps its scripted-failure identity.
- `src/sim/decisions/conditions.ts` — engine-owned registry:
  `deterministic-baseline-v1` (resolves to the default wiring — explicitly
  selecting it is byte-identical to omitting it, under test) and
  `mara-model-per-decision-v1` (Mara → `ExternalDeferredProvider`
  (`openai-mara-action-v1`), Jonas/Rin → deterministic). The model condition
  refuses Scenario F. `load-scenario` accepts only a registered `conditionId`;
  no command exists that accepts a provider, provider ID, prompt, or model.
- Every `DecisionRequested` records its actual per-NPC provider; the
  acceptance gate's provider binding (re-audit finding 1) applies unchanged.
  `ScenarioStarted.providerId` and the ledger-file `providerId` record the
  plan ID.

### Exact outbound contract and context (brief §9)

- Types in `src/shared/decisionContracts.ts`; the deterministic bounded
  context builder in `src/sim/decisions/externalContext.ts` (limits 24/24/12/
  12/12/20; documented truncation orderings; truncation counts reported;
  mechanical affordance descriptions); exact schemas in
  `src/sim/decisions/externalSchemas.ts`, single-sourced — offered
  affordances reuse the ledger event schema itself, and the gateway re-exports
  these definitions rather than copying them.
- The engine builds and exact-validates the request + context at the deferral
  site, OUTSIDE the provider try/catch (a contract violation is a loud engine
  bug, never a fake provider failure); the worker output boundary and the
  main-thread client re-validate with the same schema.
- `contextHash` = canonical serialization + FNV-1a 64, recomputed by the
  gateway before any upstream call.

### Failure lifecycle (brief §15)

`ExternalDecisionFailure` with the nine bounded codes;
`submit-decision-failure` command; `run.failureInbox` drains at the same
fixed in-tick point as responses. A matching failure records
`DecisionProviderFailed` (structured code) + `DecisionRequestExpired` with
new reason `external-failure` (compatible enum widening; SCHEMA_VERSION
unchanged; old exports still import). The reducer deliberately does NOT flag
re-evaluation for `external-failure`: the NPC keeps its provisional/ongoing
action and re-decides on the ordinary cadence, bounding request rate while a
gateway is down. Moot failures (unknown/resolved request, wrong provider,
wrong scenario) are dropped without canonical consequence. No automatic
upstream retries exist anywhere: one engine request → at most one model call.

### Gateway (brief §10–14)

`gateway/` (Node, plain `node:http`, no framework): exact envelope
validation; registered provider/condition/prompt/Mara identity checks;
context-hash recomputation; single-flight concurrency; per-run 80-call
budget; abort-on-timeout; server-owned prompt (constant system instruction;
all dynamic data serialized as structured JSON inside a delimited
UNTRUSTED_WORLD_DATA block in the user content); JSON-Schema Structured
Outputs with a DYNAMIC enum of exactly the offered IDs; the gateway
constructs the complete engine `DecisionResponse` itself with identity copied
from the validated request, never from model text. Adapters:
`FakeDecisionAdapter` (deterministic; CI default; scriptable failure modes)
and `OpenAIResponsesDecisionAdapter` (official SDK pinned at 6.49.0;
Responses API; `store: false`; no tools/background/persistence; bounded
output tokens; typed refusal/timeout/error failures; exact model ID, response
ID, and token usage recorded in the noncanonical trace only). Trace writer +
run manifests under `artifacts/model-runs/<runId>/` (git-ignored);
`scripts/model/summarize.ts` joins trace ↔ ledger into `model-summary.json`
and writes a sha256 `bundle-manifest.json`.

### Browser orchestration (brief §16–18)

`src/app/modelGatewayClient.ts`: exact request validation, envelope with
crypto-random noncanonical `runId`, POST with AbortController, one in-flight
call, queue ≤ 4, per-run budget 80 (overflow → `budget-exhausted`), typed
failure mapping, stale-`runId` discard before submission, reset/scenario
change aborts in-flight work. Baseline conditions and Jonas/Rin can never
cause a gateway call (condition gate in the composition root + Mara/provider
filter in the client + gateway identity checks). The model panel
(`src/ui/modelPanel.ts`) shows the registered-condition selector, gateway
status, provider/prompt/model IDs, run ID, call/response/failure counters
with per-code breakdown, engine acceptances and rejections, pending Mara
request, latency, and cumulative tokens — and deliberately cannot edit
prompts, keys, provider IDs, or select actions manually. The gateway URL is
nonsecret `VITE_MODEL_GATEWAY_URL`.

### Determinism and fixtures (brief §22)

`src/sim/decisions/fixtureResponseProvider.ts` replays recorded choices and
logical delays with no network; the fixture plan run is byte-identical across
repeats and its export imports and replays — proving world response,
gate verdicts, and replay are deterministic given a recorded exchange. The
standard 100-run batch is unchanged and starts no gateway.

## Deviations from the brief (with reasons)

1. **Envelope carries `truncationCounts`.** §9's envelope list omits it, but
   §17 requires truncation counts in the trace and the gateway is the trace
   writer; the field is transport diagnostics, exact-schema'd.
2. **Gateway response carries a `usage` echo.** §18 requires cumulative
   token display in the UI; usage would otherwise exist only in the
   server-side trace. Transport diagnostics, never canonical.
3. **`PROTOCOL_CONDITION_IDS` mirror in `src/shared/workerProtocol.ts`.**
   The shared protocol layer stays a leaf (it cannot import the sim
   registry); a drift test pins the mirror to `CONDITION_IDS`.
4. **§23.4 "browser" tests run in Node** against the same composed modules
   (WorkerSession command semantics + ModelGatewayClient + a real
   fake-adapter gateway over HTTP); Playwright still covers the UI shell.
   Browser-only additions (panel pixel tests) were judged out of scope.
5. **Failure inbox drains after responses** at the same fixed point —
   deterministic and documented; the brief did not specify relative order.
6. **`budget-exhausted` doubles as the queue-overflow and concurrency-refusal
   code** (marked retryable for transient refusals), per §16's "or a
   similarly explicit failure".

## Test evidence (all executed from this tree)

- `npm run typecheck`, `npm run typecheck:gateway` — clean.
- `npm run lint` — clean. `npm run validate` — PASSED (now also enforcing:
  no `openai` import and no `OPENAI_API_KEY`/`VITE_OPENAI` reference under
  `src/`; gateway imports no app/worker/render/ui module).
- `npm run test:run` — **306 tests / 39 files** passing, including the new
  suites: provider plans (6), external request schema (5), gateway + prompt
  contract + metrics + identity/trace regressions (19), summarizer + scanner
  self-tests (2), gateway-client unit regressions (5), model condition +
  failure lifecycle + fixtures (6), browser/worker/gateway integration (5).
- `npm run test:gateway` — 21/21 (fake adapter only; no secret, no network
  beyond localhost).
- `npm run build` → `npm run check:dist` — dist secret scan PASSED
  (no key path, no canary, no OpenAI SDK/host in the browser bundle).
- `npm run build:gateway` — dist-gateway/main.js (SDK external).
- `npm run test:e2e` — 9/9 Playwright.
- `npm run batch` — full 100 runs/scenario PASSED with **all fourteen golden
  hashes byte-identical** to release 1.2.0 (A 8bf6de492261aa78/2b37e828af8d8b30
  … F 099557a99bde1fb4/36daff45eae4fcd3); no gateway started.
- `npm run test:model:live` — skips by default (verified); not executed live.

### Fake-gateway model condition across all supported scenarios (§28.17)

Executed once via the in-process harness (fake adapter, paced stepping);
every run reached tick 2700, exported, imported, and replayed to a hash
match, with only Mara generating traffic:

| Scenario | Gateway acceptances | Engine rejections | Task | Import/replay |
| -------- | ------------------- | ----------------- | ---- | ------------- |
| A | 47 | — | completed | ok / match |
| B1 | 47 | — | completed | ok / match |
| B2 | 47 | — | completed | ok / match |
| C | 49 | 1 × stale-dependencies | completed | ok / match |
| D | 47 | — | completed | ok / match |
| E | 48 | — | completed | ok / match |

Notes: the single Scenario C rejection is the staleness gate correctly
refusing a model-shaped response that crossed a world change. The fake
adapter's mechanical work-preferring policy makes Mara occupy the bench
continuously, so B2/D complete the purifier and the relief promise ends
`broken` under this condition — a property of the FAKE policy, not evidence
about any real model, and not comparable to the deterministic baseline.

## Security posture

Key and model name read only in the gateway process (`.env.gateway`,
git-ignored; `.env.gateway.example` committed); fail-fast when missing; no
`VITE_` secret; JSON-only bodies with a 512 KB limit and localhost origin
allowlist; no tools, no background mode, no conversation persistence,
`store: false`; gateway logs and traces contain no authorization material
(under test); logical provider binding enforced at the engine gate — this
prototype does not authenticate browser↔gateway transport, and a production
deployment would require authenticated transport and request integrity.

## Known limitations

- The live OpenAI path is implemented but not yet exercised against the real
  API from this environment (no key configured); the opt-in smoke test and
  the manual acceptance sequence in brief §20 remain for the user. Per §29,
  no live test is reported as passed.
- The gateway's per-run budget map is bounded (64 runs) with oldest-first
  eviction; a long-lived gateway serving >64 concurrent run IDs would reset
  the oldest run's budget count.
- `engineOutcome` in trace entries is joined post-hoc by the summarizer, not
  streamed back to the gateway.
- The fake adapter's policy is intentionally simple; it validates
  infrastructure, not behavior.

## Recommended next experiment

Run the live acceptance sequence (§20), then the pre-registered comparison:
deterministic Mara vs `mara-model-per-decision-v1` on A and the B1/B2 memory
ablation (same model, same prompt version, fresh runIds), summarized with
`npm run model:summarize`. Only after that baseline is measured cleanly does
the policy-patch condition (§31) become meaningful.

## Adversarial review of this change-set

Per project practice: 5 Opus-xhigh finders (lenses: baseline determinism,
authority/spoofing/secrets, failure lifecycle, gateway/client transport,
coverage honesty), each finding independently attacked by 2 Opus-xhigh
refuters (47 agents total). 14 findings survived refutation — four of them
the same client defect seen through different lenses — and every one is fixed
in this release with regression tests:

1. **`ModelGatewayClient.pump()` was re-entrant across the `connect()` await**
   (reported by four lenses; refuters reproduced N concurrent upstream POSTs
   and a bypassed queue cap with genuine Mara requests). Fixed: a synchronous
   single-flight latch taken before any suspension point drives a sequential
   dispatch loop; unit tests pin max-one-concurrent-POST through the connect
   window, the queue cap, and the per-run budget.
2. **(high) The OpenAI SDK's default `maxRetries: 2`** would have made one
   engine request cost up to three upstream calls, corrupting the milestone's
   one-request-one-call accounting. Fixed: `maxRetries: 0`.
3. **`connect()` had no timeout**, so a gateway that accepted connections but
   never answered stalled the queue with no typed failure. Fixed: the
   provider-config fetch aborts on the client timeout and degrades into
   typed `gateway-unavailable` failures (under test).
4. **Old-run decision-requests could be re-labelled with the NEW gateway
   runId** (the worker's queued messages survive a reset). Fixed: the worker
   stamps every decision-request with a `runSeq` incremented on load/reset,
   and the client drops mismatches before forwarding (worker side under
   test; the client branch is three lines in the DOM-bound WorkerClient).
5. **Selecting a scenario the model condition refuses desynchronized UI and
   worker.** Fixed: the client degrades the selection to the baseline
   condition, visibly, before sending the load.
6. **(high) The gateway's only-Mara identity arm was mutation-survivable.**
   Fixed with a dedicated test: an internally consistent non-Mara envelope
   is rejected with no trace entry.
7. **(high) The stale-runId discard was only exercised via the abort path.**
   Fixed: a unit test proves a COMPLETED result from a superseded run is
   discarded before submission even when the transport ignores the abort.
8. **Trace/metrics coverage was nominal.** Fixed: exact one-entry-per-request
   assertions; a summarizer test covering the trace↔ledger join, and bundle
   hashes that change when (and only when) the trace changes.
9. **§21/§26 derived metrics were missing** (max concurrent calls, calls per
   Mara decision opportunity, model calls per simulated NPC-hour). Fixed:
   trace entries record dispatch concurrency; the summary reports all three.
10. **Report/scanner gaps:** this section now exists, the exact file list is
    appended, and the dist scanner covers sourcemaps/JSON/text and has a
    self-test proving it detects its own canary, the key path, and the SDK
    host.

Seven further findings were refuted (details in the review transcript). One
process note: a review subagent deleted the generated `artifacts/model-runs`
directory during probing; `artifacts/` is git-ignored, fully regenerable, and
contained no live model runs, so nothing of value was lost.

## Exact files changed

- `.env.gateway.example` (added)
- `.github/workflows/ci.yml` (modified)
- `.gitignore` (modified)
- `README.md` (modified)
- `documentation/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md` (added)
- `gateway/adapters/fakeDecisionAdapter.ts` (added)
- `gateway/adapters/modelDecisionAdapter.ts` (added)
- `gateway/adapters/openaiResponsesAdapter.ts` (added)
- `gateway/config.ts` (added)
- `gateway/main.ts` (added)
- `gateway/metrics/runMetrics.ts` (added)
- `gateway/prompts/maraActionSelection.ts` (added)
- `gateway/schemas.ts` (added)
- `gateway/server.ts` (added)
- `gateway/tracing/modelTraceWriter.ts` (added)
- `gateway/tsconfig.json` (added)
- `gateway/vite.config.ts` (added)
- `package-lock.json` (modified)
- `package.json` (modified)
- `scripts/model/liveSmoke.ts` (added)
- `scripts/model/summarize.ts` (added)
- `scripts/security/scanDist.ts` (added)
- `scripts/validate/run.ts` (modified)
- `src/app/main.ts` (modified)
- `src/app/modelGatewayClient.ts` (added)
- `src/app/store.ts` (modified)
- `src/app/workerClient.ts` (modified)
- `src/shared/decisionContracts.ts` (modified)
- `src/shared/versions.ts` (modified)
- `src/shared/workerProtocol.ts` (modified)
- `src/sim/decisions/conditions.ts` (added)
- `src/sim/decisions/externalContext.ts` (added)
- `src/sim/decisions/externalDeferredProvider.ts` (added)
- `src/sim/decisions/externalSchemas.ts` (added)
- `src/sim/decisions/fixtureResponseProvider.ts` (added)
- `src/sim/decisions/providerPlan.ts` (added)
- `src/sim/events/eventSchemas.ts` (modified)
- `src/sim/events/reduce.ts` (modified)
- `src/sim/events/types.ts` (modified)
- `src/sim/runtime/engine.ts` (modified)
- `src/sim/runtime/host.ts` (modified)
- `src/sim/runtime/ledgerFileBuilder.ts` (modified)
- `src/ui/modelPanel.ts` (added)
- `src/worker/commandProcessor.ts` (modified)
- `tests/gateway/gateway.test.ts` (added)
- `tests/gateway/summarize-and-scan.test.ts` (added)
- `tests/integration/model-condition.test.ts` (added)
- `tests/integration/model-gateway-integration.test.ts` (added)
- `tests/unit/external-request-schema.test.ts` (added)
- `tests/unit/model-gateway-client.test.ts` (added)
- `tests/unit/provider-plan.test.ts` (added)
- `vitest.config.ts` (modified)
