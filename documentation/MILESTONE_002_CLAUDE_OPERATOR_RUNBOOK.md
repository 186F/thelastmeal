# Milestone 2 — Claude Operator Runbook (Unattended Orchestrator)

**Audience:** a Claude Code session (optionally with Chrome/MCP tools) supervising an unattended Milestone 2 sequence.
**Design principle (brief §20.1):** the repository-native orchestrator is the authoritative experiment runner. Claude supervises, monitors, and diagnoses — it never becomes the runner.

## 1. Before launch

1. Verify the tracked worktree is clean and on the frozen SHA the plan pins:
   `git status --porcelain` (must be empty) and `git rev-parse HEAD` (must equal the plan's `repositorySha` when the plan pins one).
2. Verify ports 5199 (Vite) and 8799 (gateway) are free. The orchestrator refuses occupied ports; it never falls back.
3. For a LIVE plan only: confirm the operator has set `M2_LIVE_RUNS=1` and intends `--acknowledge-live-cost`. **Never read, print, or copy `.env.gateway`** — the gateway child process is the only credential reader (§19.15).

## 2. Launch

```
npm run m2:orchestrate -- --plan <plan.json> [--acknowledge-live-cost] [--headed]
```

The command runs the complete sequence unattended: preflight (ports, free disk vs the evidence budget) → Vite (fixed port) → per attempt: freeze checkpoint → fresh gateway child + pre-Start treatment verification + fresh browser context → paced run through the real operator controls with navigation detection → automatic ledger/bundle downloads → in-browser replay gate → strict finalization (typed stages) → fingerprint → treatment-threshold evaluation under the plan's attempt profile → terminal seal → freeze checkpoint → deterministic batch (if planned) → cross-run evaluation → final evidence manifest + report → secret scan → SHA256 inventory → versioned portable ZIP (atomic same-volume commit) → post-package freeze check → receipt → `completed`.

## 3. Monitor

- `<root>.control/sequence-state.json` (the CONTROL root beside the evidence root): `lastTransition`, per-execution `status`/`failureReason`/`failureStage`, `artifactStatus`/`studyStatus`, `replacementDisposition`, freeze checkpoints. The evidence root itself holds `sequence-manifest.json`, the immutable final evidence facts.
- `attempt-*/heartbeat.jsonl`: machine-readable heartbeats (tick, run status, gateway state, call counters) at the plan's cadence.
- `attempt-*/gateway.log` and `vite.log`: child-process health; the report records PIDs, exit codes, and process-provenance health.
- Use Chrome tools ONLY to inspect semantic UI state or capture screenshots when the orchestrator itself reports a browser failure. Do not click controls in the automation browser.

## 4. Failures

A failed attempt is PRESERVED and SEALED, never cleaned up: `failure-manifest.json` (taxonomy class + stage), `failure.json` / `failure-message.txt`, `failure-screenshot.png`, `failure-dom.html`, `failure-trace.zip`, `context-logs.txt`, heartbeats, and any gateway trace stay in the attempt directory under the terminal seal. The orchestrator applies the plan's replacement policy automatically and RECORDS each failure's replacement disposition (`permitted`/`forbidden`/`exhausted`). Do not delete, edit, or re-run anything by hand.

## 5. Resume

`npm run m2:orchestrate -- --plan <same plan> --resume` is the resume command (§19.2). It identity-checks the plan hash, repository SHA, package/experiment versions, attempt profile, and configuration fingerprint against the recorded state (16 fields); refuses when any recorded disposition is `forbidden` or `exhausted` — a non-retryable failure can never be revived by a restart; verifies EVERY terminal seal and semantically revalidates completed evidence; marks interrupted executions failed-preserved-and-sealed; skips completed attempts; and continues from the first incomplete one. A resume of a COMPLETED sequence is a verified no-op: seals, inventory, manifest, semantic revalidation, archive, and receipt are all checked and nothing launches. Invoke it only under the pre-registered rules of the running study.

## 5.1 Derived outputs

A completed sequence root is immutable raw evidence. `npm run m2:evaluate` against a completed root writes to `<root>.derived/evaluation-<stamp>/`; `npm run m2:package` verifies the root against its recorded inventory and writes the NEXT versioned archive (`<sequenceId>-evidence-NNN.zip`) — existing archives are never overwritten or deleted.

## 6. Never

- Never edit code, plans, thresholds, prompts, model, or provider during a sequence.
- Never read or reference `.env.gateway`.
- Never rerun a completed attempt or reuse a run id.
- Never substitute Chrome-tool driving for the orchestrator: if the orchestrator cannot complete a sequence, the sequence fails and is diagnosed — it is not hand-finished.
