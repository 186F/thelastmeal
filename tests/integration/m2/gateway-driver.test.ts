import { describe, expect, it, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessManager } from '../../../scripts/experiments/m2/processManager';
import {
  GATEWAY_READY_PREFIX,
  portIsFree,
  startGateway,
} from '../../../scripts/experiments/m2/gatewayDriver';

/**
 * Gateway child-process driver (M2 brief §19.5, §19.15): a REAL keyless
 * fake-adapter gateway child on a dedicated test port — readiness from the
 * stdout contract line, explicit env-pinned configuration (nothing
 * inherited from a developer's .env.gateway), provider-config served on the
 * configured port, and graceful shutdown that frees the port.
 *
 * Uses a port distinct from the 8799 automation port so this test never
 * collides with a concurrently running rehearsal.
 */

const TEST_PORT = 8794;
const SUITE_TIMEOUT = 60_000;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('gateway driver', () => {
  it(
    'spawns a keyless fake gateway child, serves provider-config, and stops cleanly',
    async () => {
      const workDir = mkdtempSync(join(tmpdir(), 'm2-gateway-driver-'));
      dirs.push(workDir);
      const processManager = new ProcessManager();
      try {
        expect(await portIsFree(TEST_PORT)).toBe(true);
        const gateway = await startGateway(processManager, {
          mode: 'fake',
          port: TEST_PORT,
          allowedBrowserOrigin: 'http://localhost:5199',
          traceDir: join(workDir, 'traces'),
          maxCallsPerRun: 10,
          maxTotalCalls: 10,
          repoRoot: process.cwd(),
          logPath: join(workDir, 'gateway.log'),
        });
        expect(gateway.pid).toBeGreaterThan(0);
        const log = readFileSync(join(workDir, 'gateway.log'), 'utf8');
        expect(log).toContain(`${GATEWAY_READY_PREFIX}${TEST_PORT}`);
        // The child is keyless fake mode: its readiness line names the fake
        // adapter and never any upstream model host.
        expect(log).toContain('adapter=fake-decision-adapter-v1');
        const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/provider-config`);
        expect(response.ok).toBe(true);

        const exit = await processManager.stop(gateway, 5_000);
        expect(exit).not.toBe('timeout');
        expect(await portIsFree(TEST_PORT)).toBe(true);
        expect(existsSync(join(workDir, 'gateway.log'))).toBe(true);
      } finally {
        await processManager.stopAll();
      }
    },
    SUITE_TIMEOUT,
  );

  it(
    'refuses to start when the port is occupied (§19.6 preflight)',
    async () => {
      const workDir = mkdtempSync(join(tmpdir(), 'm2-gateway-driver-'));
      dirs.push(workDir);
      const processManager = new ProcessManager();
      try {
        const first = await startGateway(processManager, {
          mode: 'fake',
          port: TEST_PORT,
          allowedBrowserOrigin: 'http://localhost:5199',
          traceDir: join(workDir, 'traces-a'),
          repoRoot: process.cwd(),
          logPath: join(workDir, 'gateway-a.log'),
        });
        await expect(
          startGateway(processManager, {
            mode: 'fake',
            port: TEST_PORT,
            allowedBrowserOrigin: 'http://localhost:5199',
            traceDir: join(workDir, 'traces-b'),
            repoRoot: process.cwd(),
            logPath: join(workDir, 'gateway-b.log'),
          }),
        ).rejects.toThrow(/preflight-port-occupied/);
        await processManager.stop(first, 5_000);
      } finally {
        await processManager.stopAll();
      }
    },
    SUITE_TIMEOUT,
  );
});
