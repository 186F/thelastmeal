import { spawn, type ChildProcess } from 'node:child_process';
import { helperEnv } from './childEnv';

/**
 * Optional cross-platform keep-awake lease (M2 brief §19.13; re-audit
 * finding 6).
 *
 * Best-effort: a child process holds a sleep-inhibition lease for the
 * orchestrator's lifetime and is killed on release. Failure to establish a
 * lease is not fatal by itself — the orchestrator prints a prominent
 * warning and requires `--allow-sleep-risk` before running a LIVE plan
 * without one. No security control is disabled and no power setting is
 * permanently altered: the lease dies with the process.
 *
 * Secret boundary: the helper receives the nonsecret platform environment
 * ONLY — an exported OPENROUTER_API_KEY in the operator shell never
 * reaches powershell/caffeinate/systemd-inhibit. Acquisition is LIVE-ONLY
 * and happens inside the orchestrator's release scope, so a refused or
 * failed launch never leaves the helper running.
 */

export interface KeepAwakeLease {
  method: string;
  pid: number;
  release: () => void;
}

export type KeepAwakeSpawn = typeof spawn;

const WINDOWS_KEEPAWAKE_PS = `
Add-Type -Name Sleep -Namespace Orchestrator -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001)
[Orchestrator.Sleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
while ($true) { Start-Sleep -Seconds 30; [Orchestrator.Sleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null }
`;

export async function acquireKeepAwake(
  spawnImpl: KeepAwakeSpawn = spawn,
): Promise<KeepAwakeLease | null> {
  let child: ChildProcess | null = null;
  let method: string;
  const env = helperEnv(process.env);
  try {
    if (process.platform === 'win32') {
      method = 'windows-set-thread-execution-state';
      child = spawnImpl(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_KEEPAWAKE_PS],
        {
          stdio: 'ignore',
          windowsHide: true,
          env,
        },
      );
    } else if (process.platform === 'darwin') {
      method = 'macos-caffeinate';
      child = spawnImpl('caffeinate', ['-i', '-w', String(process.pid)], {
        stdio: 'ignore',
        env,
      });
    } else {
      method = 'linux-systemd-inhibit';
      child = spawnImpl(
        'systemd-inhibit',
        ['--what=sleep', '--why=m2-orchestrator-sequence', 'sleep', 'infinity'],
        { stdio: 'ignore', env },
      );
    }
  } catch {
    return null;
  }
  if (!child || child.pid === undefined) return null;
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  // A lease is only a lease if the helper actually survives its spawn: wait
  // briefly and verify the process is still alive before reporting it held
  // (a missing binary or immediate crash must surface as `null`, so the
  // §19.13 --allow-sleep-risk interlock can do its job).
  return new Promise((resolve) => {
    setTimeout(() => {
      if (failed || child!.exitCode !== null || child!.signalCode !== null) {
        resolve(null);
        return;
      }
      resolve({
        method,
        pid: child!.pid!,
        release: () => {
          try {
            child?.kill();
          } catch {
            // release must never throw.
          }
        },
      });
    }, 500);
  });
}
