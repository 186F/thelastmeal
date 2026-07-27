import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareRunDirectory } from '../../scripts/model/prepareRun';
import { finalizeRunDirectory } from '../../scripts/model/finalize';
import { ledgerFileSchema, type LedgerFile } from '../../src/shared/ledgerFile';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
  MODEL_PROMPT_VERSION,
} from '../../src/shared/modelExperiment';
import { exportedFile, reseal, resealTopLevelHashesOnly } from '../ledgerCorruption';

/**
 * §5.4 corruption matrix (1.5.0 V1/V6): semantically-corrupt-but-schema-valid
 * ledgers must be rejected by BOTH model:prepare-run and model:finalize with
 * ZERO destination writes — schema parsing alone was the 1.4.0 hole (both
 * CLIs used ledgerFileSchema.parse only, and a resealed forgery staged and
 * finalized as status 'completed').
 *
 * The corrupt constructions are the SAME ones tests/unit/ledger-import.test.ts
 * proves against validateLedgerFile directly (shared via
 * tests/ledgerCorruption.ts). Causation tampering uses the DANGLING form —
 * a causationId re-pointed at a different *real* event is only caught where
 * a lifecycle join depends on it, so the dangling form is the reliable
 * generic probe.
 */

const RUN_ID = 'run-corrupt-0001';
const DERIVED_FILES = [
  'finalized-trace.jsonl',
  'run-manifest.final.json',
  'model-summary.json',
  'bundle-manifest.json',
] as const;

interface CorruptionCase {
  name: string;
  /** Human label of the validator error family expected (documentation only —
   * the assertions match the CLI error message, not an exhaustive code set:
   * the validator short-circuits between stages). */
  build: () => string;
}

let cases: CorruptionCase[];

beforeAll(() => {
  cases = [
    {
      name: 'dangling causationId',
      build: () => {
        const file = exportedFile();
        const withCause = file.events.find((e) => e.causationId !== null)!;
        withCause.causationId = 'evt-999999';
        return JSON.stringify(file);
      },
    },
    {
      name: 'accepted response selecting an unoffered affordance (resealed)',
      build: () => {
        const file = exportedFile();
        const accepted = file.events.find((e) => e.type === 'DecisionResponseAccepted')!;
        const acceptedPayload = accepted.payload as {
          responseId: string;
          selectedAffordanceId: string;
        };
        const received = file.events.find(
          (e) =>
            e.type === 'DecisionResponseReceived' &&
            (e.payload as { responseId: string }).responseId === acceptedPayload.responseId,
        )!;
        const forged = 'aff:mara:99:never-offered';
        acceptedPayload.selectedAffordanceId = forged;
        (received.payload as { selectedAffordanceId: string }).selectedAffordanceId = forged;
        return reseal(file);
      },
    },
    {
      name: 'mismatched provider in an accepted lifecycle (resealed)',
      build: () => {
        const file = exportedFile();
        const accepted = file.events.find((e) => e.type === 'DecisionResponseAccepted')!;
        const received = file.events.find(
          (e) =>
            e.type === 'DecisionResponseReceived' &&
            (e.payload as { responseId: string }).responseId ===
              (accepted.payload as { responseId: string }).responseId,
        )!;
        (received.payload as { providerId: string }).providerId = 'someone-else-v1';
        return reseal(file);
      },
    },
    {
      name: 'final summary inconsistent with replayed state',
      build: () => {
        const file = exportedFile();
        file.finalSummary.progressUnits += 1;
        return JSON.stringify(file);
      },
    },
    {
      name: 'reducer replay aborts (corrupted RepairProgressed payload)',
      build: () => {
        const file = exportedFile();
        const event = file.events.find((e) => e.type === 'RepairProgressed')!;
        (event.payload as { progressUnits: number }).progressUnits += 1;
        return JSON.stringify(file);
      },
    },
    {
      name: 'top-level hashes edited to match one another but not the event stream',
      build: () => {
        const file = exportedFile();
        return resealTopLevelHashesOnly(file, 'a'.repeat(16));
      },
    },
  ];
});

/** A schema-valid gateway seed manifest so a corruption rejection can only
 * come from the LEDGER validation, never from a malformed fixture. */
function writeSeedManifest(dir: string): void {
  writeFileSync(
    join(dir, 'run-manifest.json'),
    JSON.stringify(
      {
        traceSchemaVersion: 2,
        experimentId: MODEL_EXPERIMENT_ID,
        experimentVersion: MODEL_EXPERIMENT_VERSION,
        conditionId: MODEL_CONDITION_ID,
        runId: RUN_ID,
        scenarioId: 'A',
        providerPlanId: MODEL_CONDITION_ID,
        externalProviderId: EXTERNAL_MARA_PROVIDER_ID,
        promptVersion: MODEL_PROMPT_VERSION,
        modelId: 'fake-adapter',
        modelSettings: { temperature: 0 },
        startedAtUtc: '2026-07-27T09:59:59.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('§5.4 corruption matrix: prepareRun and finalize both reject, touching nothing', () => {
  it('every corruption class still passes the bare ledger-file SCHEMA (the 1.4.0 hole)', () => {
    for (const corruption of cases) {
      const parsed = ledgerFileSchema.safeParse(JSON.parse(corruption.build()) as LedgerFile);
      expect(parsed.success, corruption.name).toBe(true);
    }
  });

  it('model:prepare-run rejects each class with the destination untouched', () => {
    for (const corruption of cases) {
      const staging = mkdtempSync(join(tmpdir(), 'model-corrupt-prep-'));
      const destRoot = join(staging, 'dest');
      const ledgerPath = join(staging, `ledger-A-${RUN_ID}.json`);
      writeFileSync(ledgerPath, corruption.build(), 'utf8');
      expect(
        () =>
          prepareRunDirectory({
            runId: RUN_ID,
            ledgerPath,
            bundlePath: null,
            destRoot,
          }),
        corruption.name,
      ).toThrow(/failed full validation/);
      // Validation fully precedes mkdirSync: not even the destination root
      // may appear.
      expect(existsSync(destRoot), corruption.name).toBe(false);
    }
  });

  it('model:finalize rejects each class in BOTH modes with zero derived writes', () => {
    for (const corruption of cases) {
      const dir = join(mkdtempSync(join(tmpdir(), 'model-corrupt-fin-')), RUN_ID);
      mkdirSync(dir, { recursive: true });
      writeSeedManifest(dir);
      writeFileSync(join(dir, `ledger-A-${RUN_ID}.json`), corruption.build(), 'utf8');

      expect(() => finalizeRunDirectory(dir, RUN_ID), corruption.name).toThrow(
        /failed full validation/,
      );
      // Ledger integrity is non-negotiable: --allow-degraded covers missing
      // OPTIONAL sources, never a corrupt or truncated ledger.
      expect(
        () => finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true }),
        corruption.name,
      ).toThrow(/failed full validation/);

      for (const derived of DERIVED_FILES) {
        expect(existsSync(join(dir, derived)), `${corruption.name}: ${derived}`).toBe(false);
      }
      // No staging residue either (V2): the rejection happened before any
      // staging write.
      expect(
        existsSync(join(dirname(dir), `.${RUN_ID}.finalize-tmp`)),
        `${corruption.name}: staging dir`,
      ).toBe(false);
      // The directory holds exactly what the fixture staged — nothing more.
      expect(readdirSync(dir).sort(), corruption.name).toEqual([
        `ledger-A-${RUN_ID}.json`,
        'run-manifest.json',
      ]);
    }
  });

  it('a genuine export passes both CLIs (control case)', () => {
    const staging = mkdtempSync(join(tmpdir(), 'model-corrupt-ctl-'));
    const destRoot = join(staging, 'dest');
    const ledgerPath = join(staging, `ledger-A-${RUN_ID}.json`);
    writeFileSync(ledgerPath, JSON.stringify(exportedFile()), 'utf8');
    const { dir } = prepareRunDirectory({
      runId: RUN_ID,
      ledgerPath,
      bundlePath: null,
      destRoot,
    });
    writeSeedManifest(dir);
    // Bundle-less: strict refuses (client-bundle-present criterion), degraded
    // archives — proving the corruption rejections above were about the
    // LEDGER, not the missing optional sources.
    expect(() => finalizeRunDirectory(dir, RUN_ID)).toThrow(/client-bundle-present/);
    const result = finalizeRunDirectory(dir, RUN_ID, { allowDegraded: true });
    expect(result.status).toBe('degraded');
    for (const derived of DERIVED_FILES) {
      expect(existsSync(join(dir, derived))).toBe(true);
    }
  });
});
