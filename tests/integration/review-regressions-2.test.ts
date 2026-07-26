import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/shared/versions';
import { workerCommandSchema, type WorkerCommand } from '../../src/shared/workerProtocol';
import type { DecisionResponse } from '../../src/shared/decisionContracts';
import { DeterministicProvider } from '../../src/sim/decisions/deterministicProvider';
import { SimulatedAsyncProvider } from '../../src/sim/decisions/simulatedAsyncProvider';
import { validateEventExact } from '../../src/sim/events/eventSchemas';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { createRun, stepTick, type EngineRun } from '../../src/sim/runtime/engine';
import { handleCommand, WorkerSession } from '../../src/worker/commandProcessor';
import { eventsOfType } from '../helpers';

/** Regression tests for defects confirmed by the remediation adversarial review. */

let seq = 0;
function cmd(type: WorkerCommand['type'], extra: Record<string, unknown> = {}): WorkerCommand {
  seq += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd-r2-${seq}`,
    commandSeq: seq,
    type,
    ...extra,
  } as WorkerCommand;
}

function deferAllRun(): EngineRun {
  const run = createRun('A');
  run.provider = new SimulatedAsyncProvider(new DeterministicProvider(), () => ({
    delayTicks: null,
  }));
  return run;
}

function stepTo(run: EngineRun, tick: number): void {
  while (run.state.tick < tick && !run.state.terminal) stepTick(run);
}

describe('external response payloads cannot poison the canonical ledger (review: gateway scores)', () => {
  it('a rejected gateway response with model-internal score IDs still leaves every event schema-valid and the export importable', () => {
    const session = new WorkerSession();
    handleCommand(session, cmd('load-scenario', { scenarioId: 'A' }));
    handleCommand(session, cmd('step', { ticks: 100 }));
    const gatewayResponse = {
      responseId: 'gw-resp-1',
      requestId: 'dec-9999',
      npcId: 'mara',
      scenarioId: 'A',
      providerId: 'external-gateway',
      selectedAffordanceId: 'model-internal-option-7',
      confidenceBp: 5_000,
      reasonCode: 'model-choice',
      scores: [
        {
          affordanceId: 'model-internal-option-7', // NOT an aff:/scripted: ID
          mode: 'rest',
          totalScore: 12,
          components: [{ code: 'x', value: 1 }],
        },
      ],
    };
    // The command passes the boundary schema (external providers may score
    // their own internal options)...
    expect(
      workerCommandSchema.safeParse(cmd('submit-decision-response', { response: gatewayResponse }))
        .success,
    ).toBe(true);
    const responses = handleCommand(
      session,
      cmd('submit-decision-response', { response: gatewayResponse }),
    );
    expect(responses.some((r) => r.type === 'ack' && r.ok)).toBe(true);
    handleCommand(session, cmd('step', { ticks: 2 }));
    handleCommand(session, cmd('run-to-completion'));

    // ...and the recorded (rejected) response never invalidates the run's own
    // ledger: every event stays schema-exact and the export round-trips.
    const run = session.host.activeRun!;
    for (const event of run.ledger.events) {
      const problem = validateEventExact(JSON.parse(JSON.stringify(event)));
      expect(problem, `${event.id} (${event.type}): ${problem ?? ''}`).toBeNull();
    }
    const exported = session.host.exportLedger();
    const validated = validateLedgerFile(exported.json);
    expect(
      validated.issues.filter((i) => i.severity === 'error'),
      JSON.stringify(validated.issues.filter((i) => i.severity === 'error')),
    ).toEqual([]);
    expect(validated.ok).toBe(true);
  });

  it('oversized score arrays are rejected at the protocol boundary', () => {
    const huge = {
      responseId: 'gw-huge',
      requestId: 'dec-0001',
      npcId: 'mara',
      scenarioId: 'A',
      providerId: 'external-gateway',
      selectedAffordanceId: 'x',
      confidenceBp: 1,
      reasonCode: 'x',
      scores: Array.from({ length: 65 }, (_v, i) => ({
        affordanceId: `opt-${i}`,
        mode: 'rest',
        totalScore: 0,
        components: [],
      })),
    };
    const parsed = workerCommandSchema.safeParse(
      cmd('submit-decision-response', { response: huge }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe('actions interrupted mid-transit produce importable ledgers (review: lifecycle-without-start)', () => {
  it('an NPC still moving at scenario end exports a ledger that validates and imports', () => {
    const run = deferAllRun();
    stepTo(run, 2675);
    // Repeatedly offer Mara a travel-requiring choice until one is accepted
    // late enough that the scenario ends while the action is still moving.
    let movingActionId: string | null = null;
    for (let attempt = 0; attempt < 30 && movingActionId === null; attempt += 1) {
      const pending = run.state.npcs.mara.pendingDecision;
      const routine = pending?.offeredAffordances.find((a) => a.mode === 'routine-work');
      if (pending && routine) {
        const response: DecisionResponse = {
          responseId: `transit-${attempt}`,
          requestId: pending.requestId,
          npcId: 'mara',
          scenarioId: 'A',
          providerId: 'external-test',
          selectedAffordanceId: routine.id,
          confidenceBp: 5_000,
          reasonCode: 'external-test',
          scores: [],
        };
        run.responseInbox.push(response);
      }
      stepTick(run);
      const action = run.state.npcs.mara.currentAction;
      if (action && action.mode === 'routine-work' && action.phase === 'moving') {
        movingActionId = action.id;
      }
    }
    expect(movingActionId).not.toBeNull();
    stepTo(run, 2700);
    expect(run.state.terminal).toBe(true);

    // The moving action was interrupted at scenario end without ever starting.
    const interrupted = eventsOfType(run, 'ActionInterrupted').filter(
      (e) => (e.payload as { actionId: string }).actionId === movingActionId,
    );
    expect(interrupted).toHaveLength(1);
    const startedIds = new Set(
      eventsOfType(run, 'ActionStarted').map((e) => (e.payload as { actionId: string }).actionId),
    );
    expect(startedIds.has(movingActionId!)).toBe(false);

    const file = buildLedgerFile(run);
    const validated = validateLedgerFile(JSON.stringify(file));
    expect(
      validated.issues.filter((i) => i.severity === 'error'),
      JSON.stringify(validated.issues.filter((i) => i.severity === 'error')),
    ).toEqual([]);
    expect(validated.ok).toBe(true);
  });
});

describe('provisional bridge actions stay preemptible (review: non-interruptible bridge)', () => {
  it('a constraint-mandated provisional action launches interruptible and the pending request stays honourable', () => {
    const run = deferAllRun();
    stepTo(run, 179);
    // Rin idles at 180 under critical hunger with her own (legal) meal: the
    // survival override mandates eating, and `eat` is generated
    // non-interruptible — the provisional bridge must flip it.
    run.state.npcs.rin.hungerMicro = 980_000;
    stepTo(run, 181);
    const provisional = eventsOfType(run, 'FallbackDecisionUsed').find(
      (e) =>
        (e.payload as { npcId: string }).npcId === 'rin' &&
        (e.payload as { reasonCode: string }).reasonCode.startsWith('provisional:'),
    );
    expect(provisional).toBeDefined();
    const rin = run.state.npcs.rin;
    expect(rin.currentAction?.mode).toBe('eat');
    expect(rin.currentAction?.interruptible).toBe(true);
    expect(rin.pendingDecision).not.toBeNull();

    // After the travel leg, the eat action is active AND interruptible, so a
    // valid late response for the still-pending request is accepted.
    stepTo(run, 215);
    expect(rin.currentAction?.phase).toBe('active');
    const pendingNow = run.state.npcs.rin.pendingDecision;
    expect(pendingNow).not.toBeNull();
    const selected = pendingNow!.offeredAffordances.find((a) => a.mode === 'eat');
    expect(selected).toBeDefined();
    run.responseInbox.push({
      responseId: 'honour-1',
      requestId: pendingNow!.requestId,
      npcId: 'rin',
      scenarioId: 'A',
      providerId: 'external-test',
      selectedAffordanceId: selected!.id,
      confidenceBp: 9_000,
      reasonCode: 'external-test',
      scores: [],
    });
    stepTick(run);
    const accepted = eventsOfType(run, 'DecisionResponseAccepted').filter(
      (e) => (e.payload as { responseId: string }).responseId === 'honour-1',
    );
    expect(accepted).toHaveLength(1);
  });

  it('every provisionally launched action in a deferred run is interruptible', () => {
    const run = deferAllRun();
    stepTo(run, 600);
    const provisionalEventIds = new Set(
      eventsOfType(run, 'FallbackDecisionUsed')
        .filter((e) => (e.payload as { reasonCode: string }).reasonCode.startsWith('provisional:'))
        .map((e) => e.id),
    );
    expect(provisionalEventIds.size).toBeGreaterThan(0);
    const proposedByProvisional = eventsOfType(run, 'ActionProposed').filter(
      (e) => e.causationId !== null && provisionalEventIds.has(e.causationId),
    );
    expect(proposedByProvisional.length).toBeGreaterThan(0);
    for (const proposal of proposedByProvisional) {
      expect((proposal.payload as { interruptible: boolean }).interruptible).toBe(true);
    }
  });
});
