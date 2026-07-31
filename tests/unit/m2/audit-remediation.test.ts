import { describe, expect, it, afterAll } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  batchChildEnv,
  fakeGatewayEnv,
  viteChildEnv,
} from '../../../scripts/experiments/m2/childEnv';
import {
  sealExecution,
  verifySealedExecutions,
  type SequenceState,
  SEQUENCE_STATE_VERSION,
} from '../../../scripts/experiments/m2/sequenceState';
import {
  nextArchivePath,
  packageSequence,
  stagedArchivePath,
} from '../../../scripts/experiments/m2/packageEvidence';
import { loadGatewayConfig } from '../../../gateway/config';

/**
 * Phase 3 audit remediation suites (§15 of the audit):
 *  - release metadata agreement (finding 1);
 *  - allowlisted child environments and the fake gateway's structural
 *    inability to observe credentials (finding 9);
 *  - execution seals detecting tamper, deletion, and addition (finding 4);
 *  - immutable portable packaging with receipt, exclusions, and nested-
 *    archive secret scanning (finding 7).
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe('release metadata (audit finding 1)', () => {
  it('package.json and package-lock.json agree on the release version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });
});

describe('child environments (audit finding 9)', () => {
  const poisoned: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    OPENROUTER_API_KEY: 'sk-or-v1-poisoned-parent-environment-canary',
    OPENAI_API_KEY: 'sk-poisoned-parent-environment-canary',
    OPENROUTER_MODEL: 'poisoned/model',
    OPENROUTER_PROVIDER: 'poisoned-provider',
  };

  it('vite, batch, and fake-gateway environments never carry credential variables', () => {
    for (const [name, env] of [
      ['vite', viteChildEnv(poisoned, 'http://localhost:8799')],
      ['batch', batchChildEnv(poisoned)],
      ['fake-gateway', fakeGatewayEnv(poisoned)],
    ] as const) {
      expect(env.OPENROUTER_API_KEY, name).toBeUndefined();
      expect(env.OPENAI_API_KEY, name).toBeUndefined();
      expect(env.OPENROUTER_MODEL, name).toBeUndefined();
      expect(env.OPENROUTER_PROVIDER, name).toBeUndefined();
      expect(env.PATH, name).toBe(process.env.PATH);
    }
    expect(viteChildEnv(poisoned, 'http://localhost:8799').VITE_MODEL_GATEWAY_URL).toBe(
      'http://localhost:8799',
    );
  });

  it('fake-mode gateway config never reads .env.gateway and blanks leaked credentials', () => {
    const root = scratch('m2-fake-env-');
    writeFileSync(
      join(root, '.env.gateway'),
      [
        'OPENROUTER_API_KEY=sk-or-v1-file-canary-must-never-be-read',
        'OPENROUTER_MODEL=file/model',
        'OPENROUTER_PROVIDER=file-provider',
        'MODEL_GATEWAY_PORT=9999',
      ].join('\n'),
      'utf8',
    );
    // Even with a poisoned FILE and poisoned PROCESS ENV, the fake config
    // carries no credentials and no file-derived values.
    const config = loadGatewayConfig(
      'fake',
      { OPENROUTER_API_KEY: 'sk-or-v1-env-canary', OPENAI_API_KEY: 'sk-env-canary' },
      root,
    );
    expect(config.openRouterApiKey).toBeNull();
    expect(config.openaiApiKey).toBeNull();
    expect(config.openRouterModel).toBeNull();
    expect(config.openRouterProvider).toBeNull();
    expect(config.port).toBe(8787); // the file's 9999 was never read
    // A live-mode load in the same root DOES read the file (the authorized
    // path), proving the boundary is fake-specific, not accidental.
    const live = loadGatewayConfig('openrouter', {}, root);
    expect(live.openRouterApiKey).toBe('sk-or-v1-file-canary-must-never-be-read');
  });
});

describe('execution seals (audit finding 4; re-audit finding 5)', () => {
  function sealedState(root: string): SequenceState {
    mkdirSync(join(root, 'attempt-a-e1', 'sub'), { recursive: true });
    writeFileSync(join(root, 'attempt-a-e1', 'ledger-A.json'), '{"canonical":true}', 'utf8');
    writeFileSync(join(root, 'attempt-a-e1', 'sub', 'trace.jsonl'), '{"row":1}\n', 'utf8');
    mkdirSync(join(root, 'attempt-a-e2'), { recursive: true });
    writeFileSync(join(root, 'attempt-a-e2', 'failure-message.txt'), 'run-timeout: x\n', 'utf8');
    const seal = sealExecution(root, 'attempt-a-e1', 'completed');
    const failedSeal = sealExecution(root, 'attempt-a-e2', 'failed');
    const executionBase = {
      failureStage: null,
      artifactStatus: null,
      studyStatus: null,
      replacementDisposition: null,
      thresholdVerdicts: null,
      runId: null,
      artifacts: [],
      verdicts: {},
      navigationCount: null,
      browserProvenance: null,
      startedAtUtc: '2026-07-30T00:00:00.000Z',
      endedAtUtc: '2026-07-30T00:01:00.000Z',
    };
    return {
      stateVersion: SEQUENCE_STATE_VERSION,
      sequenceId: 'seal-test',
      planSha256: 'a'.repeat(64),
      repositorySha: 'b'.repeat(40),
      packageVersion: '1.8.0',
      experimentId: 'model-backed-npc-001',
      experimentVersion: '1.2.0',
      promptVersion: 'mara-action-selection-1.0.0',
      externalProviderId: 'openrouter-mara-action-v1',
      upstreamPlatform: 'openrouter',
      expectedModelId: 'none',
      expectedServingProviderId: 'none',
      studyId: 'none',
      studyVersion: 'none',
      studyPlanSha256: 'none',
      thresholdProfileId: 'm2-rehearsal-attempt-profile',
      thresholdProfileVersion: '1.0.0',
      configFingerprint: 'c'.repeat(16),
      status: 'completed',
      sequenceFailureReason: null,
      archivePath: null,
      archiveSha256: null,
      inventoryAggregateSha256: null,
      supersededArchives: [],
      freezeCheckpoints: [],
      executions: [
        {
          ...executionBase,
          executionId: 'a-e1',
          attemptId: 'a',
          status: 'completed',
          seal,
          failureReason: null,
          dir: 'attempt-a-e1',
        },
        {
          ...executionBase,
          executionId: 'a-e2',
          attemptId: 'a',
          status: 'failed',
          seal: failedSeal,
          failureReason: 'run-timeout',
          dir: 'attempt-a-e2',
        },
      ],
      lastTransition: 'sequence-completed',
      createdAtUtc: '2026-07-30T00:00:00.000Z',
      updatedAtUtc: '2026-07-30T00:01:00.000Z',
    };
  }

  it('intact evidence verifies; tamper, deletion, and addition each refuse', () => {
    const root = scratch('m2-seal-');
    const state = sealedState(root);
    expect(() => verifySealedExecutions(root, state)).not.toThrow();

    writeFileSync(join(root, 'attempt-a-e1', 'ledger-A.json'), '{"canonical":false}', 'utf8');
    expect(() => verifySealedExecutions(root, state)).toThrow(/resume-evidence-invalid.*altered/);

    writeFileSync(join(root, 'attempt-a-e1', 'ledger-A.json'), '{"canonical":true}', 'utf8');
    expect(() => verifySealedExecutions(root, state)).not.toThrow();

    rmSync(join(root, 'attempt-a-e1', 'sub', 'trace.jsonl'));
    expect(() => verifySealedExecutions(root, state)).toThrow(/resume-evidence-invalid.*missing/);

    writeFileSync(join(root, 'attempt-a-e1', 'sub', 'trace.jsonl'), '{"row":1}\n', 'utf8');
    writeFileSync(join(root, 'attempt-a-e1', 'planted.txt'), 'x', 'utf8');
    expect(() => verifySealedExecutions(root, state)).toThrow(/resume-evidence-invalid.*added/);
  });

  it('FAILED executions are sealed evidence too: tamper or deletion refuses (re-audit finding 5)', () => {
    const root = scratch('m2-seal-');
    const state = sealedState(root);
    writeFileSync(join(root, 'attempt-a-e2', 'failure-message.txt'), 'edited\n', 'utf8');
    expect(() => verifySealedExecutions(root, state)).toThrow(/a-e2.*altered/);

    writeFileSync(join(root, 'attempt-a-e2', 'failure-message.txt'), 'run-timeout: x\n', 'utf8');
    expect(() => verifySealedExecutions(root, state)).not.toThrow();
    rmSync(join(root, 'attempt-a-e2', 'failure-message.txt'));
    expect(() => verifySealedExecutions(root, state)).toThrow(/a-e2.*missing/);
  });

  it('any terminal execution without a seal, or with a status-mismatched seal, refuses', () => {
    const root = scratch('m2-seal-');
    const state = sealedState(root);
    state.executions[1]!.seal = null;
    expect(() => verifySealedExecutions(root, state)).toThrow(/has no terminal seal/);

    const fresh = sealedState(scratch('m2-seal-'));
    fresh.executions[0]!.seal = { ...fresh.executions[0]!.seal!, sealedStatus: 'failed' };
    expect(() => verifySealedExecutions(root, fresh)).toThrow(/seal status/);
  });
});

describe('portable packaging (audit finding 7; re-audit findings 1 and 7)', () => {
  const receipt = {
    sequenceId: 'package-test',
    planSha256: 'a'.repeat(64),
    repositorySha: 'b'.repeat(40),
    studyPlanSha256: null,
  };

  function evidenceRoot(): string {
    const root = scratch('m2-package-');
    mkdirSync(join(root, 'attempt-a'), { recursive: true });
    writeFileSync(join(root, 'sequence-manifest.json'), '{"attemptSetComplete":true}', 'utf8');
    writeFileSync(join(root, 'attempt-a', 'heartbeat.jsonl'), '{"tick":1}\n', 'utf8');
    return root;
  }

  it('produces a verified fresh archive with receipt; excludes transient files', async () => {
    const root = evidenceRoot();
    writeFileSync(join(root, 'stale.tmp'), 'transient', 'utf8');
    const zipPath = join(scratch('m2-package-out-'), 'evidence-001.zip');
    const result = await packageSequence(root, zipPath, receipt);
    expect(result.zipSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(`${zipPath}.sha256`, 'utf8')).toContain(result.zipSha256);
    const receiptJson = JSON.parse(readFileSync(result.receiptPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(receiptJson.archiveSha256).toBe(result.zipSha256);
    expect(receiptJson.sequenceId).toBe('package-test');
    expect(receiptJson.inventoryAggregateSha256).toBe(result.inventoryAggregateSha256);
    const inventory = JSON.parse(readFileSync(result.inventoryPath, 'utf8')) as {
      files: { name: string }[];
    };
    const names = inventory.files.map((file) => file.name);
    expect(names).not.toContain('stale.tmp');
    expect(names.every((name) => !name.includes('\\'))).toBe(true);
  });

  it('a packaged root is immutable: post-inventory deletion refuses instead of re-inventorying (re-audit finding 1)', async () => {
    const root = evidenceRoot();
    writeFileSync(join(root, 'doomed.md'), 'will be deleted', 'utf8');
    const zipPath = join(scratch('m2-package-out-'), 'evidence-001.zip');
    await packageSequence(root, zipPath, receipt);
    rmSync(join(root, 'doomed.md'));
    // A stale entry can never survive because the mutated tree is REFUSED
    // outright — repackaging verifies the recorded inventory byte-for-byte.
    const zipPath2 = join(scratch('m2-package-out-'), 'evidence-002.zip');
    await expect(packageSequence(root, zipPath2, receipt)).rejects.toThrow(
      /inventory-tree-mismatch/,
    );
    expect(existsSync(zipPath2)).toBe(false);
    expect(existsSync(`${zipPath2}.receipt.json`)).toBe(false);
  });

  it('an existing destination archive is never deleted or overwritten (re-audit finding 7)', async () => {
    const root = evidenceRoot();
    const outDir = scratch('m2-package-out-');
    const zipPath = join(outDir, 'evidence-001.zip');
    const first = await packageSequence(root, zipPath, receipt);
    const firstBytes = readFileSync(zipPath);
    await expect(packageSequence(root, zipPath, receipt)).rejects.toThrow(
      /archive-destination-exists/,
    );
    expect(readFileSync(zipPath)).toEqual(firstBytes);
    expect(first.zipSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stages the archive as a dot-tmp SIBLING on the destination volume (re-audit finding 7)', () => {
    const zipPath = join('C:', 'somewhere', 'deep', 'evidence-001.zip');
    const staged = stagedArchivePath(zipPath);
    expect(dirname(staged)).toBe(dirname(zipPath));
    expect(basename(staged).startsWith('.evidence-001.zip.')).toBe(true);
    expect(staged.endsWith('.tmp')).toBe(true);
  });

  it('a failed verification leaves no partial destination archive and no receipt', async () => {
    const root = evidenceRoot();
    writeFileSync(join(root, 'leak.log'), 'Authorization: Bearer oops', 'utf8');
    const outDir = scratch('m2-package-out-');
    const zipPath = join(outDir, 'evidence-001.zip');
    await expect(packageSequence(root, zipPath, receipt)).rejects.toThrow(
      /evidence-secret-scan-failed/,
    );
    expect(existsSync(zipPath)).toBe(false);
    expect(existsSync(`${zipPath}.sha256`)).toBe(false);
    expect(existsSync(`${zipPath}.receipt.json`)).toBe(false);
    // No staged temp file survives either.
    expect(readdirSync(outDir)).toHaveLength(0);
  });

  it('versioned archive paths increment and never collide', async () => {
    const root = evidenceRoot();
    const outDir = scratch('m2-package-out-');
    expect(basename(nextArchivePath(outDir, 'seq'))).toBe('seq-evidence-001.zip');
    await packageSequence(root, nextArchivePath(outDir, 'seq'), receipt);
    expect(basename(nextArchivePath(outDir, 'seq'))).toBe('seq-evidence-002.zip');
  });

  it('refuses to package a tree containing secrets — including inside nested archives', async () => {
    const root = evidenceRoot();
    writeFileSync(join(root, 'leak.log'), 'Authorization: Bearer oops', 'utf8');
    const zipPath = join(scratch('m2-package-out-'), 'evidence-001.zip');
    await expect(packageSequence(root, zipPath, receipt)).rejects.toThrow(
      /evidence-secret-scan-failed/,
    );

    // Nested archive case: a zip (like a Playwright trace) whose TEXT
    // entries contain a secret is caught even though .zip is binary.
    const root2 = evidenceRoot();
    const nestedSource = scratch('m2-nested-src-');
    writeFileSync(join(nestedSource, 'network.log'), 'OPENROUTER_API_KEY=sk-or-canary', 'utf8');
    const { execSync } = await import('node:child_process');
    const nestedZip = join(root2, 'attempt-a', 'attempt-trace.zip');
    if (process.platform === 'win32') {
      execSync(`tar -a -c -f "${nestedZip}" -C "${nestedSource}" .`);
    } else {
      execSync(`cd "${nestedSource}" && zip -r -q "${nestedZip}" .`);
    }
    const zipPath2 = join(scratch('m2-package-out-'), 'evidence-001.zip');
    await expect(packageSequence(root2, zipPath2, receipt)).rejects.toThrow(
      /evidence-secret-scan-failed/,
    );
  });
});
