import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Child-process management for the orchestrator (M2 brief §19.5).
 *
 * Every managed child records its PID, captured stdout/stderr (to a log
 * file), and exit code. Shutdown is graceful first (SIGTERM / Windows
 * taskkill without /F), then force-kill after a fixed timeout. The
 * orchestrator never leaves children running: `stopAll` runs in `finally`
 * on success and failure alike.
 */

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
    } catch {
      // Process-record IO must never break orchestration.
    }
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

  /** Graceful stop, then force-kill after `graceMs`. Windows has no POSIX
   * signal delivery to detached consoles, so graceful = taskkill (no /F)
   * and force = child.kill() plus taskkill /F /T. */
  async stop(managedProcess: ManagedProcess, graceMs = 5_000): Promise<string> {
    const { child } = managedProcess;
    if (child.exitCode !== null || child.signalCode !== null) {
      return managedProcess.exited;
    }
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(managedProcess.pid), '/T'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
    const raceResult = await Promise.race([
      managedProcess.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs)),
    ]);
    if (raceResult !== 'timeout') return raceResult;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(managedProcess.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    child.kill('SIGKILL');
    return managedProcess.exited;
  }

  async stopAll(graceMs = 5_000): Promise<void> {
    for (const managedProcess of [...this.managed].reverse()) {
      try {
        await this.stop(managedProcess, graceMs);
      } catch {
        // stopAll must never throw: it runs in finally paths.
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
