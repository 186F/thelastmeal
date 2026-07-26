import { describe, expect, it } from 'vitest';
import { SimulationHost } from '../../src/sim/runtime/host';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { applyEvent } from '../../src/sim/events/reduce';
import { validateStart } from '../../src/sim/actions/validation';
import type { PendingActionState } from '../../src/sim/domain/state';
import { createRun, stepTick } from '../../src/sim/runtime/engine';
import { completedRun, freshState, mkEvent } from '../helpers';

/** Regression tests for defects confirmed by the adversarial review pass. */

describe('corrupted payloads are stopped at import (remediation 3 upgrade)', () => {
  it('a payload-corrupted but schema-shaped ledger is REJECTED at import; no imported replay exists', () => {
    const file = JSON.parse(JSON.stringify(buildLedgerFile(completedRun('A'))));
    // Corrupt one RepairProgressed payload so the reducer's hard guard trips.
    // Import validation now performs the isolated replay itself, so this file
    // never becomes available for a later replay command.
    const repairEvent = file.events.find(
      (e: { type: string }) => e.type === 'RepairProgressed',
    ) as { payload: { progressUnits: number } };
    repairEvent.payload.progressUnits += 1;

    const host = new SimulationHost();
    host.loadScenario('A');
    host.stepTicks(10);
    const liveBefore = JSON.stringify(host.snapshot());

    const imported = host.importLedger(JSON.stringify(file));
    expect(imported.ok).toBe(false);
    expect(
      imported.issues.some(
        (i) => i.code === 'replay-aborted' && i.message.includes('reduce-repair-mismatch'),
      ),
    ).toBe(true);
    expect(host.hasImportedLedger).toBe(false);
    expect(host.replay('imported').errors[0]).toBe('no-imported-ledger');
    // The active live run is untouched.
    expect(JSON.stringify(host.snapshot())).toBe(liveBefore);
  });
});

describe('replay error boundary (review: stale replay verdict)', () => {
  it('a reducer abort during a LIVE replay still yields an explicit failure, never a lost result', () => {
    // The import path now rejects corrupted files outright, so the error
    // boundary is exercised on the live path: corrupt the completed run's
    // own in-memory ledger and replay it.
    const host = new SimulationHost();
    host.loadScenario('A');
    host.runToCompletion();
    const live = host.activeRun!;
    const repairEvent = live.ledger.events.find((e) => e.type === 'RepairProgressed')!;
    (repairEvent.payload as { progressUnits: number }).progressUnits += 1;

    const outcome = host.replay('live');
    expect(outcome.ok).toBe(false);
    expect(outcome.match).toBe(false);
    expect(outcome.computedWorldStateHash).toBeNull();
    expect(outcome.expectedWorldStateHash).toBe(live.worldStateHash);
    expect(outcome.errors[0]).toMatch(/replay-aborted: reduce-repair-mismatch/);
  });
});

describe('interrupted treatment unlock (review: patient permanently locked)', () => {
  it('aborting a treatment clears the patient markers so re-treatment and worsening re-arm', () => {
    const state = freshState('C');
    applyEvent(
      state,
      mkEvent('InjuryOccurred', 720, { npcId: 'rin', severityMicro: 550_000, cause: 'scripted' }),
    );
    applyEvent(
      state,
      mkEvent('ActionStarted', 781, {
        actionId: 'act-t9',
        affordanceId: 'aff:jonas:751:treat:rin',
        npcId: 'jonas',
        category: 'treat-injured',
        mode: 'treat',
        targetNpcId: 'rin',
        targetResourceId: null,
        locationId: 'medical-cot',
        durationTicks: 240,
        stateVersion: 0,
        interruptible: false,
        violation: false,
        commitmentId: null,
        proposalId: null,
        requestId: null,
        proposedTerms: null,
        completesAtTick: 1021,
      }),
    );
    applyEvent(
      state,
      mkEvent('TreatmentStarted', 781, {
        actionId: 'act-t9',
        healerId: 'jonas',
        patientId: 'rin',
        expectedDurationTicks: 240,
      }),
    );
    expect(state.npcs.rin.injury.treatmentStartedTick).toBe(781);

    applyEvent(
      state,
      mkEvent('ActionInterrupted', 900, {
        actionId: 'act-t9',
        npcId: 'jonas',
        category: 'treat-injured',
        mode: 'treat',
        reasonCode: 'sustained-check-failed:patient-absent',
      }),
    );
    expect(state.npcs.rin.injury.treatmentStartedTick).toBeNull();
    expect(state.npcs.rin.injury.treatedByNpcId).toBeNull();
    expect(state.npcs.rin.injury.severityMicro).toBe(550_000); // still injured
  });

  it('worsening still fires when the deadline passed during an aborted treatment window', () => {
    // Engine-level: the monitor uses ">= injuredAt + delay" with the
    // untreated predicate, so the exact-deadline scenario F case is a lower
    // bound, not the only trigger. Confirm F still worsens exactly at 1320.
    const run = createRun('F');
    for (let i = 0; i < 1320; i += 1) stepTick(run);
    expect(run.state.npcs.rin.injury.worsened).toBe(true);
    expect(run.state.npcs.rin.incapacitated).toBe(true);
  });
});

describe('relieve staleness (review: silent retarget)', () => {
  function relieveAction(target: 'mara' | 'jonas' | 'rin'): PendingActionState {
    return {
      id: 'act-r9',
      affordanceId: `aff:jonas:840:relieve:${target}`,
      category: 'relieve-worker',
      mode: 'relieve',
      actorId: 'jonas',
      targetNpcId: target,
      targetResourceId: null,
      locationId: 'purifier-workbench',
      durationTicks: 100,
      stateVersionAtProposal: 0,
      interruptible: true,
      violation: false,
      commitmentId: null,
      proposalId: null,
      requestId: null,
      proposedTerms: null,
    };
  }

  it('rejects the relieve at start when the bench occupant changed during travel', () => {
    const state = freshState('A');
    applyEvent(
      state,
      mkEvent('ResourceReserved', 0, {
        resourceId: 'workbench-slot',
        holderNpcId: 'rin',
        kind: 'exclusive-use',
      }),
    );
    state.npcs.jonas.locationId = 'purifier-workbench'; // arrived
    // Proposed against Mara, but Rin now holds the bench: stale, not retargeted.
    const outcome = validateStart(state, relieveAction('mara'), true);
    expect(outcome.ok).toBe(false);
    expect(outcome.failed).toContain('stale-relieve-target');
    // Against the actual holder it is valid.
    expect(validateStart(state, relieveAction('rin'), true).ok).toBe(true);
  });
});
