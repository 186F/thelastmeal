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
and "NPC" interchangeably. The bigger question behind the project: can
AI-driven characters be believable, distinct personalities _without_ ever
being allowed to break the rules of their world? And can they eventually be
affordable? Today's approach asks the AI what to do at every single decision
point. The research program's long-term goal ("sparse cognition") is for the
AI to instead write short standing policies for a character and only be
consulted when something genuinely new happens — the same believable
behavior for a fraction of the AI calls.

This repository is **Vertical Slice 001**, the first building block of that
program. It contains the simulation, the browser app for watching and
controlling runs, the AI "gateway" (a small local server) that connects one
character to a language model, and a growing automated laboratory that runs
whole experiments unattended.

## The big idea: sparse cognition

When a language model drives Mara today, the simulation asks it what to do
at each genuine decision point: it describes her situation and the concrete
actions on offer, then folds the model's choice in when the answer arrives.
The world never stops to wait — the clock keeps running, and a
deterministic fallback covers her if a reply is late — but every question
is a paid model call, dozens of them in every 45-minute story. That works;
the first milestone proved it with a passing live sequence. It just cannot
be the affordable long-term shape of an AI-driven character.

**Sparse cognition** is the alternative this research program exists to
test. "Sparse" is the opposite of "constant": rather than being consulted
at every step, the model is occasionally asked to write a **policy** — a
short set of standing "in situations like this, prefer actions like that"
rules, expressed as plain data in a small fixed vocabulary the simulation
owns. From then on the simulation applies those rules itself,
deterministically and instantly, at each decision point. The model is
consulted again only when a **novelty trigger** fires: something happens
that the standing rules were never written to cover.

An everyday picture: instead of phoning an expert before every small
choice, the character asks once for brief written instructions and only
calls back when events go beyond what the instructions anticipated.

|                          | Per-decision (today's baseline)        | Policy-patch (sparse cognition)                                 |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------- |
| When the model is called | At every genuine decision opportunity  | Only when a fixed, inspectable novelty trigger fires            |
| What the model returns   | One chosen action                      | A short standing policy — data, not code                        |
| Who decides in between   | Nobody: every decision is a model call | A local, deterministic policy interpreter in the simulation     |
| Who has final authority  | The simulation's action gate           | The same gate — a policy has no more power than a direct choice |

The crucial constraint: this hands the model **less** authority, not more.
A policy is a piece of data that the simulation validates and installs
through its normal event system. It cannot contain code, invent new kinds
of actions, change the world directly, or bypass the legality gate that
every decision already passes through. And because installed policies live
inside the recorded event stream, a finished run still replays exactly —
with no model connected at all.

How the milestones build toward it:

- **Milestone 1 (complete)** built the expensive baseline: Mara driven
  decision-by-decision by a live model, with the evidence pipeline proving
  every run valid and replayable.
- **Milestone 2 (in progress)** builds the automated laboratory and then
  runs the head-to-head experiment (`sparse-cognition-policy-001`): the
  same story, with Mara driven both ways, judged on criteria pre-registered
  before any data is collected:

| Pre-registered bar    | What it demands                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fewer calls**       | The policy condition uses at most **25%** of the baseline's model calls, and no single scenario exceeds 35%                                                               |
| **Real coverage**     | At least **80%** of Mara's decision opportunities are resolved by an installed policy — savings must not come from her quietly collapsing into scripted fallback behavior |
| **Still Mara**        | Her behavior stays measurably close to the per-decision baseline, judged by pre-registered similarity thresholds over behavioral "fingerprints" of each run               |
| **Honest thinking**   | Nearly every policy-writing call traces to a named novelty trigger — no hidden "ask the model every minute anyway" loop                                                   |
| **No safety erosion** | No new illegal actions, no replay divergence, no untreated lethal injury when Mara is the only possible helper — the hard guarantees hold exactly as before               |

If the experiment passes, the supported claim is deliberately modest: in
this one small simulation, a model-written policy preserved a
pre-registered level of behavioral similarity while using at most a quarter
as many model calls, with exact replay and no loss of simulation authority.
Whether that generalizes to larger worlds, other models, or many characters
is future work — not a Milestone 2 claim.

## Why build the laboratory first?

The laboratory is not the final game this project hopes to become. It is the
instrument for deciding whether the architecture above deserves to scale.

One convincing run cannot answer that question. Language models can make
different choices under identical starting conditions, and an NPC can appear
intelligent for the wrong reason: the model may have caused the behavior, but
so might a deterministic fallback, a race between the world and a late
response, or a bug in the simulation. Before asking whether policy-driven
Mara is still Mara, the project first has to measure **how different
per-decision Mara normally is from herself** across repeated runs. That
within-condition variation becomes the yardstick for every later comparison.

The event and evidence machinery then makes the causal chain inspectable:
what Mara knew, which actions the engine actually offered, what the model
selected, whether the simulation accepted it, what happened in the world,
and what later beliefs or memories followed. Without that chain, a striking
moment is only an anecdote. With it, the project can distinguish model
behavior from fallback behavior, engine behavior, provider failure, and
presentation prose.

The same machinery turns architectural changes into behavioral regression
tests. A new prompt, model, memory representation, context selector, policy
vocabulary, or call cadence can be evaluated on more than whether a demo
"feels better": did Mara remain recognizable, become more repetitive, miss
more tasks, use fewer calls, survive provider loss, or merely produce more
persuasive explanations for the same actions?

That is also how the project approaches the much larger population-scale
question without pretending it has already solved it:

```text
one model-driven character acts lawfully
        ↓
measure how much that character naturally varies
        ↓
preserve most of that behavior with reusable local policies
        ↓
reduce model calls and continue through provider failure
        ↓
test whether larger populations are economically and operationally plausible
```

Much of the laboratory is therefore intended to become production
infrastructure rather than disposable research scaffolding: engine-owned
legal actions, deterministic fallbacks, model and provider provenance, cost
budgets, exact replay, failure continuity, and release-to-release behavioral
testing are all things a studio would need before shipping autonomous
characters.

There is a limit to that justification. Evidence infrastructure is useful
only when it begins producing decisions. Once the per-decision baseline and
its ordinary variance are established, the value of the project comes from
running the sparse-cognition experiment and learning whether occasional AI
input can really preserve a character — not from allowing the laboratory to
grow indefinitely for its own sake.

## The project at a glance

|                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                  | A deterministic browser simulation of three characters under pressure, built as a research instrument                                                                                                                                                                                                                                                                                                                                          |
| **Built with**                  | Vite, TypeScript, Three.js (browser); Node.js (tools, tests, AI gateway)                                                                                                                                                                                                                                                                                                                                                                       |
| **Implementation release**      | 1.9.0                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Frozen experiment identity**  | Vertical Slice 001 — v1.0, configuration `vs001-1.0.0` (never changes with the release)                                                                                                                                                                                                                                                                                                                                                        |
| **AI integration status**       | **Live milestone complete:** a six-run formal sequence under experiment v1.2.0 passed every pre-registered threshold (2026-07-29 → 30; [acceptance report](documentation/milestones/001-model-integration/acceptance/MODEL_INTEGRATION_MILESTONE_001_LIVE_ACCEPTANCE_REPORT.md)). Day-to-day development and CI still run keylessly on a stand-in fake model.                                                                                  |
| **Current work**                | Milestone 2: the unattended experiment orchestrator is merged (Phase 3 complete); Phase 4 — the model-driven baseline arm, its registered studies, and bounded tracing for long live runs — has its final targeted remediation complete and awaits the Advisor's targeted verification; Stage A remains blocked until it is accepted, merged, and green on merged-`main` CI; the sparse policy system and head-to-head comparison follow later |
| **What you need to try it**     | Git, Node.js, and a Chromium-based browser — no account, API key, or payment                                                                                                                                                                                                                                                                                                                                                                   |
| **Authoritative specification** | [`documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md`](documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md)                                                                                                                                                                                                                                                                                                                     |
| **Deep technical contract**     | [`documentation/reference/TECHNICAL_REFERENCE.md`](documentation/reference/TECHNICAL_REFERENCE.md)                                                                                                                                                                                                                                                                                                                                             |

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

## The automated laboratory (Milestone 2, in progress)

Milestone 2 turns the project from "an experiment you run by hand" into "a
laboratory that runs experiments unattended" — and is being built in audited
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
- **Phase 4 (final targeted remediation complete — awaiting the Advisor's targeted verification):** the experiment's model-driven
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

No live model calls have been made in any Milestone 2 phase so far; the
first live runs (Stage A acceptance, then the calibration study) happen
only after the Phase 4 final remediation passes the Advisor's targeted
verification, exact-head CI is green, and the PR is merged.

## Pre-registered success criteria

Recorded before results, and not to be tuned or redefined after observing
results without creating a new experiment version (brief section 26).

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

**Future scalability targets** (recorded, not demonstrated in this slice).
In plain terms: today's setup consults the AI at every decision point (the
"per-decision" condition); the goal is a future "policy-patch" condition
where the AI writes short standing rules for a character and is consulted
only when something genuinely new happens:

- The policy-patch condition should eventually use ≤ 25% of the model calls of the per-decision condition.
- Model use should scale with novel causal situations, not raw ticks.

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
| **Specification**        | [Vertical Slice 001 coding brief](documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md) (authoritative), [Milestone 2 brief](documentation/milestones/002-sparse-cognition/MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md) + [scope ruling](documentation/milestones/002-sparse-cognition/MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) (authoritative for M2)                                                                                                                                                                                                                                                                                                                         |
| **Engineering contract** | [Technical reference](documentation/reference/TECHNICAL_REFERENCE.md) — determinism rules, decision lifecycle, evidence pipeline, CI details, implementation assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Operations**           | [Milestone 2 operator runbook](documentation/operations/MILESTONE_002_CLAUDE_OPERATOR_RUNBOOK.md), [live-run setup](documentation/reference/TECHNICAL_REFERENCE.md#live-run-operator-setup-and-walkthrough)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Reports & audits**     | Per-release implementation and audit reports linked from the version-history table above; Milestone 2 Phase 3 audits: [audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_AUDIT.md) · [re-audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_REAUDIT.md) · [focused re-audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FOCUSED_REAUDIT.md) · [final targeted audit](documentation/milestones/002-sparse-cognition/phase-03-orchestrator/audits/MILESTONE_002_PHASE3_ORCHESTRATOR_FINAL_TARGETED_AUDIT.md) |
