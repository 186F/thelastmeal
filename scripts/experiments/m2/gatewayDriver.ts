import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { ProcessManager, type ManagedProcess } from './processManager';

/**
 * Gateway child-process driver (M2 brief §19.5, §19.15).
 *
 * A FRESH gateway process per model-backed attempt: in-memory budgets and
 * the process-wide total-call cap reset per attempt by construction.
 *
 * Secret boundary (§19.15): this module never reads, parses, prints, or
 * copies `.env.gateway` or any credential. It only spawns `gateway/main.ts`,
 * which loads its own configuration. For keyless fake attempts EVERY
 * relevant setting is passed explicitly through the child environment so a
 * developer's `.env.gateway` values can never leak into a rehearsal; for
 * live attempts the child reads its own credentials exactly as it does when
 * a human starts it.
 */

export const GATEWAY_READY_PREFIX = 'model gateway listening on http://127.0.0.1:';

export interface GatewayLaunch {
  mode: 'fake' | 'live';
  port: number;
  allowedBrowserOrigin: string;
  /** Absolute path — the child resolves relative traceDirs against ITS cwd. */
  traceDir: string;
  maxCallsPerRun?: number;
  maxTotalCalls?: number;
  requestTimeoutMs?: number;
  maxConcurrency?: number;
  repoRoot: string;
  logPath: string;
  readyTimeoutMs?: number;
}

export function tsxCliPath(repoRoot: string): string {
  const cli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(cli)) throw new Error(`tsx-cli-not-found: ${cli} (run npm ci)`);
  return cli;
}

/** True when nothing is listening on the port (loopback). */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

export async function startGateway(
  processManager: ProcessManager,
  launch: GatewayLaunch,
): Promise<ManagedProcess> {
  if (!(await portIsFree(launch.port))) {
    throw new Error(`preflight-port-occupied: gateway port ${launch.port}`);
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MODEL_GATEWAY_PORT: String(launch.port),
    ALLOWED_BROWSER_ORIGIN: launch.allowedBrowserOrigin,
    MODEL_TRACE_DIR: launch.traceDir,
    // Fake attempts pin every numeric setting explicitly so nothing is
    // silently inherited from a developer's .env.gateway file (the loader
    // prefers process env over the file).
    MODEL_MAX_CALLS_PER_RUN: String(launch.maxCallsPerRun ?? 120),
    MODEL_MAX_TOTAL_CALLS: String(launch.maxTotalCalls ?? 120),
    MODEL_REQUEST_TIMEOUT_MS: String(launch.requestTimeoutMs ?? 20_000),
    MODEL_MAX_CONCURRENCY: String(launch.maxConcurrency ?? 1),
  };
  const args = [tsxCliPath(launch.repoRoot), join(launch.repoRoot, 'gateway', 'main.ts')];
  if (launch.mode === 'fake') args.push('--fake');
  const managedProcess = processManager.spawnManaged({
    name: `gateway-${launch.mode}`,
    command: process.execPath,
    args,
    cwd: launch.repoRoot,
    env,
    logPath: launch.logPath,
  });
  await ProcessManager.waitFor(
    () =>
      existsSync(launch.logPath) &&
      readFileSync(launch.logPath, 'utf8').includes(`${GATEWAY_READY_PREFIX}${launch.port}`),
    launch.readyTimeoutMs ?? 30_000,
    `gateway readiness on port ${launch.port}`,
  );
  return managedProcess;
}
