import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProcessManager,
  classifyChildTerminalState,
  type ManagedProcess,
} from '../../../scripts/experiments/m2/processManager';
import { helperEnv } from '../../../scripts/experiments/m2/childEnv';
import { issuePlannedGatewayStop } from '../../../scripts/experiments/m2/orchestrate';
import { AttemptFailure } from '../../../scripts/experiments/m2/failureTaxonomy';

/**
 * Signal-aware child terminal state (focused re-audit finding 1, §4):
 * REAL spawned children prove that every terminal shape — numeric exit,
 * SIGTERM, SIGKILL, spawn error — is recorded as terminal with its exact
 * code or signal, that a signal-killed child is never reported as a
 * running child, and that unexpected-death classification is based on
 * terminal STATE rather than the numeric exit code (which stays null for
 * signal terminations).
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'm2-terminal-'));
  dirs.push(dir);
  return dir;
}

function spawnNode(manager: ProcessManager, name: string, script: string): ManagedProcess {
  return manager.spawnManaged({
    name,
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: helperEnv(process.env),
    logPath: join(scratchDir(), `${name}.log`),
  });
}

const LONG_RUNNING = 'setInterval(() => {}, 1000)';

describe('terminal state for every exit shape (§4.4)', () => {
  it('a natural exit code 0 is terminal with numeric code 0 and no signal', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'exit-zero', 'process.exit(0)');
    await expect(managed.exited).resolves.toBe('0');
    expect(managed.hasExited()).toBe(true);
    expect(managed.terminalOutcome()).toBe('0');
    expect(managed.numericExitCode()).toBe(0);
    expect(managed.exitSignal()).toBeNull();
    expect(manager.health().runningChildren).toEqual([]);
  });

  it('a nonzero numeric exit retains its exact code', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'exit-three', 'process.exit(3)');
    await expect(managed.exited).resolves.toBe('3');
    expect(managed.hasExited()).toBe(true);
    expect(managed.numericExitCode()).toBe(3);
    expect(managed.exitSignal()).toBeNull();
    expect(manager.health().runningChildren).toEqual([]);
  });

  it('a SIGTERM-terminated child is TERMINAL with a null numeric code and the signal retained', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'sigterm-child', LONG_RUNNING);
    expect(managed.hasExited()).toBe(false);
    managed.child.kill('SIGTERM');
    await expect(managed.exited).resolves.toBe('signal:SIGTERM');
    expect(managed.hasExited()).toBe(true);
    expect(managed.terminalOutcome()).toBe('signal:SIGTERM');
    expect(managed.numericExitCode()).toBeNull();
    expect(managed.exitSignal()).toBe('SIGTERM');
  });

  it('a SIGKILL-terminated child is TERMINAL with the signal retained', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'sigkill-child', LONG_RUNNING);
    managed.child.kill('SIGKILL');
    await expect(managed.exited).resolves.toBe('signal:SIGKILL');
    expect(managed.hasExited()).toBe(true);
    expect(managed.numericExitCode()).toBeNull();
    expect(managed.exitSignal()).toBe('SIGKILL');
  });

  it('an unspawnable command refuses immediately and leaves no phantom running child', () => {
    const manager = new ProcessManager();
    expect(() =>
      manager.spawnManaged({
        name: 'never-spawns',
        command: join(scratchDir(), 'no-such-binary-xyz'),
        args: [],
        cwd: process.cwd(),
        env: {},
        logPath: join(scratchDir(), 'never-spawns.log'),
      }),
    ).toThrow(/process-spawn-failed/);
    expect(manager.health().runningChildren).toEqual([]);
  });

  it('a post-spawn error is a NONTERMINAL diagnostic: the live child stays running until a genuine exit (final audit blocker 1)', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'error-event', LONG_RUNNING);
    // An operation error on a live child — e.g. a failed kill or IPC call —
    // must never be treated as proof of process termination.
    managed.child.emit('error', new Error('injected operation error'));
    expect(managed.hasExited()).toBe(false);
    expect(managed.terminalOutcome()).toBeNull();
    expect(manager.health().runningChildren).toEqual(['error-event']);
    // The diagnostic is recorded and visible, per child and in health.
    expect(managed.processErrors()).toEqual(['injected operation error']);
    expect(manager.health().processErrorCount).toBe(1);
    expect(manager.health().lastProcessError).toBe('error-event: injected operation error');
    // Only the GENUINE exit establishes terminal state.
    managed.child.kill('SIGKILL');
    await expect(managed.exited).resolves.toBe('signal:SIGKILL');
    expect(managed.hasExited()).toBe(true);
    expect(manager.health().runningChildren).toEqual([]);
    // The diagnostic remains visible in provenance after the exit.
    expect(manager.health().processErrorCount).toBe(1);
    expect(manager.health().lastProcessError).toBe('error-event: injected operation error');
  });

  it('a failed-kill error followed by a later real exit records the true outcome, never spawn-error', async () => {
    const manager = new ProcessManager();
    const managed = spawnNode(manager, 'kill-fails-first', LONG_RUNNING);
    managed.child.emit('error', new Error('kill EPERM (simulated failed kill)'));
    managed.child.emit('error', new Error('second operation error'));
    expect(managed.hasExited()).toBe(false);
    expect(managed.processErrors()).toHaveLength(2);
    managed.child.kill('SIGTERM');
    await expect(managed.exited).resolves.toBe('signal:SIGTERM');
    expect(managed.terminalOutcome()).toBe('signal:SIGTERM');
    expect(managed.exitSignal()).toBe('SIGTERM');
    expect(manager.health().runningChildren).toEqual([]);
  });

  it('a stop that cannot CONFIRM termination reports stop-unconfirmed, counts a stop failure, and keeps the child unreconciled', async () => {
    const manager = new ProcessManager();
    // A hand-built unkillable child: every kill operation is a no-op and no
    // exit event ever arrives — the shutdown contract must FAIL provenance
    // rather than report success.
    const unkillable: ManagedProcess = {
      name: 'unkillable',
      child: {
        exitCode: null,
        signalCode: null,
        kill: () => true,
      } as unknown as ManagedProcess['child'],
      pid: 999_999_999,
      logPath: join(scratchDir(), 'unkillable.log'),
      exited: new Promise<string>(() => undefined),
      hasExited: () => false,
      terminalOutcome: () => null,
      numericExitCode: () => null,
      exitSignal: () => null,
      processErrors: () => [],
      stopRequested: () => false,
    };
    const before = manager.health().stopFailures;
    const outcome = await manager.stop(unkillable, 200);
    expect(outcome).toBe('stop-unconfirmed');
    expect(manager.health().stopFailures).toBe(before + 1);
    expect(unkillable.hasExited()).toBe(false);
  });
});

describe('liveness is terminal state, never the numeric exit code (§4.1–§4.2)', () => {
  it('a signal-terminated Vite-like child is NOT reported as a running child', async () => {
    const manager = new ProcessManager();
    const vite = spawnNode(manager, 'vite', LONG_RUNNING);
    expect(manager.health().runningChildren).toEqual(['vite']);
    vite.child.kill('SIGKILL');
    await vite.exited;
    // The numeric exit code is null — exactly the ambiguity of the finding
    // — yet the child is terminal and the health report reconciles it.
    expect(vite.numericExitCode()).toBeNull();
    expect(manager.health().runningChildren).toEqual([]);
    expect(manager.processTable().find((row) => row.name === 'vite')?.terminalOutcome).toMatch(
      /^signal:SIGKILL$/,
    );
  });
});

describe('gateway-death classification uses terminal state (§4.3)', () => {
  it('a running gateway classifies still-running', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    expect(classifyChildTerminalState(gateway, false)).toBe('still-running');
    await manager.stop(gateway, 500);
  });

  it('gateway death is classified ONLY after genuine termination: an operation error alone stays still-running', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    gateway.child.emit('error', new Error('operation error on a live gateway'));
    expect(classifyChildTerminalState(gateway, false)).toBe('still-running');
    gateway.child.kill('SIGKILL');
    await gateway.exited;
    expect(classifyChildTerminalState(gateway, false)).toBe('unexpected-terminal-exit');
  });

  it('an EXTERNALLY signal-terminated gateway classifies unexpected-terminal-exit (gateway-died-unexpectedly)', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    // An external actor kills the child — the orchestrator never asked.
    gateway.child.kill('SIGKILL');
    await gateway.exited;
    expect(gateway.numericExitCode()).toBeNull();
    expect(classifyChildTerminalState(gateway, false)).toBe('unexpected-terminal-exit');
  });

  it('a PLANNED signal termination is never classified as an unexpected death', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    await manager.stop(gateway, 500);
    expect(gateway.hasExited()).toBe(true);
    expect(classifyChildTerminalState(gateway, true)).toBe('planned-stop-completed');
  });

  it('an orchestrator-initiated normal shutdown classifies orchestrator-stop-completed', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    await manager.stop(gateway, 500);
    expect(gateway.hasExited()).toBe(true);
    expect(gateway.stopRequested()).toBe(true);
    expect(classifyChildTerminalState(gateway, false)).toBe('orchestrator-stop-completed');
  });
});

describe('the planned-stop trigger refuses an already-dead gateway (pre-push adversarial round)', () => {
  it('a gateway that already exited before the stop tick fails as gateway-died-unexpectedly and the stop is never marked issued', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    gateway.child.kill('SIGKILL');
    await gateway.exited;
    let issued = false;
    const rejection = await issuePlannedGatewayStop(manager, gateway, () => {
      issued = true;
    }).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(AttemptFailure);
    expect((rejection as AttemptFailure).reason).toBe('gateway-died-unexpectedly');
    expect(issued).toBe(false);
    // With the stop never issued, classification still names the earlier
    // external death an unexpected exit — never a planned stop.
    expect(classifyChildTerminalState(gateway, false)).toBe('unexpected-terminal-exit');
  });

  it('a gateway alive at the stop tick is stopped, marked issued, and classifies planned-stop-completed', async () => {
    const manager = new ProcessManager();
    const gateway = spawnNode(manager, 'gateway-fake', LONG_RUNNING);
    let issued = false;
    const outcome = await issuePlannedGatewayStop(
      manager,
      gateway,
      () => {
        issued = true;
      },
      500,
    );
    expect(issued).toBe(true);
    expect(typeof outcome).toBe('string');
    expect(gateway.hasExited()).toBe(true);
    expect(classifyChildTerminalState(gateway, true)).toBe('planned-stop-completed');
  });
});
