import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkFreeze,
  planConfigFingerprint,
  runPostSequencePipeline,
  studyFreezeRecordContent,
  type FreezeIdentity,
  type PostSequenceDeps,
} from '../../../scripts/experiments/m2/orchestrate';
import { parsePlan } from '../../../scripts/experiments/m2/planSchema';
import { packageSequence } from '../../../scripts/experiments/m2/packageEvidence';

/**
 * Freeze coverage through the COMPLETE post-sequence pipeline (re-audit
 * finding 4): every drift KIND is detected by the full freeze check —
 * HEAD, tracked worktree, package + lockfile versions, archived plan and
 * its configuration fingerprint, the registered attempt profile, archived
 * study bytes + freeze record, and the EXTERNAL registered study file —
 * and drift at every pipeline CHECKPOINT fails the sequence as a
 * preserved freeze-violation that is never packaged or receipted.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=m2@test', '-c', 'user.name=m2-test', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const PLAN_JSON = JSON.stringify(
  {
    planSchemaVersion: 'm2-orchestrator-plan-1.1.0',
    sequenceId: 'freeze-fixture',
    description: 'freeze drill plan',
    evidentiary: false,
    outputRoot: 'artifacts/freeze-fixture',
    attempts: [
      {
        attemptId: 'a-det',
        scenarioId: 'A',
        conditionId: 'deterministic-baseline-v1',
        speed: 20,
        gatewayMode: 'off',
      },
    ],
    attemptProfile: { profileId: 'm2-rehearsal-attempt-profile', profileVersion: '1.0.0' },
    replacementPolicy: { maxReplacementAttempts: 0, retryableFailureClasses: [] },
    liveCallBudget: 0,
    timeouts: {
      runTimeoutMs: 60000,
      stallTimeoutMs: 60000,
      stallGraceMs: 5000,
      heartbeatIntervalMs: 5000,
    },
    postSequenceBatch: false,
  },
  null,
  2,
);

interface FreezeFixture {
  repoRoot: string;
  sequenceRoot: string;
  freeze: FreezeIdentity;
  studyPath: string;
}

function freezeFixture(
  options: { requireCleanWorktree?: boolean; withStudy?: boolean } = {},
): FreezeFixture {
  const base = mkdtempSync(join(tmpdir(), 'm2-freeze-'));
  dirs.push(base);
  const repoRoot = join(base, 'repo');
  const sequenceRoot = join(base, 'sequence');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(sequenceRoot, { recursive: true });
  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'freeze-fixture', version: '1.8.0' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(repoRoot, 'package-lock.json'),
    JSON.stringify({ version: '1.8.0', packages: { '': { version: '1.8.0' } } }, null, 2),
    'utf8',
  );
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'freeze fixture']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);

  writeFileSync(join(sequenceRoot, 'plan.archived.json'), PLAN_JSON, 'utf8');
  const { plan } = parsePlan(Buffer.from(PLAN_JSON));

  const studyPath = join(base, 'study.json');
  let studyPlanSha256: string | null = null;
  let freezeRecord: string | null = null;
  if (options.withStudy) {
    const studyBytes = '{"studyId":"freeze-study","frozen":true}';
    writeFileSync(studyPath, studyBytes, 'utf8');
    writeFileSync(join(sequenceRoot, 'study.archived.json'), studyBytes, 'utf8');
    studyPlanSha256 = sha256(studyBytes);
    freezeRecord = studyFreezeRecordContent({
      studyId: 'freeze-study',
      studyVersion: '1.0.0',
      studyPlanSha256,
      studyConfigFingerprint: 'fp-fixture',
    });
    writeFileSync(join(sequenceRoot, 'study.freeze.archived.json'), freezeRecord, 'utf8');
  }

  return {
    repoRoot,
    sequenceRoot,
    studyPath,
    freeze: {
      repositorySha: head,
      packageVersion: '1.8.0',
      planSha256: sha256(PLAN_JSON),
      requireCleanWorktree: options.requireCleanWorktree ?? false,
      configFingerprint: planConfigFingerprint(plan),
      thresholdProfileId: 'm2-rehearsal-attempt-profile',
      thresholdProfileVersion: '1.0.0',
      studyPlanSha256,
      studyPlanPathAbsolute: options.withStudy ? studyPath : null,
      studyId: options.withStudy ? 'freeze-study' : null,
      studyVersion: options.withStudy ? '1.0.0' : null,
      studyConfigFingerprint: options.withStudy ? 'fp-fixture' : null,
      studyFreezeRecordSha256: freezeRecord !== null ? sha256(freezeRecord) : null,
    },
  };
}

describe('checkFreeze drift kinds (re-audit finding 4 + §6.5)', () => {
  it('an unchanged environment passes', () => {
    const fixture = freezeFixture({ requireCleanWorktree: true, withStudy: true });
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).not.toThrow();
  });

  it('a moved HEAD violates', () => {
    const fixture = freezeFixture();
    writeFileSync(join(fixture.repoRoot, 'new.txt'), 'x', 'utf8');
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'drift']);
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: HEAD moved/,
    );
  });

  it('a dirty tracked worktree violates when cleanliness is required', () => {
    const fixture = freezeFixture({ requireCleanWorktree: true });
    writeFileSync(join(fixture.repoRoot, 'scratch.txt'), 'dirty', 'utf8');
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: tracked worktree is dirty/,
    );
  });

  it('a package version or lockfile drift during the sequence violates (§8)', () => {
    const fixture = freezeFixture();
    writeFileSync(
      join(fixture.repoRoot, 'package.json'),
      JSON.stringify({ name: 'freeze-fixture', version: '1.8.1' }, null, 2),
      'utf8',
    );
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: package version moved/,
    );

    const fixture2 = freezeFixture();
    writeFileSync(
      join(fixture2.repoRoot, 'package-lock.json'),
      JSON.stringify({ version: '1.8.2', packages: { '': { version: '1.8.0' } } }, null, 2),
      'utf8',
    );
    expect(() => checkFreeze(fixture2.repoRoot, fixture2.sequenceRoot, fixture2.freeze)).toThrow(
      /freeze-violation: package-lock.json versions/,
    );
  });

  it('altered archived plan bytes and a moved config fingerprint each violate', () => {
    const fixture = freezeFixture();
    writeFileSync(
      join(fixture.sequenceRoot, 'plan.archived.json'),
      PLAN_JSON.replace('freeze drill plan', 'edited plan'),
      'utf8',
    );
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: archived plan bytes/,
    );

    const fixture2 = freezeFixture();
    expect(() =>
      checkFreeze(fixture2.repoRoot, fixture2.sequenceRoot, {
        ...fixture2.freeze,
        configFingerprint: 'not-the-fingerprint',
      }),
    ).toThrow(/freeze-violation: nonsecret configuration fingerprint/);
  });

  it('a moved attempt profile violates', () => {
    const fixture = freezeFixture();
    expect(() =>
      checkFreeze(fixture.repoRoot, fixture.sequenceRoot, {
        ...fixture.freeze,
        thresholdProfileVersion: '9.9.9',
      }),
    ).toThrow(/freeze-violation: registered attempt profile/);
  });

  it('archived study drift, missing freeze record, and a CHANGED external study file each violate (§6.3)', () => {
    const fixture = freezeFixture({ withStudy: true });
    writeFileSync(join(fixture.sequenceRoot, 'study.archived.json'), '{"tampered":true}', 'utf8');
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: archived study bytes/,
    );

    const fixture2 = freezeFixture({ withStudy: true });
    rmSync(join(fixture2.sequenceRoot, 'study.freeze.archived.json'));
    expect(() => checkFreeze(fixture2.repoRoot, fixture2.sequenceRoot, fixture2.freeze)).toThrow(
      /freeze-violation: archived study freeze record missing/,
    );

    const fixture3 = freezeFixture({ withStudy: true });
    writeFileSync(fixture3.studyPath, '{"studyId":"freeze-study","frozen":false}', 'utf8');
    expect(() => checkFreeze(fixture3.repoRoot, fixture3.sequenceRoot, fixture3.freeze)).toThrow(
      /freeze-violation: registered study file changed/,
    );
  });

  it('every tampered study freeze-record FIELD violates with the field named (focused re-audit §7.1)', () => {
    const fieldTampers: Array<[string, string]> = [
      ['studyId', 'other-study'],
      ['studyVersion', '9.9.9'],
      ['planSha256', 'f'.repeat(64)],
      ['configFingerprint', 'fp-tampered'],
    ];
    for (const [field, tamperedValue] of fieldTampers) {
      const fixture = freezeFixture({ withStudy: true });
      const recordPath = join(fixture.sequenceRoot, 'study.freeze.archived.json');
      const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
      record[field] = tamperedValue;
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      expect(
        () => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze),
        field,
      ).toThrow(new RegExp(`freeze-violation: archived study freeze record ${field}`));
    }
  });

  it('a byte-level record change that preserves valid JSON and every field value still violates (§7.1)', () => {
    const fixture = freezeFixture({ withStudy: true });
    const recordPath = join(fixture.sequenceRoot, 'study.freeze.archived.json');
    // Reserialize compactly: same parsed fields, different bytes.
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');
    expect(() => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze)).toThrow(
      /freeze-violation: archived study freeze record bytes altered/,
    );
  });

  it('an unparseable or non-object study freeze record violates with a TYPED refusal', () => {
    // 'null' and '[]' parse as valid JSON but are not records — they must
    // be typed freeze violations, never an untyped TypeError (pre-push
    // adversarial round).
    for (const content of ['not-json {', 'null', '[]', '"a string"']) {
      const fixture = freezeFixture({ withStudy: true });
      writeFileSync(join(fixture.sequenceRoot, 'study.freeze.archived.json'), content, 'utf8');
      expect(
        () => checkFreeze(fixture.repoRoot, fixture.sequenceRoot, fixture.freeze),
        JSON.stringify(content),
      ).toThrow(/freeze-violation: archived study freeze record is not a parseable JSON object/);
    }
  });
});

interface PipelineHarness {
  deps: PostSequenceDeps;
  calls: string[];
  failures: Array<{ stage: string; message: string }>;
  completed: boolean;
}

function pipelineHarness(
  options: {
    violateAt?: string;
    withBatch?: boolean;
    batchExit?: string;
    provenanceError?: boolean;
  } = {},
): PipelineHarness {
  const calls: string[] = [];
  const failures: Array<{ stage: string; message: string }> = [];
  const harness: PipelineHarness = {
    calls,
    failures,
    completed: false,
    deps: {
      checkpoint: (name) => {
        calls.push(`checkpoint:${name}`);
        if (name === options.violateAt) {
          throw new Error(`freeze-violation: injected at ${name}`);
        }
      },
      runBatch: options.withBatch
        ? async () => {
            calls.push('batch');
            return options.batchExit ?? '0';
          }
        : null,
      evaluate: () => {
        calls.push('evaluate');
        return { sequenceId: 's', completedExecutions: [], comparisons: [], skippedPairs: [] };
      },
      assertProcessProvenance: () => {
        calls.push('provenance');
        if (options.provenanceError) throw new Error('process-provenance-incomplete: injected');
      },
      writeFinalEvidence: () => {
        calls.push('write-final-evidence');
      },
      markValidating: () => calls.push('validating'),
      markPackaging: () => calls.push('packaging'),
      packageArchive: async (beforeReceipt) => {
        calls.push('package');
        beforeReceipt();
        calls.push('receipt');
        return {
          zipPath: 'z.zip',
          zipSha256: 'f'.repeat(64),
          inventoryAggregateSha256: 'e'.repeat(64),
        };
      },
      markCompleted: () => {
        calls.push('completed');
        harness.completed = true;
      },
      fail: (stage, error) => {
        failures.push({
          stage,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    },
  };
  return harness;
}

describe('post-sequence pipeline checkpoints (re-audit finding 4 control flow)', () => {
  it('a clean pipeline passes every checkpoint in order and completes after the receipt', async () => {
    const harness = pipelineHarness({ withBatch: true });
    const result = await runPostSequencePipeline(harness.deps);
    expect(result.failed).toBe(false);
    expect(harness.completed).toBe(true);
    expect(harness.calls).toEqual([
      'checkpoint:pre-batch',
      'batch',
      'checkpoint:post-batch',
      'provenance',
      'validating',
      'checkpoint:pre-evaluation',
      'evaluate',
      'write-final-evidence',
      'checkpoint:post-evaluation',
      'packaging',
      'checkpoint:pre-package',
      'package',
      'checkpoint:post-package',
      'receipt',
      'completed',
    ]);
  });

  const driftMatrix: Array<[string, string]> = [
    ['pre-batch', 'freeze-violation:pre-batch'],
    ['post-batch', 'freeze-violation:post-batch'],
    ['pre-evaluation', 'freeze-violation:evaluation'],
    ['post-evaluation', 'freeze-violation:evaluation'],
    ['pre-package', 'freeze-violation:packaging'],
    ['post-package', 'freeze-violation:packaging'],
  ];

  for (const [checkpoint, failStage] of driftMatrix) {
    it(`drift at ${checkpoint} fails the sequence and never completes or receipts (§8)`, async () => {
      const harness = pipelineHarness({ withBatch: true, violateAt: checkpoint });
      const result = await runPostSequencePipeline(harness.deps);
      expect(result.failed).toBe(true);
      expect(result.zipPath).toBeNull();
      expect(harness.completed).toBe(false);
      expect(harness.failures).toHaveLength(1);
      expect(harness.failures[0]!.stage).toBe(failStage);
      expect(harness.failures[0]!.message).toContain('freeze-violation');
      // Drift before packaging must never reach the packaging step; drift
      // at the post-package checkpoint must never reach the receipt.
      if (checkpoint !== 'post-package') {
        expect(harness.calls).not.toContain('package');
      } else {
        expect(harness.calls).toContain('package');
        expect(harness.calls).not.toContain('receipt');
      }
    });
  }

  it('a failing batch fails the sequence before validation', async () => {
    const harness = pipelineHarness({ withBatch: true, batchExit: '1' });
    const result = await runPostSequencePipeline(harness.deps);
    expect(result.failed).toBe(true);
    expect(harness.failures[0]!.stage).toBe('post-sequence-batch');
    expect(harness.calls).not.toContain('validating');
  });

  it('incomplete process provenance fails an evidentiary sequence before any evidence writes (§13.1)', async () => {
    const harness = pipelineHarness({ provenanceError: true });
    const result = await runPostSequencePipeline(harness.deps);
    expect(result.failed).toBe(true);
    expect(harness.failures[0]!.stage).toBe('process-evidence-incomplete');
    expect(harness.calls).not.toContain('write-final-evidence');
  });
});

describe('the receipt is written only after the post-package freeze check (re-audit finding 7)', () => {
  it('a beforeReceipt failure leaves the archive committed but UNRECEIPTED', async () => {
    const base = mkdtempSync(join(tmpdir(), 'm2-receipt-gate-'));
    dirs.push(base);
    const root = join(base, 'root');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'evidence.txt'), 'bytes', 'utf8');
    const zipPath = join(base, 'gate-evidence-001.zip');
    await expect(
      packageSequence(
        root,
        zipPath,
        {
          sequenceId: 's',
          planSha256: 'a'.repeat(64),
          repositorySha: 'b'.repeat(40),
          studyPlanSha256: null,
        },
        {
          beforeReceipt: () => {
            throw new Error('freeze-violation: injected post-package');
          },
        },
      ),
    ).rejects.toThrow(/freeze-violation: injected post-package/);
    expect(readFileSync(zipPath).length).toBeGreaterThan(0);
    expect(() => readFileSync(`${zipPath}.receipt.json`)).toThrow();
    expect(() => readFileSync(`${zipPath}.sha256`)).toThrow();
  });
});
