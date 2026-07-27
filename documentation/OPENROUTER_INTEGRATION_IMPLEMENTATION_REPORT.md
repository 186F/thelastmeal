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

1. OpenRouter's Responses API is beta; one disposable live smoke request is required before formal collection.
2. Router metadata is additive and may be absent in some early API-edge or cache/error cases. The integration decodes it permissively and never lets metadata absence affect canonical simulation behavior.
3. The existing finalized-trace field named `engineResolutionEventId` still carries the pre-1.6.0 semantics identified in the prior audit. That artifact-only correction should be merged before the formal six-run acceptance dataset is collected.
4. No live OpenRouter request has been executed by this implementation. The live acceptance report remains `PENDING`.

## Completion status

The OpenRouter migration is code-complete when the PR's required clean-checkout CI job passes, including the full deterministic batch and keyless formal rehearsal.

It is ready for a disposable live smoke request after merge. It is not, by itself, authorization to begin policy-patch work, dialogue, reflection, additional model-backed NPCs, or the intersubjectivity/coping layer.
