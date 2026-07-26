import { PROTOCOL_VERSION } from '../shared/versions';
import type { RunStatus } from '../shared/snapshots';
import type { OperatorSpeed, WorkerCommand, WorkerResponse } from '../shared/workerProtocol';
import { runFullBatch } from '../sim/batch';
import { renderMarkdownReport } from '../sim/reporting';
import { SimulationHost } from '../sim/runtime/host';
import { validateExperimentData } from '../sim/validation/validateData';
import { buildFinalSummary } from '../sim/reporting';

/**
 * Platform-independent worker command semantics. The browser worker shell
 * (simWorker.ts) wires this to postMessage and a pacing timer; Node tests
 * drive it directly with the same typed commands, which is what guarantees
 * browser-worker and headless execution share command behavior.
 *
 * The processor mutates only its own WorkerSession bookkeeping; canonical
 * state stays inside the SimulationHost / engine.
 */

export class WorkerSession {
  readonly host = new SimulationHost();
  runStatus: RunStatus = 'idle';
  speed: OperatorSpeed = 1;
  snapshotSeq = 0;
  lastSentEventSeq = 0;
  completionAnnounced = false;

  /** True while the pacing loop should be stepping ticks. */
  get isRunning(): boolean {
    return this.runStatus === 'running';
  }
}

export function handleCommand(session: WorkerSession, command: WorkerCommand): WorkerResponse[] {
  const out: WorkerResponse[] = [];
  const ack = (
    ok: boolean,
    errorCode: string | null = null,
    message: string | null = null,
  ): void => {
    out.push({
      protocolVersion: PROTOCOL_VERSION,
      type: 'ack',
      commandId: command.commandId,
      ok,
      errorCode,
      message,
    });
  };

  const refreshAfterMutation = (): void => {
    syncTerminalStatus(session);
    pushSnapshot(session, out);
    pushNewEvents(session, out);
    pushExternalDecisionRequests(session, out);
  };

  try {
    switch (command.type) {
      case 'hello': {
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'ready',
          scenarios: session.host.listScenarios().map((s) => ({
            id: s.id,
            version: s.version,
            seed: s.seed,
            title: s.title,
            description: s.description,
          })),
          providerId: session.host.providerId,
        });
        ack(true);
        break;
      }

      case 'load-scenario': {
        session.host.loadScenario(command.scenarioId);
        session.runStatus = 'idle';
        session.lastSentEventSeq = 0;
        session.completionAnnounced = false;
        ack(true);
        refreshAfterMutation();
        break;
      }

      case 'start': {
        requireLoaded(session);
        if (session.host.terminal) {
          ack(false, 'run-already-complete');
          break;
        }
        session.runStatus = 'running';
        ack(true);
        pushSnapshot(session, out);
        break;
      }

      case 'pause': {
        requireLoaded(session);
        if (session.runStatus === 'running') {
          session.host.markPaused();
          session.runStatus = 'paused';
        }
        ack(true);
        refreshAfterMutation();
        break;
      }

      case 'resume': {
        requireLoaded(session);
        if (session.runStatus === 'paused') {
          session.host.markResumed();
          session.runStatus = 'running';
        }
        ack(true);
        refreshAfterMutation();
        break;
      }

      case 'set-speed': {
        session.speed = command.speed;
        ack(true);
        pushSnapshot(session, out);
        break;
      }

      case 'step': {
        requireLoaded(session);
        if (session.runStatus === 'running') {
          ack(false, 'cannot-step-while-running');
          break;
        }
        session.host.stepTicks(command.ticks);
        ack(true);
        refreshAfterMutation();
        maybeAnnounceCompletion(session, out);
        break;
      }

      case 'run-to-completion': {
        requireLoaded(session);
        session.host.runToCompletion();
        session.runStatus = 'complete';
        ack(true);
        refreshAfterMutation();
        maybeAnnounceCompletion(session, out);
        break;
      }

      case 'reset': {
        requireLoaded(session);
        session.host.reset();
        session.runStatus = 'idle';
        session.lastSentEventSeq = 0;
        session.completionAnnounced = false;
        ack(true);
        refreshAfterMutation();
        break;
      }

      case 'run-batch': {
        const batch = runFullBatch({
          runsPerScenario: 1,
          onProgress: (completed, total, scenarioId) => {
            out.push({
              protocolVersion: PROTOCOL_VERSION,
              type: 'batch-progress',
              completed,
              total,
              currentScenarioId: scenarioId,
            });
          },
        });
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'batch-result',
          report: batch.report,
          reportJson: JSON.stringify(batch.report, null, 2),
          reportMarkdown: renderMarkdownReport(batch.report),
        });
        ack(true);
        break;
      }

      case 'export-ledger': {
        requireLoaded(session);
        const exported = session.host.exportLedger();
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'ledger-export',
          fileName: exported.fileName,
          json: exported.json,
        });
        ack(true);
        break;
      }

      case 'import-ledger': {
        // Import performs a full isolated replay plus invariant and hash
        // recomputation (remediation 3); surface an 'importing' status for
        // its duration like the existing 'replaying' transition.
        const statusBefore = session.runStatus;
        if (session.host.scenarioId !== null) {
          session.runStatus = 'importing';
          pushSnapshot(session, out);
        }
        const result = session.host.importLedger(command.fileText);
        session.runStatus = statusBefore;
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'import-result',
          ok: result.ok,
          errors: result.issues
            .filter((i) => i.severity === 'error')
            .map((i) => `${i.code}: ${i.message}${i.where ? ` [${i.where}]` : ''}`),
          scenarioId: result.scenarioId,
        });
        ack(result.ok, result.ok ? null : 'import-validation-failed');
        if (session.host.scenarioId !== null) {
          pushSnapshot(session, out);
        }
        break;
      }

      case 'replay': {
        // Surface the required 'replaying' run state for the duration of the
        // replay (synchronous here, but the operator sees the transition).
        const statusBefore = session.runStatus;
        if (session.host.scenarioId !== null) {
          session.runStatus = 'replaying';
          pushSnapshot(session, out);
        }
        const outcome = session.host.replay(command.source);
        session.runStatus = statusBefore;
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'replay-result',
          ok: outcome.ok,
          match: outcome.match,
          computedWorldStateHash: outcome.computedWorldStateHash,
          expectedWorldStateHash: outcome.expectedWorldStateHash,
          computedLedgerHash: outcome.computedLedgerHash,
          expectedLedgerHash: outcome.expectedLedgerHash,
          errors: outcome.errors,
        });
        ack(outcome.ok, outcome.ok ? null : (outcome.errors[0] ?? 'replay-failed'));
        if (session.host.scenarioId !== null) {
          pushSnapshot(session, out);
        }
        break;
      }

      case 'submit-decision-response': {
        requireLoaded(session);
        if (session.host.terminal) {
          ack(false, 'run-already-complete');
          break;
        }
        // Queued only: the response drains at the fixed point inside the
        // next processed tick, never mid-command, so outcomes stay
        // batch-size independent.
        session.host.submitDecisionResponse(command.response);
        ack(true);
        break;
      }

      case 'export-traces': {
        requireLoaded(session);
        const exported = session.host.exportTraces();
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'traces-export',
          fileName: exported.fileName,
          json: exported.json,
        });
        ack(true);
        break;
      }

      case 'export-batch-report': {
        // The batch result already carries reportJson/reportMarkdown; this
        // command exists so the UI can re-request a fresh batch report.
        const batch = runFullBatch({ runsPerScenario: 1 });
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'batch-result',
          report: batch.report,
          reportJson: JSON.stringify(batch.report, null, 2),
          reportMarkdown: renderMarkdownReport(batch.report),
        });
        ack(true);
        break;
      }

      case 'validate-config': {
        const result = validateExperimentData();
        out.push({
          protocolVersion: PROTOCOL_VERSION,
          type: 'validation-result',
          ok: result.ok,
          issues: result.issues,
        });
        ack(true);
        break;
      }

      default: {
        const exhaustive: never = command;
        ack(false, 'unknown-command', `Unhandled command ${(exhaustive as WorkerCommand).type}`);
      }
    }
  } catch (error) {
    ack(false, 'command-failed', (error as Error).message);
  }
  return out;
}

/** Called by the pacing loop after stepping ticks while running. */
export function afterTickBatch(session: WorkerSession): WorkerResponse[] {
  const out: WorkerResponse[] = [];
  syncTerminalStatus(session);
  pushSnapshot(session, out);
  pushNewEvents(session, out);
  pushExternalDecisionRequests(session, out);
  maybeAnnounceCompletion(session, out);
  return out;
}

function requireLoaded(session: WorkerSession): void {
  if (session.host.scenarioId === null) {
    throw new Error('no-scenario-loaded');
  }
}

function syncTerminalStatus(session: WorkerSession): void {
  if (session.host.scenarioId !== null && session.host.terminal) {
    session.runStatus = 'complete';
  }
}

function pushSnapshot(session: WorkerSession, out: WorkerResponse[]): void {
  if (session.host.scenarioId === null) return;
  session.snapshotSeq += 1;
  out.push({
    protocolVersion: PROTOCOL_VERSION,
    type: 'snapshot',
    snapshotSeq: session.snapshotSeq,
    runStatus: session.runStatus,
    speed: session.speed,
    snapshot: session.host.snapshot(),
  });
}

function pushNewEvents(session: WorkerSession, out: WorkerResponse[]): void {
  if (session.host.scenarioId === null) return;
  const events = session.host.eventsSince(session.lastSentEventSeq);
  if (events.length === 0) return;
  session.lastSentEventSeq += events.length;
  out.push({
    protocolVersion: PROTOCOL_VERSION,
    type: 'events',
    events,
    totalCount: session.lastSentEventSeq,
  });
}

/** Forward pending external decision requests (diagnostics-only seam). */
function pushExternalDecisionRequests(session: WorkerSession, out: WorkerResponse[]): void {
  if (session.host.scenarioId === null) return;
  for (const request of session.host.drainExternalDecisionRequests()) {
    out.push({ protocolVersion: PROTOCOL_VERSION, type: 'decision-request', request });
  }
}

function maybeAnnounceCompletion(session: WorkerSession, out: WorkerResponse[]): void {
  const host = session.host;
  if (host.scenarioId === null || !host.terminal || session.completionAnnounced) return;
  const run = host.activeRun;
  if (!run || run.worldStateHash === null || run.canonicalLedgerHash === null) return;
  session.completionAnnounced = true;
  out.push({
    protocolVersion: PROTOCOL_VERSION,
    type: 'run-complete',
    scenarioId: host.scenarioId,
    worldStateHash: run.worldStateHash,
    canonicalLedgerHash: run.canonicalLedgerHash,
    summary: buildFinalSummary(run.state, run.ledger.events),
  });
}
