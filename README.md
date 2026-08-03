# The Last Meal (`causal-npc-lab`)

**A tiny survival story, simulated with scientific rigor — so we can safely
put an AI in charge of one of its characters and measure what happens.**

Three survivors share a workshop after a disaster: a broken water purifier, a
single remaining meal, a promise that comes due, and an injury at the worst
possible moment. Every run of the story is computed deterministically —
same starting conditions, same outcome, every time — and every run writes a
complete, replayable record of everything that happened.

That rigor is the point. It lets us hand one character's decisions to a
language model and answer, with checkable evidence: did the AI-driven
character act in character? Did it follow the rules of the world? Could a
neutral reviewer tell the characters apart just by watching their behavior?

A note on one word first: the people in a story that the computer plays are
called NPCs — "non-player characters" — and this document uses "character"
and "NPC" interchangeably. The project's north-star question is: **which
cognitive functions should be deterministic, which should be generative, and
at what timescales should each operate so that long-running simulated lives
remain persistent, grounded, varied, causally intelligible, and compelling to
observe?** Model calls, tokens, cost, and latency matter as operational
diagnostics, but they are not the research objective or a substitute for
behavioral quality.

This repository is **Vertical Slice 001**, the first building block of that
program. It contains the simulation, the browser app for watching and
controlling runs, the AI "gateway" (a small local server) that connects one
character to a language model, and a growing automated laboratory that runs
whole experiments unattended.

## The big idea: sparse cognition

When a language model drives Mara in the current system, it selects an action
from engine-legal options at each genuine decision point. The world does not
wait: a deterministic fallback covers late or failed responses, and every
accepted action still passes through the simulation's authority boundary.

For the current research program, **sparse cognition** means bounded generative
authority over cognitive functions. It asks which forms of appraisal,
reflection, planning, dialogue, memory, and development a model may influence,
and on what timescale. How often the model is called is a separate question: a
system can call frequently while granting narrow authority, or call rarely
while granting broad authority.

The Milestone 3 charter therefore defines seven neutral candidate allocations:

1. deterministic control;
2. per-decision generative control;
3. episode-appraisal / policy-artifact cognition;
4. reflection-only cognition;
5. planning-only cognition;
6. dialogue-only generation over engine-selected intent; and
7. mixed multi-timescale cognition.

The episode-appraisal / policy-artifact design is one candidate, not the
program's assumed destination. None of the seven is selected or authorized for
implementation. Across every candidate, the deterministic engine remains the
final authority over objective world state, legal affordances, and committed
consequences. Model prose can express or propose cognition; it cannot make a
world claim true or silently rewrite history.

Milestone 1 established that one character could be driven through the live
model gateway while preserving legal action, replay, and evidence requirements.
Milestone 2 then built the automated laboratory and completed a registered
ten-run per-decision calibration. That historical calibration found highly
repetitive behavior and a consistent semantic error about the story's central
promise, so Milestone 2 closed before the planned policy comparison and made no
sparse-cognition acceptance claim. See the
[closeout report](documentation/milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md)
and
[canonical analysis](documentation/milestones/002-sparse-cognition/calibration/m2-calibration-variance-a-001.analysis.md).

## Why build the laboratory first?

The laboratory is a research instrument, not a claim that any candidate
architecture works. Its event and evidence machinery makes a causal chain
inspectable: what a character could know, which actions the engine offered,
what a decision source proposed, whether the simulation accepted it, what
happened in the world, and what later state followed. Exact replay,
deterministic fallback, and versioned model, provider, prompt, and execution
provenance help separate model behavior from engine behavior, operational
failure, and presentation prose.

The charter proposes matched comparisons among cognitive-authority allocations
instead of a linear path toward one preferred design. A future causal-twin
method would fork two descendants from one authoritative common ancestor,
apply one preregistered difference, and preserve separate evidence and replay
lineage after divergence. Multiple paired replications would be needed before
drawing a bounded conclusion.

Future measurement would keep distinct questions distinct: semantic
correctness, character individuality, repetition and loop recovery,
consequentiality, trajectory emergence, and independent observer evaluation.
Operational diagnostics such as calls, cost, latency, failures, and fallbacks
would explain how evidence was produced, not stand in for behavioral quality.

Parallel execution could make replicated scenario studies practical at higher
throughput, but it is itself a possible treatment. Serial-versus-parallel parity
must be established before their behavioral results are treated as
interchangeable. The charter defines that research direction; no parallel-lab
implementation, causal-twin study, scenario build, or later work package is
currently authorized.

## The project at a glance

|                                 |                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                  | A deterministic browser simulation of three characters under pressure, built as a research instrument                                                                                                                                                                                                                                                         |
| **Built with**                  | Vite, TypeScript, Three.js (browser); Node.js (tools, tests, AI gateway)                                                                                                                                                                                                                                                                                      |
| **Implementation release**      | 1.9.0                                                                                                                                                                                                                                                                                                                                                         |
| **Frozen experiment identity**  | Vertical Slice 001 — v1.0, configuration `vs001-1.0.0` (never changes with the release)                                                                                                                                                                                                                                                                       |
| **AI integration status**       | **Live milestone complete:** a six-run formal sequence under experiment v1.2.0 passed every pre-registered threshold (2026-07-29 → 30; [acceptance report](documentation/milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)). Day-to-day development and CI still run keylessly on a stand-in fake model. |
| **Current work**                | Milestone 3 Item 2 is complete: the research charter and claim boundaries are established. No Milestone 3 implementation, live experiment, model call, evidence generation, or Work Package 2 activity is authorized or underway.                                                                                                                             |
| **Current research direction**  | [`documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md`](documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md) — authoritative when merged to `main` for research direction, claim boundaries, sequencing, and governance only                                            |
| **What you need to try it**     | Git, Node.js, and a Chromium-based browser — no account, API key, or payment                                                                                                                                                                                                                                                                                  |
| **Authoritative specification** | [`documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md`](documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md)                                                                                                                                                                                                                                    |
| **Deep technical contract**     | [`documentation/reference/TECHNICAL_REFERENCE.md`](documentation/reference/TECHNICAL_REFERENCE.md)                                                                                                                                                                                                                                                            |

This project deliberately versions several things separately. The three to
keep apart while reading: the **software release** moves with every code
change (currently 1.9.0); the **frozen scenario data** (`vs001-1.0.0`) never
moves — that is what "frozen" means; and the **model-experiment version**
(currently v1.2.0) moves only when the AI setup being tested changes.
(Smaller contracts — the prompt, file formats, individual schemas — carry
their own version strings too; those are catalogued in the technical
documents.)

## The three characters

Each character is defined by data — values, memories, and one hard personal
boundary — not by custom code.

| Character                     | Role in the story                                                                                                                                      | Values                                                | Hard boundary                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| **Mara** (drawn as a box)     | Repairs the water purifier at the workbench; the relief promise is owed to her. In the AI experiment, she is the character a language model can drive. | Competence, personal dignity, colony survival         | Will not ignore a life-threatening injury when nobody else can intervene |
| **Jonas** (drawn as a sphere) | Promised to relieve Mara at the bench — a promise the scenarios put under pressure.                                                                    | Caring for others, keeping promises, colony stability | Will not knowingly consume food reserved for someone else                |
| **Rin** (drawn as a cone)     | Owns the one remaining meal, and is the one injured when a scenario includes the emergency.                                                            | Personal autonomy, survival, fair treatment           | Will not voluntarily surrender essential food while medically vulnerable |

## The seven scenarios

Every scenario runs for 45 simulated minutes (2,700 one-second ticks) from a
fixed seed.

| ID  | Title                     | What it tests                                                                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A   | Routine Operation         | Ordinary work, hunger, relief, promise, and meal behavior — no injury                                                           |
| B1  | Pride Memory Present      | Mara runs with a memory of being criticized…                                                                                    |
| B2  | Pride Memory Absent       | …and B2 is identical (same seed) with that one memory removed, isolating the effect of a single memory on behavior              |
| C   | Promise Versus Emergency  | Rin is injured while Jonas's promise to Mara comes due — competing obligations of care and duty                                 |
| D   | Scarce Resource Conflict  | Mara starts nearly starving while Rin still holds the meal — an ownership conflict, isolated from the injury                    |
| E   | Stale Decision            | The meal is scripted to vanish after a character decides to eat it but before they can — testing how stale decisions are caught |
| F   | Decision Provider Failure | The decision-making system itself fails mid-run; the built-in fallback must carry the simulation safely to the end              |

## Try it in five minutes

You need **Git**, **Node.js** (version 22 or newer — CI verifies on Node
22), and a Chromium-based browser. In a terminal:

```bash
git clone https://github.com/186F/thelastmeal.git
cd thelastmeal
npm ci          # install exact locked dependencies
npm run dev     # start the app; open the URL it prints (the port is not fixed)
```

What you'll see: a top-down 3D view of the workshop with the three
characters, plus an operator console. Pick a scenario, press **Start**, and
watch. Click any character to inspect what they believe, remember, and are
deciding right now. When a run finishes you can export its complete event
record (the "ledger"), re-import it, and **replay** it — the replay recomputes
the entire run from the record and confirms it reaches exactly the same final
state, verified by **hash**: a short digital fingerprint computed from the
data, where any change to the data yields a different fingerprint, so
alterations are evident. Every control mentioned here — and the rest of the
console — is documented in the
[operator console reference](documentation/reference/TECHNICAL_REFERENCE.md#operator-console-reference).

Optional extras:

```bash
npm run test:e2e:install   # one-time: install the test browser (for e2e tests)
npm run batch              # prove determinism: 100 repeat runs of every scenario, byte-identical
npm run gateway:dev:fake   # start the fake "AI" gateway (no key), then pick the model-driven setup in the app
```

## How it stays trustworthy

The design rests on a few plain rules, each mechanically enforced:

| Rule                                                                            | In practice                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The simulation is the referee**                                               | World state changes in exactly one place (the event reducer). Characters — including an AI-driven one — never touch the world directly.                                                                                                                                                                                                                                                                                                                             |
| **Deciders only pick from an offered menu — and the referee rejects bad picks** | At each decision point the engine generates the full menu of physically concrete actions, with rule-violating options explicitly flagged rather than hidden. Any decision source (scripted, fallback, or AI) can only pick from that menu — and an acceptance gate plus a shared constraint layer then reject an illegal, stale, out-of-character, or forbidden pick before it can touch the world. Offered is not the same as permitted; the gate is what forbids. |
| **No hidden randomness**                                                        | Integer math only, one seeded random source, no wall-clock influence on outcomes. Pausing, stepping, or changing playback speed never changes results.                                                                                                                                                                                                                                                                                                              |
| **Every run is a checkable record**                                             | Each run writes a ledger of typed events. Replaying the ledger reproduces the exact final state; two hashes (world state + full event stream) make tampering evident. Imported ledgers are validated completely or rejected outright.                                                                                                                                                                                                                               |
| **The world never waits for the AI**                                            | If a model is slow, silent, or broken, a deterministic fallback keeps the character acting and the clock running. Model failures are recorded, never fatal.                                                                                                                                                                                                                                                                                                         |
| **Secrets stay out of the browser**                                             | The API key exists only inside a separate local gateway process. Scanners and validators enforce that no secret can appear in client code, builds, or exported files.                                                                                                                                                                                                                                                                                               |
| **Proven on every change**                                                      | Continuous integration re-runs everything from a clean checkout — including the 100-run determinism batch and full keyless rehearsals — and fourteen "golden hashes" pin the frozen baseline byte-for-byte.                                                                                                                                                                                                                                                         |

The full engineering contract behind this table — hashing rules, the
decision lifecycle, import validation, the constraint system — is in the
[technical reference](documentation/reference/TECHNICAL_REFERENCE.md).

## The AI experiment (Milestone 1)

Mara can be driven by a language model through a small local server (the
"gateway"), while Jonas and Rin stay deterministic. The important
properties, in plain terms:

- The model **only chooses from the menu** the engine offered — it cannot
  invent actions, and every choice passes the same acceptance gate as any
  other decision source.
- The browser can only name a registered experimental **condition** — one of
  the pre-registered setups being compared (for example "everyone
  deterministic" versus "Mara model-driven") — never a model, provider, or
  prompt. Those are pinned inside the gateway, and a check before every run
  confirms both sides agree on the exact setup.
- Every model **request** is archived **byte-for-byte** — including requests
  that never reached the model — and each response is recorded as its
  structured selection plus outcome, timing, and identifiers (the model's
  raw text is retained, bounded, only when it was invalid or a refusal). A
  finished run exports as a validated evidence bundle, which a strict
  finalizer then joins with the gateway's own records and seals into a
  hash-linked archive.
- A **keyless rehearsal** (`npm run model:rehearse`) proves the whole
  pipeline — including a mid-run gateway shutdown and slow-response
  scenarios — using a deterministic fake model, so CI needs no secrets and
  spends no money.

> **Status:** the formal live milestone is **complete and passed**. A
> six-run formal sequence with the real AI service (experiment v1.2.0, run
> 2026-07-29 → 30 at a frozen code version) met every pre-registered
> threshold — six of six runs, with sealed evidence archives
> ([acceptance report](documentation/milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)).
> An earlier attempt (2026-07-29, experiment v1.1.0) was stopped early when
> the AI provider throttled our requests and a run fell below the standards
> committed to in advance; that attempt is preserved — not erased — as
> non-acceptance evidence in the same report. Results from the stand-in fake
> model prove the plumbing works; they are never reported as real-AI
> results.

Live-run setup and the operator walkthrough live in the
[technical reference](documentation/reference/TECHNICAL_REFERENCE.md#live-run-operator-setup-and-walkthrough).

## The automated laboratory (Milestone 2, closed after calibration)

Milestone 2 turned the project from "an experiment you run by hand" into
"a laboratory that runs experiments unattended" — built in audited
phases:

- **Phase 2 (landed):** the measurement tools. Behavioral "fingerprints" — a
  versioned numerical profile of how a character behaved in a run, so two
  runs can be compared automatically and deterministically; a registry for
  declaring a study's design _before_ running it; automated audits that
  check the simulation really offers and interrupts actions the way its
  contracts promise; and blinded review packages, so a human can judge
  behavior without knowing which character produced it
  ([report](documentation/milestones/002-sparse-cognition/phase-02-laboratory/MILESTONE_002_PHASE2_LABORATORY_REPORT.md)).
- **Phase 3 (landed):** one command
  (`npm run m2:orchestrate -- --plan <plan>`) runs a whole planned sequence
  of runs unattended — it starts the real app and a real browser, drives the
  actual on-screen controls, downloads and validates the evidence, seals
  everything with hashes into a versioned archive, preserves failures
  instead of deleting them, and can resume safely after interruptions
  (including failures that happen during evidence packaging itself). A
  self-verifying keyless rehearsal (`npm run m2:rehearse`) exercises the
  entire pipeline, including deliberate failure drills
  ([report](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md),
  [operator runbook](documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md)).
- **Phase 4 (complete — merged at `8282dfe`):** the experiment's model-driven
  baseline arm — the new AI condition and prompt under the Milestone 2
  experiment identity (with rationale and confidence downgraded to
  harmless diagnostic notes, so a chatty model can never invalidate a
  sound choice); the reviewed formal profile and both registered study
  files (the two-run acceptance and the ten-run self-consistency
  calibration); browser traces rotated into bounded retained chunks with
  early evidence-size forecasting for multi-hour live runs; and a
  registration ritual (`npm run m2:register`) that pins reviewed study
  templates to one exact repository state immediately before execution
  ([report](documentation/milestones/002-sparse-cognition/phase-04-per-decision/MILESTONE_002_PHASE4_PER_DECISION_REPORT.md)).

The laboratory then ran for real. Stage A acceptance passed on
2026-08-01 (a deterministic Scenario A baseline plus the same scenario
driven live through the pinned gateway, both registered against one
exact merged repository state), and the registered ten-run calibration
completed on 2026-08-02 — ten valid runs, first attempt each, sealed
evidence, and a registered analysis. The calibration's answer is what
closed the milestone: the per-decision condition repeated itself almost
exactly (median composite similarity 10,000 basis points), varied only
in a consequence-free stretch after the repair was already done, and
consistently described the story's central promise backwards. Rather
than measure whether cheap policies could reproduce that, Milestone 2
closed after calibration with no sparse-cognition acceptance claim —
the full reasoning and claim boundary are in the
[closeout report](documentation/milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md).

## Vertical Slice 001 correctness and distinctiveness criteria

These criteria were recorded for the frozen Vertical Slice 001 before results
and remain historical correctness and distinctiveness requirements for that
slice, not the active Milestone 3 research objective (brief section 26).

**Correctness — the simulation must never break its own rules:**

- No NPC may commit an action whose physical or logical preconditions are false.
- A meal may not be consumed more than once.
- Two NPCs may not simultaneously hold an exclusive reservation for the same resource.
- A promise may not be simultaneously recorded as both fulfilled and broken.
- A rejected action may not mutate canonical world state.
- Replaying an event ledger from the same initial state must reproduce the exact same final canonical state.
- The simulation must continue when the active decision provider fails.

**Behavioral distinctiveness — the characters must be genuinely different:**

- Mara, Jonas, and Rin must exhibit distinguishable action patterns under equivalent circumstances.
- An anonymized action trace should permit a human reviewer to identify the NPC above the 33% chance baseline (later-study target: ≥ 70%).
- A relevant memory must measurably alter behavior in a controlled comparison (B1/B2).
- Memory and personality may affect preferences but may not bypass survival constraints, action legality, or the authoritative event system.

## Commands

Grouped by purpose; a one-line description each. Commands with substantial
semantics are detailed in the
[technical reference](documentation/reference/TECHNICAL_REFERENCE.md#npm-command-details).

**Everyday development**

| Command                                           | What it does                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                                     | Start the app locally (open the URL it prints; the port is not fixed) |
| `npm run build`                                   | Typecheck, then build the production bundle into `dist/`              |
| `npm run preview`                                 | Serve the production bundle locally                                   |
| `npm run typecheck` / `npm run typecheck:gateway` | Strict TypeScript checks (app / gateway)                              |
| `npm run lint`                                    | ESLint (incl. simulation-purity rules) + Prettier check               |
| `npm run test` / `npm run test:run`               | Unit + integration tests (watch mode / run once)                      |
| `npm run test:coverage`                           | Tests with V8 coverage over `src/sim` and `src/shared`                |

**Verification gates**

| Command                     | What it does                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`          | Experiment-data validation + architecture checks (simulation-purity import scan, required npm scripts); exits nonzero on failure |
| `npm run batch`             | The determinism proof: 100 repeat runs per scenario, complete event-stream equality (`-- --runs=N` to change)                    |
| `npm run test:e2e`          | Browser end-to-end tests; starts its own Vite server (`npm run test:e2e:install` first, once)                                    |
| `npm run test:gateway`      | Gateway test suite (fake adapter, no secrets, loopback only)                                                                     |
| `npm run test:model:bundle` | The formal model-artifact gate — the ten bundle/schema/client/corruption/finalizer/rehearsal/event-semantics suites              |
| `npm run test:m2`           | The Milestone 2 orchestrator suites                                                                                              |
| `npm run check:dist`        | Post-build secret scan over `dist/` (key names, canary values, upstream host strings)                                            |
| `npm run audit:affordances` | Affordance and interruption-contract audit against the known-gap registry                                                        |

**Model gateway and run evidence (Milestone 1)**

| Command                     | What it does                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run gateway:dev:fake`  | Start the local gateway with the deterministic fake model (no key needed)                                               |
| `npm run gateway:dev`       | Start the LIVE gateway (requires credentials in `.env.gateway`)                                                         |
| `npm run build:gateway`     | Bundle the gateway into `dist-gateway/`                                                                                 |
| `npm run model:prepare-run` | Validate and stage an exported run's ledger + bundle for finalization                                                   |
| `npm run model:finalize`    | The strict formal finalizer: joins all evidence sources into a hash-linked bundle, or writes nothing                    |
| `npm run model:summarize`   | Informal, non-gating summary of a staged run (`-- --run-id <id>`; writes `model-summary.json` + `bundle-manifest.json`) |
| `npm run model:rehearse`    | Keyless end-to-end rehearsal of the whole model pipeline (three scenarios incl. gateway-stop)                           |
| `npm run test:model:live`   | Opt-in live smoke call (`RUN_LIVE_MODEL_TESTS=1`; skipped by default, never in CI)                                      |

**Evaluation and studies (Milestone 2)**

| Command                                                | What it does                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `npm run eval:individuality`                           | Role-counterbalanced, blinded reviewer packages for the can-you-tell-them-apart evaluation          |
| `npm run eval:behavior`                                | Build versioned behavioral fingerprints from a ledger or finalized run                              |
| `npm run eval:compare`                                 | Compute the versioned behavioral similarity between two comparable runs                             |
| `npm run eval:reviewer-package` / `eval:score-reviews` | Blinded reviewer packages for validated live ledgers / score returned reviews                       |
| `npm run study:validate`                               | Validate a registered study declaration file                                                        |
| `npm run m2:orchestrate`                               | Run a planned experiment sequence unattended (`-- --plan <path>`; `-- --resume` resumes)            |
| `npm run m2:register`                                  | Register a reviewed template pair from the closed registry at the exact current repository state    |
| `npm run m2:analyze`                                   | Produce the registered ten-run calibration variance analysis for a completed sequence               |
| `npm run m2:evaluate` / `m2:package`                   | Re-derive evaluation outputs / produce the next versioned evidence archive for a completed sequence |
| `npm run m2:rehearse`                                  | Self-verifying keyless rehearsal of the entire unattended pipeline, failure drills included         |
| `npm run m2:pilot`                                     | Refusal stub until the pilot phase is authorized                                                    |

## Version history

The frozen experiment data — scenarios, seeds, identities, needs, rates,
timelines, weights, the ten action categories — is unchanged across **all**
releases; each release hardened the machinery around it. Fourteen golden
hashes pin the deterministic baseline byte-for-byte throughout.

| Release | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Details                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.0   | First audit remediation (decision lifecycle, constraints, schemas, hashing, determinism proofs)                                                                                                                                                                                                                                                                                                                                                                                     | [brief](documentation/history/vertical-slice-001-remediation/THE_LAST_MEAL_AUDIT_REMEDIATION_BRIEF.md) · [report](documentation/history/vertical-slice-001-remediation/AUDIT_REMEDIATION_REPORT.md)                                                                                                                                                           |
| 1.2.0   | Re-audit remediation                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [notes](documentation/history/vertical-slice-001-remediation/REAUDIT_REMEDIATION_NOTES.md)                                                                                                                                                                                                                                                                    |
| 1.3.0   | Model integration milestone 001: Mara can be model-driven through a local gateway                                                                                                                                                                                                                                                                                                                                                                                                   | [brief](documentation/milestones/001-model-integration/briefs/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_BRIEF.md) · [report](documentation/milestones/001-model-integration/reports/MODEL_INTEGRATION_MILESTONE_001_IMPLEMENTATION_REPORT.md)                                                                                                            |
| 1.4.0   | Model-integration re-audit remediation                                                                                                                                                                                                                                                                                                                                                                                                                                              | [brief](documentation/milestones/001-model-integration/briefs/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_BRIEF.md) · [report](documentation/milestones/001-model-integration/reports/MODEL_INTEGRATION_MILESTONE_001_REAUDIT_REMEDIATION_REPORT.md)                                                                                                  |
| 1.5.0   | Model-run artifact integrity, CI verification, keyless rehearsal; version-2 evidence bundles                                                                                                                                                                                                                                                                                                                                                                                        | [brief](documentation/milestones/001-model-integration/briefs/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_CI_REHEARSAL_BRIEF.md) · [report](documentation/milestones/001-model-integration/reports/MODEL_INTEGRATION_ARTIFACT_INTEGRITY_IMPLEMENTATION_REPORT.md)                                                                                                    |
| 1.6.0   | Pinned OpenRouter integration: one exact model, one exact provider route, fallbacks disabled; the registered external provider changes from direct OpenAI access to `openrouter-mara-action-v1` (model experiment advances to v1.1.0; the prompt text and `mara-action-selection-1.0.0` prompt version are unchanged)                                                                                                                                                               | [report](documentation/milestones/001-model-integration/reports/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md)                                                                                                                                                                                                                                              |
| 1.6.1   | Finalized-trace event-semantics correction (derived data only; nothing frozen moved)                                                                                                                                                                                                                                                                                                                                                                                                | [brief](documentation/milestones/001-model-integration/briefs/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_REMEDIATION_BRIEF.md) · [report](documentation/milestones/001-model-integration/reports/MODEL_INTEGRATION_ARTIFACT_EVENT_SEMANTICS_IMPLEMENTATION_REPORT.md)                                                                                         |
| 1.6.2   | Formal treatment change: the pinned upstream model and provider endpoint — which live only in git-ignored gateway configuration — change from `inclusionai/ling-2.6-flash` via `novita` to `google/gemini-2.5-flash-lite` via `google-ai-studio`, after the v1.1.0 live attempt was aborted under sustained rate limiting (model experiment advances to v1.2.0; the prompt, provider identity, condition, scenarios, thresholds, action system, and gateway behavior do not change) | [addendum](documentation/milestones/001-model-integration/reports/OPENROUTER_INTEGRATION_IMPLEMENTATION_REPORT.md) · [attempt record](documentation/milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)                                                                                                    |
| 1.7.0   | Milestone 2 Phase 2: the laboratory foundation (fingerprints, similarity, study registry, contract auditors, blinded review)                                                                                                                                                                                                                                                                                                                                                        | [brief](documentation/milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) · [scope ruling](documentation/milestones/002-sparse-cognition/MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) · [report](documentation/milestones/002-sparse-cognition/phase-02-laboratory/MILESTONE_002_PHASE2_LABORATORY_REPORT.md) |
| 1.8.0   | Milestone 2 Phase 3: the unattended experiment orchestrator with sealed, recoverable evidence packaging                                                                                                                                                                                                                                                                                                                                                                             | [report](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/MILESTONE_002_PHASE3_ORCHESTRATOR_REPORT.md) · [runbook](documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md)                                                                                                                                                      |
| 1.9.0   | Milestone 2 Phase 4: the M2 per-decision comparator condition and prompt (rationale and confidence become normalized diagnostics, never gates), the formal attempt profile with both registered study templates and the `m2:register` pinning ritual, and chunked Playwright tracing with evidence-size forecasting for multi-hour live runs                                                                                                                                        | [report](documentation/milestones/002-sparse-cognition/phase-04-per-decision/MILESTONE_002_PHASE4_PER_DECISION_REPORT.md)                                                                                                                                                                                                                                     |

One compatibility note: ledger exports are format version 2; version-1 files
are rejected at import with an explicit error, never silently reinterpreted
([details](documentation/reference/TECHNICAL_REFERENCE.md#compatibility-break-ledger-format-2)).

## Continuous integration

**GitHub CI is the authoritative merge gate.** A change is mergeable only
when the `Required checks (clean checkout)` job is green on the pull
request, and green again on `main` after the merge. Local runs are
preparation, never the verdict — CI runs from a clean checkout with no
cached build output, no secrets, and no model provider. The full step list
and artifact-upload policy are in the
[technical reference](documentation/reference/TECHNICAL_REFERENCE.md#continuous-integration-details).

## Deployment

`npm run build` produces a fully static `dist/` (no backend, no external
assets — the worker is bundled). Serve it from any static host that delivers
`.js` with correct MIME types, e.g. `npx serve dist`. `npm run preview` does
this locally.

## Known limitations

- Characters move in a straight line and always take 30 seconds to get
  anywhere — they don't walk around obstacles. This is by design: navigation
  is not what this experiment measures.
- The operator console is designed for desktop screens; mobile is out of
  scope.
- The scripted decision system's scoring weights are tuned to make the three
  characters distinct under the frozen scenarios; they live in one module so
  experiments can hold them fixed while comparing conditions.
- Everything under `artifacts/` is regenerated output and git-ignored;
  committed test fixtures live under `tests/` instead.

## Documentation map

The [documentation index](documentation/README.md) is the authoritative
entry point — it tracks current project status, a document-status legend,
the milestone chronology, and the audit reading order. The highlights:

| Kind                     | Documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Research direction**   | [Milestone 3 research charter](documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md) — authoritative when merged to `main` for current research direction and claim boundaries only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Specification**        | [Vertical Slice 001 coding brief](documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md) (authoritative), [Milestone 2 brief](documentation/milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) + [scope ruling](documentation/milestones/002-sparse-cognition/MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) (historical; authoritative for M2 only)                                                                                                                                                                                                                                                                                                        |
| **Engineering contract** | [Technical reference](documentation/reference/TECHNICAL_REFERENCE.md) — determinism rules, decision lifecycle, evidence pipeline, CI details, implementation assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Operations**           | [Milestone 2 operator runbook](documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md) (historical), [live-run setup](documentation/reference/TECHNICAL_REFERENCE.md#live-run-operator-setup-and-walkthrough)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Reports & audits**     | Per-release implementation and audit reports linked from the version-history table above; Milestone 2 Phase 3 audits: [audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md) · [re-audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_REAUDIT.md) · [focused re-audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FOCUSED_REAUDIT.md) · [final targeted audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FINAL_TARGETED_AUDIT.md) |
