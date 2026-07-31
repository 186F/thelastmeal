import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { helperEnv } from './childEnv';

/**
 * Child-process management for the orchestrator (M2 brief §19.5;
 * re-audit findings 6 and 13.1).
 *
 * Every managed child records its PID, captured stdout/stderr (to a log
 * file), and exit code. Shutdown is graceful first (SIGTERM / Windows
 * taskkill without /F), then force-kill after a fixed timeout. The
 * orchestrator never leaves children running: `stopAll` runs in `finally`
 * on success and failure alike.
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
  /** Managed children with no observed exit at reconciliation time. */
  runningChildren: string[];
}

export interface ManagedProcess {
  name: string;
  child: ChildProcess;
  pid: number;
  logPath: string;
  /** Resolves with the exit code (or signal description) once the child exits. */
  exited: Promise<string>;
  exitCode: () => number | null;
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
   * completeness gate (re-audit §13.1). */
  health(): ProcessManagerHealth {
    return {
      recordPath: this.recordPath,
      recordWriteFailures: this.recordWriteFailures,
      lastRecordWriteError: this.lastRecordWriteError,
      stopFailures: this.stopFailures,
      runningChildren: this.managed
        .filter((managedProcess) => managedProcess.exitCode() === null)
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
      throw new Error(`process-spawn-failed: ${options.name} (${options.command})`);
    }
    const log = (stream: string, chunk: Buffer): void => {
      appendFileSync(options.logPath, chunk.toString('utf8').replace(/\r\n/g, '\n'));
      void stream;
    };
    child.stdout?.on('data', (chunk: Buffer) => log('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => log('stderr', chunk));
    this.record({ event: 'spawned', name: options.name, pid: child.pid });
    let code: number | null = null;
    const exited = new Promise<string>((resolve) => {
      child.on('exit', (exitCode, signal) => {
        code = exitCode;
        const outcome = exitCode !== null ? String(exitCode) : `signal:${String(signal)}`;
        this.record({ event: 'exited', name: options.name, pid: child.pid, exit: outcome });
        resolve(outcome);
      });
      child.on('error', () => {
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
      exitCode: () => code,
    };
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
   * and force = child.kill() plus taskkill /F /T. */
  async stop(managedProcess: ManagedProcess, graceMs = 5_000): Promise<string> {
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

  processTable(): { name: string; pid: number; exitCode: number | null }[] {
    return this.managed.map((managedProcess) => ({
      name: managedProcess.name,
      pid: managedProcess.pid,
      exitCode: managedProcess.exitCode(),
    }));
  }
}
