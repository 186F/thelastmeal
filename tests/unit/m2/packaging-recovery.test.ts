import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { completedRun } from '../../helpers';
import { buildLedgerFile } from '../../../src/sim/runtime/ledgerFileBuilder';
import { ledgerFileName } from '../../../src/shared/ledgerFile';
import { validateLedgerFile } from '../../../src/sim/replay/validateLedger';
import { buildBehaviorFingerprints } from '../../../src/sim/evaluation/behaviorFingerprint';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
  MODEL_UPSTREAM_PLATFORM,
} from '../../../src/shared/modelExperiment';
import {
  orchestrateSequence,
  planConfigFingerprint,
  type OrchestrateOptions,
} from '../../../scripts/experiments/m2/orchestrate';
import { parsePlan } from '../../../scripts/experiments/m2/planSchema';
import {
  readInventory,
  verifyTreeAgainstInventory,
  type PackagingStage,
} from '../../../scripts/experiments/m2/packageEvidence';
import {
  SEQUENCE_STATE_VERSION,
  readSequenceState,
  sealExecution,
  stateFilePath,
  writeSequenceState,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';
import { verifyCompletedSequence } from '../../../scripts/experiments/m2/sequenceVerification';
import { portIsFree } from '../../../scripts/experiments/m2/gatewayDriver';
import {
  AUTOMATION_GATEWAY_PORT,
  AUTOMATION_VITE_PORT,
} from '../../../scripts/experiments/m2/viteDriver';

/**
 * Packaging-ready recovery (focused re-audit finding 3, §6): a failure in
 * ANY packaging stage after the inventory exists must leave a recoverable
 * sequence. Every drill runs BOTH legs through the REAL
 * `orchestrateSequence` entry point: the failing leg resumes an
 * attempts-complete sequence through the ordinary pipeline (real
 * evaluation, real reports, real inventory, real failure recording by
 * `recordSequenceFailure` — including the freeze-violation branch) and the
 * recovery leg proves the packaging-only path launches no Vite, Chromium,
 * or gateway process, changes no inventoried evidence byte, handles prior
 * staged/unreceipted material explicitly, authenticates the inventory
 * against the control-recorded aggregate, produces the next versioned
 * receipt-verified archive, and writes `completed` only after
 * verification.
 */

const REPO_ROOT = process.cwd();
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
}).trim();
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;
const LEDGER_JSON = JSON.stringify(buildLedgerFile(completedRun('A')));

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitForAutomationPortsFree(): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await portIsFree(AUTOMATION_VITE_PORT)) && (await portIsFree(AUTOMATION_GATEWAY_PORT))) {
      return;
    }
    if (Date.now() > deadline) throw new Error('automation-ports-not-released');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

interface RecoveryFixture {
  base: string;
  root: string;
  planPath: string;
  processLogPath: string;
  viteLogPath: string;
}

/** A real completed-attempts sequence bound to the ACTUAL repository
 * identity, so the genuine `orchestrateSequence --resume` gates all pass. */
function attemptsCompleteFixture(): RecoveryFixture {
  const base = mkdtempSync(join(tmpdir(), 'm2-pkg-recovery-'));
  dirs.push(base);
  const root = join(base, 'sequence');
  const attemptDir = join(root, 'attempt-a-rec-e1');
  mkdirSync(attemptDir, { recursive: true });

  writeFileSync(join(attemptDir, ledgerFileName('A', '1.0.0', 1001)), LEDGER_JSON, 'utf8');
  const validated = validateLedgerFile(LEDGER_JSON);
  if (!validated.ok || !validated.file) throw new Error('fixture ledger invalid');
  writeFileSync(
    join(attemptDir, 'behavior-fingerprint.json'),
    canonicalSerialize(buildBehaviorFingerprints(validated.file)),
    'utf8',
  );

  const planPath = join(base, 'plan.json');
  const planJson = JSON.stringify(
    {
      planSchemaVersion: 'm2-orchestrator-plan-1.1.0',
      sequenceId: 'packaging-recovery-fixture',
      description: 'packaging-recovery drill fixture',
      evidentiary: false,
      outputRoot: root,
      attempts: [
        {
          attemptId: 'a-rec',
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
        runTimeoutMs: 60_000,
        stallTimeoutMs: 60_000,
        stallGraceMs: 5_000,
        heartbeatIntervalMs: 5_000,
      },
      postSequenceBatch: false,
    },
    null,
    2,
  );
  writeFileSync(planPath, planJson, 'utf8');
  writeFileSync(join(root, 'plan.archived.json'), planJson, 'utf8');
  const loaded = parsePlan(Buffer.from(planJson));

  const processLogPath = join(root, 'process-log.jsonl');
  const viteLogPath = join(root, 'vite.log');

  const state: SequenceState = {
    stateVersion: SEQUENCE_STATE_VERSION,
    sequenceId: 'packaging-recovery-fixture',
    planSha256: loaded.planSha256,
    repositorySha: HEAD,
    packageVersion: PACKAGE_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    promptVersion: MODEL_PROMPT_VERSION,
    externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
    upstreamPlatform: MODEL_UPSTREAM_PLATFORM,
    expectedModelId: 'none',
    expectedServingProviderId: 'none',
    studyId: 'none',
    studyVersion: 'none',
    studyPlanSha256: 'none',
    thresholdProfileId: 'm2-rehearsal-attempt-profile',
    thresholdProfileVersion: '1.0.0',
    registrationId: 'none',
    registrationProvenanceSha256: 'none',
    stageAPrerequisiteSha256: 'none',
    configFingerprint: planConfigFingerprint(loaded.plan),
    status: 'attempts-complete',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    inventoryAggregateSha256: null,
    supersededArchives: [],
    freezeCheckpoints: [],
    executions: [
      {
        executionId: 'a-rec-e1',
        attemptId: 'a-rec',
        status: 'completed',
        seal: null,
        failureReason: null,
        failureStage: null,
        artifactStatus: 'artifact-valid',
        studyStatus: 'study-valid',
        replacementDisposition: null,
        thresholdVerdicts: [],
        runId: null,
        dir: 'attempt-a-rec-e1',
        artifacts: ['attempt-a-rec-e1/behavior-fingerprint.json'],
        verdicts: { 'replay-match': true },
        navigationCount: 1,
        browserProvenance: null,
        startedAtUtc: '2026-07-31T00:00:00.000Z',
        endedAtUtc: '2026-07-31T00:01:00.000Z',
      },
    ],
    lastTransition: 'attempts-complete',
    createdAtUtc: '2026-07-31T00:00:00.000Z',
    updatedAtUtc: '2026-07-31T00:01:00.000Z',
  };
  state.executions[0]!.seal = sealExecution(root, 'attempt-a-rec-e1', 'completed');
  writeSequenceState(root, state);
  return { base, root, planPath, processLogPath, viteLogPath };
}

function resume(planPath: string, onPackagingStage?: OrchestrateOptions['onPackagingStage']) {
  return orchestrateSequence({
    planPath,
    resume: true,
    acknowledgeLiveCost: false,
    allowSleepRisk: true,
    headed: false,
    repoRoot: REPO_ROOT,
    onPackagingStage,
  });
}

interface DrillPoint {
  key: string;
  /** Whether the injected failure leaves a COMMITTED (renamed) but
   * unreceipted first archive behind. */
  committed: boolean;
  /** The failure the REAL pipeline's recordSequenceFailure must record. */
  reasonPattern: RegExp;
  onPackagingStage: (stage: PackagingStage) => void;
}

function throwAt(point: PackagingStage): (stage: PackagingStage) => void {
  return (stage) => {
    if (stage === point) throw new Error(`injected-${point}-failure`);
  };
}

/** All seven §6.4 injection points, driven through the REAL orchestrator:
 * six by failing the named packaging stage, and the post-package freeze
 * check by a freeze-violation raised at the first post-checkpoint stage —
 * exercising the pipeline's freeze-violation:packaging failure branch. */
const POINTS: DrillPoint[] = [
  {
    key: 'zip',
    committed: false,
    reasonPattern: /^packaging: injected-zip/,
    onPackagingStage: throwAt('zip'),
  },
  {
    key: 'size',
    committed: false,
    reasonPattern: /^packaging: injected-size/,
    onPackagingStage: throwAt('size'),
  },
  {
    key: 'extraction',
    committed: false,
    reasonPattern: /^packaging: injected-extraction/,
    onPackagingStage: throwAt('extraction'),
  },
  {
    key: 'commit',
    committed: false,
    reasonPattern: /^packaging: injected-commit/,
    onPackagingStage: throwAt('commit'),
  },
  {
    key: 'post-package-freeze',
    committed: true,
    reasonPattern: /^freeze-violation:packaging: freeze-violation: injected/,
    onPackagingStage: (stage) => {
      // The post-package freeze checkpoint (beforeReceipt) has passed by
      // 'sidecar'; a freeze-violation surfacing here routes through the
      // pipeline's freeze-violation:packaging branch.
      if (stage === 'sidecar') throw new Error('freeze-violation: injected post-package drift');
    },
  },
  {
    key: 'sidecar',
    committed: true,
    reasonPattern: /^packaging: injected-sidecar/,
    onPackagingStage: throwAt('sidecar'),
  },
  {
    key: 'receipt',
    committed: true,
    reasonPattern: /^packaging: injected-receipt/,
    onPackagingStage: throwAt('receipt'),
  },
];

/** Strands a fixture at the given point THROUGH the real orchestrator: the
 * ordinary resume runs the genuine pipeline (evaluation, reports,
 * manifest, inventory) and the genuine failure recording. */
async function strandThroughOrchestrator(point: DrillPoint): Promise<RecoveryFixture> {
  const fixture = attemptsCompleteFixture();
  await waitForAutomationPortsFree();
  const failing = await resume(fixture.planPath, point.onPackagingStage);
  expect(failing.status, point.key).toBe('failed');
  expect(failing.packagingRecovery, point.key).toBe(false);
  const stranded = readSequenceState(fixture.root)!;
  expect(stranded.status, point.key).toBe('failed');
  expect(stranded.sequenceFailureReason, point.key).toMatch(point.reasonPattern);
  // The inventory exists AND its aggregate was recorded in control state
  // BEFORE the file was written (adversarial round): the stranded shape is
  // authenticatable.
  const inventory = readInventory(fixture.root);
  expect(inventory, point.key).not.toBeNull();
  expect(stranded.inventoryAggregateSha256, point.key).toBe(inventory!.aggregateSha256);
  return fixture;
}

describe('every late packaging failure recovers through the packaging-only resume (§6.4)', () => {
  for (const point of POINTS) {
    it(
      `a failure at '${point.key}' recorded by the REAL pipeline is recoverable without process launches or evidence mutation`,
      { timeout: 300_000 },
      async () => {
        const fixture = await strandThroughOrchestrator(point);
        const { root, base } = fixture;
        const inventory = readInventory(root)!;
        const processLogBefore = readFileSync(fixture.processLogPath, 'utf8');
        const viteLogBefore = readFileSync(fixture.viteLogPath, 'utf8');
        const firstArchive = join(base, 'packaging-recovery-fixture-evidence-001.zip');
        expect(existsSync(firstArchive)).toBe(point.committed);
        expect(existsSync(`${firstArchive}.receipt.json`)).toBe(false);
        const firstArchiveSha = point.committed ? sha256(readFileSync(firstArchive)) : null;

        const recovered = await resume(fixture.planPath);
        expect(recovered.packagingRecovery).toBe(true);
        expect(recovered.status).toBe('completed');
        expect(recovered.noOpResume).toBe(false);

        // No Vite, Chromium, or gateway: the packaging-only path never
        // constructs a process manager, and the inventoried logs prove it.
        expect(readFileSync(fixture.processLogPath, 'utf8')).toBe(processLogBefore);
        expect(readFileSync(fixture.viteLogPath, 'utf8')).toBe(viteLogBefore);
        // No inventoried byte changed.
        verifyTreeAgainstInventory(root, inventory, `post-recovery-${point.key}`);

        const state = readSequenceState(root)!;
        expect(state.status).toBe('completed');
        const expectedArchive = point.committed
          ? 'packaging-recovery-fixture-evidence-002.zip'
          : 'packaging-recovery-fixture-evidence-001.zip';
        expect(basename(state.archivePath!)).toBe(expectedArchive);
        expect(existsSync(state.archivePath!)).toBe(true);
        expect(existsSync(`${state.archivePath!}.sha256`)).toBe(true);
        expect(existsSync(`${state.archivePath!}.receipt.json`)).toBe(true);
        if (point.committed) {
          // The unreceipted first archive is preserved byte-for-byte and
          // recorded as superseded — never deleted.
          expect(sha256(readFileSync(firstArchive))).toBe(firstArchiveSha);
          expect(state.supersededArchives).toEqual([
            expect.objectContaining({
              archive: 'packaging-recovery-fixture-evidence-001.zip',
              reason: 'unreceipted-before-recovery',
            }),
          ]);
        } else {
          expect(state.supersededArchives).toEqual([]);
        }
        // The recovered sequence verifies whole and no-op resumes.
        await expect(
          verifyCompletedSequence(root, state, parsePlan(readFileSync(fixture.planPath)).plan),
        ).resolves.toBeUndefined();
        const noop = await resume(fixture.planPath);
        expect(noop.noOpResume).toBe(true);
      },
    );
  }

  it(
    'recovery removes crash-leftover STAGED archives but never a committed one',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'commit')!);
      const staleStaged = join(
        fixture.base,
        '.packaging-recovery-fixture-evidence-001.zip.9999-123456.tmp',
      );
      writeFileSync(staleStaged, 'crash leftover bytes', 'utf8');
      const recovered = await resume(fixture.planPath);
      expect(recovered.status).toBe('completed');
      expect(existsSync(staleStaged)).toBe(false);
    },
  );

  it(
    'a tampered inventoried byte REFUSES recovery and the sequence never completes',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      appendFileSync(fixture.viteLogPath, 'tamper after inventory\n');
      await expect(resume(fixture.planPath)).rejects.toThrow(
        /inventory-byte-mismatch|inventory-tree-mismatch/,
      );
      expect(readSequenceState(fixture.root)!.status).not.toBe('completed');
    },
  );

  it(
    'a REWRITTEN inventory matching a mutated root cannot self-certify: the control-recorded aggregate refuses',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      // The attack from the adversarial round: mutate an inventoried log
      // AND regenerate the inventory file so the tree matches it again.
      appendFileSync(fixture.viteLogPath, 'covered tamper\n');
      const inventoryPath = join(fixture.root, 'sha256-inventory.json');
      const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
        files: { name: string; sha256: string }[];
        aggregateSha256: string;
      };
      const viteEntry = inventory.files.find((file) => file.name === 'vite.log')!;
      viteEntry.sha256 = sha256(readFileSync(fixture.viteLogPath));
      inventory.aggregateSha256 = sha256(
        inventory.files.map((file) => `${file.name}:${file.sha256}`).join('\n'),
      );
      writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
      await expect(resume(fixture.planPath)).rejects.toThrow(
        /packaging-recovery-blocked: the recorded inventory aggregate disagrees/,
      );
      expect(readSequenceState(fixture.root)!.status).not.toBe('completed');
    },
  );

  it(
    'a PLANTED inventory with no control-recorded aggregate is refused outright',
    { timeout: 300_000 },
    async () => {
      const fixture = attemptsCompleteFixture();
      // Fabricate a fully VALIDATOR-PASSING inventory over the current tree
      // (canonical order, recomputing aggregate) and a packaging-failure
      // state that never recorded an aggregate — only the control-state
      // authentication gate can refuse it.
      const names = ['attempt-a-rec-e1/behavior-fingerprint.json', 'plan.archived.json'].sort();
      const files = names.map((name) => ({
        name,
        sha256: sha256(readFileSync(join(fixture.root, name))),
      }));
      writeFileSync(
        join(fixture.root, 'sha256-inventory.json'),
        `${JSON.stringify(
          {
            files,
            aggregateSha256: sha256(files.map((file) => `${file.name}:${file.sha256}`).join('\n')),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const state = readSequenceState(fixture.root)!;
      state.status = 'failed';
      state.sequenceFailureReason = 'packaging: fabricated strand';
      writeSequenceState(fixture.root, state);
      await expect(resume(fixture.planPath)).rejects.toThrow(
        /packaging-recovery-blocked: no inventory aggregate is recorded/,
      );
      expect(readSequenceState(fixture.root)!.status).not.toBe('completed');
    },
  );

  it(
    'a control-state edit that diverges from the immutable manifest REFUSES recovery (finding 4)',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      const state = readSequenceState(fixture.root)!;
      state.executions[0]!.navigationCount = 7;
      writeSequenceState(fixture.root, state);
      await expect(resume(fixture.planPath)).rejects.toThrow(/completed-manifest-state-divergence/);
      expect(readSequenceState(fixture.root)!.status).not.toBe('completed');
    },
  );

  it(
    'an entry-hash rewrite with an UNCHANGED aggregate refuses recovery before any archive or state mutation (final audit §4.4)',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      // The §4.2 bypass: mutate an inventoried log, cover it by rewriting
      // ONLY that entry's hash, and leave aggregateSha256 unchanged — the
      // control-state aggregate comparison alone would still pass.
      appendFileSync(fixture.viteLogPath, 'covered tamper\n');
      const inventoryPath = join(fixture.root, 'sha256-inventory.json');
      const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
        files: { name: string; sha256: string }[];
        aggregateSha256: string;
      };
      inventory.files.find((file) => file.name === 'vite.log')!.sha256 = sha256(
        readFileSync(fixture.viteLogPath),
      );
      writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
      const stateBefore = readFileSync(stateFilePath(fixture.root), 'utf8');
      await expect(resume(fixture.planPath)).rejects.toThrow(
        /inventory-invalid.*aggregateSha256 does not recompute/,
      );
      // Refused BEFORE archive creation or any recovery-state mutation.
      expect(readFileSync(stateFilePath(fixture.root), 'utf8')).toBe(stateBefore);
      expect(existsSync(join(fixture.base, 'packaging-recovery-fixture-evidence-002.zip'))).toBe(
        false,
      );
      expect(readSequenceState(fixture.root)!.status).toBe('failed');
    },
  );

  it(
    'a competing invocation that completes first turns the delayed one into a verified NO-OP (final audit §5.4)',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      let competitor: Awaited<ReturnType<typeof resume>> | null = null;
      let stateAfterCompetitor: string | null = null;
      // Invocation B passes the recovery dispatch on the FAILED state, then
      // — before acquiring the writer lock — invocation A runs the complete
      // recovery. B must re-read under the lock and become a verified no-op.
      const delayed = await orchestrateSequence({
        planPath: fixture.planPath,
        resume: true,
        acknowledgeLiveCost: false,
        allowSleepRisk: true,
        headed: false,
        repoRoot: REPO_ROOT,
        onBeforeRecoveryLock: async () => {
          competitor = await resume(fixture.planPath);
          stateAfterCompetitor = readFileSync(stateFilePath(fixture.root), 'utf8');
        },
      });
      expect(competitor!.packagingRecovery).toBe(true);
      expect(competitor!.status).toBe('completed');
      expect(delayed.status).toBe('completed');
      expect(delayed.noOpResume).toBe(true);
      expect(delayed.packagingRecovery).toBe(false);
      // No additional archive was created and nothing was overwritten from
      // the delayed invocation's stale pre-lock view: checkpoints,
      // supersededArchives, archive identity, and timestamps are untouched.
      expect(existsSync(join(fixture.base, 'packaging-recovery-fixture-evidence-003.zip'))).toBe(
        false,
      );
      expect(readFileSync(stateFilePath(fixture.root), 'utf8')).toBe(stateAfterCompetitor);
    },
  );

  it(
    'an INVENTORY mutation made while WAITING for the lock is observed by the post-lock re-read and refused (§5.4)',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      const stateBefore = readFileSync(stateFilePath(fixture.root), 'utf8');
      // The pre-lock dispatch read sees the VALID inventory; only the
      // post-lock RE-READ can observe this seam-time entry rewrite. The
      // refusal must be a REJECTION before any recovery-state write — a
      // stale pre-lock inventory object would instead reach the packaging
      // transaction and mutate control state first.
      await expect(
        orchestrateSequence({
          planPath: fixture.planPath,
          resume: true,
          acknowledgeLiveCost: false,
          allowSleepRisk: true,
          headed: false,
          repoRoot: REPO_ROOT,
          onBeforeRecoveryLock: () => {
            const inventoryPath = join(fixture.root, 'sha256-inventory.json');
            const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
              files: { name: string; sha256: string }[];
              aggregateSha256: string;
            };
            inventory.files.find((file) => file.name === 'vite.log')!.sha256 = 'f'.repeat(64);
            writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
          },
        }),
      ).rejects.toThrow(/inventory-invalid.*aggregateSha256 does not recompute/);
      expect(readFileSync(stateFilePath(fixture.root), 'utf8')).toBe(stateBefore);
      expect(readSequenceState(fixture.root)!.status).toBe('failed');
      expect(existsSync(join(fixture.base, 'packaging-recovery-fixture-evidence-002.zip'))).toBe(
        false,
      );
    },
  );

  it(
    'a state mutation made while WAITING for the lock is observed and refused after acquisition (§5.4)',
    { timeout: 300_000 },
    async () => {
      const fixture = await strandThroughOrchestrator(POINTS.find((p) => p.key === 'receipt')!);
      await expect(
        orchestrateSequence({
          planPath: fixture.planPath,
          resume: true,
          acknowledgeLiveCost: false,
          allowSleepRisk: true,
          headed: false,
          repoRoot: REPO_ROOT,
          onBeforeRecoveryLock: () => {
            // The dispatch prechecks passed on the untampered state; only
            // the post-lock RE-READ can observe this edit.
            const state = readSequenceState(fixture.root)!;
            state.executions[0]!.navigationCount = 9;
            writeSequenceState(fixture.root, state);
          },
        }),
      ).rejects.toThrow(/completed-manifest-state-divergence/);
      expect(readSequenceState(fixture.root)!.status).not.toBe('completed');
    },
  );
});
