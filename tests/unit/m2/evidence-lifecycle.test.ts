import { afterAll, describe, expect, it } from 'vitest';
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
  SEQUENCE_STATE_VERSION,
  readSequenceState,
  sealExecution,
  writeSequenceState,
  type SequenceState,
} from '../../../scripts/experiments/m2/sequenceState';
import {
  packageSequence,
  readInventory,
  verifyTreeAgainstInventory,
} from '../../../scripts/experiments/m2/packageEvidence';
import { writeSequenceManifest } from '../../../scripts/experiments/m2/reporting';
import {
  revalidateCompletedExecutions,
  verifyCompletedSequence,
} from '../../../scripts/experiments/m2/sequenceVerification';
import {
  orchestratorPlanSchema,
  type OrchestratorPlan,
} from '../../../scripts/experiments/m2/planSchema';
import { runCli } from '../../../scripts/experiments/m2/cli';

/**
 * Final evidence lifecycle (re-audit findings 1 and 5, §5.5/§9): a REAL
 * completed deterministic sequence fixture — valid canonical ledger,
 * recomputable fingerprint, terminal seal, final evidence manifest,
 * inventory, versioned archive, sidecar, and receipt — is verified whole,
 * then each element is tampered with in turn and must produce a typed
 * refusal. Derived commands never mutate the completed root.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  state: SequenceState;
  plan: OrchestratorPlan;
  zipPath: string;
  attemptDir: string;
  fingerprintPath: string;
  ledgerPath: string;
}

async function completedSequenceFixture(): Promise<Fixture> {
  const base = mkdtempSync(join(tmpdir(), 'm2-lifecycle-'));
  dirs.push(base);
  const root = join(base, 'sequence');
  const attemptDir = join(root, 'attempt-a-det-e1');
  mkdirSync(attemptDir, { recursive: true });

  const run = completedRun('A');
  const ledgerJson = JSON.stringify(buildLedgerFile(run));
  const ledgerPath = join(attemptDir, ledgerFileName('A', '1.0.0', 1001));
  writeFileSync(ledgerPath, ledgerJson, 'utf8');
  const validated = validateLedgerFile(ledgerJson);
  if (!validated.ok || !validated.file) throw new Error('fixture ledger invalid');
  const fingerprintPath = join(attemptDir, 'behavior-fingerprint.json');
  writeFileSync(
    fingerprintPath,
    canonicalSerialize(buildBehaviorFingerprints(validated.file)),
    'utf8',
  );

  const plan = orchestratorPlanSchema.parse({
    planSchemaVersion: 'm2-orchestrator-plan-1.1.0',
    sequenceId: 'lifecycle-fixture',
    description: 'completed-sequence lifecycle fixture',
    evidentiary: false,
    outputRoot: root,
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
      runTimeoutMs: 60_000,
      stallTimeoutMs: 60_000,
      stallGraceMs: 5_000,
      heartbeatIntervalMs: 5_000,
    },
    postSequenceBatch: false,
  });

  const state: SequenceState = {
    stateVersion: SEQUENCE_STATE_VERSION,
    sequenceId: 'lifecycle-fixture',
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
    registrationId: 'none',
    registrationProvenanceSha256: 'none',
    stageAPrerequisiteSha256: 'none',
    configFingerprint: 'c'.repeat(16),
    status: 'packaging',
    sequenceFailureReason: null,
    archivePath: null,
    archiveSha256: null,
    inventoryAggregateSha256: null,
    supersededArchives: [],
    freezeCheckpoints: [{ checkpoint: 'pre-package', atUtc: '2026-07-30T00:00:00.000Z' }],
    executions: [
      {
        executionId: 'a-det-e1',
        attemptId: 'a-det',
        status: 'completed',
        seal: null,
        failureReason: null,
        failureStage: null,
        artifactStatus: 'artifact-valid',
        studyStatus: 'study-valid',
        replacementDisposition: null,
        thresholdVerdicts: [],
        runId: null,
        dir: 'attempt-a-det-e1',
        artifacts: ['attempt-a-det-e1/behavior-fingerprint.json'],
        verdicts: { 'replay-match': true },
        navigationCount: 1,
        browserProvenance: null,
        startedAtUtc: '2026-07-30T00:00:00.000Z',
        endedAtUtc: '2026-07-30T00:01:00.000Z',
      },
    ],
    lastTransition: 'packaging',
    createdAtUtc: '2026-07-30T00:00:00.000Z',
    updatedAtUtc: '2026-07-30T00:01:00.000Z',
  };
  state.executions[0]!.seal = sealExecution(root, 'attempt-a-det-e1', 'completed');

  writeSequenceManifest(root, state, {
    sequenceOutcome: 'evidence-finalized',
    attemptSetComplete: true,
    batchVerdict: null,
    evaluation: null,
    processLogHealth: null,
    browserVersion: 'chromium-test',
    launchFlags: ['headless'],
    processLog: [],
    finalizedAtUtc: '2026-07-30T00:01:00.000Z',
  });

  const zipPath = join(base, 'lifecycle-fixture-evidence-001.zip');
  const packaged = await packageSequence(root, zipPath, {
    sequenceId: 'lifecycle-fixture',
    planSha256: state.planSha256,
    repositorySha: state.repositorySha,
    studyPlanSha256: null,
  });
  state.archivePath = packaged.zipPath;
  state.archiveSha256 = packaged.zipSha256;
  state.inventoryAggregateSha256 = packaged.inventoryAggregateSha256;
  state.status = 'completed';
  writeSequenceState(root, state);
  return { root, state, plan, zipPath, attemptDir, fingerprintPath, ledgerPath };
}

describe('completed-sequence verification (re-audit §5.3/§5.5)', () => {
  it('an intact completed sequence verifies whole: seals, inventory, manifest, semantics, archive, receipt', async () => {
    const fixture = await completedSequenceFixture();
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).resolves.toBeUndefined();
    // The archive carries the final evidence manifest, never the mutable
    // operational state (finding 1).
    const inventory = readInventory(fixture.root)!;
    const names = inventory.files.map((file) => file.name);
    expect(names).toContain('sequence-manifest.json');
    expect(names).not.toContain('sequence-state.json');
  });

  it('deleting or modifying the archive refuses', async () => {
    const fixture = await completedSequenceFixture();
    appendFileSync(fixture.zipPath, 'x');
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/completed-resume-verification-failed: archive sha/);

    const fixture2 = await completedSequenceFixture();
    rmSync(fixture2.zipPath);
    await expect(
      verifyCompletedSequence(fixture2.root, fixture2.state, fixture2.plan),
    ).rejects.toThrow(/completed-resume-verification-failed: archive missing/);
  });

  it('deleting or modifying the sidecar or receipt refuses', async () => {
    const fixture = await completedSequenceFixture();
    rmSync(`${fixture.zipPath}.sha256`);
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/sha256 sidecar/);

    const fixture2 = await completedSequenceFixture();
    rmSync(`${fixture2.zipPath}.receipt.json`);
    await expect(
      verifyCompletedSequence(fixture2.root, fixture2.state, fixture2.plan),
    ).rejects.toThrow(/receipt missing/);
  });

  it('a receipt whose identity fields disagree refuses (§5.5)', async () => {
    const fixture = await completedSequenceFixture();
    const receiptPath = `${fixture.zipPath}.receipt.json`;
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
    receipt.planSha256 = 'd'.repeat(64);
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/receipt planSha256/);
  });

  it('any post-completion change to a NON-attempt evidence file refuses via the inventory (§9.3)', async () => {
    const fixture = await completedSequenceFixture();
    const manifestPath = join(fixture.root, 'sequence-manifest.json');
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}\n`, 'utf8');
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/inventory-byte-mismatch|inventory-tree-mismatch/);
  });

  it('attempt-evidence tampering refuses via the terminal seal', async () => {
    const fixture = await completedSequenceFixture();
    writeFileSync(join(fixture.attemptDir, 'planted.txt'), 'x', 'utf8');
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/resume-evidence-invalid/);
  });

  it('a control-state edit diverging from the immutable manifest refuses (focused re-audit §7.2)', async () => {
    // An execution added to control state alone: the archive and evidence
    // root are untouched, seals still verify — only reconciliation against
    // the AUTHORITATIVE manifest can notice.
    const fixture = await completedSequenceFixture();
    fixture.state.executions.push({
      ...fixture.state.executions[0]!,
      executionId: 'a-det-e0',
      status: 'failed',
      failureReason: 'run-timeout',
      // A VALID empty-set seal for the never-created directory, so seal
      // verification passes and only manifest reconciliation can refuse.
      seal: sealExecution(fixture.root, 'attempt-a-det-e0', 'failed'),
      dir: 'attempt-a-det-e0',
    });
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/completed-manifest-state-divergence/);

    // An edited per-execution field with a matching re-computed seal: same
    // authority argument, caught by field-level reconciliation.
    const fixture2 = await completedSequenceFixture();
    fixture2.state.executions[0]!.navigationCount = 9;
    await expect(
      verifyCompletedSequence(fixture2.root, fixture2.state, fixture2.plan),
    ).rejects.toThrow(/completed-manifest-state-divergence.*navigationCount/);
  });
});

describe('semantic revalidation (re-audit §9.2)', () => {
  it('seal-valid but semantically stale evidence refuses: fingerprint recomputation differs', async () => {
    const fixture = await completedSequenceFixture();
    // Simulate a re-sealed tamper: alter the derived fingerprint AND
    // recompute the seal, so only the semantic validators can notice.
    appendFileSync(fixture.fingerprintPath, ' ');
    fixture.state.executions[0]!.seal = sealExecution(
      fixture.root,
      'attempt-a-det-e1',
      'completed',
    );
    expect(() => revalidateCompletedExecutions(fixture.root, fixture.state, fixture.plan)).toThrow(
      /resume-semantic-invalid.*fingerprint recomputation differs/,
    );
  });

  it('a completed ledger that no longer validates under the installed contract refuses', async () => {
    const fixture = await completedSequenceFixture();
    writeFileSync(fixture.ledgerPath, '{"not":"a ledger"}', 'utf8');
    fixture.state.executions[0]!.seal = sealExecution(
      fixture.root,
      'attempt-a-det-e1',
      'completed',
    );
    expect(() => revalidateCompletedExecutions(fixture.root, fixture.state, fixture.plan)).toThrow(
      /resume-semantic-invalid/,
    );
  });
});

describe('derived commands never mutate the completed root (re-audit §9.4/§5.5)', () => {
  it('m2:evaluate writes ONLY to the derived directory', async () => {
    const fixture = await completedSequenceFixture();
    const inventory = readInventory(fixture.root)!;
    const exit = await runCli(['evaluate', '--sequence', fixture.root]);
    expect(exit).toBe(0);
    verifyTreeAgainstInventory(fixture.root, inventory, 'post-derived-evaluate');
    expect(existsSync(`${fixture.root}.derived`)).toBe(true);
  });

  it('m2:package verifies immutability, writes the NEXT versioned archive, and points state at it', async () => {
    const fixture = await completedSequenceFixture();
    const inventory = readInventory(fixture.root)!;
    const exit = await runCli(['package', '--sequence', fixture.root]);
    expect(exit).toBe(0);
    const updated = readSequenceState(fixture.root)!;
    expect(basename(updated.archivePath!)).toBe('lifecycle-fixture-evidence-002.zip');
    expect(existsSync(fixture.zipPath)).toBe(true); // the prior archive survives
    expect(existsSync(updated.archivePath!)).toBe(true);
    expect(existsSync(`${updated.archivePath!}.receipt.json`)).toBe(true);
    verifyTreeAgainstInventory(fixture.root, inventory, 'post-repackage');
    // The refreshed state still verifies whole against the NEW archive.
    await expect(
      verifyCompletedSequence(fixture.root, updated, fixture.plan),
    ).resolves.toBeUndefined();
  });

  it('m2:package refuses a mutated completed root outright', async () => {
    const fixture = await completedSequenceFixture();
    writeFileSync(join(fixture.root, 'planted.md'), 'mutation', 'utf8');
    await expect(runCli(['package', '--sequence', fixture.root])).rejects.toThrow(
      /inventory-tree-mismatch/,
    );
  });

  it('an aggregate-preserving inventory entry rewrite refuses completed resume AND standalone packaging alike (final audit §4.4)', async () => {
    // The §4.2 bypass on the COMPLETED paths: mutate an inventoried
    // non-attempt file, rewrite only its entry hash, keep the aggregate.
    // The recomputed aggregate stops matching, so every consumer that
    // reads the inventory refuses consistently.
    const fixture = await completedSequenceFixture();
    const manifestPath = join(fixture.root, 'sequence-manifest.json');
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')} `, 'utf8');
    const inventoryPath = join(fixture.root, 'sha256-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
      files: { name: string; sha256: string }[];
      aggregateSha256: string;
    };
    const entry = inventory.files.find((file) => file.name === 'sequence-manifest.json')!;
    entry.sha256 = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    await expect(
      verifyCompletedSequence(fixture.root, fixture.state, fixture.plan),
    ).rejects.toThrow(/inventory-invalid.*aggregateSha256 does not recompute/);
    await expect(runCli(['package', '--sequence', fixture.root])).rejects.toThrow(
      /inventory-invalid.*aggregateSha256 does not recompute/,
    );
  });

  it('m2:package refuses control state that diverges from the immutable manifest (pre-push adversarial round)', async () => {
    // An edited identity in control state changes no inventoried byte and
    // no seal — only reconciliation against the ARCHIVED manifest refuses,
    // and the receipt identity is minted from the manifest, never from
    // control state.
    const fixture = await completedSequenceFixture();
    const tampered = readSequenceState(fixture.root)!;
    tampered.repositorySha = 'd'.repeat(40);
    writeSequenceState(fixture.root, tampered);
    await expect(runCli(['package', '--sequence', fixture.root])).rejects.toThrow(
      /completed-manifest-state-divergence.*repositorySha/,
    );
  });
});
