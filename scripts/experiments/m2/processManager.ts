import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { helperEnv } from './childEnv';

/**
 * Child-process management for the orchestrator (M2 brief §19.5;
 * re-audit findings 6 and 13.1; focused re-audit finding 1; final audit
 * blocker 1).
 *
 * Every managed child records its PID, captured stdout/stderr (to a log
 * file), and its TERMINAL STATE. A child ends by a numeric exit code or a
 * signal (numeric code null) — both established ONLY by a genuine `exit`
 * event. A post-spawn `error` event is NOT proof of process termination:
 * it may describe a failed kill, IPC, or abort operation on a child that
 * is still alive, so it is recorded as a PROCESS-OPERATION DIAGNOSTIC
 * (counted, message retained, per-child list) and the child stays in
 * `runningChildren` until it actually exits. Liveness is decided by
 * `hasExited()`, never by the numeric exit code alone, so a signal-killed
 * child is never mistaken for a running one and a signal-killed gateway
 * never evades death detection. A command that never spawns (no PID) is
 * refused immediately and never becomes a managed child.
 *
 * Shutdown is graceful first (SIGTERM / Windows taskkill without /F), then
 * force-kill, then a BOUNDED confirmation wait: if genuine termination
 * cannot be established within the shutdown contract, `stop()` returns
 * `stop-unconfirmed`, counts a stop failure, and the child remains an
 * unreconciled running child — process provenance FAILS rather than
 * reporting a successful shutdown that never happened. The orchestrator
 * never leaves children running: `stopAll` runs in `finally` on success
 * and failure alike.
 *
 * Provenance is a GATE, not best-effort: record-write failures, stop
 * failures, and process-operation errors are counted in `health()`, and
 * the sequence report carries them explicitly instead of implying complete
 * provenance. The Windows `taskkill` helpers run under the nonsecret
 * helper environment.
 */

export interface ProcessManagerHealth {
  recordPath: string | null;
  recordWriteFailures: number;
  lastRecordWriteError: string | null;
  stopFailures: number;
  /** Post-spawn process-operation `error` events (final audit blocker 1):
   * diagnostics, never terminal proof — but always VISIBLE. */
  processErrorCount: number;
  lastProcessError: string | null;
  /** Managed children with no GENUINE terminal exit observed at
   * reconciliation time. A child that emitted only operation errors is
   * still here (final audit blocker 1). */
  runningChildren: string[];
}

export interface ManagedProcess {
  name: string;
  child: ChildProcess;
  pid: number;
  logPath: string;
  /** Resolves with the terminal outcome — the numeric exit code as a
   * string or `signal:<NAME>` — once the child GENUINELY exits. */
  exited: Promise<string>;
  /** True only once a genuine terminal exit was observed (final audit
   * blocker 1): a post-spawn `error` event never sets this. */
  hasExited: () => boolean;
  /** The exact terminal outcome string, or null while running. */
  terminalOutcome: () => string | null;
  /** The numeric exit code; null while running AND for signal
   * terminations — never a liveness signal on its own. */
  numericExitCode: () => number | null;
  /** The terminating signal name, or null. */
  exitSignal: () => string | null;
  /** Post-spawn process-operation errors observed for THIS child (final
   * audit blocker 1): diagnostics, never terminal proof. */
  processErrors: () => readonly string[];
  /** True once the ORCHESTRATOR requested a stop through `stop()` — used
   * to separate orchestrator-initiated shutdown from an unexpected death. */
  stopRequested: () => boolean;
}

/** Terminal-state classification for a managed child (focused re-audit
 * finding 1 §4.3): the four states the orchestrator must distinguish. */
export type ChildTerminalClassification =
  | 'still-running'
  | 'planned-stop-completed'
  | 'orchestrator-stop-completed'
  | 'unexpected-terminal-exit';

/**
 * Classifies a managed child's terminal state. `plannedStopIssued` is the
 * caller's record that a PLANNED mid-run stop (e.g. the gateway-stop
 * drill) was triggered for this child. Detection is based on terminal
 * STATE — a signal-terminated child (numeric exit code null) classifies
 * exactly like a numeric exit.
 */
export function classifyChildTerminalState(
  managedProcess: ManagedProcess,
  plannedStopIssued: boolean,
): ChildTerminalClassification {
  if (!managedProcess.hasExited()) return 'still-running';
  if (plannedStopIssued) return 'planned-stop-completed';
  if (managedProcess.stopRequested()) return 'orchestrator-stop-completed';
  return 'unexpected-terminal-exit';
}

export interface SpawnOptions {
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export class ProcessManager {
  private readonly managed: ManagedProcess[] = [];
  /** Append-only JSONL record of every spawn and exit (§19.5): survives
   * report regeneration and resume, unlike any in-memory table. */
  private readonly recordPath: string | null;
  private recordWriteFailures = 0;
  private lastRecordWriteError: string | null = null;
  private stopFailures = 0;
  private processErrorCount = 0;
  private lastProcessError: string | null = null;
  /** Per-child setter that marks an orchestrator-initiated stop
   * (focused re-audit finding 1 §4.3). */
  private readonly stopIntent = new WeakMap<ManagedProcess, () => void>();

  constructor(recordPath: string | null = null) {
    this.recordPath = recordPath;
  }

  private record(entry: Record<string, unknown>): void {
    if (!this.recordPath) return;
    try {
      mkdirSync(dirname(this.recordPath), { recursive: true });
      appendFileSync(
        this.recordPath,
        `${JSON.stringify({ atUtc: new Date().toISOString(), ...entry })}\n`,
      );
    } catch (error: unknown) {
      // Process-record IO must never break orchestration mid-flight — but
      // it is COUNTED and gated, never silently absorbed (re-audit §13.1).
      this.recordWriteFailures += 1;
      this.lastRecordWriteError = error instanceof Error ? error.message : String(error);
    }
  }

  /** Provenance health for the sequence report and the evidentiary
   * completeness gate (re-audit §13.1). Liveness is `hasExited()`, never
   * the numeric exit code (focused re-audit finding 1): a signal-killed
   * child is terminal, not an unreconciled running child. */
  health(): ProcessManagerHealth {
    return {
      recordPath: this.recordPath,
      recordWriteFailures: this.recordWriteFailures,
      lastRecordWriteError: this.lastRecordWriteError,
      stopFailures: this.stopFailures,
      processErrorCount: this.processErrorCount,
      lastProcessError: this.lastProcessError,
      runningChildren: this.managed
        .filter((managedProcess) => !managedProcess.hasExited())
        .map((managedProcess) => managedProcess.name),
    };
  }

  spawnManaged(options: SpawnOptions): ManagedProcess {
    mkdirSync(dirname(options.logPath), { recursive: true });
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    if (child.pid === undefined) {
      // The failed spawn still emits an async 'error' event; absorb it so
      // the typed refusal below is the ONLY failure signal — an unhandled
      // 'error' event would crash the orchestrator process itself.
      child.once('error', () => undefined);
      this.record({ event: 'spawn-error', name: options.name, pid: null });
      throw new Error(`process-spawn-failed: ${options.name} (${options.command})`);
    }
    const log = (stream: string, chunk: Buffer): void => {
      appendFileSync(options.logPath, chunk.toString('utf8').replace(/\r\n/g, '\n'));
      void stream;
    };
    child.stdout?.on('data', (chunk: Buffer) => log('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => log('stderr', chunk));
    this.record({ event: 'spawned', name: options.name, pid: child.pid });
    // Terminal state (focused re-audit finding 1; final audit blocker 1):
    // established ONLY by a genuine `exit` event, recorded once. A signal
    // exit keeps its numeric code null but is fully terminal. A post-spawn
    // `error` event is a PROCESS-OPERATION DIAGNOSTIC — a failed kill or
    // IPC operation on a possibly-still-alive child — recorded and counted
    // but NEVER terminal proof: declaring such a child dead could orphan a
    // live Vite/gateway process behind a false-green provenance gate.
    let terminal: { outcome: string; code: number | null; signal: string | null } | null = null;
    let stopWasRequested = false;
    const childProcessErrors: string[] = [];
    const exited = new Promise<string>((resolve) => {
      child.on('exit', (exitCode, signal) => {
        if (terminal !== null) return;
        const outcome = exitCode !== null ? String(exitCode) : `signal:${String(signal)}`;
        terminal = { outcome, code: exitCode, signal: signal ?? null };
        this.record({ event: 'exited', name: options.name, pid: child.pid, exit: outcome });
        resolve(outcome);
      });
      child.on('error', (error: Error) => {
        const message = error.message || String(error);
        childProcessErrors.push(message);
        this.processErrorCount += 1;
        this.lastProcessError = `${options.name}: ${message}`;
        this.record({
          event: 'process-error',
          name: options.name,
          pid: child.pid,
          error: message,
        });
      });
    });
    const managedProcess: ManagedProcess = {
      name: options.name,
      child,
      pid: child.pid,
      logPath: options.logPath,
      exited,
      hasExited: () => terminal !== null,
      terminalOutcome: () => terminal?.outcome ?? null,
      numericExitCode: () => terminal?.code ?? null,
      exitSignal: () => terminal?.signal ?? null,
      processErrors: () => [...childProcessErrors],
      stopRequested: () => stopWasRequested,
    };
    // `stop()` flags intent through this seam so the flag stays private to
    // the manager while the accessor is part of the managed handle.
    this.stopIntent.set(managedProcess, () => {
      stopWasRequested = true;
    });
    this.managed.push(managedProcess);
    return managedProcess;
  }

  /** Waits for a predicate over the child's accumulated stdout/stderr log.
   * The caller supplies a reader to keep this module filesystem-simple. */
  static async waitFor(
    check: () => boolean,
    timeoutMs: number,
    what: string,
    intervalMs = 100,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`process-wait-timeout: ${what} (${timeoutMs}ms)`);
  }

  /** Spawns a Windows taskkill helper under the nonsecret helper
   * environment (re-audit finding 6); its own spawn errors are counted as
   * stop failures rather than crashing the orchestrator. */
  private taskkill(pid: number, force: boolean): void {
    const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T'];
    const killer = spawn('taskkill', args, {
      stdio: 'ignore',
      windowsHide: true,
      env: helperEnv(process.env),
    });
    killer.on('error', () => {
      this.stopFailures += 1;
    });
  }

  /** Graceful stop, then force-kill after `graceMs`, then a BOUNDED
   * confirmation wait (final audit blocker 1): a kill operation that
   * errors is a recorded diagnostic, never termination proof, so `stop()`
   * keeps waiting for the GENUINE exit — and when termination cannot be
   * established within the shutdown contract it returns
   * `stop-unconfirmed`, counts a stop failure, and leaves the child in
   * `runningChildren`, failing process provenance rather than reporting a
   * shutdown that never happened. Windows has no POSIX signal delivery to
   * detached consoles, so graceful = taskkill (no /F) and force =
   * child.kill() plus taskkill /F /T. Marks the stop as
   * orchestrator-initiated BEFORE acting, so classification never mistakes
   * this shutdown for an unexpected death (focused re-audit finding 1). */
  async stop(managedProcess: ManagedProcess, graceMs = 5_000): Promise<string> {
    this.stopIntent.get(managedProcess)?.();
    const { child } = managedProcess;
    if (child.exitCode !== null || child.signalCode !== null) {
      return managedProcess.exited;
    }
    const waitBounded = (boundMs: number): Promise<string | 'timeout'> =>
      Promise.race([
        managedProcess.exited,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), boundMs)),
      ]);
    if (process.platform === 'win32') {
      this.taskkill(managedProcess.pid, false);
    } else {
      child.kill('SIGTERM');
    }
    const graceful = await waitBounded(graceMs);
    if (graceful !== 'timeout') return graceful;
    if (process.platform === 'win32') {
      this.taskkill(managedProcess.pid, true);
    }
    child.kill('SIGKILL');
    const forced = await waitBounded(graceMs);
    if (forced !== 'timeout') return forced;
    this.stopFailures += 1;
    this.record({ event: 'stop-unconfirmed', name: managedProcess.name, pid: managedProcess.pid });
    return 'stop-unconfirmed';
  }

  async stopAll(graceMs = 5_000): Promise<void> {
    for (const managedProcess of [...this.managed].reverse()) {
      try {
        await this.stop(managedProcess, graceMs);
      } catch {
        // stopAll must never throw: it runs in finally paths — but the
        // failure is COUNTED for the provenance gate (re-audit §13.1).
        this.stopFailures += 1;
      }
    }
  }

  /** Snapshot of every managed child's terminal state: the exact numeric
   * code or signal is retained (focused re-audit finding 1 §4.3). */
  processTable(): {
    name: string;
    pid: number;
    terminalOutcome: string | null;
    numericExitCode: number | null;
    exitSignal: string | null;
  }[] {
    return this.managed.map((managedProcess) => ({
      name: managedProcess.name,
      pid: managedProcess.pid,
      terminalOutcome: managedProcess.terminalOutcome(),
      numericExitCode: managedProcess.numericExitCode(),
      exitSignal: managedProcess.exitSignal(),
    }));
  }
}
