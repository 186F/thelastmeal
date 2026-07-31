import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { helperEnv } from './childEnv';

/**
 * Child-process management for the orchestrator (M2 brief §19.5;
 * re-audit findings 6 and 13.1; focused re-audit finding 1).
 *
 * Every managed child records its PID, captured stdout/stderr (to a log
 * file), and its TERMINAL STATE. A child can end three ways — a numeric
 * exit code, a signal (numeric code null), or a spawn error — and all
 * three are terminal: liveness is decided by `hasExited()`, never by the
 * numeric exit code alone, so a signal-killed child is never mistaken for
 * a running one and a signal-killed gateway never evades death detection.
 * Shutdown is graceful first (SIGTERM / Windows taskkill without /F), then
 * force-kill after a fixed timeout. The orchestrator never leaves children
 * running: `stopAll` runs in `finally` on success and failure alike.
 *
 * Provenance is a GATE, not best-effort: record-write and stop failures
 * are counted in `health()`, and the sequence report carries them
 * explicitly instead of implying complete provenance. The Windows
 * `taskkill` helpers run under the nonsecret helper environment.
 */

export interface ProcessManagerHealth {
  recordPath: string | null;
  recordWriteFailures: number;
  lastRecordWriteError: string | null;
  stopFailures: number;
  /** Managed children with no observed TERMINAL state (exit code, signal,
   * or spawn error) at reconciliation time (focused re-audit finding 1). */
  runningChildren: string[];
}

export interface ManagedProcess {
  name: string;
  child: ChildProcess;
  pid: number;
  logPath: string;
  /** Resolves with the terminal outcome — the numeric exit code as a
   * string, `signal:<NAME>`, or `spawn-error` — once the child ends. */
  exited: Promise<string>;
  /** True once ANY terminal state was observed: numeric exit, signal
   * termination, or spawn error (focused re-audit finding 1). */
  hasExited: () => boolean;
  /** The exact terminal outcome string, or null while running. */
  terminalOutcome: () => string | null;
  /** The numeric exit code; null while running AND for signal/spawn-error
   * terminations — never a liveness signal on its own. */
  numericExitCode: () => number | null;
  /** The terminating signal name, or null. */
  exitSignal: () => string | null;
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
    // Terminal state (focused re-audit finding 1): recorded ONCE from
    // whichever terminal event fires first. A signal exit keeps its numeric
    // code null but is fully terminal; a spawn error is terminal too —
    // neither may linger as a phantom running child.
    let terminal: { outcome: string; code: number | null; signal: string | null } | null = null;
    let stopWasRequested = false;
    const exited = new Promise<string>((resolve) => {
      child.on('exit', (exitCode, signal) => {
        if (terminal !== null) return;
        const outcome = exitCode !== null ? String(exitCode) : `signal:${String(signal)}`;
        terminal = { outcome, code: exitCode, signal: signal ?? null };
        this.record({ event: 'exited', name: options.name, pid: child.pid, exit: outcome });
        resolve(outcome);
      });
      child.on('error', () => {
        if (terminal !== null) return;
        terminal = { outcome: 'spawn-error', code: null, signal: null };
        this.record({ event: 'spawn-error', name: options.name, pid: child.pid });
        resolve('spawn-error');
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

  /** Graceful stop, then force-kill after `graceMs`. Windows has no POSIX
   * signal delivery to detached consoles, so graceful = taskkill (no /F)
   * and force = child.kill() plus taskkill /F /T. Marks the stop as
   * orchestrator-initiated BEFORE acting, so classification never mistakes
   * this shutdown for an unexpected death (focused re-audit finding 1). */
  async stop(managedProcess: ManagedProcess, graceMs = 5_000): Promise<string> {
    this.stopIntent.get(managedProcess)?.();
    const { child } = managedProcess;
    if (child.exitCode !== null || child.signalCode !== null) {
      return managedProcess.exited;
    }
    if (process.platform === 'win32') {
      this.taskkill(managedProcess.pid, false);
    } else {
      child.kill('SIGTERM');
    }
    const raceResult = await Promise.race([
      managedProcess.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs)),
    ]);
    if (raceResult !== 'timeout') return raceResult;
    if (process.platform === 'win32') {
      this.taskkill(managedProcess.pid, true);
    }
    child.kill('SIGKILL');
    return managedProcess.exited;
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
