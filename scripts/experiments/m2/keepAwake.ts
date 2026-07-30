import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Optional cross-platform keep-awake lease (M2 brief §19.13).
 *
 * Best-effort: a child process holds a sleep-inhibition lease for the
 * orchestrator's lifetime and is killed on release. Failure to establish a
 * lease is not fatal by itself — the orchestrator prints a prominent
 * warning and requires `--allow-sleep-risk` before running a LIVE plan
 * without one. No security control is disabled and no power setting is
 * permanently altered: the lease dies with the process.
 */

export interface KeepAwakeLease {
  method: string;
  release: () => void;
}

const WINDOWS_KEEPAWAKE_PS = `
Add-Type -Name Sleep -Namespace Orchestrator -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001)
[Orchestrator.Sleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
while ($true) { Start-Sleep -Seconds 30; [Orchestrator.Sleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null }
`;

export function acquireKeepAwake(): KeepAwakeLease | null {
  let child: ChildProcess | null = null;
  let method: string;
  try {
    if (process.platform === 'win32') {
      method = 'windows-set-thread-execution-state';
      child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_KEEPAWAKE_PS],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      );
    } else if (process.platform === 'darwin') {
      method = 'macos-caffeinate';
      child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    } else {
      method = 'linux-systemd-inhibit';
      child = spawn(
        'systemd-inhibit',
        ['--what=sleep', '--why=m2-orchestrator-sequence', 'sleep', 'infinity'],
        { stdio: 'ignore' },
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
  const lease: KeepAwakeLease = {
    method,
    release: () => {
      try {
        child?.kill();
      } catch {
        // release must never throw.
      }
    },
  };
  // Give a spawn error one tick to surface before declaring the lease held.
  return failed ? null : lease;
}
