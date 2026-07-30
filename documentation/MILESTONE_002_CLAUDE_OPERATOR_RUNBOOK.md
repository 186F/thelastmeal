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

The command runs the complete sequence unattended: preflight → Vite (fixed port) → per attempt: fresh gateway child + fresh browser context → paced run through the real operator controls → automatic ledger/bundle downloads → in-browser replay gate → strict finalization → fingerprint → atomic state → cross-run evaluation → secret scan → SHA256 inventory → portable ZIP → report.

## 3. Monitor

- `sequence-state.json` in the sequence root: `lastTransition`, per-execution `status`/`failureReason`.
- `attempt-*/heartbeat.jsonl`: machine-readable heartbeats (tick, run status, gateway state, call counters) at the plan's cadence.
- `attempt-*/gateway.log` and `vite.log`: child-process health; the report records PIDs and exit codes.
- Use Chrome tools ONLY to inspect semantic UI state or capture screenshots when the orchestrator itself reports a browser failure. Do not click controls in the automation browser.

## 4. Failures

A failed attempt is PRESERVED, never cleaned up: `failure.json` / `failure-message.txt`, `failure-screenshot.png`, `failure-dom.html`, `failure-trace.zip`, heartbeats, and any gateway trace stay in the attempt directory. The orchestrator applies the plan's replacement policy automatically. Do not delete, edit, or re-run anything by hand.

## 5. Resume

`npm run m2:orchestrate -- --plan <same plan> --resume` is the resume command (§19.2). It identity-checks the plan hash, repository SHA, package/experiment versions, and configuration fingerprint against the recorded state; marks interrupted executions failed-preserved; skips completed attempts; and continues from the first incomplete one. Invoke it only under the pre-registered rules of the running study.

## 6. Never

- Never edit code, plans, thresholds, prompts, model, or provider during a sequence.
- Never read or reference `.env.gateway`.
- Never rerun a completed attempt or reuse a run id.
- Never substitute Chrome-tool driving for the orchestrator: if the orchestrator cannot complete a sequence, the sequence fails and is diagnosed — it is not hand-finished.
