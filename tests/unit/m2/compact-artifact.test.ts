import { describe, expect, it } from 'vitest';
import {
  COMPACT_BUDGET_BYTES,
  FULL_BUDGET_BYTES,
  selectCompactFiles,
  selectFullPayloads,
} from '../../../scripts/ci/prepareCompactArtifact.mjs';

/**
 * Routine-CI compact artifact profile (Phase 4 audit finding 4): the
 * include set can never contain full trace or evidence ZIP payloads, the
 * registered budget is explicit, and digest sidecars/receipts (which
 * attest sealed archives without their payload) remain included.
 */

const F = (path: string, bytes = 1_000) => ({ path, bytes });

describe('compact artifact selection', () => {
  it('includes exactly the compact proof set', () => {
    const { included, conflicts } = selectCompactFiles([
      F('artifacts/m2-rehearsal/m2-rehearsal-report.json'),
      F('artifacts/m2-sequences/rehearsal/sequence-manifest.json'),
      F('artifacts/m2-sequences/rehearsal/sequence-report.json'),
      F('artifacts/m2-sequences/rehearsal/sequence-report.md'),
      F('artifacts/m2-sequences/rehearsal/sha256-inventory.json'),
      F('artifacts/m2-sequences/rehearsal.control/sequence-state.json'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/trace-manifest.json'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/diagnostics-manifest.json'),
      F('artifacts/m2-sequences/failure-drill/attempt-x-e1/failure-manifest.json'),
      F('artifacts/m2-sequences/failure-drill/attempt-x-e1/failure.json'),
      F('artifacts/m2-sequences/m2-orchestrator-rehearsal-evidence-001.zip.sha256'),
      F('artifacts/m2-sequences/m2-orchestrator-rehearsal-evidence-001.zip.receipt.json'),
    ]);
    expect(conflicts).toEqual([]);
    expect(included).toHaveLength(12);
  });

  it('NEVER includes evidence ZIPs, trace chunks, screenshots, or DOM snapshots', () => {
    const { included } = selectCompactFiles([
      F('artifacts/m2-sequences/m2-orchestrator-rehearsal-evidence-001.zip', 900_000_000),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/attempt-trace.zip', 400_000_000),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/trace-chunks/attempt-trace-chunk-001.zip'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/failure-trace.zip'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/final-screenshot.png'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/final-dom.html'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/heartbeat.jsonl'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/gateway/run-x/model-trace.jsonl'),
      F('artifacts/m2-sequences/rehearsal/vite.log'),
    ]);
    expect(included).toEqual([]);
  });

  it('the sidecar/receipt suffixes are allowed while the archive itself is denied', () => {
    const { included } = selectCompactFiles([
      F('a/x-evidence-001.zip'),
      F('a/x-evidence-001.zip.sha256'),
      F('a/x-evidence-001.zip.receipt.json'),
    ]);
    expect(included.map((file: { path: string }) => file.path)).toEqual([
      'a/x-evidence-001.zip.sha256',
      'a/x-evidence-001.zip.receipt.json',
    ]);
  });

  it('the registered budget is the audit value', () => {
    expect(COMPACT_BUDGET_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('full-evidence artifact selection (re-audit: each payload exactly once)', () => {
  const archived = {
    name: 'rehearsal',
    archivePath: 'artifacts/m2-sequences/rehearsal-evidence-001.zip',
    archiveFiles: [
      F('artifacts/m2-sequences/rehearsal-evidence-001.zip', 900_000_000),
      F('artifacts/m2-sequences/rehearsal-evidence-001.zip.sha256'),
      F('artifacts/m2-sequences/rehearsal-evidence-001.zip.receipt.json'),
    ],
    treeFiles: [
      F('artifacts/m2-sequences/rehearsal/sequence-manifest.json'),
      F('artifacts/m2-sequences/rehearsal/attempt-a-1-e1/attempt-trace.zip', 400_000_000),
    ],
    controlFiles: [F('artifacts/m2-sequences/rehearsal.control/sequence-state.json')],
  };
  const neverArchived = {
    name: 'failure-drill',
    archivePath: null,
    archiveFiles: [],
    treeFiles: [
      F('artifacts/m2-sequences/failure-drill/attempt-x-e1/failure-manifest.json'),
      F('artifacts/m2-sequences/failure-drill/attempt-x-e1/failure-trace.zip', 50_000_000),
    ],
    controlFiles: [F('artifacts/m2-sequences/failure-drill.control/sequence-state.json')],
  };

  it('an ARCHIVED sequence ships ZIP + sidecar + receipt + control state, never its raw tree', () => {
    const { included, dispositions } = selectFullPayloads([archived]);
    const paths = included.map((file: { path: string }) => file.path);
    expect(paths).toContain('artifacts/m2-sequences/rehearsal-evidence-001.zip');
    expect(paths).toContain('artifacts/m2-sequences/rehearsal-evidence-001.zip.sha256');
    expect(paths).toContain('artifacts/m2-sequences/rehearsal-evidence-001.zip.receipt.json');
    expect(paths).toContain('artifacts/m2-sequences/rehearsal.control/sequence-state.json');
    // The raw tree is contained inside the sealed ZIP — shipping it again
    // is the duplicate upload the audit blocked on.
    expect(paths).not.toContain('artifacts/m2-sequences/rehearsal/sequence-manifest.json');
    expect(paths.some((path: string) => path.includes('attempt-trace.zip'))).toBe(false);
    expect(dispositions).toEqual([
      {
        sequence: 'rehearsal',
        disposition:
          'archived — raw tree excluded (contained in artifacts/m2-sequences/rehearsal-evidence-001.zip)',
      },
    ]);
  });

  it('a NEVER-ARCHIVED sequence ships its raw tree — the tree IS the unique payload', () => {
    const { included, dispositions } = selectFullPayloads([neverArchived]);
    const paths = included.map((file: { path: string }) => file.path);
    expect(paths).toContain(
      'artifacts/m2-sequences/failure-drill/attempt-x-e1/failure-manifest.json',
    );
    expect(paths).toContain('artifacts/m2-sequences/failure-drill/attempt-x-e1/failure-trace.zip');
    expect(paths).toContain('artifacts/m2-sequences/failure-drill.control/sequence-state.json');
    expect(dispositions[0]!.disposition).toContain('never archived');
  });

  it('mixed sequences: total bytes count each payload once and stay reportable against the budget', () => {
    const { included } = selectFullPayloads([archived, neverArchived]);
    const totalBytes = included.reduce(
      (sum: number, file: { bytes: number }) => sum + file.bytes,
      0,
    );
    // 900 MB ZIP + 2 sidecar/receipt + control + 50 MB failure trace +
    // failure manifest + control — the 400 MB duplicate tree is absent.
    expect(totalBytes).toBe(900_000_000 + 1_000 + 1_000 + 1_000 + 50_000_000 + 1_000 + 1_000);
    expect(totalBytes).toBeLessThanOrEqual(FULL_BUDGET_BYTES);
  });

  it('the registered full budget is explicit', () => {
    expect(FULL_BUDGET_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });
});
