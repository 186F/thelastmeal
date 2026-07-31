# Vertical Slice 001 — “The Last Meal”

## Instructions for the coding model

Build a small, deterministic browser simulation using **Vite, TypeScript, and Three.js**. This project is the first experimental vertical slice for a future large-scale AI-driven NPC architecture.

Read this entire document before making changes. Treat all values marked **fixed** as requirements, not suggestions. Do not add features outside the stated scope. When implementation details are not specified, choose the simplest deterministic solution and document the choice in the project README.

The goal is **not** to build a complete colony game and **not** to connect an LLM. The goal is to create a controlled simulation in which later decision systems can be compared fairly.

The simulation must be implemented as a **pure TypeScript domain core** that can run without a browser, DOM, WebGL, or Three.js. Three.js is only the presentation layer. In the browser, the simulation must run inside a dedicated Web Worker so rendering and UI activity cannot become authoritative. The browser application must display read-only snapshots and issue typed operator commands to the worker. Never place canonical game logic inside meshes, scene objects, animation callbacks, UI components, or the render loop.

The finished project must provide:

- One browser-based, inspectable 3D tabletop workshop.
- A pure TypeScript simulation core shared by browser-worker and Node-headless execution.
- A dedicated browser simulation worker with a typed, versioned message protocol.
- Three deterministic NPCs with distinct behavioral profiles.
- A typed, append-only event ledger.
- Legal-action generation and validation.
- Resource ownership and reservations.
- Typed promises and renegotiation.
- Six seeded scenario variants.
- Deterministic replay, automated tests, and a headless batch runner.
- A simple DOM operator UI for running, pausing, resetting, inspecting, importing, replaying, and exporting simulations.
- A clean decision-provider interface through which later model and policy-patch systems can be added without changing the world simulation.

Do not implement model API calls, natural-language dialogue generation, embeddings, vector databases, procedural maps, combat, physics-driven gameplay, or free-form player control in this task.

---

# 1. Research question

The experiment is intended to test this eventual claim:

> Three NPCs can make stable, recognizably different decisions under resource scarcity, social obligations, memory, and an emergency, while the deterministic simulation—not a language model—retains exclusive control over objective reality.

The complete research program will eventually compare three decision conditions:

1. **Deterministic baseline:** utility-based or equivalent local decision logic only.
2. **Per-decision model baseline:** a model chooses every high-level action.
3. **Policy-patch system:** deterministic control normally acts; a model occasionally supplies temporary, conditional decision rules.

For this task, implement only condition 1 and the interfaces needed to add conditions 2 and 3 later.

---

# 2. Pre-registered success criteria

Record these criteria in the project README. Do not tune or redefine them after observing results without creating a new experiment version.

## Correctness

- No NPC may commit an action whose physical or logical preconditions are false.
- A meal may not be consumed more than once.
- Two NPCs may not simultaneously hold an exclusive reservation for the same resource.
- A promise may not be simultaneously recorded as both fulfilled and broken.
- A rejected action may not mutate canonical world state.
- Replaying an event ledger from the same initial state must reproduce the exact same final canonical state.
- The simulation must continue when the active decision provider fails.

## Behavioral distinctiveness

- Mara, Jonas, and Rin must exhibit distinguishable action patterns under equivalent circumstances.
- An anonymized action trace should permit a human reviewer to identify the NPC above the 33% chance baseline. The target for the later study is at least 70% accuracy.
- A relevant memory must measurably alter behavior in a controlled comparison.
- Memory and personality may affect preferences, but may not bypass survival constraints, action legality, or the authoritative event system.

## Future scalability targets

These are recorded now but are not expected to be demonstrated in this task:

- The policy-patch condition should eventually use no more than 25% of the model calls required by the per-decision condition.
- Model use should scale primarily with novel causal situations rather than with raw simulation ticks.

---

# 3. Manual setup required from the user

## Required local software

Install these tools before handing the repository to the coding model:

1. **Node.js active LTS**, including `npm`.
2. **Git**.
3. A current Chromium-based browser such as Chrome or Edge.
4. A text editor is optional; Visual Studio Code is a sensible default.

Verify the installations in a terminal:

```bash
node --version
npm --version
git --version
```

Do not install Unity, a physics engine, Docker, a database, or a model SDK for this vertical slice.

## Create the repository

Create an empty project folder and initialize Git:

```bash
mkdir causal-npc-lab
cd causal-npc-lab
git init
```

Then:

1. Place this file at the project root as `VERTICAL_SLICE_001_CODING_BRIEF.md`.
2. Create a minimal `README.md` stating that the repository is for Vertical Slice 001.
3. Make a baseline commit before the coding model starts.
4. Give the coding model access to the entire repository root.

The coding model must scaffold Vite directly in this existing folder rather than creating a nested application directory. It is responsible for the package manifest, lockfile, TypeScript configuration, source structure, tests, scripts, and initial application files.

## Fixed implementation stack

Use:

- **Vite** with the `vanilla-ts` template or an equivalent hand-created Vite configuration.
- **TypeScript** with strict type checking.
- **Three.js** for visualization only.
- Standard **HTML and CSS** for the operator UI. Do not add React, Vue, Svelte, or another UI framework.
- **Vitest** for unit, integration, replay, and headless simulation tests.
- **Playwright** with Chromium for a small browser end-to-end suite.
- A dedicated browser **Web Worker** for simulation execution.
- A **Node-compatible headless runner** that imports the same pure simulation core.

Approved dependencies are:

### Runtime

- `three`
- `zod`, or another lightweight runtime schema validator only when used consistently for configuration, worker messages, and imported ledgers

### Development

- `vite`
- `typescript`
- `@types/three` when required by the selected Three.js package version
- `vitest`
- `@vitest/coverage-v8`
- `@playwright/test`
- `tsx`
- ESLint and Prettier packages needed by the documented lint and format configuration

Do not add a game engine, physics library, ECS framework, Redux-style state manager, database, pathfinding package, component library, or server framework unless a stated requirement cannot reasonably be met without it. Document any additional dependency and the reason before using it.

## Required npm commands

The completed repository must expose these commands:

```text
npm run dev
npm run build
npm run preview
npm run typecheck
npm run lint
npm run test
npm run test:run
npm run test:coverage
npm run test:e2e
npm run test:e2e:install
npm run validate
npm run batch
```

`npm run test` may use watch mode. Every other verification command must run once and terminate with a meaningful exit code. `npm run test:e2e` should use Playwright's `webServer` configuration so the user does not have to start Vite separately.

## Manual verification after the coding model finishes

From the project root:

1. Install the exact dependency versions in the lockfile:

   ```bash
   npm ci
   ```

   Use `npm install` only when no lockfile was created, then commit the generated lockfile.

2. Install Playwright's Chromium binary:

   ```bash
   npm run test:e2e:install
   ```

3. Run static and configuration checks:

   ```bash
   npm run typecheck
   npm run lint
   npm run validate
   ```

4. Run automated tests:

   ```bash
   npm run test:run
   npm run test:e2e
   ```

5. Run the deterministic headless batch:

   ```bash
   npm run batch
   ```

6. Start the browser application:

   ```bash
   npm run dev
   ```

7. Open the URL printed by Vite. Do not assume a fixed port.
8. Run each of the six scenarios once at 1× speed.
9. Run the complete in-browser batch at accelerated speed.
10. Select each NPC in the Three.js view and verify that the inspector shows the correct logical state and decision metadata.
11. Export one completed ledger, import it through the replay control, and confirm that the replay hash matches the original hash.
12. Verify that pausing, single-tick stepping, and 1×, 5×, and 20× operation do not change the authoritative result for the same scenario and seed.
13. Build and preview the production bundle:

   ```bash
   npm run build
   npm run preview
   ```

14. Confirm that a full scenario produces no uncaught browser-console error.
15. Commit the working project before changing any fixed experiment data or behavioral weights.

No API key, cloud service, backend server, paid asset, database, or external model account is required.

# 4. Scope and non-goals

## In scope

- A single isometric or slightly angled 3D workshop presented in a browser.
- Three NPCs represented by simple Three.js primitives.
- Four functional locations.
- One repair objective.
- One meal.
- One injury event.
- One pre-existing promise.
- Ten high-level action categories.
- Deterministic NPC decision logic.
- Structured memories and beliefs.
- Resource reservation and transfer.
- Promise fulfillment, breach, and renegotiation.
- Deterministic simulation, event logging, replay, and testing.
- A browser worker, Node headless runner, minimal Three.js visualization, and DOM operator controls.

## Explicitly out of scope

- LLM or external AI integration.
- Natural-language conversations.
- Speech synthesis.
- Free-form movement or player-controlled characters.
- Real pathfinding or collision-based navigation.
- Physics simulation.
- Combat.
- Inventory beyond the single meal and repair materials.
- Crafting systems.
- Procedural generation.
- More than three NPCs.
- More than one simultaneous emergency.
- Long-term colony simulation.
- Vector search or semantic memory retrieval.
- A backend server or database.
- Accounts, authentication, cloud saves, multiplayer, or synchronization.
- Mobile, console, or native desktop packaging.
- Detailed models, skeletal animation, post-processing, audio, network-hosted assets, or purchased assets.
- React, Vue, Svelte, a game framework, or an ECS framework layered on top of Three.js.

Do not expand the scope because an additional mechanic appears interesting.

# 5. Required technology and project architecture

Use a modular, data-driven TypeScript structure. Exact folder names may vary slightly, but dependency direction and responsibility boundaries are mandatory.

A recommended structure is:

```text
src/
  app/                 browser composition and typed operator-command wiring
  sim/
    domain/            canonical state and stable identifiers
    events/            event schemas, append-only ledger, and projections
    clock/             fixed logical tick and deterministic scheduling
    systems/           needs, repair, injury, resources, and commitments
    actions/           affordances, validation, reservations, and execution
    cognition/         perception, beliefs, memories, and relationships
    decisions/         provider contracts, deterministic provider, fallback
    scenarios/         frozen definitions and scripted scenario events
    replay/            canonical serialization, replay, and state hashing
    runtime/           platform-independent simulation host
  worker/              browser simulation worker and versioned message protocol
  render/              Three.js scene and snapshot-to-visual adapters
  ui/                  DOM controls, inspectors, logs, import, and export
  shared/              serializable commands, snapshots, reports, and schemas
scripts/
  validate/            static configuration and architecture validation
  batch/               Node headless batch and report entry points
tests/
  unit/
  integration/
  e2e/
public/                 static files only when genuinely required
```

The simulation core under `src/sim` must:

- Import no Three.js, DOM, CSS, WebGL, Vite, browser storage, or worker-specific module.
- Run directly under Node for tests, replay, validation, and batch execution.
- Accept typed commands and produce typed events and read-only presentation snapshots.
- Remain usable when the entire `worker`, `render`, `ui`, and browser `app` layers are absent.

The browser must follow this authority flow:

```text
DOM operator command
        ↓
Browser application controller
        ↓ typed, versioned worker command
Simulation Web Worker
        ↓
Pure TypeScript simulation core
        ↓ events + read-only presentation snapshot
Main thread
        ↓
Three.js renderer and DOM inspectors
```

Rules:

- The main thread may never directly mutate canonical state.
- Three.js objects may store stable entity IDs for picking and view lookup, but no authoritative needs, beliefs, commitments, resource ownership, or behavior logic.
- Worker commands and responses must be serializable, versioned, schema-validated, and assigned stable sequence or correlation IDs.
- The Node runner and browser worker must import the same scenarios, providers, event definitions, transition logic, replay logic, and hashing code.
- Canonical state must contain only serializable domain data and stable IDs.
- Presentation snapshots may be coalesced or dropped for performance without altering simulation behavior.

All fixed values must live in centrally inspectable TypeScript configuration modules or validated JSON. Prefer TypeScript data modules in this slice so values are type-checked and versioned. Do not scatter unexplained constants through rendering, UI, or action files.

Create a concise `README.md` explaining:

- Prerequisites and installation.
- Every required npm command.
- How to run the browser application.
- How the Web Worker and Node runner share the same simulation core.
- How to select, start, pause, step, reset, export, import, and replay scenarios.
- How to run validation, tests, and the 100-run deterministic batch.
- Where scenario constants and decision weights live.
- How the simulation is isolated from Three.js and the DOM.
- How a future decision provider will plug in.
- How to serve the production `dist` folder from a static host.
- Any implementation assumptions not specified here.

# 6. Determinism requirements

Determinism is a core product requirement, not a debugging convenience.

- The fixed logical tick is **one simulated second**.
- Store canonical time as an integer tick count. Do not use wall-clock timestamps or accumulated floating-point render deltas as canonical time.
- The simulation must be independent of `requestAnimationFrame`, monitor refresh rate, browser timer accuracy, window size, tab visibility, and Three.js rendering.
- Decision reevaluation should occur on relevant events and at a fixed maximum interval, not every rendered frame.
- The operator may run at 1×, 5×, and 20× without changing the ordered authoritative ledger.
- Accelerated, run-to-completion, and headless modes must process deterministic batches of logical ticks rather than multiplying a variable frame delta.
- Any randomness must come from one explicitly seeded deterministic pseudo-random source owned by the simulation core.
- `Math.random()` is forbidden anywhere that can affect canonical state.
- `Date.now()`, `performance.now()`, locale, time zone, browser scheduling, and operating-system timing may not influence decisions or canonical outcomes.
- A scenario definition must include its seed.
- The same scenario, configuration version, provider, and seed must produce the same authoritative ledger and final-state hash through browser-worker and Node-headless execution.
- The worker may be delayed or throttled. This may change wall-clock completion time, but never the logical outcome after the same ticks are processed.
- Every mutating operator command must carry a stable command ID. Duplicate or out-of-order commands must be rejected or made idempotent.
- The UI may only issue typed commands such as start, pause, reset, step, change speed, select scenario, run to completion, import, replay, or request export.
- Renderer interpolation is visual only. The renderer may animate between snapshots, but visual coordinates, animation completion, and raycast results must never feed back into canonical state.

For canonical values and hashing:

- Prefer integer representations for normalized and percentage values. For example, represent 0–1 quantities as 0–10,000 basis points and format them for display only.
- Use a documented canonical serialization procedure with explicit field and collection ordering.
- Do not hash Three.js classes, functions, DOM objects, browser state, `Map`, `Set`, unstable object-key order, debug strings, formatted labels, camera state, or render state.
- Use the same documented hash algorithm in browser and Node.

The system must generate the same ledger and final hash with the canvas hidden, at different display frame rates, in a background-throttled tab after processing resumes, and entirely in Node.

# 7. The frozen world

Create one small logical workshop with four abstract locations:

1. **Purifier Workbench**
2. **Food Shelf**
3. **Medical Cot**
4. **Routine Work Station**

The Three.js view must show these locations and the current logical position of each NPC. Use an orthographic camera with a clear isometric or tabletop angle, a simple floor plane or grid, primitive geometry, and DOM or simple spatial labels. No imported assets are required.

Assign every logical location one fixed presentation coordinate in centralized view configuration. Location IDs—not coordinates—remain canonical. Do not add a physics engine.

Movement is intentionally simple:

- No pathfinding.
- No collision-based routing.
- Canonically, travel is an abstract timed transition. The renderer may display straight-line interpolation between fixed presentation coordinates.
- Travel between any two different locations takes exactly **30 simulated seconds**.
- An action that requires a location begins only after the authoritative `MovementCompleted` event. A mesh visually reaching a destination early does not count as arrival.
- A destination becoming invalid while an NPC is traveling must cause the intended action to be revalidated before execution.

The scenario lasts **45 simulated minutes**.

## Purifier objective

- Initial purifier repair progress: **60%**.
- Required progress by minute 45: **100%**.
- Only one NPC may actively use the workbench at a time.
- Repair rates:
  - Mara: **1.00 percentage point per simulated minute**.
  - Jonas: **0.70 percentage point per simulated minute**.
  - Rin: **0.35 percentage point per simulated minute**, while medically capable.
- Repair progress may not exceed 100%.
- At minute 45, record exactly one of:
  - `TaskCompleted`, if progress reached 100% before or at the deadline.
  - `TaskDeadlineMissed`, otherwise.

## Meal

- Exactly one meal exists at the Food Shelf.
- The meal is reserved for Rin at scenario start.
- All three NPCs know that Rin owns the reservation.
- Eating takes **3 simulated minutes** after arrival at the shelf.
- Successful consumption lowers hunger by **0.55**, clamped at 0.
- The meal is destroyed by the authoritative engine only when `MealConsumed` is committed.
- Another NPC may physically attempt to take the meal without permission, but the engine must classify and record the ownership violation rather than pretending permission existed.
- The same meal may never be consumed twice.

## Needs

Use normalized values from 0 to 1.

- Hunger: 0 means fully fed; 1 means extreme starvation.
- Fatigue: 0 means fully rested; 1 means extreme exhaustion.

Fixed thresholds:

- Hunger below 0.65: ordinary.
- Hunger from 0.65 to below 0.80: moderate.
- Hunger from 0.80 to below 0.95: high.
- Hunger at or above 0.95: critical.

Unless a scenario overrides it:

- Hunger increases by **0.003 per simulated minute**.
- Fatigue increases by **0.0015 per simulated minute** while awake.
- A five-minute rest action reduces fatigue by **0.10**, clamped at 0.

Critical survival and safety logic must override personality preferences. Personality may alter how early an NPC reacts, what social method they choose, and what norm they are willing to violate. It may not make an NPC ignore hard incapacity or execute an illegal action.

## Injury

At exactly minute 12 in the standard emergency scenarios, Rin receives a moderate injury.

- Initial severity: **0.55**.
- Rin remains conscious but cannot perform repair work after the injury.
- If treatment has not begun by minute 22, severity becomes **0.85** and Rin becomes incapacitated.
- Jonas can treat Rin in **4 simulated minutes**.
- Mara can treat Rin in **8 simulated minutes**.
- Rin cannot treat herself in this slice.
- Successful treatment by Jonas lowers severity to **0.15**.
- Successful treatment by Mara lowers severity to **0.25**.
- A treatment action must be revalidated at start and completion.
- The engine—not the decision provider—determines treatment outcome.

## Jonas’s promise

At scenario start, a typed commitment already exists:

- Debtor: Jonas.
- Creditor: Mara.
- Promised outcome: Jonas will relieve Mara at the purifier bench.
- Original start time: minute 15.
- Grace deadline: minute 17.
- Minimum relief duration: five simulated minutes.

The promise is fulfilled only when Jonas takes control of the workbench no later than minute 17 and works there for at least five continuous simulated minutes.

Before the grace deadline, Jonas may propose renegotiation. Mara must independently accept for the commitment terms to change. Silence, absence, or a model assertion must never count as acceptance.

A valid renegotiation may change the start time and minimum duration. Record both proposal and acceptance as events. If no valid renegotiation occurs and the original terms are not met, record `CommitmentBroken` once.

---

# 8. NPC identity cards

Store identity as structured data. A short display biography may be generated from it, but prose must not be the authoritative source of traits or values.

## Mara

### Traits

- Diligence: 0.85
- Pride: 0.80
- Empathy: 0.35
- Rule adherence: 0.60

### Values

- Competence
- Personal dignity
- Colony survival

### Skills

- Repair: high
- First aid: low

### Initial state

- Hunger: 0.72
- Fatigue: 0.35
- Location: Purifier Workbench
- Initial action: repairing the purifier

### Goal

Finish the purifier repair and demonstrate that she is dependable.

### Memory

Yesterday, the player criticized Mara for “giving up when work becomes difficult.”

Store separately:

- Canonical fact: the criticism occurred.
- Mara’s perception: she heard it directly.
- Mara’s interpretation: it was an attack on her competence.
- Confidence: high.
- Importance: high.

### Hard boundary

Mara will not ignore a life-threatening injury when nobody else can intervene.

### Expected behavioral signature

- Persists at work under moderate hunger.
- Is sensitive to competence-related memories.
- Is relatively reluctant to request relief.
- May accept social costs to avoid appearing weak.
- Still yields to hard safety constraints.

## Jonas

### Traits

- Empathy: 0.85
- Conscientiousness: 0.75
- Conflict avoidance: 0.65
- Pride: 0.25

### Values

- Caring for others
- Keeping promises
- Colony stability

### Skills

- Repair: medium
- First aid: high

### Initial state

- Hunger: 0.45
- Fatigue: 0.30
- Location: Routine Work Station
- Initial action: routine work

### Goal

Keep the group functioning without letting anyone feel abandoned.

### Commitment

He promised to relieve Mara at minute 15, under the formal terms specified above.

### Memory

Mara covered one of Jonas’s shifts several days earlier.

Store the fact, perception, interpretation, confidence, and importance separately.

### Hard boundary

Jonas will not knowingly consume food reserved for someone else.

### Expected behavioral signature

- Responds quickly to another NPC’s distress.
- Prefers renegotiation over silent promise-breaking.
- Seeks cooperative solutions.
- Avoids ownership violations.
- Feels competing pressure when care duties conflict with promises.

## Rin

### Traits

- Self-preservation: 0.85
- Suspicion: 0.75
- Generosity: 0.25
- Directness: 0.75

### Values

- Personal autonomy
- Survival
- Fair treatment

### Skills

- Repair: low
- First aid: low

### Initial state

- Hunger: 0.80
- Fatigue: 0.40
- Location: Purifier Workbench area
- Initial action: delivering repair materials
- Meal reservation owner: yes

### Goal

Protect her health and retain control over resources assigned to her.

### Memory

Jonas once used one of Rin’s supplies without asking.

Store the fact, perception, interpretation, confidence, and importance separately.

### Hard boundary

Rin will not voluntarily surrender essential food while medically vulnerable.

### Expected behavioral signature

- Protects owned resources.
- Is resistant to informal requests.
- Prefers explicit exchanges and commitments.
- Prioritizes personal safety rapidly.
- May accept help while remaining wary of Jonas.

---

# 9. High-level action vocabulary

The decision provider may select only from currently generated, concrete affordances belonging to these categories:

1. Work on the purifier
2. Relieve another worker
3. Treat an injured NPC
4. Eat the meal
5. Request transfer of the meal
6. Transfer or release the meal reservation
7. Ask another NPC for help
8. Request a break or reassignment
9. Renegotiate a commitment
10. Rest or wait

Each affordance must contain enough structured information to validate and execute it, including where relevant:

- Unique action instance ID
- Action category
- Actor
- Target NPC
- Target resource
- Required location
- Expected duration
- Preconditions
- Reservation or ownership implications
- Commitment implications
- World-state version or equivalent staleness token

“Available” means physically and procedurally executable at proposal time. It does not mean morally approved. For example, an NPC may be able to attempt to eat Rin’s meal without permission. The engine must then record the ownership violation and resulting consequences.

Do not permit the decision provider to invent new action categories, resources, NPCs, locations, or effects.

---

# 10. Authority boundary

## The simulation engine exclusively controls

- Canonical world state
- Time
- Location and movement
- Need changes
- Injury severity
- Repair progress
- Resource existence
- Ownership and reservations
- Action legality
- Skill outcomes
- Perception eligibility
- Promise state
- Relationship consequences
- Event ordering
- State hashing
- Replay

## A decision provider may influence

- Which currently legal affordance an NPC prefers
- Temporary priorities
- Whether an NPC requests, refuses, negotiates, complies, waits, or violates a norm
- How an NPC interprets a perceived event
- A short reason code used for debugging

## A decision provider may never

- Create an object
- Delete an object
- Change a need value directly
- Declare an action successful
- Assert that another NPC accepted an agreement
- Give an NPC knowledge they did not perceive
- Directly alter a trait, relationship, commitment, injury, or resource reservation
- Rewrite an earlier event
- Skip validation
- Commit an event directly

Use this governing rule:

> Anything capable of changing objective reality belongs to the deterministic engine.

---

# 11. Facts, perceptions, beliefs, and memories

Keep four concepts distinct.

## Canonical fact

An event that objectively occurred in the simulation.

## Perception record

What an NPC was capable of seeing, hearing, or otherwise observing.

## Belief

A proposition held by an NPC, with confidence, provenance, and a last-updated time. A belief may be wrong.

## Narrative memory

A compact description used for display or future language-model context. It is not authoritative and must not be used to prove an event occurred.

The deterministic baseline may use structured interpretations and reason codes. Do not require natural-language generation.

An NPC may act on a false belief only when that belief has valid provenance from perception, testimony, or a prior inference. The engine must never confuse the belief with canonical truth.

---

# 12. Required event ledger

The authoritative ledger must be append-only during a run. Each event must include at least:

- Event ID
- Event type
- Logical timestamp
- Sequence number
- Actor, when applicable
- Target, when applicable
- Causation or parent event ID, when applicable
- Correlation ID for multi-event actions, when applicable
- Structured payload
- Schema version

Support at minimum these event types:

- ScenarioStarted
- ScenarioEnded
- TimeAdvanced
- DecisionRequested
- DecisionReturned
- DecisionProviderFailed
- FallbackDecisionUsed
- ActionProposed
- ActionStarted
- ActionCompleted
- ActionRejected
- ActionInterrupted
- MovementStarted
- MovementCompleted
- RepairProgressed
- InjuryOccurred
- InjuryWorsened
- TreatmentStarted
- TreatmentCompleted
- ResourceReserved
- ReservationTransferRequested
- ReservationTransferred
- ReservationReleased
- MealConsumed
- OwnershipViolated
- CommitmentCreated
- CommitmentRenegotiationProposed
- CommitmentRenegotiationAccepted
- CommitmentRenegotiationRejected
- CommitmentFulfilled
- CommitmentBroken
- TaskCompleted
- TaskDeadlineMissed
- PerceptionRecorded
- BeliefUpdated
- RelationshipChanged
- SimulationPaused
- SimulationResumed

Events must be data, not arbitrary log strings. Human-readable log messages may be derived from them.

---

# 13. Validation and transactional behavior

Every action must pass through the same sequence:

1. Generate legal affordances from the current canonical state.
2. Ask the active decision provider to choose one affordance.
3. Confirm that the returned affordance ID was offered.
4. Revalidate the action against current state before starting it.
5. Reserve any exclusive resource required by the action.
6. Execute through the simulation kernel.
7. Revalidate completion conditions.
8. Commit typed outcome events.
9. Release temporary reservations.
10. Update projections, perceptions, beliefs, relationships, and future affordances.

If the world changes between proposal and execution, reject or interrupt the action cleanly. Never silently reinterpret the action against a new target.

A failed decision provider must produce a `DecisionProviderFailed` event, followed by `FallbackDecisionUsed`. The simulation must continue through a deterministic fallback policy.

---

# 14. Deterministic decision-provider requirements

Implement a decision-provider interface that receives:

- The NPC’s structured identity
- Current needs and health
- Current beliefs and memories
- Current goals
- Current commitments
- Current legal affordances
- Current scenario time

It returns:

- One offered affordance ID
- A confidence value
- A short structured reason code
- Optional debug scoring information

Implement a deterministic provider for this task. The implementation may use utility scores, a behavior tree, or another transparent deterministic method, but it must satisfy the following constraints:

- Survival and hard safety boundaries are evaluated before personality preferences.
- Only currently offered affordances may be chosen.
- Trait, value, memory, relationship, and commitment effects must be separately inspectable in debug output.
- Scores and weights must live in centralized configuration.
- Ties must be resolved deterministically.
- The provider must not mutate the world.
- A separate fallback provider must always be available.
- The world simulation must not know whether a decision came from deterministic logic, a future model, or a future policy-patch compiler.

Do not overfit behavior to one scripted sequence. The three NPCs should respond sensibly when scenario parameters change.

---

# 15. Social and relationship consequences

Use deterministic, typed relationship changes. At minimum, implement these consequences:

- Taking Rin’s reserved meal without permission causes Rin’s relationship toward the actor to decrease by **0.25**.
- Jonas breaking his promise without a successful renegotiation causes Mara’s relationship toward Jonas to decrease by **0.15**.
- A successful renegotiation before breach avoids the full promise-breaking penalty.
- Jonas successfully treating Rin increases Rin’s relationship toward Jonas by **0.10**, but does not erase her existing suspicious memory.
- An NPC voluntarily transferring the meal reservation creates no ownership violation.
- Relationship values must be clamped to the project’s documented range.

Every relationship change must cite one or more causal event IDs.

---

# 16. Six seeded scenario variants

Each scenario must have a stable ID, version, seed, configuration, expected invariants, and batch-run support.

## Scenario A — Routine Operation

- No injury occurs.
- All other standard initial conditions remain.

Purpose:

- Establish ordinary work, hunger, relief, promise, and meal behavior.

Required invariants:

- No injury or treatment events.
- Meal is consumed at most once.
- Jonas’s promise ends as fulfilled, renegotiated and fulfilled, or broken—never ambiguously.
- Purifier deadline produces exactly one final task outcome.

## Scenario B1 — Pride Memory Present

- Use the standard scenario without Rin’s injury.
- Mara has the criticism memory.

## Scenario B2 — Pride Memory Absent

- Identical to B1 except Mara’s criticism memory is removed.
- Use the same seed.

Purpose:

- Isolate the effect of one memory.

Expected tendency:

- With the memory present, Mara should be more inclined to persist at work, delay requesting relief, or resist behavior she interprets as appearing weak.
- The memory must not alter action legality or override critical survival thresholds.

The batch report must compare Mara’s decisions and work duration between B1 and B2.

## Scenario C — Promise Versus Emergency

- Rin is injured at minute 12.
- Jonas remains obligated to relieve Mara at minute 15, with the minute-17 grace deadline.

Purpose:

- Test competing care and promise obligations.

Acceptable patterns include:

- Jonas treats Rin and renegotiates with Mara.
- Jonas requests another valid treatment arrangement.
- Jonas briefly relieves Mara before treating Rin, if the injury timing still permits it.

Unacceptable behavior includes:

- Recording Jonas as simultaneously treating Rin and working at the bench.
- Treating silence as Mara’s acceptance of renegotiation.
- Claiming both the original promise and an incompatible emergency action were fully completed at the same time.

## Scenario D — Scarce Resource Conflict

- Mara’s initial hunger is **0.88**.
- Rin retains the meal reservation.
- No injury occurs unless explicitly included in the scenario definition; default this test to no injury so ownership conflict is isolated.

Purpose:

- Test personality, ownership, negotiation, and possible norm violation.

Mara may request the meal, persist at work, rest, seek reassignment, or take the meal and incur consequences. The engine must record the exact resource and relationship outcome.

## Scenario E — Stale Decision

- At a deterministic time after an NPC has selected an eat-related action but before consumption begins, transfer or remove the meal through a scripted world event.

Purpose:

- Test stale-action detection.

Required result:

- The eat action is rejected or interrupted.
- No phantom meal is consumed.
- The NPC receives a new decision opportunity or fallback action.
- The event ledger clearly identifies the stale precondition.

## Scenario F — Decision Provider Failure

- At minute 10, switch the active decision provider into a deterministic failure mode.

Purpose:

- Simulate future model unavailability without requiring a model.

Required result:

- The simulation continues.
- Each failure is recorded.
- The fallback provider supplies legal actions.
- The scenario reaches a valid final task outcome.
- No canonical state corruption occurs.

---

# 17. Browser operator UI and Three.js presentation

Create one desktop-oriented browser page containing one Three.js canvas and ordinary HTML/CSS controls. Do not render the operator interface inside WebGL.

## Recommended layout

- Global controls and scenario selector above the viewport.
- Three.js workshop viewport in the center or left.
- Selected-NPC inspector on the right.
- Event and decision details in a collapsible lower panel.

The layout must remain usable on a typical laptop display. Mobile optimization is not required.

## Three.js viewport

The viewport must:

- Show the four workshop locations.
- Represent Mara, Jonas, and Rin with distinct primitive meshes.
- Show the meal, purifier progress, and injury state through simple visible markers.
- Use one renderer, one primary scene, and one primary camera. An orthographic camera is preferred.
- Support selecting an NPC by clicking its mesh.
- Visually interpolate movement and continuous progress from read-only snapshots.
- Make selected state obvious.
- Use simple lighting and avoid expensive shadows or post-processing.
- Load no external models, textures, fonts, or network-hosted assets.

Optional pan, zoom, or orbit controls are acceptable only when they cannot alter simulation state.

Animation completion must never determine logical arrival, work completion, treatment completion, or any other canonical outcome. Removing the renderer entirely must not prevent scenarios, replay, reports, hashes, or tests from running.

## Global state panel

Display:

- Scenario ID and version
- Seed
- Logical simulation time
- Current speed
- Running, paused, replaying, or complete state
- Purifier progress
- Deadline status
- Meal existence and reservation owner
- Active decision provider
- Event count
- Worker connection and last-snapshot status
- Final-state hash when complete
- Replay hash match or mismatch

## Per-NPC inspector

For Mara, Jonas, and Rin display:

- Current logical location
- Current action
- Hunger
- Fatigue
- Injury severity
- Current goal
- Current commitment status
- Current chosen affordance
- Decision confidence
- Primary reason code
- Relevant current beliefs and memories
- Latest relationship changes

Selecting an NPC through either the Three.js viewport or an HTML list must update the same inspector.

## Controls

Provide:

- Select scenario
- Start
- Pause
- Resume
- Reset
- Run at 1×
- Run at 5×
- Run at 20×
- Step one logical tick while paused
- Run to completion
- Run all scenarios as a worker batch
- Export event ledger as JSON
- Import a ledger JSON file
- Replay imported or most recent ledger
- Export batch report
- Export anonymized individuality traces
- Toggle detailed decision scoring
- Toggle event-log panel
- Validate configuration

Use browser-native downloads for export and an explicit file input or drag-and-drop target for import. Do not require filesystem permissions, local storage, a database, or a backend.

The UI exists for observability. It must send typed commands to the worker and render returned snapshots and events. It may never directly mutate canonical objects.

# 18. Replay, import, export, and reporting

## Replay

The application must reconstruct final canonical state from:

- The initial scenario definition
- The ordered authoritative event ledger

Replay must not ask a decision provider to make new decisions. It applies the recorded authoritative events.

At the end of both original execution and replay, compute a stable final-state hash over canonical state only. Debug text, wall-clock timing, render timing, camera state, selected NPC, panel state, worker scheduling, interpolation, and non-authoritative logs must not affect the hash.

Replay must work through:

- The browser import and replay controls.
- The Node headless runner used by tests and batch reports.

Both paths must produce the same hash.

## Browser import and export

- Export human-inspectable JSON through a browser download.
- Import through an explicit user-selected file input or drag-and-drop target.
- Validate schema, version, event ordering, IDs, and required metadata before replay.
- Reject invalid, truncated, unsupported, or tampered files without partially mutating an active run.
- Do not require filesystem permissions, a backend, IndexedDB, or local storage for authoritative replay.
- Local storage may hold only non-authoritative convenience settings, and the application must work when it is unavailable or cleared.

The exported ledger must include:

- Scenario metadata
- Seed
- Configuration version
- Ordered events
- Final-state summary
- Final-state hash

## Headless output

The Node batch runner must write generated ledgers, reports, and anonymized traces to a documented ignored directory such as `artifacts/`. Filenames must include scenario ID, version, seed, and run type where relevant. Committed test fixtures belong in a separate fixture directory.

## Batch report

Run all scenarios without manual intervention and produce machine-readable JSON plus a readable Markdown or HTML summary containing at least:

- Scenario ID
- Seed
- Final purifier progress
- Task success or failure
- Meal consumer, if any
- Ownership violation count
- Promise outcome
- Treatment outcome
- Decision-provider failure count
- Rejected or interrupted action count
- Final relationship values
- Event count
- Final-state hash
- Replay hash match
- Per-NPC action counts and time spent by action category

For B1 and B2, include an explicit comparison of Mara's work persistence and help-seeking behavior.

`npm run batch` must exit nonzero when any invariant fails, replay differs, or a scenario cannot reach a terminal state.

# 19. Automated tests

Use three testing layers.

## Vitest unit coverage

Cover at minimum:

- Event schema creation and serialization
- Append-only event ordering
- State projection from events
- Stable canonical serialization and state hashing
- Seeded random-source repeatability
- Hunger and fatigue updates
- Repair-rate calculations
- Injury worsening and treatment outcomes
- Meal reservation creation, transfer, release, and consumption
- Prevention of double consumption
- Commitment creation, renegotiation, fulfillment, and breach
- Prevention of contradictory commitment states
- Affordance generation
- Action validation
- Stale-action rejection
- Decision-provider failure and fallback selection
- Deterministic tie-breaking
- Fact, perception, belief, and memory separation
- Imported-ledger validation
- Worker command and snapshot schema validation

Unit tests must import the pure simulation core directly and require no browser, DOM, canvas, WebGL context, Vite server, or Three.js renderer.

## Vitest integration and headless coverage

Cover at minimum:

- Each scenario runs to completion through the Node runner.
- Different tick-processing batch sizes corresponding to 1×, 5×, and 20× produce identical authoritative ledgers.
- Replay hash matches original-run hash.
- Direct Node execution and worker-compatible command semantics produce the same result for fixed fixtures.
- Scenario E rejects or interrupts the stale action.
- Scenario F continues after provider failure.
- One hundred repeated deterministic batch runs produce zero invariant violations.
- B1 and B2 differ only through the configured Mara memory and produce a machine-readable comparison.
- Running scenarios sequentially in one process does not leak state.

## Playwright browser coverage

Keep browser tests focused and reliable. Cover at minimum:

- The application boots with no uncaught error.
- The Three.js canvas and DOM controls appear.
- The simulation worker connects and returns an initial snapshot.
- Selecting, starting, pausing, resuming, stepping, resetting, changing speed, and running to completion work.
- Clicking an NPC updates the inspector.
- A completed scenario displays a final hash.
- Scenario E visibly reports stale-action rejection or interruption.
- Scenario F visibly reports provider failure and fallback use while continuing.
- A ledger can be exported, imported, and replayed to a matching hash.
- Opening diagnostics does not change canonical state.

Do not use brittle screenshot-pixel comparisons as the primary correctness test. Test semantic DOM state, worker messages, exported data, and canonical hashes. A rendering smoke test is enough for Three.js.

Every failure must identify the scenario, seed, logical tick, relevant command, and causal event sequence.

# 20. Human individuality test

Provide a batch-export mode that creates anonymized action traces for each NPC. Remove:

- NPC names
- Trait labels
- Biography text
- Distinctive dialogue wording

Retain:

- Time
- Needs
- Available action categories
- Chosen action category
- Commitment state
- Relevant event context
- Outcome

The trace format should allow a human reviewer to guess whether the actor was Mara, Jonas, or Rin from behavior alone.

This task does not require recruiting reviewers or achieving the 70% target. It does require producing the material needed to run that test later.

---

# 21. Architecture constraints for future AI integration

The codebase must allow these later additions without rewriting the simulation kernel:

- A per-decision external model provider
- An asynchronous policy-patch compiler
- Versioned policy storage
- Policy activation, expiration, and invalidation
- A global inference scheduler
- Structured model-output validation
- Shadow testing of proposed policies

A future implementation should place a local or hosted Node gateway between the browser and any model provider. Therefore:

- Never place a model API key in browser code, a client-exposed Vite environment variable, committed files, browser storage, or exported ledgers.
- Keep provider transport and model SDK types outside the simulation core.
- Give every decision request a request ID, NPC ID, scenario ID, logical timestamp, canonical state-version token, and explicit list of offered affordance IDs.
- Treat future responses as asynchronous, fallible, possibly duplicated, out of order, and potentially stale.
- Revalidate every returned affordance against current state before action start.
- Preserve deterministic fallback behavior for timeout, transport failure, invalid schema, provider refusal, or stale affordance.
- Keep prompts and narrative model context out of authoritative state.

For this vertical slice:

- Do not add external networking.
- Do not store API keys.
- Do not add a model SDK.
- Do not implement a backend server.
- Do not put prompts in the simulation layer.

The required future-facing seams are:

1. A stable decision-provider contract.
2. A provider-failure and fallback path.
3. State-version and action-instance validation.
4. Sufficient event and score data to compare providers later.
5. A worker protocol that does not assume the provider will remain local or synchronous.

# 22. Required project tooling and npm scripts

The browser application must construct the workshop declaratively from scenario and presentation configuration. There is no manual scene assembly step.

The coding model must provide these npm scripts with these exact names:

- `npm run dev` — start the Vite development server.
- `npm run build` — create the production bundle after required checks.
- `npm run preview` — serve the production bundle locally.
- `npm run typecheck` — run TypeScript checking without emitting files.
- `npm run lint` — run the configured source and architecture lint checks.
- `npm run test` — run Vitest in watch mode.
- `npm run test:run` — run all Vitest tests once.
- `npm run test:coverage` — produce domain and integration coverage.
- `npm run test:e2e` — run Playwright with an automatically managed Vite server.
- `npm run test:e2e:install` — install Playwright Chromium.
- `npm run validate` — validate experiment data and architecture constraints.
- `npm run batch` — run every scenario headlessly, replay every ledger, and write reports and traces.

## Validation command

`npm run validate` must report actionable failures for at least:

- Missing scenario definitions
- Duplicate stable IDs
- Unsupported schema versions
- Unknown action or event types
- Invalid fixed values
- Broken NPC, resource, location, or commitment references
- Duplicate exclusive resource ownership
- Missing presentation coordinates
- Non-serializable canonical data
- Missing required npm scripts
- Imports from Three.js, DOM, UI, or worker modules inside the pure simulation core

It must exit nonzero on failure.

## In-browser validation

Add a **Validate Configuration** control that invokes the same shared validation rules and displays a concise pass/fail result. Do not maintain an incompatible second implementation.

## Development diagnostics

Provide optional diagnostics for:

- Worker command and response traffic
- Decision score decomposition
- Event sequence, correlation, and causation IDs
- Canonical state version
- Snapshot sequence number
- Renderer interpolation state

Diagnostics must never become authoritative and must remain unobtrusive in normal use.

The user must not have to create Three.js objects manually, edit generated scene files, wire references, author HTML panels, or configure anything beyond the documented npm commands.

# 23. Coding quality requirements

- Enable TypeScript strict mode and keep it enabled.
- Prefer small, single-responsibility modules and explicit domain types.
- Avoid untyped `any` in the simulation core. Narrow `unknown` values through runtime validation.
- Use stable, explicit identifiers for NPCs, resources, actions, events, commitments, locations, and scenarios.
- Keep all canonical logic independent of Three.js, DOM, CSS, WebGL, Vite, browser storage, and worker APIs.
- Do not use `requestAnimationFrame`, rendered frame delta, `Date`, `setTimeout`, or browser timer drift as authoritative simulation time.
- Do not call `Math.random()` from canonical code.
- Do not hide domain state in meshes, `userData`, HTML datasets, UI components, CSS classes, or worker globals.
- Do not let animation callbacks start, complete, interrupt, or validate canonical actions.
- Maintain explicit ID-to-view maps rather than scanning the Three.js scene during render or selection loops.
- Use one clear owner for the worker lifecycle and terminate or replace it cleanly during application teardown and development hot reload.
- Dispose Three.js geometries, materials, textures, listeners, animation handles, and renderer resources when the view is destroyed.
- Keep worker messages structured, versioned, serializable, schema-validated, and correlated.
- Do not pass mutable canonical objects across the worker boundary. Send read-only structured-clone snapshots and events intended for presentation.
- Keep debug logging separate from authoritative events.
- Fail fast with clear errors on invalid scenarios and imported ledgers.
- Ensure reset and repeated runs do not leak state, timers, listeners, workers, subscriptions, or Three.js objects.
- Do not rely on import order, asynchronous completion order, unstable key iteration, floating-point epsilon accidents, or frame timing.
- Keep generated reports and ledgers outside source folders.
- Document any unavoidable browser-specific compromise.

Keep dependencies minimal. Every direct dependency must have a documented role in the README. Do not add a framework merely to avoid a small amount of straightforward, testable domain code.

# 24. Required implementation sequence

Execute the work in this order:

1. Scaffold Vite in the repository root, configure strict TypeScript, linting, formatting, tests, required scripts, and the README.
2. Establish folder boundaries and shared serializable types.
3. Define scenario configuration, stable IDs, canonical numeric conventions, and validation rules.
4. Implement canonical state, fixed logical clock, seeded random source, event ledger, state projection, canonical serialization, and hashing as pure TypeScript.
5. Implement movement, resources, reservations, commitments, needs, injury, repair, and transactional action execution.
6. Implement perception, beliefs, memories, and relationship consequences.
7. Implement affordance generation and validation.
8. Implement the decision-provider contract, deterministic provider, and fallback provider.
9. Implement the six scenarios and scripted scenario events.
10. Implement replay, imported-ledger validation, export structures, and headless reports.
11. Implement Vitest unit and integration tests. Make the pure and headless suites pass before building presentation.
12. Implement the browser worker host and typed command/snapshot protocol.
13. Implement the declarative Three.js workshop and snapshot-driven visual adapters.
14. Implement the DOM operator UI, inspector, diagnostics, and browser file flows.
15. Implement Playwright tests.
16. Implement the final batch command and anonymized trace export.
17. Run type checking, linting, validation, all tests, production build, and the 100-run deterministic batch.
18. Correct every invariant violation and replay mismatch.
19. Update the README with exact setup, operation, deployment, and known limitations.

Do not begin visual polish before the pure simulation, replay, hash, and headless scenario tests pass. Do not make the simulation depend on what is easiest to animate in Three.js.

# 25. Definition of done

The task is complete only when all of the following are true:

- `npm ci` succeeds from a clean checkout.
- `npm run typecheck`, `npm run lint`, and `npm run validate` succeed.
- `npm run test:run` and `npm run test:e2e` succeed.
- `npm run build` creates a working production `dist` folder.
- `npm run preview` serves the production build without uncaught console errors.
- The pure simulation core runs in Node without loading Three.js, the DOM, canvas, WebGL, or worker APIs.
- The browser application runs canonical simulation through a dedicated Web Worker.
- The Three.js workshop is created declaratively with no manual object assembly.
- All six scenarios are selectable and runnable.
- Every scenario reaches a terminal state.
- The event ledger captures every canonical mutation.
- Browser-worker and Node-headless execution match for the same scenario, provider, configuration, and seed.
- Replay produces the same final-state hash.
- The meal cannot be consumed twice.
- Reservations and commitments cannot enter contradictory states.
- Stale actions are rejected or interrupted cleanly.
- Decision-provider failure activates deterministic fallback behavior.
- NPC behavior reflects structured traits, values, memories, relationships, and commitments.
- Pausing, stepping, tab throttling, and speed changes do not alter authoritative outcomes after the same logical ticks.
- A 100-run deterministic batch produces no invariant violation.
- Ledgers, batch reports, and anonymized traces can be exported.
- An exported ledger can be imported in the browser and replayed successfully.
- Clicking an NPC updates the correct DOM inspector.
- The README contains complete setup and operating instructions.
- No external model integration, backend, database, game engine, physics engine, UI framework, or unrelated gameplay system has been added.

# 26. Change control

This document defines `Vertical Slice 001 — v1.0`.

Do not silently change:

- NPC traits
- Initial need values
- Repair rates
- Injury timing or severity
- Meal ownership
- Commitment terms
- Scenario duration
- Action categories
- Acceptance criteria

A material change requires:

1. A new experiment version.
2. A written reason for the change.
3. Updated scenario configuration.
4. Re-running every automated scenario and replay test.
5. Reporting results separately from v1.0.

The purpose of the slice is to test an architecture under fixed conditions, not to keep changing the conditions until the implementation appears successful.
