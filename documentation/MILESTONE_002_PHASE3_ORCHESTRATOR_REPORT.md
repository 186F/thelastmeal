# Milestone 2 — Phase 3 Unattended Orchestrator — Implementation Report

**Package:** `1.8.0`
**Governing documents:** [`MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) §19–§20, and [`MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md`](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) Phase 3 ("Build R1 first against existing deterministic and per-decision paths").
**Scope discipline:** no M2 action prompt or per-decision condition (Phase 4); no policy patches, compiler, interpreter, or novelty broker (Phase 5); no live API calls anywhere in Phase 3 — every model-backed path is exercised keylessly through the fake-adapter gateway. No canonical simulation-mechanics change; all fourteen golden hashes byte-identical.

## 0. Audit remediation record (July 30, 2026)

[`MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md`](MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md) requested changes on nine blockers plus mediums. All are remediated in this head; the accepted architecture (§3 of the audit) is unchanged.

| Audit finding | Resolution |
| --- | --- |
| 1 — release metadata | `package-lock.json` synchronized to 1.8.0; a test fails on any future package/lock version disagreement |
| 2 — treatment identity unbound | Plans carry a reviewed `expectedTreatment` (model, serving route, allowFallbacks=false, requireParameters=true, prompt, condition, experiment) — required for any model attempt; the gateway's public config now exposes the nonsecret `servingProviderId` and the orchestrator verifies EVERY field before Start (typed `treatment-mismatch` refusal), records verified values in execution verdicts and the acknowledgement, binds them (with the study identity) into resume identity, and re-verifies the final manifest after finalization. Evidentiary plans must bind a validated Phase 2 study declaration (id/version/sha256/fingerprint checked against `study:validate`) |
| 3 — freeze unenforced | Evidentiary plans require a pinned SHA, a clean tracked worktree, and an output root OUTSIDE the repository; the exact plan bytes are archived into the sequence root and sha-verified; HEAD, package version, and the archived plan are re-checked before AND after every execution — drift during an attempt preserves the work as a `freeze-violation` |
| 4 — resume mutates/trusts | All identity checks run before any write (refused invocations are byte-read-only); the cost acknowledgement is create-once immutable; every completed execution is SEALED (per-file sha256 + aggregate) and seals are revalidated on resume — missing/altered/added evidence is a typed refusal; a nonempty stateless root is refused; a completed-sequence resume is a NO-OP that verifies seals and launches nothing; `evaluateFromState` fails on a missing fingerprint |
| 5 — completion before sealing | Sequence lifecycle `in-progress → attempts-complete → validating → packaging → completed/failed` with typed `sequenceFailureReason`; `completed` is written only after the archive AND its receipt verify; secret-scan or packaging failure → `failed` |
| 6 — diagnostics incomplete | Every attempt (success or failure) saves `attempt-trace.zip`, final screenshot, final DOM, `console-log.json`, and a `diagnostics-manifest.json` (capture failures recorded explicitly, never silently); failed attempts additionally get failure-* artifacts, the thrown stage/message, and bounded Vite/process-log tails — so finalizer-stage failures have complete browser forensics |
| 7 — packaging not immutable | Writer lock moved OUTSIDE the packaged root; fresh archive in a temp path with atomic move (never an in-place ZIP update); portable forward-slash entries (bsdtar on Windows); extraction verification against the inventory (set + byte equality — stale entries cannot survive); sibling `.sha256` + `.receipt.json` receipts; nested archives (Playwright traces) extracted and secret-scanned; `m2:package` requires a completed, seal-valid sequence; CI uploads the complete evidence zip + receipt + failure drill with `if-no-files-found: error` |
| 8 — profiles/verdicts | Evidentiary plans must use EXACTLY the formal profile (heartbeat ≤60 s, stall 120 s, 75-min normal / 90-min gateway-stop timeouts, per-attempt-kind); a planned gateway stop must FIRE and is evidenced (observed tick, wall clock, accepted responses at stop, child exit) — an unfired stop fails as `gateway-stop-not-fired`; unplanned gateway death in a normal attempt fails as `gateway-died-unexpectedly`; replacements are restricted to the plan's registered `retryableFailureClasses` — integrity/treatment failures halt without spending another run |
| 9 — secret process boundary | Allowlisted child environments: Vite, batch, and fake-gateway children are built from a platform allowlist and structurally cannot carry `OPENAI_API_KEY`/`OPENROUTER_API_KEY`; fake-mode `loadGatewayConfig` no longer reads `.env.gateway` at all and blanks credential/model/route fields even against a poisoned process environment (tested with canary files and env); only the live gateway child receives the full environment (§19.15) |

Mediums: process provenance is an append-only `process-log.jsonl`; the lock uses a unique holder token outside the root; the rehearsal's gateway-stop counts are documented as the pre-registered INVARIANT (`emitted > attempted`, `attempted = completed`) rather than a timing-sensitive constant; `m2:pilot` correctly cites brief §31 **Phase 7** (rehearsal + pilot, after the Phase 6 adversarial audit).

## 1. What Phase 3 delivers

| Component | Files | Purpose |
| --- | --- | --- |
| Automation contract | `src/shared/automationContract.ts` | the stable selector/data-field/text surface the driver uses (§19.7), pinned to the live DOM by an e2e contract test |
| Plan schema | `scripts/experiments/m2/planSchema.ts` | strict plan contract: condition/gateway cross-rules, §19.17 evidentiary 1× pacing, §19.14 worst-case budget refusal incl. replacements, byte-exact plan hash |
| Sequence state | `scripts/experiments/m2/sequenceState.ts` | atomic `sequence-state.json` (§19.11), exact resume-identity refusal, interrupted-execution preservation, execution-id discipline |
| Process manager | `scripts/experiments/m2/processManager.ts` | child spawn with PID/exit-code recording, log capture, graceful-then-forced shutdown (§19.5) |
| Gateway driver | `scripts/experiments/m2/gatewayDriver.ts` | fresh gateway child per model attempt on the fixed port; keyless fake mode pins EVERY setting via env so `.env.gateway` values cannot leak into rehearsals; live mode leaves credential loading entirely to the child (§19.15) |
| Vite driver | `scripts/experiments/m2/viteDriver.ts` | one strict-fixed-port server per sequence (5199), `VITE_MODEL_GATEWAY_URL` injected, occupied port = refusal (§19.6) |
| Browser driver | `scripts/experiments/m2/browserDriver.ts` | fresh Chromium context per attempt; real operator controls; semantic DOM polling; heartbeats (§19.9); stall watchdog + run timeout (§19.9–§19.10); downloads into the attempt directory; in-browser replay gate; failure diagnostics (screenshot, DOM, Playwright trace) |
| Run finalizer | `scripts/experiments/m2/runFinalizer.ts` | deterministic attempts: full ledger validation + bare fingerprint; model attempts: M1 `prepareRunDirectory` → strict `finalizeRunDirectory` → Phase 2 strict-finalized evidence layer → ENRICHED fingerprint |
| Sequence evaluation | `scripts/experiments/m2/evaluateSequence.ts` | cross-run Phase 2 comparisons over completed executions; derived, regenerable |
| Packaging | `scripts/experiments/m2/{secretScan,packageEvidence}.ts` | evidence secret scan (hard failure), SHA256 inventory, portable ZIP (§19.4) |
| Keep-awake | `scripts/experiments/m2/keepAwake.ts` | best-effort cross-platform sleep-inhibition lease; live plans without a lease require `--allow-sleep-risk` (§19.13) |
| Orchestrator + CLI | `scripts/experiments/m2/{orchestrate,cli,reporting}.ts` | the §19.4 state machine end to end; `m2:orchestrate` (with `--resume`), `m2:evaluate`, `m2:package`, `m2:pilot` (Phase 7 refusal stub), `test:m2` |
| Self-verifying rehearsal | `scripts/experiments/m2/rehearse.ts`, `experiments/m2/plans/{rehearsal,failure-drill}.json` | `m2:rehearse`: the keyless three-attempt sequence, the gateway-stop drill, idempotent resume, identity-refused resume, and the preserved-failure drill — asserted, not just run |
| Operator runbook | `documentation/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md` | §20.2 supervision document |

## 2. The ten Phase 3 proofs (scope ruling)

| Property | Where proven |
| --- | --- |
| Process isolation | fresh gateway child + fresh browser context per attempt; PIDs/exit codes recorded; sequential attempts (`orchestrate.ts`, report process table) |
| Fresh gateway per run | `gatewayDriver.startGateway` per model attempt; per-attempt caps; process-wide budget resets by construction |
| Browser isolation | `browser.newContext()` per attempt; no cookies/storage/page reuse (`browserDriver.ts`) |
| Downloads | Playwright `download` events saved directly into the attempt directory under the app's own filenames |
| Replay | in-browser `Replay latest` must report `match` before the context closes; deterministic + model attempts alike |
| Finalization | strict `finalizeRunDirectory` (status `completed`) + Phase 2 evidence layer with the exact trace-to-ledger join |
| Failure preservation | stall watchdog, run timeout, and every thrown stage preserve the attempt directory + diagnostics; failure drill asserts it |
| Resume behavior | atomic state, §19.11 identity refusal, interrupted-execution preservation, idempotent resume — all asserted by `m2:rehearse` |
| Secret scanning | `secretScan.ts` over the whole sequence tree; packaging refuses on any finding; unit-tested patterns |
| Portable packaging | SHA256 inventory + ZIP with recorded zip hash (`packageEvidence.ts`) |

## 3. Rehearsal evidence (keyless)

`npm run m2:rehearse` (self-verifying; also a CI step) on the implementation head:

`npm run m2:rehearse` self-verifies, per run (fake-adapter counts vary with timing, so the rehearsal pre-registers INVARIANTS, not constants):

- All three attempts (deterministic baseline; per-decision fake gateway; per-decision fake with the planned tick-900 gateway stop) complete unattended with in-browser **replay matches**; both model attempts pass **pre-Start treatment verification** (`fake-adapter`/`local` against the gateway's public config), **strict-finalize `completed`**, produce Phase 2-enriched fingerprints, and are **sealed**; the sequence packages with a verified archive and receipt.
- The gateway-stop drill reproduces the Milestone 1 Run 6 shape keylessly — the enriched fingerprint must satisfy **`emitted > attempted` and `attempted = completed`**, and the stop is EVIDENCED (fired flag, observed tick, wall clock, accepted responses at stop, child exit) — satisfying §19.16's requirement that the gateway-stop path be demonstrated keylessly before any live spend.
- The completed-sequence resume is asserted to be a **no-op** (seals verified; process log and state bytes unchanged; nothing launched); the mutated-plan resume is refused; the failure drill preserves a `run-timeout` attempt with full diagnostics.
- An incidental validation during development: the resume-identity check refused a real mid-sequence configuration change (the package version was bumped while a rehearsal sequence was in flight, and `--resume` was refused with `resume-identity-mismatch: packageVersion: state 1.7.0 != current 1.8.0`) — the §19.11 mechanism catching exactly what it exists to catch.

## 4. Interpretation decisions

1. **`m2:resume` is `m2:orchestrate -- --resume`** (§19.2 allows this when documented — here, in the CLI header, and in the README).
2. **`m2:pilot` is a refusal stub**: the pilot is brief §31 Phase 7 (rehearsal + pilot, after the Phase 6 adversarial audit) and requires the Phase 4 condition and Phase 5 policy system; the command exists so the §19.2 surface is stable, and it exits 1 with an explanation. `formal-v1.json` and `pilot.json` plans are deliberately NOT shipped — a committed plan naming conditions that do not exist yet would be an executable lie.
3. **Deterministic attempts produce ledger-only evidence** (validated + bare fingerprint): the run-directory pipeline is model-condition-only by frozen design (no gateway seed manifest, no bundle export under the baseline condition). This matches the M1 evidence model exactly.
4. **The sequence identity records the Milestone 1 experiment** (`model-backed-npc-001` v1.2.0) because Phase 3 drives exactly those paths; the M2 experiment identity joins the plan schema in Phase 4.
5. **Rehearsal pacing is 20×** under `evidentiary: false` (§19.17 allows accelerated fake-adapter rehearsals); the schema refuses any non-1× pacing the moment a plan declares itself evidentiary.
6. **The planned gateway stop is tick-triggered** (the M1 Run 6 drill). A mid-flight stop is legal evidence — the finalizer's disposition taxonomy classifies post-stop requests — and the rehearsal asserts the enriched fingerprint preserves emitted > attempted.
7. **Keyless env pinning**: fake-gateway children receive every numeric/config setting explicitly, because the gateway's loader falls back to `.env.gateway` FILE values for unset variables and a rehearsal must never depend on a developer's local file. The orchestrator itself never reads that file in any mode.
8. **Ports are constants** (5199/8799) rather than plan fields: §19.6 wants fixed automation ports with refusal, not configuration.

## 5. Test evidence

- Full suite at the remediated head: **66 files, 605 tests passing**. The m2 suites cover: plan-schema cross-rules, the §19.14 budget refusal, evidentiary formal-profile enforcement, expected-treatment and study-binding requirements, static scenario/condition pairing; atomic sequence state with 14-field resume-identity refusal and interrupted-execution preservation; release-metadata (package/lock) agreement; poisoned-environment child-env allowlists and the fake gateway's structural `.env.gateway` refusal (canary file + canary env); execution seals detecting tamper/deletion/addition; portable packaging (receipt, exclusions, fresh-archive stale-entry impossibility, nested-archive secret scan); secret-scan patterns; and the REAL keyless fake-gateway child cycle. `npm run test:m2` scopes the m2 suites for §19.2.
- New e2e test `automation-contract.spec.ts` pins every contract selector to the live DOM (e2e now 10/10).
- `npm run validate` 0/0; batch PASSED with all fourteen goldens byte-identical; gateway 55/55; model-bundle 127/127; builds + dist secret scan; keyless model rehearsal ×3 strict-completed; `audit:affordances` OK (4 known / 0 unregistered / 4-4 coverage).
- CI gains three steps after the audit per A10: `test:m2`, the keyless `m2:rehearse -- --ci`, and an evidence-artifact upload; the job timeout rises 30 → 45 minutes for the three paced rehearsal runs.

## 6. Known limitations

1. The unattended acceptance test proper (§19.16 Stage A) belongs to Phase 4: it requires the M2 per-decision condition and one live run. Phase 3 proves the machinery keylessly, including the gateway-stop path demonstrated keylessly before any live spend, exactly as §19.16 requires.
2. `m2:pilot` refuses until Phase 7 (see decision 2).
3. The keep-awake lease is best-effort; the §19.13 interlock (`--allow-sleep-risk`) is enforced for live plans only, and no live plan exists yet.
4. Heartbeat cadence, stall windows, and run timeouts are plan fields; the committed rehearsal plans use test-scaled values. Formal plans must use the §19.9–§19.10 values (60 s heartbeat, 120 s stall, 75/90 min timeouts) — enforcing those numerically for evidentiary plans is a Phase 4 concern when the first formal plan is authored.
5. Cross-run evaluation currently reports Mara composites for comparable pairs; the full R2/R3 statistics arrive with those registered studies.
