# Milestone 3 Item 2 — staged research-charter instructions

**Date:** August 2, 2026  
**Status:** ACTIVE WORKING INSTRUCTIONS — Item 2 only  
**Repository:** `186F/thelastmeal`  
**Working branch:** `docs/m3-item2-staged-charter`  
**Base merge:** `ce8e779fe1812a67e780bf6e7909597154d8e823`  
**Operator:** the user  
**Advisor:** ChatGPT  
**Coding Agent:** Codex using `gpt-5.6-sol` at ultra reasoning

---

# 1. Purpose

This document governs **Item 2 only**:

> Open a new milestone around the project’s revised research question.

The intended milestone is:

```text
Milestone 003 — Parallel Causal Life Laboratory
```

The revised north-star question is:

> Which cognitive functions should be deterministic, which should be generative, and at what timescales should each operate so that long-running simulated lives remain persistent, grounded, varied, causally intelligible, and compelling to observe?

This work is a **research-charter and milestone-framing task**. It is not an implementation task.

The Coding Agent will modify the same working pull request in modest, separately reviewable chunks. At the end of every chunk, it must stop and wait for explicit Advisor clearance relayed by the Operator.

---

# 2. Historical baseline

Milestone 2 is closed. Its final record is:

```text
documentation/milestones/002-sparse-cognition/
  MILESTONE_002_CLOSEOUT_REPORT.md
```

Its canonical registered analysis is:

```text
documentation/milestones/002-sparse-cognition/calibration/
  m2-calibration-variance-a-001.analysis.json
  m2-calibration-variance-a-001.analysis.md
```

The Milestone 2 calibration remains immutable historical evidence:

```text
study-plan SHA-256:
e2002b6b414404060dcb5d9d89af8ac96a0147859116d6cdd81b8ded5dd995d0

archive:
m2-calibration-variance-a-evidence-001.zip

archive SHA-256:
0e178266f24dfdca77c6b90c3478c0d48b82f9f133dc0c6393db3a6be9ed4039

inventory aggregate SHA-256:
fd71cf99087894e17d2759c108a9b0ecf3afbda1d9f09048a188bf9514c873dd
```

Milestone 3 must not retroactively alter Milestone 2’s experiment, analysis, evidence, findings, or claim boundaries.

---

# 3. Authority and precedence

The authority order for this work is:

1. **Operator** — final project and merge authority.
2. **Advisor** — approves or rejects each chunk before work proceeds.
3. **This instruction document** — governs Item 2 unless amended by the Operator and Advisor.
4. **Coding Agent** — executes only the currently authorized chunk.

The Coding Agent must not infer approval from silence, elapsed time, a green CI run, or the apparent obviousness of the next task.

Only an instruction materially equivalent to the following authorizes continuation:

> Advisor approves Chunk N. Proceed to Chunk N+1.

If the Advisor requests changes, those changes remain part of the same chunk. The Coding Agent must implement them, push them to this PR, and stop again.

---

# 4. Working-PR protocol

This pull request is deliberately opened before Item 2 is complete. It is a **working draft PR**, not a merge candidate.

The Coding Agent must:

- Work only on `docs/m3-item2-staged-charter`.
- Pull the latest remote branch before each chunk.
- Keep every chunk in one coherent commit unless a requested remediation requires another commit.
- Push after each chunk so the Advisor can review the exact GitHub diff.
- Never force-push unless the Operator explicitly authorizes it.
- Never squash or rewrite previously approved chunk history during Item 2.
- Keep the PR in draft state until final Advisor review.
- Update the PR body after each chunk with the current gate and a concise dispatch.
- Stop after every chunk.

Do not create a second Milestone 3 PR for Item 2.

Do not merge this PR.

Do not modify this instruction file unless the Advisor explicitly directs a correction to the governing plan.

---

# 5. Absolute scope limits

Throughout Item 2, do **not**:

- Change application, simulation, gateway, evaluator, or orchestration source.
- Change tests.
- Change package versions, dependencies, or lockfiles.
- Change any Vertical Slice 001 data or golden hash.
- Change any Milestone 1 or Milestone 2 experiment, prompt, condition, provider, metric, threshold, study, template, plan, schema, or evidence contract.
- Modify or repackage any evidence.
- Repair the archive-format defect.
- Implement concurrency.
- Implement a headless runner.
- Implement a quota or inference broker.
- Implement policy patches or any other cognitive architecture.
- Revise the comparator or scenario mechanics.
- Create a new model prompt.
- Register or run a new experiment.
- Start the repository gateway or browser automation.
- Make any repository NPC-model call.
- Build the Truman-style or Apartment Building scenarios.
- Claim that a candidate architecture is accepted.
- Claim that a broad research problem is solved.
- Claim novelty that the reviewed literature does not support.

The Codex session itself is permitted. “Zero model calls” in the PR means zero calls through the repository’s game-model, gateway, or experimental infrastructure.

---

# 6. Required final deliverables

By the end of Item 2, the PR should contain:

```text
documentation/milestones/003-parallel-causal-life-laboratory/
  README.md
  MILESTONE_003_RESEARCH_CHARTER.md
  MILESTONE_003_ITEM2_STAGED_CHARTER_INSTRUCTIONS.md
```

After the final integration chunk, it may also contain minimal navigation updates to:

```text
README.md
documentation/README.md
```

No implementation brief, experiment plan, schema, source stub, prompt, or test belongs in this PR.

---

# 7. General writing and evidence rules

The charter must clearly distinguish:

```text
Historical finding
Hypothesis
Design proposal
Candidate architecture
Future work
Explicit exclusion
```

Never blur these categories.

## 7.1 Internal evidence

Use the merged Milestone 2 closeout report and canonical analysis as the sole authority for Milestone 2 findings.

Do not independently reinterpret the raw archive in Item 2.

Do not add new post-hoc Milestone 2 metrics.

## 7.2 External research

Use primary sources only for substantive research claims:

- Peer-reviewed papers
- Author-hosted preprints
- Official project papers
- Official technical documentation when discussing systems behavior

For every cited research system, identify:

```text
what it attempted
what it demonstrated
what it did not evaluate
what limitations the authors reported
what this project may borrow
what this project proposes to test differently
```

Do not describe an approach as “proven not to work” unless its evidence actually supports that conclusion.

Use cautious language such as:

- “reported this failure mode”
- “did not evaluate”
- “leaves this question open”
- “provides evidence for”
- “does not establish”

Label preprints as preprints.

Verify titles, authors, publication venues, dates, URLs, and reported results before committing them.

## 7.3 Novelty claims

The broad aspiration—believable autonomous characters and emergent simulated societies—is not novel.

The charter may identify a **potentially distinctive combination**, but must present it as a research hypothesis requiring literature review and empirical validation.

---

# 8. Mandatory stop-and-review dispatch

At the end of every chunk, the Coding Agent must provide the Operator with:

```text
Chunk completed:
Branch:
Base SHA:
Head SHA:
Commit(s):
Files changed:
Summary of substantive additions:
Sources added or consulted:
Claims introduced or revised:
Checks run and results:
Known uncertainties:
Explicit confirmation that no later chunk was started:
Explicit confirmation of zero repository game-model calls:
```

Then stop.

The Coding Agent must not begin the next chunk while waiting for review.

---

# 9. Chunk 0 — read-only orientation and proposed file map

## Objective

Establish that the Coding Agent understands the closed Milestone 2 record, the revised objective, and the exact scope of Item 2 before writing charter content.

## Required work

Read at minimum:

```text
README.md
documentation/README.md
documentation/milestones/002-sparse-cognition/README.md
documentation/milestones/002-sparse-cognition/MILESTONE_002_CLOSEOUT_REPORT.md
documentation/milestones/002-sparse-cognition/calibration/README.md
documentation/milestones/002-sparse-cognition/calibration/m2-calibration-variance-a-001.analysis.md
documentation/reference/VERTICAL_SLICE_001_CODING_BRIEF.md
documentation/reference/TECHNICAL_REFERENCE.md
this instruction document
```

Inspect the current branch, base, and diff.

Produce a proposed heading structure for:

```text
README.md
MILESTONE_003_RESEARCH_CHARTER.md
```

Identify any apparent ambiguity or conflict in these instructions.

## Files allowed to change

None.

## Required validation

```text
git status --short
git diff --name-only main...HEAD
```

## Stop condition

Send the Chunk 0 dispatch with the proposed file map and stop.

Do not create the milestone README or charter yet.

---

# 10. Chunk 1 — milestone shell and charter skeleton

## Objective

Create the minimal Milestone 3 documentation shell without yet making substantive research claims.

## Required work

Create:

```text
documentation/milestones/003-parallel-causal-life-laboratory/README.md
documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md
```

The milestone README must include:

- Title
- Status
- Purpose
- Current authorization
- Authoritative document
- Relationship to Milestone 2
- Planned future work packages
- Explicit exclusions
- Reading order

Use a status materially equivalent to:

> **CHARTER PHASE — no Milestone 3 implementation or experiment has been authorized.**

The charter should contain a complete heading skeleton and brief one- or two-sentence scope notes under each heading. Use explicit placeholders such as `TBD IN CHUNK 2`, not invented content.

The skeleton must reserve sections for:

1. Executive statement
2. Revised problem statement
3. Reinterpretation of sparse cognition
4. What Milestone 2 taught us
5. North-star evaluation target
6. Scenario families
7. Candidate allocations of cognitive authority
8. Potentially distinctive contribution
9. Relationship to existing research
10. Parallel causal laboratory
11. Counterfactual causal twins
12. Behavioral failure taxonomy and metrics
13. Planned work packages
14. Governance and evidence rules
15. Explicit exclusions
16. Charter acceptance criteria

## Files allowed to change

Only the two new Milestone 3 files.

## Prohibited in this chunk

- No external research claims
- No shared navigation updates
- No detailed candidate-architecture design
- No implementation specification

## Required validation

```text
npm run lint
node scripts/docs/checkLinks.mjs
git diff --check
```

## Commit

Suggested commit:

```text
docs: scaffold milestone 3 research charter
```

## Stop condition

Push, update the draft PR body to say `Awaiting Advisor review: Chunk 1`, send the dispatch, and stop.

---

# 11. Chunk 2 — revised objective, M2 lessons, and claim boundaries

## Objective

Define why Milestone 3 exists and what the project is now trying to learn.

## Required charter sections

Complete:

1. Executive statement
2. Revised problem statement
3. Reinterpretation of sparse cognition
4. What Milestone 2 taught us
5. North-star evaluation target
15. Explicit exclusions

## Required substance

State that the project seeks a general architecture in which:

- A deterministic engine maintains persistent and consequential reality.
- Generative models perform bounded forms of interpretation, reflection, imagination, social reasoning, planning, language, and psychological development.

Clarify that the objective is not:

- Minimizing cost for its own sake
- Maximizing model calls
- Replacing all game logic with an LLM
- Adding decorative dialogue to deterministic utility agents
- Creating one impressive scripted demonstration
- Optimizing only task completion or persona consistency

Explain the opposed failure modes:

### Excessive generative authority

Potentially:

- Repetition
- Semantic drift
- Hallucinated facts
- Forgotten causality
- Mutual echoing
- Conversation loops
- Goal churn
- Rationales replacing motives
- Narrative overinterpretation

### Excessive deterministic control

Potentially:

- Predictable utility maximization
- Trait-weighted automata
- No genuine interpretation or ambivalence
- Little invention
- The same motive always producing the same action

Define sparse cognition as **bounded generative authority**, not merely few calls.

Use the merged Milestone 2 closeout to explain that operational reliability and high behavioral similarity can coexist with narrow or semantically incorrect behavior.

Do not imply that the current calibration proves all per-decision systems fail.

Define the north-star properties:

- Persistence
- Causal grounding
- Coherent individuality
- Behavioral breadth
- Adaptation
- Emergence
- Non-degeneracy
- Observer value

## Files allowed to change

Only the two Milestone 3 files.

## Required validation

- Verify every Milestone 2 factual statement against the closeout report or canonical analysis.
- Run documentation checks.
- Search for prohibited overclaims such as `proved`, `solved`, `first`, `best`, or `human-like` and justify every remaining use.

## Commit

Suggested commit:

```text
docs: define milestone 3 research objective
```

## Stop condition

Push, set the PR body gate to `Awaiting Advisor review: Chunk 2`, send the dispatch, and stop.

---

# 12. Chunk 3 — scenario families and candidate cognitive allocations

## Objective

Describe what kinds of simulated-life problems the project intends to study and define a neutral comparison space of cognitive architectures.

## Required charter sections

Complete:

6. Scenario families
7. Candidate allocations of cognitive authority

## Scenario families

### Colony-pressure laboratory

Research focus:

- Scarcity
- Work and competence
- Emergencies
- Commitments
- Practical conflict
- Group formation
- Resentment and gratitude
- Shared-resource consequences

Primary question:

> Can distinct people create an emergent social history inside a demanding systemic world?

### Developmental epistemology laboratory

The Truman-style family.

Research focus:

- Early development
- Concept acquisition
- Curiosity
- Attention
- Trust
- Theory formation
- Hypothesis testing
- Belief revision
- False explanations
- Self/world-model development

State that an NPC merely saying “this is a simulation” is not success. A meaningful discovery requires causally grounded evidence accumulation and belief revision.

### Ambient-community laboratory

The Apartment Building family.

Research focus:

- Lives not centered on the player
- Routines and employment
- Friendship and romance
- Household change
- Financial pressure
- Visitors
- Secrets
- Arrival and departure
- Offscreen continuity
- Quiet periods
- Longitudinal relationship change

Primary question:

> Can residents appear to have lives that existed before observation and continue when the user looks away?

## Candidate cognitive allocations

Describe neutrally:

- Deterministic control
- Per-decision generative control
- Episode-appraisal / policy-artifact cognition
- Reflection-only cognition
- Planning-only cognition
- Dialogue-only generation over engine-selected intent
- Mixed multi-timescale cognition

The episode-appraisal architecture is a candidate, not the answer. Summarize its conceptual features only:

- Quiet-event candidates
- Reflection windows
- Episode-scoped motivational artifacts
- Engine-owned psychological primitives
- Bounded acyclic motivational graphs
- Multiple simultaneous motives
- Explicit motivational conflict
- Partial coverage and abstention
- Immutable successor lineages
- Persistent memory, belief, relationship, and emotional residue

Do not convert those concepts into schemas, constants, prompts, or implementation choices.

## Files allowed to change

Only the two Milestone 3 files.

## Required validation

- Confirm every condition is framed as a candidate or control.
- Confirm no implementation is authorized.
- Run documentation checks.

## Commit

Suggested commit:

```text
docs: frame milestone 3 scenarios and candidate architectures
```

## Stop condition

Push, set the PR body gate to `Awaiting Advisor review: Chunk 3`, send the dispatch, and stop.

---

# 13. Chunk 4 — primary-source related-work and novelty map

## Objective

Position the revised research program honestly against the strongest relevant prior work.

## Required charter sections

Complete:

8. Potentially distinctive contribution
9. Relationship to existing research

## Required research areas

At minimum, investigate primary sources for:

- Generative Agents
- Concordia
- Project Sid / PIANO
- AI Metropolis
- AgentSociety
- Agentopia
- Persona coherence, anti-echoing, or long-horizon role consistency
- Plan, policy, or skill caching
- Scalable persona-conditioned policy systems
- Large-population LLM-agent simulation

This list is a search floor, not permission to include irrelevant papers.

## Required comparison method

For every included work, document:

```text
Aim
Architecture
Scale
Evaluation
Positive findings
Negative findings or reported failure modes
Author-stated limitations
Relevance to Milestone 3
What we would adopt
What we would test differently
```

## Potentially distinctive combination

The charter may identify these as candidate contributions:

1. Adaptive cognitive-authority allocation
2. Counterfactual cognitive twins
3. Episode-scoped, provenance-bearing inner life
4. Direct measurement of cognitive dead ends
5. High-throughput causal architecture search

Use language materially equivalent to:

> This combination is a candidate contribution requiring continued literature review and empirical validation.

Do not claim no prior work has combined these elements unless a defensible systematic review supports it.

## Files allowed to change

Only the charter, unless the Advisor previously authorized a separate related-work appendix.

## Required validation

- Every external factual claim has a primary-source citation.
- Preprints are labeled.
- No citation supports a stronger statement than the source itself.
- More than one research lineage is represented.
- The charter distinguishes “not evaluated” from “failed.”
- Run documentation checks.

## Commit

Suggested commit:

```text
docs: map milestone 3 to related research
```

## Stop condition

Push, set the PR body gate to `Awaiting Advisor review: Chunk 4`, send the source list and claim map, and stop.

---

# 14. Chunk 5 — parallel laboratory, causal twins, and metrics

## Objective

Define why high-throughput concurrency is scientifically central and specify the future experimental method without implementing it.

## Required charter sections

Complete:

10. Parallel causal laboratory
11. Counterfactual causal twins
12. Behavioral failure taxonomy and metrics

## Parallelism

Distinguish:

1. Independent runs
2. Independent experiments
3. Multiple NPCs in one shared world

State that independent runs and studies should be highly parallelizable, while shared-world parallelism requires causal-dependency management.

Define the future objective:

> Permit tens, hundreds, and eventually thousands of independent causal lives and multiple experimental families to run concurrently while preserving run isolation, treatment identity, replay, and evidence integrity.

Do not select a cloud provider or implementation stack in this charter.

## Causal twins

Define the method:

```text
Identical world history
Identical NPC identity
Identical memories and beliefs
Identical seed prefix
Identical legal affordances
        ↓
Fork into different cognitive-authority conditions
        ↓
Run descendants independently
        ↓
Compare first divergence, altered worlds, and long-horizon trajectories
```

After first causal divergence, later decisions must not be naively matched by ordinal position.

## Metric families

Propose, without freezing formulas or thresholds:

### Repetition and loops

- Repeated action sequences
- Semantic dialogue repetition
- Conversation-turn loops
- Repeated goals without consequence
- Recurrent decision states

### Consequentiality

- Time since last consequential change
- Fraction of interactions producing later effects
- Persistence of relationship changes
- Commitment follow-through
- Whether conversation produces action or state change

### Belief and memory

- Belief correction after contrary evidence
- Retrieval relevance
- Memory self-reinforcement
- Contradictory beliefs
- Novel-event assimilation
- Unjustified certainty

### Individuality

- Behavioral repertoire breadth
- Within-character variation
- Between-character distinguishability
- Persona convergence or echoing
- Caricature collapse

### Goal behavior

- Goal churn
- Abandoned plans
- Replanning after changed conditions
- Repetitive fixation

### Social life

- Conversation termination
- Relationship-network change
- Generic friendliness or hostility convergence
- Rumor propagation
- Conflict resolution or persistence

### Observer evaluation

- Interest in continuing to watch
- Perceived life beyond the scene
- Surprise
- Causal intelligibility
- Character recognizability
- Perceived repetition
- Perceived nonsense

### Operational diagnostics

- Calls
- Tokens
- Cost
- Latency
- Failures
- Fallbacks
- Queue delay
- Concurrency profile

State that operational diagnostics do not alone determine behavioral success.

## Files allowed to change

Only the charter.

## Required validation

- Confirm formulas and thresholds remain future work.
- Confirm concurrency is described as an experimental parameter with possible treatment effects.
- Confirm the charter does not authorize implementation.
- Run documentation checks.

## Commit

Suggested commit:

```text
docs: define parallel causal research method
```

## Stop condition

Push, set the PR body gate to `Awaiting Advisor review: Chunk 5`, send the dispatch, and stop.

---

# 15. Chunk 6 — work packages, governance, and charter acceptance criteria

## Objective

Turn the research vision into an ordered but not-yet-authorized program of work.

## Required charter sections

Complete:

13. Planned work packages
14. Governance and evidence rules
16. Charter acceptance criteria

## Planned work packages

Use a sequence materially equivalent to:

```text
Work Package 1:
Research charter and claim boundaries
[this PR]

Work Package 2:
Minimum parallel-run laboratory specification

Work Package 3:
Serial-versus-parallel parity study

Work Package 4:
Corrected causal test world and semantic contracts

Work Package 5:
Reduced candidate cognitive architectures

Work Package 6:
First causally matched architecture-comparison study

Work Package 7:
Dead-end and observer-evaluation laboratory

Work Package 8:
Scale-out and additional scenario families
```

Do not imply that Work Packages 2–8 are authorized.

## Governance

Include at minimum:

- M2 remains immutable historical evidence.
- M3 receives separate versions and experiment identities.
- M2 conditions and metrics cannot be silently repurposed.
- Formula changes require metric-version changes.
- Treatment changes require experiment-version changes.
- Every live dataset requires pre-registration.
- Failed attempts remain evidence.
- Concurrent runs require explicit concurrency provenance.
- Provider queueing and rate limits must be measured.
- Logical simulation time is distinct from provider wall-clock time.
- Parallelism requires parity evidence before behavioral use.
- One study cannot silently change its execution architecture.
- Every causal fork identifies its common ancestor.
- Model prose is never authoritative world evidence.
- The deterministic engine remains final authority over world state and legal consequence.

## Acceptance criteria

The charter is review-ready only if it:

- States the revised objective accurately.
- Makes cost and call reduction secondary.
- Treats cognitive-authority allocation as the research variable.
- Preserves M2’s claim boundaries.
- Treats policy artifacts as one candidate.
- Defines the three scenario families.
- Defines causal twins.
- Makes concurrency scientifically central.
- Identifies dead-end metrics.
- Uses cautious related-work language.
- Contains no hidden implementation authorization.
- Separates findings, hypotheses, proposals, and exclusions.

## Files allowed to change

Only the two Milestone 3 files.

## Required validation

Run documentation checks and a terminology consistency review across the whole charter.

## Commit

Suggested commit:

```text
docs: govern milestone 3 research program
```

## Stop condition

Push, set the PR body gate to `Awaiting Advisor review: Chunk 6`, send the dispatch, and stop.

---

# 16. Chunk 7 — integration, navigation, and final Item 2 audit

## Objective

Produce the final coherent Item 2 documentation set and prepare—not merge—the PR for final Advisor and Operator review.

## Required work

1. Re-read the entire charter as one argument.
2. Remove all placeholders.
3. Resolve contradictions, duplicate definitions, and inconsistent terminology.
4. Add minimal navigation updates to:

```text
README.md
documentation/README.md
```

Use status language materially equivalent to:

```text
Current work:
Milestone 003 — Parallel Causal Life Laboratory, charter phase.

Milestone 2 is closed after calibration.
No Milestone 3 implementation or live experiment is authorized.
```

5. Link:

- Milestone 3 README
- Milestone 3 research charter
- Milestone 2 closeout report

6. Update the PR body with:

- Base SHA
- M2 closeout authority
- Files changed
- Revised objective
- Candidate cognitive allocations
- Causal-twin and concurrency rationale
- Related-work sources
- Explicit exclusions
- Checks
- Zero game-model-call confirmation
- Confirmation that Work Packages 2+ were not begun

## Final claim audit

Create a review table in the PR body or dispatch that classifies every major charter statement as:

```text
Historical finding
Research-supported premise
Project hypothesis
Candidate design
Future work
Exclusion
```

## Allowed files

```text
README.md
documentation/README.md
documentation/milestones/003-parallel-causal-life-laboratory/README.md
documentation/milestones/003-parallel-causal-life-laboratory/MILESTONE_003_RESEARCH_CHARTER.md
```

This instruction file should remain unchanged.

## Required validation

```text
npm run lint
node scripts/docs/checkLinks.mjs
git diff --check
git diff --name-only main...HEAD
```

Also confirm:

- No source files changed.
- No tests changed.
- No package or lockfile changed.
- No M1 or M2 experiment file changed.
- No raw evidence was added.
- No gateway or browser was launched.
- No repository game-model call occurred.
- All citations are primary sources.
- All local links resolve.

## Commit

Suggested commit:

```text
docs: finalize milestone 3 research charter
```

## Stop condition

Push, leave the PR as draft, set the PR body gate to `Awaiting final Advisor review: Item 2`, send the final dispatch, and stop.

Do not mark the PR ready for review without explicit Advisor clearance.

Do not merge.

---

# 17. Item 2 completion boundary

Item 2 is complete only when:

- Chunks 0–7 have each received explicit Advisor approval.
- The PR contains the final Milestone 3 README and research charter.
- The final diff remains documentation-only.
- The charter is internally coherent and cautiously situated in the literature.
- The PR is approved by the Advisor for readiness.
- The Operator decides whether to mark it ready and merge it.

Item 2 completion does **not** authorize:

- A parallel laboratory implementation
- Any new scenario mechanics
- A new comparator
- Any policy-patch implementation
- Any model prompt
- Any live experiment
- Any cloud deployment

---

# 18. Initial instruction to the Coding Agent

When taking over this PR, begin with **Chunk 0 only**.

Do not create charter files until Chunk 0 is approved.

Your first dispatch must end with:

> **Chunk 0 orientation is complete. No charter content or later Item 2 work was started.**
