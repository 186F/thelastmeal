# Milestone 2 — Phase 3 Unattended Orchestrator — Implementation Report

**Package:** `1.8.0`
**Governing documents:** [`MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md`](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) §19–§20, and [`MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md`](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) Phase 3 ("Build R1 first against existing deterministic and per-decision paths").
**Scope discipline:** no M2 action prompt or per-decision condition (Phase 4); no policy patches, compiler, interpreter, or novelty broker (Phase 5); no live API calls anywhere in Phase 3 — every model-backed path is exercised keylessly through the fake-adapter gateway. No canonical simulation-mechanics change; all fourteen golden hashes byte-identical.

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
| Orchestrator + CLI | `scripts/experiments/m2/{orchestrate,cli,reporting}.ts` | the §19.4 state machine end to end; `m2:orchestrate` (with `--resume`), `m2:evaluate`, `m2:package`, `m2:pilot` (Phase 6 refusal stub), `test:m2` |
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

```text
m2:rehearse — OK
  - sequence completed: 3/3 executions; zip artifacts/m2-sequences/m2-orchestrator-rehearsal-evidence.zip
  - gateway-stop drill: emitted 51, attempted 18, completed 18
  - resume on completed sequence: idempotent (no new executions; reports regenerated)
  - mutated-plan resume refused (resume-identity-mismatch)
  - failure drill: run-timeout attempt preserved with diagnostics and heartbeats
```

- All three attempts (deterministic baseline; per-decision fake gateway; per-decision fake with the planned tick-900 gateway stop) completed unattended with in-browser **replay matches**; both model attempts **strict-finalized `completed`** and produced Phase 2-enriched fingerprints through the exact trace-to-ledger join.
- The gateway-stop drill reproduces the Milestone 1 Run 6 shape keylessly — 51 engine-emitted external requests versus 18 attempted/completed upstream calls, read from the enriched fingerprint — satisfying §19.16's requirement that the gateway-stop path be demonstrated keylessly before any live spend.
- An incidental validation during development: the resume-identity check refused a real mid-sequence configuration change (the package version was bumped while a rehearsal sequence was in flight, and `--resume` was refused with `resume-identity-mismatch: packageVersion: state 1.7.0 != current 1.8.0`) — the §19.11 mechanism catching exactly what it exists to catch.

## 4. Interpretation decisions

1. **`m2:resume` is `m2:orchestrate -- --resume`** (§19.2 allows this when documented — here, in the CLI header, and in the README).
2. **`m2:pilot` is a refusal stub**: the pilot is brief §31 Phase 6 and requires the Phase 4 condition and Phase 5 policy system; the command exists so the §19.2 surface is stable, and it exits 1 with an explanation. `formal-v1.json` and `pilot.json` plans are deliberately NOT shipped — a committed plan naming conditions that do not exist yet would be an executable lie.
3. **Deterministic attempts produce ledger-only evidence** (validated + bare fingerprint): the run-directory pipeline is model-condition-only by frozen design (no gateway seed manifest, no bundle export under the baseline condition). This matches the M1 evidence model exactly.
4. **The sequence identity records the Milestone 1 experiment** (`model-backed-npc-001` v1.2.0) because Phase 3 drives exactly those paths; the M2 experiment identity joins the plan schema in Phase 4.
5. **Rehearsal pacing is 20×** under `evidentiary: false` (§19.17 allows accelerated fake-adapter rehearsals); the schema refuses any non-1× pacing the moment a plan declares itself evidentiary.
6. **The planned gateway stop is tick-triggered** (the M1 Run 6 drill). A mid-flight stop is legal evidence — the finalizer's disposition taxonomy classifies post-stop requests — and the rehearsal asserts the enriched fingerprint preserves emitted > attempted.
7. **Keyless env pinning**: fake-gateway children receive every numeric/config setting explicitly, because the gateway's loader falls back to `.env.gateway` FILE values for unset variables and a rehearsal must never depend on a developer's local file. The orchestrator itself never reads that file in any mode.
8. **Ports are constants** (5199/8799) rather than plan fields: §19.6 wants fixed automation ports with refusal, not configuration.

## 5. Test evidence

- Full suite at the implementation head: **65 files, 594 tests passing** (16 new under `tests/unit/m2` + `tests/integration/m2`: plan-schema cross-rules and §19.14 budget refusal, atomic sequence state + per-field resume-identity refusal + interrupted-execution preservation, secret-scan patterns, and a REAL keyless fake-gateway child spawn/readiness/stop cycle on a dedicated test port). `npm run test:m2` scopes the same suites for §19.2.
- New e2e test `automation-contract.spec.ts` pins every contract selector to the live DOM (e2e now 10/10).
- `npm run validate` 0/0; batch PASSED with all fourteen goldens byte-identical; gateway 55/55; model-bundle 127/127; builds + dist secret scan; keyless model rehearsal ×3 strict-completed; `audit:affordances` OK (4 known / 0 unregistered / 4-4 coverage).
- CI gains three steps after the audit per A10: `test:m2`, the keyless `m2:rehearse -- --ci`, and an evidence-artifact upload; the job timeout rises 30 → 45 minutes for the three paced rehearsal runs.

## 6. Known limitations

1. The unattended acceptance test proper (§19.16 Stage A) belongs to Phase 4: it requires the M2 per-decision condition and one live run. Phase 3 proves the machinery keylessly, including the gateway-stop path demonstrated keylessly before any live spend, exactly as §19.16 requires.
2. `m2:pilot` refuses until Phase 6 (see decision 2).
3. The keep-awake lease is best-effort; the §19.13 interlock (`--allow-sleep-risk`) is enforced for live plans only, and no live plan exists yet.
4. Heartbeat cadence, stall windows, and run timeouts are plan fields; the committed rehearsal plans use test-scaled values. Formal plans must use the §19.9–§19.10 values (60 s heartbeat, 120 s stall, 75/90 min timeouts) — enforcing those numerically for evidentiary plans is a Phase 4 concern when the first formal plan is authored.
5. Cross-run evaluation currently reports Mara composites for comparable pairs; the full R2/R3 statistics arrive with those registered studies.
