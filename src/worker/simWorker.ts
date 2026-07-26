import { PROTOCOL_VERSION } from '../shared/versions';
import { workerCommandSchema, type WorkerResponse } from '../shared/workerProtocol';
import { CommandGate } from './commandGate';
import { afterTickBatch, handleCommand, WorkerSession } from './commandProcessor';

/**
 * Dedicated simulation Web Worker.
 *
 * This shell owns only transport and pacing: it validates incoming commands,
 * enforces command ordering, delegates semantics to the shared command
 * processor, and paces the logical clock. Wall-clock timing here decides only
 * WHEN ticks are processed — never their outcome. A throttled or delayed
 * worker catches up in deterministic whole ticks.
 */

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;
const session = new WorkerSession();
const gate = new CommandGate();

const post = (response: WorkerResponse): void => {
  scope.postMessage(response);
};
const postAll = (responses: WorkerResponse[]): void => {
  for (const r of responses) post(r);
};

// --- Pacing loop ------------------------------------------------------------
// 1x/5x/20x are ticks of simulated time per wall-clock second. Elapsed wall
// time only accumulates a whole-tick budget; outcomes stay identical across
// display rates, tab throttling, and worker delays.

const PUMP_INTERVAL_MS = 50;
const MAX_TICKS_PER_PUMP = 400;
let lastPumpMs: number | null = null;
let tickBudget = 0;

setInterval(() => {
  const now = Date.now();
  if (!session.isRunning) {
    lastPumpMs = now;
    return;
  }
  if (lastPumpMs === null) lastPumpMs = now;
  const elapsedSeconds = Math.max(0, now - lastPumpMs) / 1000;
  lastPumpMs = now;
  tickBudget += elapsedSeconds * session.speed;
  const ticksToRun = Math.min(Math.floor(tickBudget), MAX_TICKS_PER_PUMP);
  if (ticksToRun <= 0) return;
  tickBudget -= ticksToRun;
  session.host.stepTicks(ticksToRun);
  postAll(afterTickBatch(session));
}, PUMP_INTERVAL_MS);

// --- Command transport --------------------------------------------------------

scope.onmessage = (event: MessageEvent) => {
  const parsed = workerCommandSchema.safeParse(event.data);
  if (!parsed.success) {
    post({
      protocolVersion: PROTOCOL_VERSION,
      type: 'ack',
      commandId:
        typeof (event.data as { commandId?: unknown })?.commandId === 'string'
          ? (event.data as { commandId: string }).commandId
          : 'unknown',
      ok: false,
      errorCode: 'invalid-command-schema',
      message: parsed.error.issues[0]?.message ?? 'schema validation failed',
    });
    return;
  }
  const command = parsed.data;
  const gateResult = gate.check(command);
  if (!gateResult.ok) {
    post({
      protocolVersion: PROTOCOL_VERSION,
      type: 'ack',
      commandId: command.commandId,
      ok: false,
      errorCode: gateResult.errorCode,
      message: null,
    });
    return;
  }
  if (command.type === 'start' || command.type === 'resume') {
    // Restart pacing cleanly so a long-idle worker doesn't "catch up".
    lastPumpMs = Date.now();
    tickBudget = 0;
  }
  postAll(handleCommand(session, command));
};
