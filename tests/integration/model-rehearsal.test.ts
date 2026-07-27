import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  rehearseNormalCase,
  runRehearsal,
  type RehearsalCaseName,
  type RehearsalReport,
} from '../../scripts/model/rehearse';

/**
 * Rehearsal harness tests (1.5.0 R4, brief §11.8): the exported rehearsal
 * cases run against a throwaway --out directory; all three cases must
 * strict-complete through the REAL pipeline, the reports must parse, a
 * deliberately induced evidence gap must make the rehearsal fail (the CLI
 * exit-nonzero contract is `report.ok === false` / a thrown case), and every
 * gateway server must be closed after success AND failure. Measured cost is
 * ~3-4s per full rehearsal; timeouts are generous (60s), never load-bearing.
 */

const SUITE_TIMEOUT = 60_000;

describe('model rehearsal harness (R4)', () => {
  let outDir: string;
  let report: RehearsalReport;
  const ports = new Map<RehearsalCaseName, number>();

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'model-rehearsal-'));
    report = await runRehearsal({
      outDir,
      hooks: { onGatewayStarted: (caseName, port) => ports.set(caseName, port) },
    });
  }, SUITE_TIMEOUT);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('all three rehearsal cases strict-complete', () => {
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    for (const run of [report.normalRun, report.gatewayStopRun, report.latencyRun]) {
      expect(run).not.toBeNull();
      expect(run!.finalManifestStatus).toBe('completed');
      expect(run!.failedCriteria).toEqual([]);
      expect(run!.replayMatch).toBe(true);
      expect(run!.onlyMara).toBe(true);
      expect(run!.bundleAggregateSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(run!.completenessSources).toContain('ledger');
      expect(run!.completenessSources).toContain('client');
      // A5: monotonic non-decreasing run timestamps (equality legal).
      expect(run!.runCompletedAtUtc <= run!.exportedAtUtc).toBe(true);
      expect(run!.exportedAtUtc <= run!.finalizedAtUtc).toBe(true);
    }
    // Case-defining shapes: the normal run answers everything; the
    // gateway-stop run keeps gateway evidence partial yet completes; the
    // latency run records the supersede regime (A9/A1).
    expect(report.normalRun!.completenessNotes).toEqual([]);
    expect(report.normalRun!.requestsWithGatewayResult).toBe(
      report.normalRun!.externalRequestsEmitted,
    );
    expect(report.gatewayStopRun!.externalFailuresByCode['gateway-unavailable']).toBeGreaterThan(0);
    expect(report.gatewayStopRun!.requestsWithGatewayResult).toBeLessThan(
      report.gatewayStopRun!.externalRequestsEmitted,
    );
    expect(report.latencyRun!.supersededRequests).toBeGreaterThan(0);
  });

  it('reports parse and the finalize outputs exist in the spec layout', () => {
    const parsed = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as RehearsalReport;
    expect(parsed.ok).toBe(true);
    expect(parsed.normalRun?.runId).toBe('rehearsal-normal-0001');
    expect(parsed.gatewayStopRun?.runId).toBe('rehearsal-gateway-stop-0001');
    expect(parsed.latencyRun?.runId).toBe('rehearsal-latency-0001');
    const markdown = readFileSync(join(outDir, 'report.md'), 'utf8');
    expect(markdown).toContain('Keyless model rehearsal report');
    // Layout satisfies finalize's basename(dir) === runId rule per case.
    for (const [caseName, runId] of [
      ['normal', 'rehearsal-normal-0001'],
      ['gateway-stop', 'rehearsal-gateway-stop-0001'],
      ['latency', 'rehearsal-latency-0001'],
    ] as const) {
      const runDir = join(outDir, caseName, runId);
      for (const file of [
        'run-manifest.json',
        'client-bundle.json',
        'finalized-trace.jsonl',
        'run-manifest.final.json',
        'model-summary.json',
        'bundle-manifest.json',
      ]) {
        expect(existsSync(join(runDir, file)), `${caseName}/${runId}/${file}`).toBe(true);
      }
    }
  });

  it(
    'every gateway server is closed after a successful rehearsal',
    async () => {
      expect(ports.size).toBe(3);
      for (const [caseName, port] of ports) {
        await expect(
          fetch(`http://127.0.0.1:${port}/health`),
          `case ${caseName} gateway on port ${port} still answers`,
        ).rejects.toThrow();
      }
    },
    SUITE_TIMEOUT,
  );

  it(
    'an induced evidence gap (client-bundle.json deleted before finalize) throws, writes no derived output, and still closes the server',
    async () => {
      const gapDir = mkdtempSync(join(tmpdir(), 'model-rehearsal-gap-'));
      let gapPort: number | null = null;
      try {
        await expect(
          rehearseNormalCase(gapDir, 'rehearsal-gap-0001', {
            onGatewayStarted: (_caseName, port) => {
              gapPort = port;
            },
            beforeFinalize: (_caseName, runDir) => {
              rmSync(join(runDir, 'client-bundle.json'));
            },
          }),
        ).rejects.toThrow(/client-bundle/);
        // Strict finalize wrote NOTHING (V2 atomicity): no bundle manifest
        // is the unambiguous not-finalized signal.
        const runDir = join(gapDir, 'normal', 'rehearsal-gap-0001');
        for (const derived of [
          'bundle-manifest.json',
          'run-manifest.final.json',
          'finalized-trace.jsonl',
          'model-summary.json',
        ]) {
          expect(existsSync(join(runDir, derived)), derived).toBe(false);
        }
        // The gateway was torn down by the case's finally despite the throw.
        expect(gapPort).not.toBeNull();
        await expect(fetch(`http://127.0.0.1:${gapPort!}/health`)).rejects.toThrow();
      } finally {
        rmSync(gapDir, { recursive: true, force: true });
      }
    },
    SUITE_TIMEOUT,
  );

  it(
    'runRehearsal maps a failed case to ok:false with failures listed and reports still written (CLI exit-nonzero contract)',
    async () => {
      const failDir = mkdtempSync(join(tmpdir(), 'model-rehearsal-fail-'));
      const failPorts: number[] = [];
      try {
        const failed = await runRehearsal({
          outDir: failDir,
          hooks: {
            onGatewayStarted: (_caseName, port) => failPorts.push(port),
            beforeFinalize: (caseName, runDir) => {
              if (caseName === 'normal') rmSync(join(runDir, 'client-bundle.json'));
            },
          },
        });
        expect(failed.ok).toBe(false);
        expect(failed.normalRun).toBeNull();
        expect(failed.failures.length).toBeGreaterThan(0);
        expect(failed.failures[0]).toMatch(/^normal: /);
        // The untampered cases still strict-complete.
        expect(failed.gatewayStopRun?.finalManifestStatus).toBe('completed');
        expect(failed.latencyRun?.finalManifestStatus).toBe('completed');
        // Reports are written even on failure (uploadable CI evidence).
        const parsed = JSON.parse(
          readFileSync(join(failDir, 'report.json'), 'utf8'),
        ) as RehearsalReport;
        expect(parsed.ok).toBe(false);
        expect(readFileSync(join(failDir, 'report.md'), 'utf8')).toContain('FAILED');
        // Servers closed after failure too.
        expect(failPorts.length).toBe(3);
        for (const port of failPorts) {
          await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
        }
      } finally {
        rmSync(failDir, { recursive: true, force: true });
      }
    },
    SUITE_TIMEOUT,
  );
});
