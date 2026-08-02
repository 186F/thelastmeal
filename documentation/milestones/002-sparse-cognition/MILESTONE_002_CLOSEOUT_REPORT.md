# Milestone 2 closeout report

**Status of this document: COMPLETED — the final record of Milestone 2.**
Written 2026-08-02 at repository HEAD
`cadcca7785618fbe12a6a5709faf67df65241527` (the frozen calibration SHA;
this closeout adds documentation only). The
[implementation brief](MILESTONE_002_SPARSE_COGNITION_AUTOMATION_IMPLEMENTATION_BRIEF.md)
and [scope ruling](MILESTONE_002_SCOPE_RULING_AND_AMENDMENTS.md) remain
preserved, unmodified, as the historical governing records of what was
originally intended.

## 1. Executive disposition

**CLOSED AFTER CALIBRATION — the policy-patch comparison was not
executed, and no sparse-cognition acceptance claim is made.**

The ten-run registered calibration study
(`m2-calibration-variance-a-001` v1.0.0) completed successfully as an
evidence-collection exercise: ten valid primary runs, first attempt every
time, zero replacements, every run artifact-valid, study-valid, and
replay-verified, with the full registration → preflight → freeze →
manifest-attestation → sealed-archive → registered-analysis chain intact
end to end. The execution and evidence systems performed strongly.

The observed per-decision behavior, however, was highly repetitive and
included a systematic social-role misunderstanding (section 6). The
planned policy-patch comparison was not executed because the calibrated
comparator was not considered an appropriate behavioral preservation
target (section 9). Milestone 2 therefore closes without a claim that
sparse cognition was implemented, accepted, or shown to preserve
believable NPC behavior.

This is not "Milestone 2 successfully completed" without qualification,
and it is not an operational failure. It is a valid calibration result
that answered the question a calibration exists to ask — what would the
comparison be measuring against? — and the answer justified stopping
before the comparison.

## 2. Original Milestone 2 objective

The brief set out, in sequence:

1. **Build the behavioral laboratory** — versioned behavioral
   fingerprints, registered similarity metrics, a study registry, contract
   auditors, blinded review packaging (Phase 2, release 1.7.0).
2. **Build the unattended evidence harness** — one-command orchestration
   of whole planned sequences with sealed, recoverable, resumable evidence
   packaging and a self-verifying keyless rehearsal (Phase 3, release
   1.8.0).
3. **Calibrate repeat-run variance** — the M2 per-decision comparator
   condition, registered studies, and the ten-run self-consistency
   calibration establishing how much per-decision Mara normally varies
   from herself (Phase 4, release 1.9.0, plus the Stage A acceptance and
   the calibration run recorded here).
4. **Implement and compare a bounded policy-patch condition** — a
   model-compiled declarative policy applied by a local deterministic
   interpreter, targeted at no more than 25% of the per-decision model's
   upstream calls while preserving registered behavioral similarity
   (brief: "The policy-patch condition must use no more than 25% of the
   upstream model calls required by the matched per-decision model
   baseline").

The first three portions were substantially completed — the laboratory,
the harness, and the calibration all exist, passed audit, and produced
sealed evidence. The fourth — the policy-patch implementation and the
paired comparison — was **not performed** under Milestone 2 (section 9).

## 3. Evidence and provenance

| Field                    | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Repository SHA           | `cadcca7785618fbe12a6a5709faf67df65241527`                         |
| Study ID and version     | `m2-calibration-variance-a-001` v1.0.0                             |
| Study-plan SHA-256       | `e2002b6b414404060dcb5d9d89af8ac96a0147859116d6cdd81b8ded5dd995d0` |
| Sequence ID              | `m2-calibration-variance-a`                                        |
| Condition                | `mara-model-per-decision-m2-v1` (Scenario A, seed 1001)            |
| Model                    | `google/gemini-2.5-flash-lite` (sole returned model)               |
| Serving provider         | Google AI Studio (sole recorded serving provider)                  |
| Prompt version           | `mara-action-selection-m2-1.0.0`                                   |
| Registration             | `calibration-variance-a` at `cadcca7…`, 2026-08-01T21:35:49.669Z   |
| Stage A prerequisite     | `ae8a8bf194f42d4caef81dcffd0d43c8cd84b76992421632159d50410f75fd22` |
| Analysis version         | `m2-calibration-variance-analysis-1.0.0`                           |
| Archive filename         | `m2-calibration-variance-a-evidence-001.zip`                       |
| Archive SHA-256          | `0e178266f24dfdca77c6b90c3478c0d48b82f9f133dc0c6393db3a6be9ed4039` |
| Inventory aggregate      | `fd71cf99087894e17d2759c108a9b0ecf3afbda1d9f09048a188bf9514c873dd` |
| File count               | 1,259 (per receipt; the archive also carries the inventory itself) |
| Packaging version        | `m2-evidence-packaging-2.1.0` (format issue: see Appendix A)       |
| Analysis JSON SHA-256    | `7b89c0c11633f819ee778fdc0fec482ca7b7ecc2f82734536feae114890c8b17` |
| Analysis Markdown SHA-256| `5d2089bc4c4acbb83e6a60b157ccb5f3f4f87f2456b771c0f79d7fe573e02e49` |

The canonical analysis reports are committed as exact byte-for-byte
copies of the production-generated files:
[`calibration/m2-calibration-variance-a-001.analysis.json`](calibration/m2-calibration-variance-a-001.analysis.json)
and
[`calibration/m2-calibration-variance-a-001.analysis.md`](calibration/m2-calibration-variance-a-001.analysis.md)
([identity record](calibration/README.md)). The raw evidence archive is
retained outside the repository and is **not** committed.

**Production analysis reproduction record.** The registered analysis was
re-produced for this closeout with the repository's production entry
point, twice, into two new create-once output directories outside the
immutable evidence root:

```
npm run m2:analyze -- --sequence <...>/calibration-variance-a \
  --out <...>/calibration-variance-a.derived/m2-calibration-variance-analysis-1.0.0-closeout-run-1
npm run m2:analyze -- --sequence <...>/calibration-variance-a \
  --out <...>/calibration-variance-a.derived/m2-calibration-variance-analysis-1.0.0-closeout-run-2
```

Each invocation independently re-verified the completed sequence status,
execution seals, root inventory, immutable sequence manifest,
manifest/control-state reconciliation, archive + sidecar + receipt,
registration provenance, Stage A prerequisite binding, the exact
registered study design, the ten valid primary observations,
strict-finalized model evidence, behavioral fingerprints, and provider
and model identity — and refused nothing. The two JSON outputs are
byte-identical to each other **and** to the original analysis produced
on 2026-08-02 immediately after the run (all three:
`7b89c0c1…`, 101,706 bytes). The official output also matches the prior
reconstructed expectations on every headline figure (ten valid
primaries, 45 pairs, no replacements, median composite 10,000 bp, range
9,375–10,000 bp, near-perfect accepted coverage, one upstream failure,
identical major consequential outcomes in all ten runs), so no
discrepancy investigation was required.

## 4. Systems findings

These are operational facts about the harness and the model route. They
are reported separately from behavior, and operational stability must
not be read as evidence of believable behavior.

- **Runs.** Ten planned primary attempts; ten valid primary executions
  (`cal-var-a-01-e1` … `cal-var-a-10-e1`), each the first execution of
  its attempt. No failed executions, no replacement executions, no
  exclusions.
- **Finalization and replay.** All ten runs strict-finalized with sealed
  per-run evidence; ledger replay reproduced the exact final canonical
  state in every run (replay-match); behavioral fingerprints built and
  verified for all ten.
- **Model and route consistency.** Every accepted response returned
  `google/gemini-2.5-flash-lite` served by Google AI Studio; route
  consistency verdict: `consistent`.
- **Request accounting.** 473 external requests emitted, 473 upstream
  calls attempted, 472 completed, 472 accepted — aggregate accepted-model
  coverage 9,978 bp. Nine runs at 10,000 bp coverage; run 08 at 9,787 bp.
  Zero engine rejections of an accepted response.
- **Failure categories.** Exactly one: `upstream-error` (1). Run 08,
  request `dec-0010` at tick 300 (failure `gwf-dec-0010`, gateway outcome
  `upstream-error`, engine outcome `expired`). Mara's in-progress work
  action simply continued; the run completed inside every gate. No other
  upstream failure occurred across the study.
- **Token distributions.** Accepted calls: median 2,440.5 total tokens
  per call (p10 1,959.3 / p90 2,891.6; min 1,891; max 2,967). Study
  totals: 1,081,519 input tokens, 52,866 output tokens.
- **Latency distributions.** Median 814 ms per call (p10 658.2 ms / p90
  1,057 ms; min 171 ms — the failed call; max 5,786 ms).
- **Evidence size.** Sequence root 132.31 MiB against the registered
  32 GiB calibration ceiling; sealed archive 139,843,584 bytes; control
  root 0.28 MiB. Under the `semantic-trace-sparse-visual-v1` capture
  profile each run recorded ≈5.9 MB of semantic trace (≈130 KB/min over
  the 45-minute run), in line with the ~121 KB/min keyless measurement
  taken before any live spend.
- **Secret scan and packaging.** Packaging completed with a receipt after
  the built-in secret scan (including nested trace archives); the sealed
  archive, sidecar, and receipt verify against the root inventory. The
  archive's container FORMAT is, however, not a standards-conforming
  ZIP — independently verified, with the evidence bytes fully intact —
  see Appendix A.

## 5. Behavioral findings

Numerical claims below are from the official
`m2-calibration-variance-analysis-1.0.0` output, except where a ledger
or trace pointer is given (event IDs, per-decision selections, and
reason codes are re-derived from the sealed evidence, with the exact
sources cited so the derivation can be repeated).

**Pairwise similarity distribution (Mara composite, basis points).**
Over all 45 pairs: median 10,000; p10/p25/min 9,375; p75/p90/max 10,000.
Only two values occur: 24 pairs at 10,000 bp and 21 pairs at 9,375 bp —
the 9,375 pairs are exactly the pairs that cross the late
rest-versus-routine-work branch (section 7).

**Entropies (milli-bits).** Pooled across runs: action-category 1,333;
action-mode 2,126; category-transition 1,989. Per run only two profiles
exist: 1,370/1,921/2,000 (the seven runs that chose routine-work at tick
2401, including run 08) and 1,251/2,251/1,921 (the three runs that chose
rest). Scale caution: under the registered fingerprint these are
distribution entropies over Mara's **started actions** — five or six
action starts per run in this scenario, because continuing an ongoing
action starts nothing new — so they describe how the handful of distinct
actions begun were spread across categories/modes, not variety across
the 47–48 per-decision model calls. (The five starts in a routine-work
run — one work-on-purifier, one relieve-worker, three rest-or-wait —
reproduce the official 1,370 milli-bit category figure exactly.)

**First-divergence patterns.** Of 45 pairs: 29 selection divergences, 8
context divergences, 8 with no divergence. Every selection divergence
falls at one of exactly three points: tick 300 (the run-08 expired
request — an infrastructure event, not a model choice; 9 pairs), tick
2401 (rest vs routine-work immediately after purifier completion; 18
pairs), or tick 2402 (one-tick rest length differences; 2 pairs). All 8
context divergences are one-tick phase offsets at ticks 2432/2433 in
otherwise identical routine-work continuations (hunger/fatigue differing
by 50µ/25µ), consistent with a one-tick difference in when the accepted
selection was folded into the world — the world clock does not wait for
a response. Semantic context at the tick-2401 branch was **identical**
across diverging runs (same beliefs, memories, commitment state,
relationships, needs, offered affordances): the variation is pure choice
variation, not context variation.

**Trajectory collapse.** The ten runs collapse into five distinct
accepted-selection trajectories: {01, 04, 07, 10} (identical), {05, 06}
(identical, one-tick phase offset from the first group), {03, 09}
(identical: one tick of rest, then routine-work), {02} (rest reaffirmed
through tick ~2582, then routine-work), and {08} (routine-work group with
the tick-300 expired call). Before tick 2401 every comparable accepted
selection is identical in all ten runs: continue work → select
`relieve:jonas` at tick 870 → exactly 26 consecutive relieve
continuations in every run.

**Outcome frequencies.** Identical in all ten runs: task `completed`
(purifier reached 120,000/120,000 at tick 2401 — `evt-005253` in every
ledger), commitment `broken` (by Jonas — section 6), meal consumed by
`rin` (tick 390, no violation), zero ownership violations, zero
treatments, zero injuries worsened, scenario ended at tick 2700. **No
behavioral difference between runs affected any consequential outcome.**

**Verdict on dispersion.** Mara's trajectory was under-dispersed, not
meaningfully varied: every model-choice divergence in the study falls in
the short post-completion rest-versus-routine-work stretch — the tick
2401 branch, the tick 2402 rest-length split among the three resting
runs, and run 02's later rest reaffirmations — all after the task was
already complete, and all consequence-free (section 7).

**These are five different properties, and this study separates them:**

| Property              | This study's result                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Task success          | Uniform: 10/10 completed — but the scenario's task pressure never forced a real dilemma |
| Behavioral similarity | Very high (median 10,000 bp) — high repeatability against the registered metric         |
| Identity expression   | Not measured here (no blinded identification study was part of this calibration)        |
| Semantic correctness  | Systematically deficient in the commitment-role dimension (section 6)                   |
| Behavioral breadth    | Low: five trajectories, one late consequence-free branch                                |

High values on the first two do not imply the last three; in this study
high similarity coexists with a repeated semantic misunderstanding and
narrow breadth, which is precisely why similarity alone cannot serve as
a preservation target (section 8).

## 6. Commitment-role semantic finding

**The mechanical facts (canonical events and typed context — primary
evidence under the registered evaluation rules).**

- Jonas was mechanically the **debtor** obligated to relieve Mara, and
  Mara was the **creditor** entitled to relief. `CommitmentCreated`
  (`evt-000002`, tick 0, identical in all ten ledgers): commitment
  `cmt-jonas-relieves-mara`, kind `relieve-at-bench`, `debtorId: jonas`,
  `creditorId: mara`, terms start 900 / grace 1020 / minimum duration 300.
- The mechanical commitment terminal status was **broken in all ten
  runs**, by Jonas, identically: `CommitmentBroken` (`evt-002252`, tick
  1021, actor `jonas`, reason `grace-deadline-passed` — Jonas is a
  deterministic NPC and never arrived), followed by the scripted
  relationship penalty (Mara→Jonas −150,000) and the memory
  `jonas-broke-commitment-cmt-jonas-relieves-mara` (`jonas-is-unreliable`).
  The official analysis reports `commitmentTerminalStatusCounts:
  {broken: 10}`.
- The typed context supplied to the model stated Mara's role explicitly.
  Archived request envelope `requests/dec-0040.json` (tick 870, every
  run): `cognition.commitments[0] = {id: cmt-jonas-relieves-mara, role:
  "creditor", otherPartyId: "jonas", status: "active", …}` — and after
  tick 1021, `status: "broken"` with the same `creditor` role at every
  remaining decision. The prompt design passes this context as structured
  JSON under a constant system instruction, so the direction information
  reached the model exactly as those typed fields.
- At tick 870 the engine offered `aff:mara:870:relieve:jonas` — category
  `relieve-worker`, mode `relieve`, `targetNpcId: jonas`, at
  `purifier-workbench`, duration 1,830 ticks, description "relieve
  (relieve-worker), targeting jonas, at purifier-workbench, for 1830
  ticks". Mechanically this is Mara covering the relief shift at the
  bench herself (its preconditions are `capable-of-repair` and
  `progress-incomplete`; performing it progressed the purifier repair to
  completion). All ten runs selected it at `dec-0040`, then selected its
  continuation exactly 26 times each — 270 relieve-family selections in
  total (27 per run).

**The model's typed output repeatedly framed this as Mara's obligation
to Jonas.** Of the 270 relieve-family selections, 162 carried the
bounded reason code `commitment` (49 `goal`, 59 `routine`) — including
**127 selections at ticks ≥ 1021**, where the only commitment in Mara's
context was `broken` with Mara's role `creditor`: there was no active
commitment binding Mara at those ticks, in either direction. Reason
codes are validated as an enumeration, not for semantic fit, so this is
diagnostic of the model's framing rather than a gate violation.

**Rationale prose (diagnostic supporting material only — under the
registered evaluation rules, rationale is a normalized diagnostic and is
NOT primary behavioral evidence).** Of 473 records, 308 rationales
mention Jonas. Counting conservatively — only rationales whose wording
explicitly casts the relief obligation as a commitment binding Mara to
Jonas ("Mara has an active commitment to relieve Jonas", "her commitment
to Jonas", "commitment with Jonas to relieve him"), and excluding the
many that merely name the selected action in the affordance's own
vocabulary ("currently relieving Jonas") — 41 such rationales occur,
in **all ten runs** (1 to 7 per run). Many rationales state the correct
direction as well ("Jonas broke his commitment to relieve Mara"), often
inside the same rationale that frames the continued bench work as Mara's
commitment to him. Representative examples (run, request ID, tick):

- run 01, `dec-0040`, 870: "Mara has an active commitment to relieve
  Jonas at the workbench."
- run 02, `dec-0051`, 1021: "Mara's commitment to Jonas to relieve him
  at the bench is broken, but she is currently fulfilling it."
- run 03, `dec-0100`, 1981: "Despite Jonas breaking his commitment to
  relieve Mara, she should continue to relieve him to ensure the
  purifier is fixed…"
- run 10, `dec-0115`, 2281: "Jonas broke his commitment to relieve Mara
  … Continuing to relieve Jonas fulfills her current action…"

Early rationales, before the affordance existed, mostly stated the
direction correctly (run 01, `dec-0001`, tick 60: "…has a commitment
from Jonas to relieve her at the bench"). The inversion appears from
tick 870 onward — the tick the `relieve:jonas` affordance is first
offered and selected — and many single rationales contain both
directions at once, correctly attributing the broken promise to Jonas
while simultaneously describing the continued bench work as Mara's
commitment **to** him.

**Bounds of this finding.** The affordance's own naming — "relieve …
targeting jonas" — is an inversion-suggestive surface supplied by the
scenario, and remediating that surface is deferred work (section 10);
no claim is made about the model's internal reason for the framing.
The selected actions themselves were mechanically legal, engine-accepted,
and task-effective throughout — the defect is semantic, not mechanical.
And no moral blame is assigned beyond the frozen VS001 mechanical
semantics: the only mechanical breach of `cmt-jonas-relieves-mara` in
any run is Jonas's, at tick 1021. Sufficient reproduction pointers for
another reviewer: ledger events `evt-000002`, `evt-002252`; envelopes
`requests/dec-0040.json` in each run's gateway directory; finalized-trace
records for `dec-0040`, `dec-0051`, `dec-0100`, `dec-0115`, `dec-0001`.

## 7. Under-dispersion and late-branch finding

Meaningful variation was confined to the late rest-versus-routine-work
decisions after purifier completion, with one non-behavioral exception
(the run-08 expired request at tick 300).

- **Where the branch is.** The purifier reached 120,000/120,000 at tick
  2401 (`evt-005253`, identical across ledgers). The relieve action then
  ended; from tick 2401 the engine offered only `rest`, `routine-work`,
  and `wait` for the remaining ~300 ticks.
- **How often it occurred.** At tick 2401 (`dec-0121` in every run):
  seven runs selected `routine-work` (01, 04, 05, 06, 07, 08, 10;
  reasons: `goal` ×4, `routine` ×3), three selected `rest` (02, 03, 09;
  reasons: `survival` ×2, `physical-need` ×1).
- **Whether it persisted.** Barely. Runs 03 and 09 rested for a single
  tick and switched to `routine-work` at tick 2402. Run 02 alone
  reaffirmed rest (`continue:rest` at 2402, 2462, 2522) before returning
  to `routine-work` at tick 2582. By the final decisions
  (ticks 2672–2674) all ten runs were in `continue:routine-work`, and
  every run ended at `ScenarioEnded`, tick 2700.
- **Whether it affected major outcomes.** No. The branch opens only
  after the task is complete; every consequential outcome (task,
  commitment, meal, treatment, violations) is identical across all ten
  runs.
- **Whether the registered composite metric captured all
  micro-trajectory variation.** No. Two documented gaps: (a) run 02
  rested ~180 ticks while run 03 rested one tick, yet the pair scores
  composite 10,000 bp / distance 0 — the registered metric compares
  category/mode/transition distributions, not time-in-state; (b) the
  one-tick phase offsets ({01, 04, 07, 10} vs {05, 06}) are classified
  as context divergences and also score 10,000 bp. These are noted as
  metric limitations for future design work; consistent with the
  registered design, no post-hoc metric or threshold is introduced in
  this closeout.
- **Limitations on interpreting the branch as characterful variation.**
  The branch is a two-option choice in a consequence-free epilogue: the
  task was already complete, no other character interaction was
  available, and the choice carried no cost either way. The reason codes
  differ plausibly (`survival`/`physical-need` for rest at 84% hunger /
  41% fatigue vs `goal`/`routine` for continued work), but a 7/3 split
  at one late decision point cannot establish that the condition
  produces varied, causally intelligible behavior where it would matter.
  No claim is made about why the model chose differently across runs.

## 8. Interpretation

The calibration was a valid and useful result. It showed that repeated
per-decision inference under this condition was operationally reliable
but did not produce the varied, causally intelligible behavioral
distribution desired as a preservation target. The high repeatability it
measured included a repeated semantic misunderstanding of the scenario's
central social relationship, and therefore cannot be interpreted as
strong evidence of believable character coherence: a comparator can be
highly self-consistent and still be self-consistently wrong about what
it is doing.

Explicit limits on this interpretation:

- The result does **not** prove that all per-decision model control
  fails.
- The result does **not** prove that policy patches are superior.
- The result does **not** establish human behavioral realism (nothing in
  this study measures resemblance to human behavior).
- The result **does** justify declining to treat this exact comparator —
  this model, prompt, scenario, and condition — as the behavioral target
  for the originally planned Phase 5 comparison.

## 9. Why the planned policy comparison was not run

The pre-registered Phase 5 design measures whether a bounded policy
condition preserves registered behavioral similarity to the per-decision
comparator at ≤ 25% of its upstream calls. With this calibration as the
target, proceeding unchanged would risk measuring whether policy patches
can cheaply reproduce:

- a narrow action pattern (five trajectories, dominated by continuations
  of a single action family);
- a systematic role misunderstanding (section 6);
- generic task persistence (uninterrupted bench work under mild need
  pressure); and
- inconsequential late variation (a consequence-free rest-versus-work
  epilogue).

A deterministic interpreter could plausibly match this distribution at
far below 25% of the calls — and that outcome would answer a
systems-efficiency question while saying nothing about the project's
intended believable-life question: whether occasional model input can
preserve a varied, causally intelligible character. Running the
comparison against this target would have produced a headline number
disconnected from the claim it is meant to support.

The unrun policy condition is **not** described as having failed: it was
never implemented, never registered, and never measured. The decision
recorded here is about the comparator, not about the policy
architecture's merits.

## 10. Deferred work

Listed for the record; none of it is designed, implemented, or
authorized by this closeout. Each item requires separate authorization
and versioned work:

- A revised research charter.
- Alternative allocations of deterministic and generative cognition.
- Policy-patch architecture as one candidate among those allocations.
- Comparator and scenario remediation (including the
  commitment/affordance-direction surfaces of section 6 and the
  task-pressure limits of section 7).
- Parallel experiment execution.
- Headless/browser parity.
- New dead-end and observer-interest metrics.
- Packaging-version correction (Appendix A).

## 11. Final Milestone 2 claim boundary

**Milestone 2 may claim:**

- A deterministic evaluation laboratory (fingerprints, registered
  metrics, study registry, contract auditors, blinded review packaging).
- A strong unattended evidence and replay pipeline (orchestration,
  strict finalization, sealed archives, resume/recovery, registration
  binding, keyless rehearsal).
- A valid ten-run calibration of the per-decision condition's repeat-run
  variance.
- Reliable model routing and evidence reconciliation (one model, one
  serving provider, 472/473 accepted, every run replay-verified).
- An empirical finding of high repeatability and limited behavioral
  breadth under the tested condition — including a systematic
  commitment-role misunderstanding expressed in the model's diagnostic
  outputs.

**Milestone 2 may not claim:**

- Successful sparse-cognition implementation.
- Successful policy-patch comparison.
- Preservation of believable character.
- Human-like behavioral variation.
- General superiority of deterministic or generative control.
- Resolution of the scalable AI-NPC problem.

## Appendix A — evidence archive format verification

Independent verification (this closeout, without modifying the archive)
of the previously reported packaging-format issue. Four checks:

1. **Magic bytes.** The file's first bytes are `2E 2F 00 00 …` (a tar
   header name field, `./`) and bytes 257–264 are
   `75 73 74 61 72 00 30 30` (`ustar` + NUL, version `00`) — the
   POSIX/ustar tar magic as written by bsdtar/libarchive. A ZIP file
   must begin `50 4B 03 04` (`PK\x03\x04`); this file does not.
2. **Strict ZIP reader.** .NET `System.IO.Compression.ZipFile.OpenRead`
   on the archive reports **0 entries** — a standards-conforming ZIP
   reader cannot see any of the 1,259 evidence files.
3. **Tar listing.** `tar -tf m2-calibration-variance-a-evidence-001.zip`
   lists all 1,331 entries (1,260 files including the inventory, plus
   directories) without error.
4. **Isolated extraction and full hash verification.** Extracting with
   `tar -xf` into an isolated temporary directory yielded 1,260 files;
   **all 1,259 files named in `sha256-inventory.json` verified against
   their recorded SHA-256 hashes with zero mismatches**, and the
   inventory's aggregate hash matches the receipt (`fd71cf99…`). The
   archive's own SHA-256 was re-computed after all checks and is
   unchanged (`0e178266…`).

**Finding (confirmed):** the evidence bytes and cryptographic receipt
remain intact, but packaging version `m2-evidence-packaging-2.1.0`
produced an archive named `.zip` that is not a standards-conforming ZIP
on the observed Windows path. Mechanism (reproduced byte-for-byte): the
Windows packager relies on bsdtar's `-a` flag, which selects ZIP format
from the **destination filename's suffix** — but for crash safety the
packager never writes to the `.zip` destination directly. It archives
to a staged sibling named `.<name>.zip.<pid>-<random>.tmp` and only
then atomically renames the finished file to `<name>.zip`. bsdtar
therefore sees a `.tmp` suffix, cannot infer ZIP, and falls back to its
default tar format; the rename then applies the `.zip` name to a tar
file. Windows' bundled bsdtar 3.8.4 given the staged `.tmp` filename
reproduces this archive's header bytes exactly, and the same bsdtar
given a `.zip` destination writes a genuine ZIP — so the defect is in
the repository's staged-write-then-rename interaction with
suffix-based format selection, not in which tar was installed, and it
reproduces on every Windows run of this packaging version. The
packager's own round-trip verification extracts with the same tool
(which auto-detects tar on read) and therefore passed.

The correction requires: a future packaging-version bump; a
standards-conforming archive test (a reader independent of the writer);
preservation of the original archive and receipt exactly as sealed; and
no retroactive modification of this evidence package. No repair,
repackaging, renaming, or re-sealing was performed in this closeout.

---

**Chronology pointers.** Phase reports and audit sequences:
[milestone index](README.md) ·
[Phase 4 status](phase-04-per-decision/README.md) ·
[canonical calibration analysis](calibration/README.md).
