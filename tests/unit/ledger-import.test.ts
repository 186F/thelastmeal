import { describe, expect, it } from 'vitest';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { SimulationHost } from '../../src/sim/runtime/host';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { completedRun } from '../helpers';

function exportedFile(scenario: 'A' | 'C' = 'A'): LedgerFile {
  return JSON.parse(JSON.stringify(buildLedgerFile(completedRun(scenario)))) as LedgerFile;
}

function errorCodes(result: ReturnType<typeof validateLedgerFile>): string[] {
  return result.issues.filter((i) => i.severity === 'error').map((i) => i.code);
}

describe('imported-ledger validation (all-or-nothing, remediation 3)', () => {
  it('accepts a genuine exported ledger after full replay + hash + summary verification', () => {
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

  it('rejects format-version-1 exports explicitly instead of reinterpreting them', () => {
    const result = validateLedgerFile(
      JSON.stringify({ formatVersion: 1, finalStateHash: 'deadbeefdeadbeef' }),
    );
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('unsupported-format-version');
  });

  it('rejects sequence gaps and reordered events', () => {
    const file = exportedFile();
    const tmp = file.events[100]!;
    file.events[100] = file.events[101]!;
    file.events[101] = tmp;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('sequence-gap');
  });

  it('rejects a seed that does not match the local scenario definition', () => {
    const file = exportedFile();
    file.scenario.seed = 9999;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('seed-mismatch');
  });

  it('rejects a tampered world-state hash via recomputation', () => {
    const file = exportedFile();
    file.worldStateHash = '0000000000000000';
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('world-hash-mismatch');
    expect(errorCodes(result)).toContain('hash-mismatch-in-file');
  });

  it('rejects a tampered canonical ledger hash via recomputation', () => {
    const file = exportedFile();
    file.canonicalLedgerHash = '0000000000000000';
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('ledger-hash-mismatch');
  });

  it('rejects a tampered final summary via field-by-field reconstruction', () => {
    const file = exportedFile();
    file.finalSummary.progressUnits += 1;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('summary-mismatch');
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
    expect(errorCodes(result)).toContain('events-after-end');
  });

  it('rejects an unsupported schema version', () => {
    const file = exportedFile();
    (file.scenario as { schemaVersion: number }).schemaVersion = 99;
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });
});

describe('exact payload schemas at import (remediation 3)', () => {
  function corrupt(
    file: LedgerFile,
    type: string,
    mutate: (payload: Record<string, unknown>) => void,
  ): LedgerFile {
    const event = file.events.find((e) => e.type === type);
    expect(event, `ledger should contain a ${type} event`).toBeDefined();
    mutate(event!.payload as Record<string, unknown>);
    return file;
  }

  it('rejects a corrupted RepairProgressed payload AT IMPORT, not at later replay', () => {
    const file = exportedFile();
    // Semantically corrupt but schema-shaped: caught by the isolated replay
    // (reducer hard guard), which is now part of import validation.
    corrupt(file, 'RepairProgressed', (p) => {
      p.progressUnits = (p.progressUnits as number) + 1;
    });
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('replay-aborted');
  });

  it('rejects malformed reservation payloads (unknown field / wrong enum)', () => {
    const extraField = corrupt(exportedFile(), 'ResourceReserved', (p) => {
      p.injectedField = 1;
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(extraField)))).toContain(
      'event-payload-invalid',
    );

    const badEnum = corrupt(exportedFile(), 'ResourceReserved', (p) => {
      p.kind = 'nonsense-kind';
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(badEnum)))).toContain(
      'event-payload-invalid',
    );
  });

  it('rejects malformed commitment payloads (missing field / non-integer)', () => {
    const missing = corrupt(exportedFile(), 'CommitmentCreated', (p) => {
      delete p.debtorId;
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(missing)))).toContain(
      'event-payload-invalid',
    );

    const fractional = corrupt(exportedFile(), 'CommitmentCreated', (p) => {
      (p.terms as { startTick: number }).startTick = 900.5;
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(fractional)))).toContain(
      'event-payload-invalid',
    );
  });

  it('rejects malformed treatment payloads (out-of-range severity)', () => {
    const file = corrupt(exportedFile('C'), 'TreatmentCompleted', (p) => {
      p.severityAfterMicro = 5_000_000;
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(file)))).toContain('event-payload-invalid');
  });

  it('rejects malformed decision-response payloads (bad confidence / unknown rejection reason)', () => {
    const badConfidence = corrupt(exportedFile(), 'DecisionResponseReceived', (p) => {
      p.confidenceBp = 99_999;
    });
    expect(errorCodes(validateLedgerFile(JSON.stringify(badConfidence)))).toContain(
      'event-payload-invalid',
    );

    const file = exportedFile();
    const accepted = file.events.find((e) => e.type === 'DecisionResponseAccepted');
    expect(accepted).toBeDefined();
    (accepted!.payload as Record<string, unknown>).usedFallback = 'yes';
    expect(errorCodes(validateLedgerFile(JSON.stringify(file)))).toContain('event-payload-invalid');
  });

  it('rejects a dangling causation reference', () => {
    const file = exportedFile();
    const withCause = file.events.find((e) => e.causationId !== null);
    expect(withCause).toBeDefined();
    withCause!.causationId = 'evt-999999';
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('dangling-causation');
  });

  it('rejects a decision resolution that references no request', () => {
    const file = exportedFile();
    const accepted = file.events.find((e) => e.type === 'DecisionResponseAccepted');
    expect(accepted).toBeDefined();
    (accepted!.payload as Record<string, unknown>).requestId = 'dec-9999';
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain('decision-resolution-without-request');
  });
});

describe('import isolation (remediation 3)', () => {
  it('a rejected import never replaces a previously valid imported file', () => {
    const host = new SimulationHost();
    const good = JSON.stringify(exportedFile());
    expect(host.importLedger(good).ok).toBe(true);
    expect(host.hasImportedLedger).toBe(true);

    const corrupted = exportedFile();
    (
      corrupted.events.find((e) => e.type === 'RepairProgressed')!.payload as {
        progressUnits: number;
      }
    ).progressUnits += 1;
    expect(host.importLedger(JSON.stringify(corrupted)).ok).toBe(false);

    // The earlier valid import is still available and still replays clean.
    expect(host.hasImportedLedger).toBe(true);
    const outcome = host.replay('imported');
    expect(outcome.ok).toBe(true);
    expect(outcome.match).toBe(true);
  });

  it('import replay is isolated: a live run is untouched by validating a corrupt file', () => {
    const host = new SimulationHost();
    host.loadScenario('C');
    host.stepTicks(50);
    const before = JSON.stringify(host.snapshot());
    const corrupted = exportedFile();
    (
      corrupted.events.find((e) => e.type === 'RepairProgressed')!.payload as {
        progressUnits: number;
      }
    ).progressUnits += 1;
    expect(host.importLedger(JSON.stringify(corrupted)).ok).toBe(false);
    expect(JSON.stringify(host.snapshot())).toBe(before);
  });
});
