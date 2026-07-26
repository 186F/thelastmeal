import { describe, expect, it } from 'vitest';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { completedRun } from '../helpers';

function exportedFile(): LedgerFile {
  return JSON.parse(JSON.stringify(buildLedgerFile(completedRun('A')))) as LedgerFile;
}

describe('imported-ledger validation', () => {
  it('accepts a genuine exported ledger', () => {
    const result = validateLedgerFile(JSON.stringify(exportedFile()));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.file?.scenario.id).toBe('A');
  });

  it('rejects invalid JSON without partial results', () => {
    const text = JSON.stringify(exportedFile()).slice(0, 500);
    const result = validateLedgerFile(text);
    expect(result.ok).toBe(false);
    expect(result.file).toBeNull();
    expect(result.issues[0]!.code).toBe('invalid-json');
  });

  it('rejects sequence gaps and reordered events', () => {
    const file = exportedFile();
    const tmp = file.events[100]!;
    file.events[100] = file.events[101]!;
    file.events[101] = tmp;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'sequence-gap')).toBe(true);
  });

  it('rejects a seed that does not match the local scenario definition', () => {
    const file = exportedFile();
    file.scenario.seed = 9999;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'seed-mismatch')).toBe(true);
  });

  it('rejects a tampered final-state hash', () => {
    const file = exportedFile();
    file.finalStateHash = '0000000000000000';
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'hash-mismatch-in-file')).toBe(true);
  });

  it('rejects events appearing after ScenarioEnded', () => {
    const file = exportedFile();
    const last = file.events[file.events.length - 1]!;
    file.events.push({
      ...file.events[5]!,
      seq: last.seq + 1,
      id: `evt-${String(last.seq + 1).padStart(6, '0')}`,
    });
    file.finalSummary.eventCount = file.events.length;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'events-after-end')).toBe(true);
  });

  it('rejects an unsupported schema version', () => {
    const file = exportedFile();
    (file.scenario as { schemaVersion: number }).schemaVersion = 99;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });
});
