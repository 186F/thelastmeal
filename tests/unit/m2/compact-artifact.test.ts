import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Static workflow assertions (final targeted remediation D, §6.3): the
 * failure-path CI behaviors that cannot be induced in the required
 * merge-gate run are pinned against the workflow text itself.
 */
describe('ci.yml failure-path hygiene (static assertions)', () => {
  const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
  /** The step block starting at the given name, ending at the next step. */
  const step = (name: string): string => {
    const start = workflow.indexOf(`- name: ${name}`);
    expect(start, `step '${name}' exists`).toBeGreaterThanOrEqual(0);
    const rest = workflow.slice(start + 1);
    const next = rest.search(/\n {6}- name: /);
    return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it('full-evidence prepare and upload are bound to the m2:rehearse PRODUCER, never bare failure()', () => {
    for (const name of [
      'Prepare FULL evidence artifact (uniqueness + size-budget gate)',
      'Upload m2 rehearsal FULL evidence (rehearsal failure or explicit dispatch only)',
    ]) {
      const block = step(name);
      expect(block).toContain("steps.m2-rehearse.outcome == 'failure'");
      expect(block).toContain('inputs.full-evidence');
      // An early unit-test failure must not trigger the heavy profile:
      // bare failure() would.
      expect(block.includes('failure() ||')).toBe(false);
    }
    // The producer step actually carries the id the conditions reference.
    expect(workflow).toContain('id: m2-rehearse');
  });

  it('report uploads are producer-bound: skipped producers cause no secondary failures', () => {
    const model = step('Upload model-rehearsal report');
    expect(model).toContain("steps.model-rehearse.outcome == 'success'");
    expect(model).toContain('if-no-files-found: error');
    const modelFailure = step('Upload model-rehearsal failure diagnostics');
    expect(modelFailure).toContain("steps.model-rehearse.outcome == 'failure'");
    expect(modelFailure).toContain('if-no-files-found: ignore');
    const batch = step('Upload batch report');
    expect(batch).toContain("steps.batch.outcome == 'success'");
    expect(batch).toContain('if-no-files-found: error');
    const playwright = step('Upload Playwright report on e2e failure');
    expect(playwright).toContain("steps.e2e.outcome == 'failure'");
    expect(workflow).toContain('id: model-rehearse');
    expect(workflow).toContain('id: batch');
    expect(workflow).toContain('id: e2e');
  });

  it('every artifact upload pins an explicit retention period', () => {
    const uploads = workflow.split('uses: actions/upload-artifact').length - 1;
    const retentions = workflow.split('retention-days:').length - 1;
    expect(uploads).toBeGreaterThan(0);
    expect(retentions).toBe(uploads);
  });

  it('the compact gate precedes the compact upload, and the routine profile stays compact', () => {
    const gateIndex = workflow.indexOf('Prepare compact rehearsal artifact (size-budget gate)');
    const uploadIndex = workflow.indexOf('Upload m2 rehearsal compact proof');
    expect(gateIndex).toBeGreaterThan(0);
    expect(uploadIndex).toBeGreaterThan(gateIndex);
    const compact = step('Upload m2 rehearsal compact proof');
    expect(compact).toContain('retention-days: 21');
    const full = step(
      'Upload m2 rehearsal FULL evidence (rehearsal failure or explicit dispatch only)',
    );
    expect(full).toContain('retention-days: 7');
  });

  it('the registered full budget is documented consistently (one budget, 4 GiB)', () => {
    expect(workflow).toContain('4 GiB');
    expect(workflow.includes('2 GiB')).toBe(false);
    expect(FULL_BUDGET_BYTES / 1024 ** 3).toBe(4);
  });
});
