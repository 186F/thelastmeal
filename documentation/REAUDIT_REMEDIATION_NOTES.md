# Re-Audit Remediation Notes — release 1.2.0

**Responds to:** `documentation/REMEDIATION_REAUDIT_REPORT.md` (re-audit of 1.1.0 at
commit `6493efb`, PR #1)
**Scope:** the five findings recommended for implementation after independent
adversarial verification of all six (one Opus-xhigh verifier per finding, each
instructed to refute it against the source; several validated their conclusions by
prototyping the fix in a sandbox clone or forging resealed ledgers).

Verification verdicts: findings 1, 2, 4, 5, 6 CONFIRMED; finding 3 PARTIAL (code
claims accurate, severity overstated — no live consumer of a nonterminal
`worldStateHash` exists, and `endScenario` force-expires all pending requests
before the only hash site).

## Implemented

### 1. Provider binding at the acceptance gate (High — the release blocker)

`processDecisionResponse` now enforces, immediately after request/NPC/scenario
identity and before every other check:

```text
normal response:   response.providerId === pending.providerId
fallback response: usedFallback === true AND response.providerId === run.fallback.id
```

New rejection reason `provider-mismatch` (`DECISION_REJECTION_REASONS` — enum
widening only; `SCHEMA_VERSION` stays 2, previously exported files still import).
`usedFallback` is an engine-side call argument that no external payload can set, so
the fallback exception is not spoofable: an external response merely labeled with
the fallback's ID is rejected. The naive form of this fix (strict equality with no
fallback exception) silently rewrites Scenario F — its 127 legitimate fallback
acceptances would all be rejected — which is why the exception is load-bearing, not
cosmetic. Tests: `tests/integration/provider-binding.test.ts` (wrong provider
rejected with no `ActionProposed` and the request left answerable; correct provider
then accepted; fallback-ID spoof rejected; Scenario F's fallback acceptances all
pass only through the explicit `usedFallback` path; frozen scenarios carry zero
mismatches). Existing wrong-provider test fixtures (`hostile-provider`,
`external-test-gateway`, `external-test`) were relabeled to the authorized
provider — the hostile *selection*, not the label, is what those tests exercise.

### 5. Resolved-request registry (folded in, per the verifier's recommendation)

`EngineRun.resolvedRequests` (engine-owned `Map`, NOT canonical state) records
requestId → accepted/expired/superseded. The gate's `!isCurrentRequest` branch now
reports `superseded-request` for ANY superseded request (not just the most recent)
and `response-expired` for TTL/scenario-end-expired requests; only
accepted/never-existing requests report `unknown-request`.
`rebuildResolvedRequests(events)` proves the registry is a pure projection of the
event stream and is the restoration hook for any future resume-from-ledger path
(equality with the live registry is under test). Bounded at 512 entries with
insertion-order (= event-order, deterministic) pruning. `lastSupersededRequestId`
remains as a replayable diagnostic; the gate no longer reads it. One pinned
expectation changed accordingly: a late response to a TTL-expired request now
reports `response-expired` (was `unknown-request`).

### 2. Semantic import validation

New step 5 of the import pipeline (`validateSemanticConsistency` in
`src/sim/replay/validateLedger.ts`):

- **Metadata reconciliation:** file envelope (scenario id/version/seed/config
  version/provider) must equal the `ScenarioStarted` payload;
  `ScenarioEnded.taskOutcome` must equal `finalSummary.taskOutcome` (which step 10
  already pins to the replayed state).
- **Per-type envelope table:** actor/target reconciled with payload identities for
  the treatment/resource/transfer/commitment/relationship/signal/task/perception
  families (the generic `payload.npcId` rule already covered the rest). Null actor
  and null target are tolerated — scripted world events (injury, scripted removal/
  release) and `ReliefRequested` legitimately carry nulls — so swapped or
  fabricated identities are caught without rejecting genuine engine output.
- **Decision lifecycle join:** every `DecisionResponseAccepted`/`Rejected` must be
  *caused by* a `DecisionResponseReceived` whose responseId/requestId/npcId (and
  for acceptances: selection, confidence, reason code) agree; the accepted
  selection must be in the request's exact offered set; provider authorization
  mirrors the runtime gate (`usedFallback` ⇒ `FALLBACK_PROVIDER_ID`, else the
  request's provider). Rejected responses are provider-exempt by design: recording
  an unauthorized response and rejecting it is exactly what the gate does.
- **Descriptor equality:** an `ActionProposed` caused by an acceptance must launch
  byte-for-byte the offered descriptor (14 field pairs + proposedTerms). Provisional
  bridge proposals (caused by `FallbackDecisionUsed`, deliberately forced
  interruptible) are outside the join by causation scoping.
- **`MODE_TO_CATEGORY`** agreement on every offer and every action event.

Tests forge **resealed** files — recomputed world hash, restamped `ScenarioEnded`,
recomputed ledger hash, exactly what a determined forger would do — and prove each
tamper class is still rejected. A positive test validates genuine exports of all
seven scenarios, including F (fallback carve-out) and C/E/F (null-actor scripted
events).

### 3. Terminal-only `worldStateHash` (scoped fix)

`worldStateHash` now throws `world-state-hash-requires-terminal-state` for
nonterminal states, making the existing de-facto contract explicit. Every
production caller already hashes terminal states (`endScenario` hashes a
provisional terminal clone after force-expiring all pending requests; replay folds
complete ledgers). `buildWorldStateHashProjection` stays unguarded for diagnostics.
The re-audit's Option B (folding provider identity into `worldStateHash`) was
REJECTED: it would defeat the provider-independent world comparison the hash exists
to provide. A separate live decision-state fingerprint is deliberately deferred
until a consumer exists; it must cover `providerId`, `responseIdsSeen`, and
`hardDependencyFingerprint`.

### 4. All-scenario Node/worker parity + real pause/resume

`tests/integration/command-parity.test.ts` now runs the direct-host vs
worker-command comparison for all seven scenarios, comparing `worldStateHash`,
`canonicalLedgerHash`, the complete serialized canonical stream, AND the final
summary. Two corrections to the audit's literal prescription, both verified:

- The previous test's `pause`/`resume` commands were dead no-ops (status-gated
  behind a `start` that was never issued; 0 markers appended). They are now real
  transitions, asserted by marker count, and the direct host mirrors
  `markPaused`/`markResumed` — necessary because `FinalSummary.eventCount` counts
  operator markers, so summary parity requires marker parity.
- The deferred-provider worker test injects `SimulatedAsyncProvider` through the
  session's host (the pattern the async suites already use) and never exports —
  protocol-level provider selection stays deliberately absent (a client choosing
  the decision authority would contradict the engine-owned design). For runs that
  ARE exported with a non-default provider, `createRun` gained an explicit
  `{ provider }` option so `ScenarioStarted` records the true provider and the
  metadata reconciliation (2.1) holds.

## Deferred (to the external-gateway milestone)

- **Finding 6 (outbound `decisionRequestSchema`):** the `decision-request` worker
  message is dead code end-to-end today — no production provider defers, and the
  store field it feeds has no reader. The schema should be defined once on the sim
  side (reusing the config-derived bounds in `eventSchemas.ts`) in the same change
  that installs the first deferring provider, with the two verified throw-site
  cautions (the engine's provider try/catch at the deferred branch; the worker's
  unguarded `afterTickBatch`).
- **Live decision-state fingerprint** (finding 3's larger ask): no consumer exists.

## Rejected prescriptions (with reasons)

- Adding `providerId` to `DecisionResponseAccepted` (or `transportId` to
  `Received`): payloads are hashed verbatim into `canonicalLedgerHash`, so any new
  field re-baselines all seven ledger pins; the causation join enforces the same
  property hash-free.
- Option B provider identity inside `worldStateHash`: contradicts provider
  independence (see above).
- A protocol-level provider selector for tests: hands decision-authority choice to
  the client.

## Verification evidence

- All 14 golden hash pins byte-identical before and after this change-set
  (`tests/integration/golden-hashes.test.ts` + full 100-runs-per-scenario batch).
- Full local gates green: typecheck, lint, validate, 250 tests / 32 files,
  production build, Playwright e2e (9), `npm run batch` (700 runs, replay match,
  complete-stream stability).
- The re-audit's CI caveat is moot: GitHub Actions run 30226472289 is a green
  full-gate run (including the 100-run batch) at exactly the audited commit
  `6493efb`.
- This change-set was itself adversarially reviewed (Opus 5 @ xhigh finders +
  refuters); confirmed findings and their resolutions are recorded in the
  adversarial-review section below.

## Adversarial review of this change-set

Per project practice, the change-set was reviewed by 4 Opus-xhigh finders
(lenses: gate correctness/determinism, spoofing/authority bypass, import false
positives+negatives, coverage/regression honesty) whose 16 raw findings were each
independently attacked by 2 Opus-xhigh refuters (a finding survives only if both
refuters fail to kill it). 3 findings survived; all are fixed in this release with
regression tests:

1. **(medium) `ActionStarted` was outside the descriptor join.** The reducer
   installs `currentAction` from the ActionStarted payload — not from the
   proposal — so a resealing forger could edit the start event (interruptible
   flag, duration, affordance, even the acting NPC) while the
   ActionProposed↔offer join stayed green; refuters reproduced four such
   forgeries importing clean. Fixed: every non-scripted `ActionStarted` must now
   repeat its proposal's descriptor byte-for-byte (`start-descriptor-divergence`),
   closing the chain offer → proposal → start. Measured against genuine output
   first: 229/229 proposal-joined starts across all seven scenarios agree on all
   fields.
2. **(medium) The provisional carve-out was unauthenticated.** Re-pointing a
   proposal's `causationId` at any earlier `FallbackDecisionUsed` silently
   disabled the descriptor join. Fixed: both causation arms are now
   authenticated — a proposal must be caused by an acceptance (full join) or by a
   *provisional* `FallbackDecisionUsed` for the same NPC, in which case it must
   launch the fallback-selected offer verbatim except `interruptible === true`
   (the engine forces it); anything else is `proposal-cause-invalid`.
3. **(low) Four step-5 checks shipped untested** (`target-payload-mismatch`,
   `request-offer-id-divergence`, the `Rejected`→`Received` join, `proposedTerms`
   equality) — disabling them left the suite green. Fixed: each now has a
   dedicated tampered-file test, including a purpose-built deferred-run export
   containing a genuine rejection record and provisional bridges (shapes the
   frozen scenarios never produce), which also serves as a positive control for
   the provisional arm.

One refuted-but-cheap hardening was also adopted: a `usedFallback` acceptance must
be licensed by an earlier `FallbackDecisionUsed` for the same request
(`fallback-acceptance-unlicensed`), closing the coordinated two-field laundering
forgery (flip `usedFallback` + relabel the received provider) that the refuters
judged low-impact but real. The remaining 13 findings were refuted (typically:
the failure scenario cannot occur, the behavior is intended, or the property is
enforced elsewhere); details live in the review transcript.
