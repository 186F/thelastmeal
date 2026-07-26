# The Last Meal — Vertical Slice 001 (`causal-npc-lab`)

A small, deterministic browser simulation built with **Vite, TypeScript, and Three.js**:
three NPCs (Mara, Jonas, Rin) make stable, recognizably different decisions under
resource scarcity, social obligations, memory, and an emergency, while the
deterministic simulation — not any model — retains exclusive control over objective
reality. This is the first experimental vertical slice of a larger causal-NPC research
program.

The authoritative specification is
[`documentation/VERTICAL_SLICE_001_CODING_BRIEF.md`](documentation/VERTICAL_SLICE_001_CODING_BRIEF.md)
(placed under `documentation/` rather than the repo root; content unchanged). This
implementation is experiment version **Vertical Slice 001 — v1.0**, configuration
version `vs001-1.0.0`.

---

## Pre-registered success criteria (from the brief, recorded verbatim in intent)

**Correctness**

- No NPC may commit an action whose physical or logical preconditions are false.
- A meal may not be consumed more than once.
- Two NPCs may not simultaneously hold an exclusive reservation for the same resource.
- A promise may not be simultaneously recorded as both fulfilled and broken.
- A rejected action may not mutate canonical world state.
- Replaying an event ledger from the same initial state must reproduce the exact same
  final canonical state.
- The simulation must continue when the active decision provider fails.

**Behavioral distinctiveness**

- Mara, Jonas, and Rin must exhibit distinguishable action patterns under equivalent
  circumstances.
- An anonymized action trace should permit a human reviewer to identify the NPC above
  the 33% chance baseline (later-study target: ≥ 70%).
- A relevant memory must measurably alter behavior in a controlled comparison (B1/B2).
- Memory and personality may affect preferences but may not bypass survival
  constraints, action legality, or the authoritative event system.

**Future scalability targets** (recorded, not demonstrated in this slice)

- The policy-patch condition should eventually use ≤ 25% of the model calls of the
  per-decision condition.
- Model use should scale with novel causal situations, not raw ticks.

These criteria are not to be tuned or redefined after observing results without
creating a new experiment version (brief section 26).

---

## Prerequisites and installation

- **Node.js active LTS** (developed on v24) with `npm`
- **Git**
- A current Chromium-based browser

```bash
npm ci                    # install exact locked dependencies
npm run test:e2e:install  # install Playwright's Chromium binary (for e2e tests)
```

No API key, cloud service, backend, database, paid asset, or model account is needed.

## npm commands

| Command                    | What it does                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`              | Start the Vite dev server (open the URL it prints; the port is not fixed)                                                                                                                                                                              |
| `npm run build`            | Typecheck, then produce the production bundle in `dist/`                                                                                                                                                                                               |
| `npm run preview`          | Serve the production bundle locally                                                                                                                                                                                                                    |
| `npm run typecheck`        | TypeScript strict checking, no emit                                                                                                                                                                                                                    |
| `npm run lint`             | ESLint (incl. sim-purity rules) + Prettier check                                                                                                                                                                                                       |
| `npm run test`             | Vitest in watch mode                                                                                                                                                                                                                                   |
| `npm run test:run`         | All Vitest unit + integration tests, once                                                                                                                                                                                                              |
| `npm run test:coverage`    | Vitest with V8 coverage over `src/sim` and `src/shared`                                                                                                                                                                                                |
| `npm run test:e2e`         | Playwright browser suite (starts its own Vite server via `webServer`)                                                                                                                                                                                  |
| `npm run test:e2e:install` | Install Playwright Chromium                                                                                                                                                                                                                            |
| `npm run validate`         | Experiment-data validation + architecture checks (sim-purity import scan, required npm scripts); exits nonzero on failure                                                                                                                              |
| `npm run batch`            | Headless deterministic batch: every scenario, 100 repeat runs each, replay verification, invariant checks; writes `artifacts/` (ledgers, traces, report.json, report.md); exits nonzero on any violation. Use `-- --runs=N` to change the repeat count |

## Running the browser application

```bash
npm run dev
```

Open the printed URL. The page is a single desktop-oriented operator console:

- **Scenario & run control (top bar):** select one of the seven scenario
  configurations (A, B1, B2, C, D, E, F), then Start / Pause / Resume / Step
  (×1/×10/×60/×300 while paused or idle) / Reset. Speeds 1×, 5×, 20× are simulated
  seconds per wall-clock second; they never change outcomes. _Run to completion_
  finishes the scenario immediately; _Run all scenarios_ executes the full in-browser
  batch in the worker (with replay verification).
- **Export / import / replay:** _Export ledger_ downloads the completed run's JSON
  ledger. _Import ledger…_ opens a file picker; the file is fully validated before it
  is accepted (schema, versions, ordering, IDs, hash) and a rejected file changes
  nothing. _Replay imported_ / _Replay latest_ fold the reducer over the recorded
  events — no decision provider runs — and report hash match/mismatch in the global
  panel. _Export traces_ downloads the anonymized individuality traces; _Export batch
  report_ downloads `batch-report.json` + `batch-report.md` after a batch.
- **Validate configuration** runs the same shared validation rules as
  `npm run validate`'s data layer, inside the worker.
- **Viewport:** orthographic Three.js tabletop with the four locations, three
  primitive NPCs (box Mara, sphere Jonas, cone Rin), meal marker, purifier progress
  bar, and injury rings. Click an NPC (or use the inspector tabs) to inspect logical
  state, current decision, confidence, reason code, beliefs, memories, and
  relationships. _Decision scoring_ toggles the per-affordance score decomposition;
  _Event log_ toggles the collapsible typed-event panel (with a "tick noise" filter).

## Architecture: one pure core, two hosts

```text
DOM operator command
        ↓ typed, versioned, sequence-checked worker command (zod-validated)
Simulation Web Worker (src/worker)          Node headless runner (scripts/, tests/)
        ↓                                        ↓
        └────────── src/sim — pure TypeScript simulation core ──────────┘
                    events + read-only presentation snapshots
        ↓
Main thread: Three.js renderer + DOM inspectors (read-only)
```

- `src/sim` and `src/shared` import **no** Three.js, DOM, WebGL, Vite, browser
  storage, or worker APIs. This is enforced three ways: ESLint restricted
  imports/globals, the `npm run validate` import scan, and the fact that the entire
  unit/integration suite and batch runner execute the core directly under Node.
- The browser worker (`src/worker/simWorker.ts`) and the Node runner both drive the
  same `SimulationHost` through the same command semantics
  (`src/worker/commandProcessor.ts`), which is covered by an explicit command-parity
  test. Scenarios, providers, event definitions, the reducer, replay, and hashing are
  literally the same modules in both hosts.
- Canonical state mutates in exactly one place: the event reducer
  (`src/sim/events/reduce.ts`). The engine emits typed events; replay folds the same
  reducer over the recorded ledger, which is why replay is exact.
- The main thread renders snapshots and issues typed commands; it can not touch
  canonical state. Meshes carry only stable entity IDs for picking.

### Determinism specifics

- Canonical time is an integer tick count (1 tick = 1 simulated second; scenarios run
  2700 ticks). Wall-clock time paces the worker only — a throttled/backgrounded tab
  catches up in whole ticks with identical outcomes.
- All canonical quantities are exact integers: normalized values in **micro units**
  (1.0 = 1,000,000), purifier progress in **repair units** (120,000 = 100%, so the
  fixed rates are exactly 20/14/7 units per tick).
- Canonical serialization: objects with sorted keys, arrays in order, integers only
  (floats/undefined/Map/Set/class instances are rejected loudly). Hash: FNV-1a 64-bit
  over the UTF-8 bytes, identical in browser and Node (`src/sim/replay/`).
- A seeded RNG (`src/sim/rng`) is the core's only permitted randomness source. This
  slice's deterministic provider consumes none; any future draw must record its
  outcome as an event to keep replay reducer-only.
- Operator pause/resume markers are recorded in the ledger but draw IDs from a
  separate counter and never advance the canonical state version, so pausing and
  stepping can never change outcomes or hashes (this is under test).

## Where the fixed data lives

- **Fixed experiment values:** `src/sim/config.ts` (time, needs, repair, injury,
  treatment, commitment terms, relationship deltas, thresholds)
- **Identity cards, seed memories:** `src/sim/domain/identities.ts`
- **Scenario definitions (IDs, versions, seeds, scripted events, expected
  invariants):** `src/sim/scenarios/definitions.ts`
- **Decision weights and scoring constants:** `src/sim/decisions/weights.ts`
- **Presentation coordinates (display-only):** `src/shared/viewConfig.ts`

## How a future decision provider plugs in

Implement `DecisionProvider` (`src/sim/decisions/provider.ts`): receive a structured
`DecisionContext` (identity, needs, injury, beliefs, memories, goal, commitments,
offered affordances, request ID, logical tick, canonical state-version token) and
return one **offered** affordance ID + confidence + reason code + optional scores.
The engine treats every provider identically: it validates the returned ID against
the offer list, revalidates the action against current state before start and
completion, and falls back deterministically (`FallbackProvider`) on any throw,
invalid result, or scripted failure — the world simulation never knows which provider
decided. Provider transport/SDK types stay outside `src/sim`; a future model gateway
belongs in a separate Node process, never in browser code, and no API key may appear
in client code, committed files, storage, or exported ledgers.

## Deployment

`npm run build` produces a fully static `dist/` (no backend, no external assets —
the worker is bundled). Serve it from any static host that delivers `.js` with
correct MIME types, e.g. `npx serve dist` or any CDN/static file server.
`npm run preview` does this locally.

## Implementation assumptions not fixed by the brief

Documented choices, all deterministic and centrally configured:

- **Speeds:** 1× means real time (1 simulated second per wall second); 5×/20× scale
  that. _Run to completion_ processes ticks as fast as possible.
- **Time integration split:** uniform per-tick need drift is applied by the reducer
  for `TimeAdvanced`; discrete action effects are their own events; repair accrues
  via per-tick `RepairProgressed` events for the active bench worker.
- **Rest or wait variants:** low-intensity duties (`routine-work`,
  `deliver-materials`, `stay-at-cot`) are structured modes of the fixed category
  "Rest or wait" — the ten-category vocabulary is unchanged.
- **Perception:** the workshop is one room; all three NPCs perceive every significant
  event (the perception layer still exists so later slices can restrict eligibility).
  Beliefs are the only channel through which providers see social facts.
- **Initial knowledge:** pre-scenario memories and the initial common-knowledge
  beliefs (meal exists, Rin owns it, Jonas's promise) are scenario data baked into
  the initial state; everything from tick 0 onward is event-sourced.
- **Relationships:** initialized to 0 for all directed pairs; documented range is
  [-1, +1] (micro units, clamped). The +0.10 treatment consequence is applied
  patient→healer for any successful treatment (the brief specifies the Jonas→Rin
  case; this generalizes it consistently).
- **Ownership violation timing:** `OwnershipViolated` (kind `took-reserved-meal`)
  and the −0.25 relationship consequence commit at the moment the violator takes
  the reserved meal (start of the eat attempt) — the brief classifies the taking
  itself as the violation. Whether consumption then completes is recorded
  separately by `MealConsumed` with its `violation` flag.
- **Treatment location:** the Medical Cot, unless the patient is incapacitated, in
  which case treatment happens in place. An injured, conscious NPC seeks the cot via
  its survival layer.
- **Commitment semantics:** the relief is fulfilled when the debtor holds a
  continuous bench session with `runStart ≤ graceTick`, `tick ≥ startTick`, and
  duration ≥ 5 min (i.e. the session overlaps the promised window). Breach is
  recorded exactly once when the grace deadline passes without a qualifying session
  under the then-current (possibly renegotiated) terms.
- **Renegotiation:** the engine computes proposal terms deterministically (earliest
  feasible start after the care conflict, rounded up to a whole minute, original
  2-minute grace span, unchanged minimum duration). The creditor accepts or rejects
  through her own recorded action; silence never counts.
- **Scenario E** omits the injury so stale-action handling is isolated; the scripted
  meal removal happens at tick 200 (after the eat decision ≈ tick 180, before
  consumption begins ≈ tick 210). **Scenario F** keeps the standard injury so the
  fallback runs under pressure.
- **Fallback policy:** continue the current action if a continue affordance is
  offered, else wait, else the lexicographically first legal affordance.
- **Social actions** (requests, responses, proposals, help/break signals) take 30
  simulated seconds and are abstract room-scale communication (no co-location
  required). A refused meal request imposes a 10-minute re-request cooldown.
- **Decision cadence:** NPCs re-decide when idle, when flagged by a relevant
  perceived event, and at most every 60 ticks while in interruptible actions;
  eating, treating, moving, and the scripted delivery are non-interruptible.
- **Pause markers** are informational ledger events (separate ID counter, no
  canonical effect), so the brief's pause-invariance requirement holds exactly.
- **Traces:** actor labels are a seed-derived permutation of the three NPCs, stable
  per export, with names/trait labels/biography text removed.
- **"Six seeded scenario variants":** B1/B2 form one memory-ablation pair sharing a
  seed, giving seven runnable configurations (A, B1, B2, C, D, E, F).
- **Ledger imports** replay against the _local_ scenario definition (matching ID,
  version, seed, and config version are required); the file supplies only the events
  and expected hash.

## Dependency roles

Runtime: `three` (presentation only), `zod` (worker-message, config, and
imported-ledger validation). Dev: `vite`, `typescript`, `vitest` +
`@vitest/coverage-v8`, `@playwright/test`, `tsx` (Node runners), ESLint + Prettier
toolchain, `@types/three`, `@types/node`. No game engine, physics, ECS, state
manager, database, pathfinding, component library, or server framework.

## Known limitations

- Movement is an abstract 30-second transition rendered as straight-line
  interpolation — by design (no pathfinding or collision).
- The operator UI is desktop-oriented; mobile is out of scope.
- The deterministic provider's weights are calibrated for distinctiveness under the
  frozen scenario family; they live in one module precisely so condition-2/3
  comparisons can hold them fixed.
- `npm run batch` regenerates `artifacts/` on every run; the directory is
  git-ignored. Committed test fixtures live under `tests/` instead.
