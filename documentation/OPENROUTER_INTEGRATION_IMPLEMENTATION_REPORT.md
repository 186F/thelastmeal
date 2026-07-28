# OpenRouter Integration — Implementation Report (1.6.0)

**Repository:** `186F/thelastmeal`  
**Pull request:** #6 — `agent/openrouter-integration` → `main`  
**Base commit:** `38bd8dd68dc4390525361e087599b229d60ae4b8`  
**Package version:** `1.6.0`  
**Model experiment:** `model-backed-npc-001` v `1.1.0`  
**Condition:** `mara-model-per-decision-v1`  
**External decision provider:** `openrouter-mara-action-v1`  
**Prompt:** `mara-action-selection-1.0.0` — unchanged  
**Frozen Vertical Slice:** v1.0 / `vs001-1.0.0` — unchanged  
**Live OpenRouter test:** not executed by this implementation or by CI

## Summary

Release 1.6.0 changes the registered live Mara route from direct OpenAI API access to an explicit OpenRouter Responses integration. It does not alter the deterministic simulation, the fake adapter, the action vocabulary, the prompt text, canonical events, replay, constraints, scenarios, seeds, or the fourteen frozen baseline hashes.

The migration is explicit rather than an invisible base-URL substitution:

- The registered engine provider is `openrouter-mara-action-v1`.
- The upstream adapter identifies itself as `openrouter-responses-adapter-v1`.
- The model experiment advances from `1.0.0` to `1.1.0` because the upstream routing layer is a material experimental change.
- The prompt remains `mara-action-selection-1.0.0` because its text and model-facing context are unchanged.

## Architecture

```text
Simulation worker
    emits one exact Mara DecisionRequest
        ↓
Browser ModelGatewayClient
    validates the registered experiment contract
        ↓
Local Node gateway
    validates request, context hash, budget and identity
        ↓
OpenRouterResponsesDecisionAdapter
    POST https://openrouter.ai/api/v1/responses
        ↓
One exact model slug
One exact provider slug
Fallbacks disabled
All parameters required
Router metadata enabled
        ↓
Gateway constructs DecisionResponse
        ↓
Engine independently applies provider binding,
staleness, constraints and action validation
```

The model still selects exactly one engine-offered affordance. It never constructs the engine response envelope and never writes canonical state.

## OpenRouter request contract

Every live request sends:

```text
model = OPENROUTER_MODEL
provider.only = [OPENROUTER_PROVIDER]
provider.allow_fallbacks = false
provider.require_parameters = true
store = false
X-OpenRouter-Metadata = enabled
```

The request uses the OpenRouter Responses endpoint and the existing dynamic JSON Schema whose `selectedAffordanceId` enum contains only the current engine offers.

The adapter performs exactly one HTTP request. It contains no retry loop and does not use the OpenAI SDK's retry behavior.

## Configuration

Live configuration belongs only in `.env.gateway` or the gateway process environment:

```text
OPENROUTER_API_KEY=<secret>
OPENROUTER_MODEL=<exact provider/model slug>
OPENROUTER_PROVIDER=<one exact provider slug>
OPENROUTER_HTTP_REFERER=http://localhost:5173
OPENROUTER_APP_TITLE=The Last Meal
```

`OPENROUTER_MODEL` must contain `/`. `OPENROUTER_PROVIDER` must contain exactly one value; comma-separated provider lists are rejected.

The remaining gateway limits are unchanged:

```text
MODEL_REQUEST_TIMEOUT_MS=20000
MODEL_MAX_CONCURRENCY=1
MODEL_MAX_CALLS_PER_RUN=80
MODEL_MAX_TOTAL_CALLS=400
```

The fake gateway requires no key.

## Routing evidence

The adapter opts into OpenRouter router metadata and decodes it permissively. Unknown additive fields are retained as opaque JSON-safe metadata rather than treated as schema failures.

For each request where routing metadata is returned, the gateway writes:

```text
artifacts/model-runs/<runId>/routing/<requestId>.json
```

The sidecar records:

- Run ID
- Request ID
- Selected upstream provider when reported
- The bounded opaque router metadata object

Routing sidecars are noncanonical. They do not influence world state or hashes, but the formal bundle manifest recursively hashes every file in the run directory, including `routing/`, so retained routing evidence is tamper-evident within the finalized bundle.

### Pinned-route enforcement at finalization

Tamper-evidence alone was not enough. As first written, `routing/` was a **write-only** evidence class: the gateway produced it, `walkFiles` hashed it into `bundle-manifest.json`, and no reader ever validated it — `finalize.ts`, `summarize.ts`, and `modelArtifacts.ts` contained zero references to it. Two consequences followed, both of which defeated the point of pinning a route:

- Up to 16,384 characters of verbatim upstream JSON per request entered the hash-bound formal bundle without ever being schema-checked, size-checked on read, or matched to a request the engine actually emitted.
- The final manifest recorded `requestedModelId` and `returnedModelIds` side by side and **never compared them**, and the provider that actually served each call existed only inside the unread sidecars. A silent model or provider substitution — precisely what `allow_fallbacks: false` and a single `provider.only` entry exist to prevent — could reach a `status: completed` manifest.

The finalizer now reads and enforces this evidence. `routerTraceEntrySchema` lives in `src/shared/modelArtifacts.ts` next to the other artifact contracts (one source for the gateway writer and the finalizer), and `OPENROUTER_ROUTER_METADATA_MAX_CHARS` re-exports the shared bound so the write-side and read-side limits cannot drift.

Severity is assigned deliberately:

| Condition | Class | Rationale |
| --- | --- | --- |
| Sidecar fails schema, exceeds the metadata bound, names a mismatched filename, or carries a foreign `runId` | **Contradiction** — fatal in both modes | A present, corrupt artifact is corruption, not missing evidence |
| Sidecar names a request with no external `DecisionRequested` in the ledger | **Contradiction** — fatal in both modes | Same orphan-fatality rule the gateway trace rows already had |
| `upstreamProviderId` disagrees with the pinned provider (`pinned-provider`) | **Strict criterion** | The comparison bridges two upstream-owned naming namespaces; an unanticipated divergence must not destroy an expensive run, but it can never read as `completed` |
| Upstream reported a model the run did not request (`pinned-model`) | **Strict criterion** | A legitimately variant slug must not destroy an expensive live run's artifacts, but a substitution must never read as `completed` either |
| An **answered** request has no routing sidecar (`routing-evidence`) | **Strict criterion** | Absence of evidence, degradable with `--allow-degraded` |
| An **answered** request's sidecar names no selected provider (`routing-provider-evidence`) | **Strict criterion** | Provenance unproven; the mismatch check can only fire on a provider it can see |

Two scoping rules are load-bearing rather than defensive, and both would have broken live runs if written the obvious way.

**Provider names are normalized, not merely case-folded.** The config pins a *routing slug* (`anthropic`, `amazon-bedrock`) while the router reports a *display name* (`Anthropic`, `Amazon Bedrock`). These namespaces diverge on case *and* on word separators, so both sides are reduced to alphanumerics before comparison. An exact compare — or even a case-only fold — would have reported a perfectly pinned run as a substitution.

**Both routing criteria are scoped to answered requests.** The gateway writes a routing sidecar for *failed* calls too: the adapter builds `meta` before it throws on an upstream HTTP error, and `metaFromPayload` always sets both router keys, so the write guard fires for a call nothing served — with a null provider, because no generation happened. Scoring those as unproven provenance would mean a single upstream 402 or 5xx anywhere in a run made `status: completed` permanently unreachable, which is the mirror image of the defect this enforcement exists to prevent.

Provenance also survives truncation: `upstreamProviderId` is derived from the **raw** router metadata rather than the bounded copy, whose truncation fallback carries neither `endpoints` nor `attempts`. Deriving it post-bound would have nulled the provider on exactly the large-metadata responses where routing is most worth proving — and a null provider skips the substitution check entirely.

The metadata bound is enforced on the **bytes on disk**. The schema's `refine` measures zod's rebuilt record, which drops keys such as `__proto__`, so a hand-edited sidecar could carry unbounded bytes while measuring as trivially small. The finalizer therefore measures the raw parsed JSON before schema validation; the refine remains as a shape-level guard for other callers. The write side was also made genuinely bounded — its truncation fallback previously copied upstream strings uncapped and could emit a "truncated" record *larger* than its input (measured: 20,085 chars in, 20,101 out), which the new read-side bound would then have rejected as corruption.

`returnedModelIds` is now computed once and shared between the criterion and the manifest, so two hash-bound facts cannot be derived by two separate expressions.

Runs that are not pinned-route (`adapterKind !== 'openrouter'`) are unaffected: the coverage and provenance criteria do not apply, and no `routing/` directory is expected. Sidecar validation and orphan fatality still apply to any `routing/` directory that exists, whatever the adapter.

The gateway seed manifest also records:

```text
adapterKind = openrouter
openRouterProvider
openRouterRequireParameters = true
openRouterAllowFallbacks = false
openRouterRouterMetadata = true
```

## Security boundaries

The OpenRouter key is gateway-only.

The architecture validator and browser-bundle scanner reject:

- `OPENROUTER_API_KEY` references under `src/`
- A `VITE_OPENROUTER...` secret path
- Direct OpenRouter upstream-host references in browser/simulation source or output
- A known OpenRouter canary key in the production bundle

No key, Authorization header, or process environment is written to canonical events, model traces, routing sidecars, manifests, or logs.

The gateway remains bound to loopback and retains the existing Origin and Host enforcement.

## Error mapping

The adapter maps transport and provider outcomes onto the existing bounded failure lifecycle:

| Upstream condition | Engine-facing failure |
| --- | --- |
| Client or gateway abort | `upstream-timeout` |
| HTTP/API failure | `upstream-error` |
| Model refusal | `upstream-refusal` |
| Empty or non-JSON structured output | `invalid-model-output` |

When OpenRouter returns router metadata on a failed request, it is retained in the routing sidecar through the same noncanonical metadata path.

No automatic retry or provider fallback is introduced.

## Compatibility

### Preserved

- Deterministic baseline provider
- Fake gateway and keyless rehearsal
- Browser/worker protocol version 3
- Ledger format 2
- Canonical event schema 2
- Prompt text and prompt version
- Scenario definitions and seeds
- Constraint and action-validation semantics
- Replay and hashing

### Intentionally changed

```text
model-backed-npc-001: 1.0.0 → 1.1.0
openai-mara-action-v1 → openrouter-mara-action-v1
package: 1.5.0 → 1.6.0
```

Artifacts from model experiment v1.0.0 are not interchangeable with v1.1.0 formal evidence, even though the prompt and game scenario remain unchanged.

## Automated coverage

New keyless tests cover:

- Exact OpenRouter Responses endpoint
- Authorization and app-attribution headers
- Router-metadata opt-in
- Exact model slug
- Exact provider allowlist
- Fallback disabling
- Required-parameter enforcement
- Dynamic structured-output schema
- Output and usage parsing
- Selected-provider extraction
- Router-metadata retention
- HTTP failures without retries
- Responses-format refusals
- Missing OpenRouter configuration
- Invalid model slug
- Multiple-provider configuration rejection
- Public gateway configuration without secret exposure

Existing provider-plan, gateway-client, bundle and gateway fixtures now import the registered experiment constants instead of hardcoding the previous OpenAI provider identity.

Pinned-route finalization adds ten cases: `routerTraceEntrySchema`'s strict matrix plus an at-the-bound acceptance case in `tests/unit/model-artifact-schemas.test.ts`, and nine finalizer cases in `tests/integration/model-bundle.test.ts` covering the genuine pinned route (which also pins the case-insensitive provider comparison), provider mismatch, orphan sidecar, foreign `runId`, schema-invalid sidecar, over-bound metadata on read, model substitution (strict failure plus explicit degrade), missing routing sidecar, unproven provider, and non-pinned-route runs staying unaffected.

These were verified by **mutation**, not merely by passing: with the routing read and both criteria disabled, all eight negative cases fail and the two positive cases still pass. Each test is load-bearing on the enforcement it names.

### Pre-merge review

The enforcement commit was itself reviewed adversarially before merge — five dimension-scoped finders plus two independent refuters per finding, all Opus 5 at xhigh, 23 agents. Nine findings were raised and **eight survived refutation**, including a high-severity defect found independently by three dimensions and reproduced end to end by both refuters: `routing-provider-evidence` scanned every sidecar with no outcome filter, so one upstream HTTP error anywhere in a pinned run would have made `completed` unreachable. The first cut of the test fixture concealed it by synthesizing sidecars only for answered rows — which is not what the gateway does. Every surviving finding is fixed above, the fixture now mirrors real gateway behaviour, and the write-side behaviour it depends on is pinned by a gateway-level test (`tests/gateway/openrouter-routing-trace.test.ts`) so the integration fixture cannot drift back to a prettier version of reality.

The one refuted finding — that `pinned-model` is not gated on `pinnedRouteRun` and would therefore change finalization for `adapterKind: 'openai'` — was correctly refuted: the criterion is degradable, and no OpenAI run is planned.

No automated test makes a live OpenRouter request.

## Manual setup

```bash
npm ci
cp .env.gateway.example .env.gateway
```

Populate the three required OpenRouter values, then start:

```bash
npm run gateway:dev
npm run dev
```

For the one-request disposable smoke test:

```bash
RUN_LIVE_MODEL_TESTS=1 npm run test:model:live
```

The smoke test is connectivity and contract evidence only. It is not a completed experimental run.

## Change control for formal runs

Before the formal six-run live sequence, freeze one exact:

- Repository commit
- `OPENROUTER_MODEL`
- `OPENROUTER_PROVIDER`
- Prompt version
- Request timeout
- Concurrency limit
- Per-run call limit
- Process-wide call limit

Do not use model aliases such as `auto`, `free`, or `latest`. Do not modify the prompt, route or limits between B1 and B2.

The live acceptance report must record the requested model, returned model identifier, configured provider slug, actual provider evidence from routing sidecars, token use, latency, engine outcomes, replay hashes and bundle aggregate hashes.

## Known limitations and next gate

1. OpenRouter's Responses API is beta; one disposable live smoke request is required before formal collection. **Satisfied 2026-07-28:** the disposable smoke test was executed after merge — a first request failed on an upstream 429 shared-pool rate limit, the second passed — and both attempts are recorded as non-formal evidence in [`MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`](MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md).
2. Router metadata is additive and may be absent in some early API-edge or cache/error cases. The integration decodes it permissively and never lets metadata absence affect canonical simulation behavior.
3. The existing finalized-trace field named `engineResolutionEventId` still carries the pre-1.6.0 semantics identified in the prior audit. That artifact-only correction should be merged before the formal six-run acceptance dataset is collected. **Closed by release 1.6.1:** finalized-trace schema v3 separates the engine submission (`engineSubmissionEventId`), the response verdict (`responseVerdictEventId`), and the canonical request resolution (`engineResolutionEventId`); the implementation PR, commits, CI runs, and schema-version evidence are recorded in [`MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md`](MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md).
4. No live OpenRouter request has been executed by this implementation. The live acceptance report remains `PENDING`.

## Completion status

The OpenRouter migration is code-complete when the PR's required clean-checkout CI job passes, including the full deterministic batch and keyless formal rehearsal.

It is ready for a disposable live smoke request after merge. It is not, by itself, authorization to begin policy-patch work, dialogue, reflection, additional model-backed NPCs, or the intersubjectivity/coping layer.

### Merge evidence

| Item | Value |
| --- | --- |
| PR | [#6](https://github.com/186F/thelastmeal/pull/6) — "Pinned OpenRouter model integration (1.6.0)" |
| Final PR head | `83b45103312098dea0b1c57db35798b87cc8008d` |
| PR head CI | run `30325998274` — success |
| Merge commit | `8620ebaacacd563f3be171d46c0054ea699d538d` |
| Merged-main CI | run `30326306354` — success |
| Merged at | 2026-07-28T03:34:47Z |

Both CI runs executed the required clean-checkout job, including the full deterministic batch and the keyless formal rehearsal. Local gates at the final PR head: 446 tests across 51 files, eslint and prettier, both typechecks, `validate` with 0 errors and 0 warnings, both builds, the dist secret scan, and the deterministic batch with all fourteen golden hashes byte-identical.

**No live model call was made during the 1.6.0 work itself; the formal six-run sequence remains PENDING.** The two disposable smoke requests executed after merge on 2026-07-28 (one failed 429, one pass) are recorded as non-formal evidence in `documentation/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md`; its Provenance table and Run log stay fully PENDING.
