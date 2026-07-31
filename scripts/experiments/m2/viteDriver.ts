import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagedProcess, ProcessManager } from './processManager';
import { portIsFree } from './gatewayDriver';
import { viteChildEnv } from './childEnv';

/**
 * Vite dev-server driver (M2 brief §19.5–§19.6): started ONCE per sequence
 * on the strict fixed automation port. Preflight fails when the port is
 * occupied — a stale server (possibly baked with the wrong gateway URL) is
 * refused, never reused. `VITE_MODEL_GATEWAY_URL` is injected into the
 * server's environment so the served app targets the automation gateway
 * port instead of the interactive default.
 */

export const AUTOMATION_VITE_PORT = 5199;
export const AUTOMATION_GATEWAY_PORT = 8799;
export const AUTOMATION_ORIGIN = `http://localhost:${AUTOMATION_VITE_PORT}`;
export const AUTOMATION_GATEWAY_URL = `http://localhost:${AUTOMATION_GATEWAY_PORT}`;

export interface ViteLaunch {
  repoRoot: string;
  logPath: string;
  port?: number;
  gatewayUrl?: string;
  readyTimeoutMs?: number;
}

export async function startVite(
  processManager: ProcessManager,
  launch: ViteLaunch,
): Promise<{ managedProcess: ManagedProcess; origin: string }> {
  const port = launch.port ?? AUTOMATION_VITE_PORT;
  if (!(await portIsFree(port))) {
    throw new Error(
      `preflight-port-occupied: vite port ${port} — stop the stale server; the orchestrator never reuses one`,
    );
  }
  const viteCli = join(launch.repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteCli)) throw new Error(`vite-cli-not-found: ${viteCli} (run npm ci)`);
  const managedProcess = processManager.spawnManaged({
    name: 'vite',
    command: process.execPath,
    args: [viteCli, '--port', String(port), '--strictPort'],
    cwd: launch.repoRoot,
    // Allowlisted environment (audit finding 9): the dev server never sees
    // credential variables from the operator shell.
    env: viteChildEnv(process.env, launch.gatewayUrl ?? AUTOMATION_GATEWAY_URL),
    logPath: launch.logPath,
  });
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + (launch.readyTimeoutMs ?? 60_000);
  let lastError = 'no-response';
  while (Date.now() < deadline) {
    // The readiness probe is an HTTP GET that ANY server on the port could
    // answer — including a stale IPv6-bound instance the IPv4 preflight
    // cannot see (observed during Phase 4 rehearsals: our child died with
    // EADDRINUSE while an imposter served the page, then vanished
    // mid-attempt). A dead child makes the answering server definitionally
    // not ours: refuse instead of proceeding against an imposter.
    if (managedProcess.hasExited()) {
      throw new Error(
        `vite-start-failed: the vite child exited (${String(
          managedProcess.terminalOutcome(),
        )}) before readiness — any server answering on port ${port} is not ours`,
      );
    }
    try {
      const response = await fetch(origin, { method: 'GET' });
      if (response.ok) return { managedProcess, origin };
      lastError = `status ${response.status}`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite-ready-timeout: ${origin} (${lastError})`);
}
