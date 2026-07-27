import { describe, expect, it } from 'vitest';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { canonicalLedgerHash } from '../../src/sim/replay/ledgerHash';
import { replayLedger } from '../../src/sim/replay/replay';
import { SimulationHost } from '../../src/sim/runtime/host';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { SimulatedAsyncProvider } from '../../src/sim/decisions/simulatedAsyncProvider';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import type { ScenarioId } from '../../src/shared/ids';
import type { SimEvent } from '../../src/sim/events/types';
import { completedRun } from '../helpers';

function exportedFile(scenario: ScenarioId = 'A'): LedgerFile {
  return JSON.parse(JSON.stringify(buildLedgerFile(completedRun(scenario)))) as LedgerFile;
}

function errorCodes(result: ReturnType<typeof validateLedgerFile>): string[] {
  return result.issues.filter((i) => i.severity === 'error').map((i) => i.code);
}

/**
 * Reseals a tampered file the way a determined forger would: recomputes the
 * world-state hash from an actual replay, restamps the ScenarioEnded payload,
 * and recomputes the canonical ledger hash over the doctored stream. A tamper
 * that survives resealing can only be caught by the semantic cross-checks
 * (re-audit finding 2) — never by the hash comparisons.
 */
function reseal(file: LedgerFile): string {
  const replayed = replayLedger(file.scenario.id, file.events);
  file.worldStateHash = replayed.worldStateHash;
  const ended = file.events.find((e) => e.type === 'ScenarioEnded');
  if (ended) {
    (ended.payload as { worldStateHash: string }).worldStateHash = replayed.worldStateHash;
  }
  file.canonicalLedgerHash = canonicalLedgerHash(file.events as SimEvent[]);
  return JSON.stringify(file);
}

describe('imported-ledger validation (all-or-nothing, remediation 3)', () => {
  it('accepts a genuine exported ledger after full replay + hash + summary verification', () => {
    const result = validateLedgerFile(JSON.stringify(exportedFile()));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.file?.scenario.id).toBe('A');
  });

  it('accepts genuine exports of ALL seven scenarios (incl. F fallback acceptances and scripted null-actor events)', () => {
    // Regression guard for the semantic cross-checks: Scenario F's ledger is
    // full of legitimate fallback acceptances (Received.providerId is the
    // engine-owned fallback, not the request's provider), and C/E/F carry
    // scripted world events with a null envelope actor. None of these may be
    // rejected by the new checks.
    for (const scenarioId of ['A', 'B1', 'B2', 'C', 'D', 'E', 'F'] as const) {
      const result = validateLedgerFile(JSON.stringify(exportedFile(scenarioId)));
      expect(
        result.issues.filter((i) => i.severity === 'error'),
        `scenario ${scenarioId}`,
      ).toEqual([]);
      expect(result.ok, `scenario ${scenarioId}`).toBe(true);
    }
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

describe('semantic cross-checks reject resealed forgeries (re-audit finding 2)', () => {
  function eventOfType(file: LedgerFile, type: string, nth = 0) {
    const matches = file.events.filter((e) => e.type === type);
    expect(matches.length, `ledger should contain ${type}`).toBeGreaterThan(nth);
    return matches[nth]!;
  }

  it('rejects file metadata that contradicts the ScenarioStarted payload (provider, seed)', () => {
    const provider = exportedFile();
    (eventOfType(provider, 'ScenarioStarted').payload as { providerId: string }).providerId =
      'evil-gateway-v9';
    expect(errorCodes(validateLedgerFile(reseal(provider)))).toContain(
      'scenario-started-metadata-mismatch',
    );

    const seed = exportedFile();
    (eventOfType(seed, 'ScenarioStarted').payload as { seed: number }).seed = 424_242;
    expect(errorCodes(validateLedgerFile(reseal(seed)))).toContain(
      'scenario-started-metadata-mismatch',
    );
  });

  it('rejects a flipped ScenarioEnded task outcome', () => {
    const file = exportedFile();
    const ended = eventOfType(file, 'ScenarioEnded');
    const payload = ended.payload as { taskOutcome: string };
    payload.taskOutcome = payload.taskOutcome === 'completed' ? 'deadline-missed' : 'completed';
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain(
      'scenario-ended-outcome-mismatch',
    );
  });

  it('rejects swapped treatment envelope identities (healer/patient)', () => {
    const file = exportedFile('C');
    const treatment = eventOfType(file, 'TreatmentStarted');
    const healer = treatment.actorId;
    treatment.actorId = treatment.targetId as typeof treatment.actorId;
    treatment.targetId = healer;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('actor-payload-mismatch');
  });

  it('rejects swapped commitment envelope identities (debtor/creditor)', () => {
    const file = exportedFile();
    const created = eventOfType(file, 'CommitmentCreated');
    const debtor = created.actorId;
    created.actorId = created.targetId as typeof created.actorId;
    created.targetId = debtor;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('actor-payload-mismatch');
  });

  it('rejects a reservation whose envelope actor is not the recorded holder', () => {
    const file = exportedFile();
    const reserved = eventOfType(file, 'ResourceReserved');
    const holder = (reserved.payload as { holderNpcId: string }).holderNpcId;
    reserved.actorId = (['mara', 'jonas', 'rin'].find((n) => n !== holder) ??
      'mara') as typeof reserved.actorId;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('actor-payload-mismatch');
  });

  it('rejects an acceptance of an affordance its request never offered', () => {
    const file = exportedFile();
    const accepted = eventOfType(file, 'DecisionResponseAccepted');
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
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('accepted-unoffered-affordance');
  });

  it('rejects an acceptance whose causation is rewired away from its received record', () => {
    const file = exportedFile();
    const accepted = eventOfType(file, 'DecisionResponseAccepted');
    const request = file.events.find(
      (e) =>
        e.type === 'DecisionRequested' &&
        (e.payload as { requestId: string }).requestId ===
          (accepted.payload as { requestId: string }).requestId,
    )!;
    accepted.causationId = request.id;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('accepted-without-received');
  });

  it('rejects received/accepted records that disagree on selection or provider', () => {
    const divergent = exportedFile();
    const accepted = eventOfType(divergent, 'DecisionResponseAccepted');
    (accepted.payload as { confidenceBp: number }).confidenceBp = 1;
    expect(errorCodes(validateLedgerFile(reseal(divergent)))).toContain(
      'accepted-received-divergence',
    );

    const wrongProvider = exportedFile();
    const accepted2 = eventOfType(wrongProvider, 'DecisionResponseAccepted');
    const received2 = wrongProvider.events.find(
      (e) =>
        e.type === 'DecisionResponseReceived' &&
        (e.payload as { responseId: string }).responseId ===
          (accepted2.payload as { responseId: string }).responseId,
    )!;
    (received2.payload as { providerId: string }).providerId = 'someone-else-v1';
    expect(errorCodes(validateLedgerFile(reseal(wrongProvider)))).toContain(
      'accepted-provider-mismatch',
    );
  });

  it('rejects a normal acceptance whose provider spoofs the engine-owned fallback ID', () => {
    const file = exportedFile();
    const accepted = file.events.find(
      (e) =>
        e.type === 'DecisionResponseAccepted' &&
        (e.payload as { usedFallback: boolean }).usedFallback === false,
    )!;
    const received = file.events.find(
      (e) =>
        e.type === 'DecisionResponseReceived' &&
        (e.payload as { responseId: string }).responseId ===
          (accepted.payload as { responseId: string }).responseId,
    )!;
    (received.payload as { providerId: string }).providerId = 'fallback-continue-or-wait-v2';
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('accepted-provider-mismatch');
  });

  it('rejects an ActionProposed descriptor that differs from the accepted offer', () => {
    const file = exportedFile();
    const proposal = file.events.find(
      (e) =>
        e.type === 'ActionProposed' &&
        e.causationId !== null &&
        file.events.some((a) => a.type === 'DecisionResponseAccepted' && a.id === e.causationId),
    )!;
    (proposal.payload as { durationTicks: number }).durationTicks += 10;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain(
      'proposal-descriptor-divergence',
    );
  });

  it('rejects a mode/category pair that violates MODE_TO_CATEGORY', () => {
    const file = exportedFile();
    const proposal = eventOfType(file, 'ActionProposed');
    (proposal.payload as { category: string }).category = 'eat-meal';
    (proposal.payload as { mode: string }).mode = 'routine-work';
    const codes = errorCodes(validateLedgerFile(reseal(file)));
    expect(codes).toContain('mode-category-mismatch');
  });
});

describe('adversarial-review regressions: descriptor chain, causation authentication, fallback licensing', () => {
  // A deferred run whose ledger contains a genuine DecisionResponseRejected
  // record AND provisional bridge proposals — the two shapes the frozen
  // scenarios never produce. Built once (2700 ticks) and reused.
  let deferredExport: LedgerFile | null = null;
  function deferredFileWithRejection(): LedgerFile {
    if (!deferredExport) {
      const run = createRun('A', {
        provider: new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
          delayTicks: null,
        })),
      });
      while (run.state.tick < 61 && !run.state.terminal) stepTick(run);
      const pending = run.state.npcs.mara.pendingDecision!;
      run.responseInbox.push({
        responseId: 'reject-fixture-1',
        requestId: pending.requestId,
        npcId: 'mara',
        scenarioId: 'A',
        providerId: pending.providerId,
        selectedAffordanceId: 'aff:mara:60:not-offered',
        confidenceBp: 1_000,
        reasonCode: 'fixture',
        scores: [],
      });
      while (!run.state.terminal) stepTick(run);
      deferredExport = buildLedgerFile(run);
    }
    return JSON.parse(JSON.stringify(deferredExport)) as LedgerFile;
  }

  it('accepts a genuine deferred export (provisional bridges + a recorded rejection)', () => {
    const file = deferredFileWithRejection();
    expect(file.events.some((e) => e.type === 'DecisionResponseRejected')).toBe(true);
    const result = validateLedgerFile(JSON.stringify(file));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an ActionStarted that diverges from its proposal (the reducer-authoritative payload)', () => {
    const file = exportedFile();
    const started = file.events.find((e) => e.type === 'ActionStarted' && e.tick > 0)!;
    (started.payload as { interruptible: boolean }).interruptible = !(
      started.payload as { interruptible: boolean }
    ).interruptible;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('start-descriptor-divergence');
  });

  it('rejects a proposal whose causation is re-pointed at a non-provisional FallbackDecisionUsed', () => {
    const file = exportedFile('F');
    const fallbackUsed = file.events.find((e) => e.type === 'FallbackDecisionUsed')!;
    const proposal = file.events.find(
      (e) => e.type === 'ActionProposed' && e.seq > fallbackUsed.seq && e.causationId !== null,
    )!;
    (proposal.payload as { interruptible: boolean }).interruptible = true;
    proposal.causationId = fallbackUsed.id;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('proposal-cause-invalid');
  });

  it('rejects a usedFallback acceptance with no licensing FallbackDecisionUsed (2-field laundering forgery)', () => {
    const file = exportedFile();
    const accepted = file.events.find(
      (e) =>
        e.type === 'DecisionResponseAccepted' &&
        (e.payload as { usedFallback: boolean }).usedFallback === false,
    )!;
    (accepted.payload as { usedFallback: boolean }).usedFallback = true;
    const received = file.events.find(
      (e) =>
        e.type === 'DecisionResponseReceived' &&
        (e.payload as { responseId: string }).responseId ===
          (accepted.payload as { responseId: string }).responseId,
    )!;
    (received.payload as { providerId: string }).providerId = 'fallback-continue-or-wait-v2';
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain(
      'fallback-acceptance-unlicensed',
    );
  });

  it('rejects a treatment whose envelope target is not the recorded patient', () => {
    const file = exportedFile('C');
    const treatment = file.events.find((e) => e.type === 'TreatmentStarted')!;
    treatment.targetId = (treatment.payload as { healerId: string }).healerId;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('target-payload-mismatch');
  });

  it('rejects a request whose declared affordanceIds disagree with its offered descriptors', () => {
    const file = exportedFile();
    const request = file.events.find(
      (e) =>
        e.type === 'DecisionRequested' &&
        ((e.payload as { affordanceIds: string[] }).affordanceIds?.length ?? 0) >= 2,
    )!;
    (request.payload as { affordanceIds: string[] }).affordanceIds.reverse();
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain('request-offer-id-divergence');
  });

  it('rejects a rejection record detached from, or disagreeing with, its received record', () => {
    const detached = deferredFileWithRejection();
    const rejected = detached.events.find((e) => e.type === 'DecisionResponseRejected')!;
    const request = detached.events.find(
      (e) =>
        e.type === 'DecisionRequested' &&
        (e.payload as { requestId: string }).requestId ===
          (rejected.payload as { requestId: string }).requestId,
    )!;
    rejected.causationId = request.id;
    expect(errorCodes(validateLedgerFile(reseal(detached)))).toContain('rejected-without-received');

    const divergent = deferredFileWithRejection();
    const rejected2 = divergent.events.find((e) => e.type === 'DecisionResponseRejected')!;
    (rejected2.payload as { requestId: string }).requestId = 'dec-9999';
    expect(errorCodes(validateLedgerFile(reseal(divergent)))).toContain(
      'rejected-received-divergence',
    );
  });

  it('rejects an accepted proposal whose proposedTerms differ from the offer', () => {
    const file = exportedFile('C');
    const proposal = file.events.find(
      (e) =>
        e.type === 'ActionProposed' &&
        (e.payload as { proposedTerms: { minDurationTicks: number } | null }).proposedTerms !==
          null,
    )!;
    (
      proposal.payload as { proposedTerms: { minDurationTicks: number } }
    ).proposedTerms.minDurationTicks += 1;
    expect(errorCodes(validateLedgerFile(reseal(file)))).toContain(
      'proposal-descriptor-divergence',
    );
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
