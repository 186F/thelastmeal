import { PROTOCOL_VERSION } from '../shared/versions';
import type { ScenarioId } from '../shared/ids';
import {
  workerEventsResponseSchema,
  workerResponseEnvelopeSchema,
  type OperatorSpeed,
  type WorkerCommand,
  type WorkerResponse,
} from '../shared/workerProtocol';
import { presentationSnapshotSchema } from '../shared/snapshotSchema';
import type { ViewStore } from './store';

/**
 * Typed client for the simulation worker. Owns the worker lifecycle (single
 * owner; terminated cleanly on teardown and dev hot reload), assigns stable
 * command IDs and strictly increasing sequence numbers, validates response
 * envelopes, and routes results into the view store.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type OutgoingCommand = DistributiveOmit<
  WorkerCommand,
  'protocolVersion' | 'commandId' | 'commandSeq'
>;

export class WorkerClient {
  private readonly worker: Worker;
  private commandSeq = 0;
  private terminated = false;

  constructor(
    private readonly store: ViewStore,
    private readonly onDownload: (fileName: string, text: string, mime: string) => void,
  ) {
    this.worker = new Worker(new URL('../worker/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => {
      this.store.update((s) => {
        s.lastError = `worker-error: ${event.message}`;
      });
    };
    this.send({ type: 'hello' });
  }

  send(command: OutgoingCommand): void {
    if (this.terminated) return;
    this.commandSeq += 1;
    const full = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: `cmd-${String(this.commandSeq).padStart(5, '0')}`,
      commandSeq: this.commandSeq,
      ...command,
    } as WorkerCommand;
    this.store.update((s) => {
      s.commandsSent += 1;
    });
    this.worker.postMessage(full);
  }

  loadScenario(id: ScenarioId): void {
    this.store.resetRunViews();
    this.send({ type: 'load-scenario', scenarioId: id });
  }
  start(): void {
    this.send({ type: 'start' });
  }
  pause(): void {
    this.send({ type: 'pause' });
  }
  resume(): void {
    this.send({ type: 'resume' });
  }
  reset(): void {
    this.store.resetRunViews();
    this.send({ type: 'reset' });
  }
  step(ticks = 1): void {
    this.send({ type: 'step', ticks });
  }
  setSpeed(speed: OperatorSpeed): void {
    this.send({ type: 'set-speed', speed });
  }
  runToCompletion(): void {
    this.send({ type: 'run-to-completion' });
  }
  runBatch(): void {
    this.store.update((s) => {
      s.batch = {
        running: true,
        progressText: 'starting…',
        report: null,
        reportJson: null,
        reportMarkdown: null,
      };
    });
    this.send({ type: 'run-batch' });
  }
  exportLedger(): void {
    this.send({ type: 'export-ledger' });
  }
  importLedger(fileText: string): void {
    // A new import invalidates any prior replay verdict.
    this.store.update((s) => {
      s.replayResult = null;
      s.importResult = null;
    });
    this.send({ type: 'import-ledger', fileText });
  }
  replay(source: 'imported' | 'live'): void {
    // Clear the previous verdict so a failed replay can never leave a stale
    // "match" on screen; the replay-result response repopulates it.
    this.store.update((s) => {
      s.replayResult = null;
    });
    this.send({ type: 'replay', source });
  }
  exportTraces(): void {
    this.send({ type: 'export-traces' });
  }
  validateConfig(): void {
    this.send({ type: 'validate-config' });
  }

  terminate(): void {
    this.terminated = true;
    this.worker.terminate();
  }

  private handleMessage(data: unknown): void {
    const envelope = workerResponseEnvelopeSchema.safeParse(data);
    if (!envelope.success) {
      this.store.update((s) => {
        s.lastError = 'invalid-worker-response';
      });
      return;
    }
    const response = data as WorkerResponse;
    this.store.update((s) => {
      s.responsesReceived += 1;
    });

    switch (response.type) {
      case 'ready':
        this.store.update((s) => {
          s.connection = 'ready';
          s.scenarios = response.scenarios;
        });
        break;
      case 'ack':
        if (!response.ok) {
          this.store.update((s) => {
            s.lastError = `${response.errorCode ?? 'command-rejected'}${response.message ? `: ${response.message}` : ''}`;
          });
        }
        break;
      case 'snapshot': {
        // Full payload-level schema validation at the worker boundary.
        const parsed = presentationSnapshotSchema.safeParse(response.snapshot);
        if (!parsed.success) {
          this.store.update((s) => {
            s.lastError = `invalid-snapshot-payload: ${parsed.error.issues[0]?.message ?? ''}`;
          });
          break;
        }
        this.store.update((s) => {
          s.snapshot = response.snapshot;
          s.snapshotSeq = response.snapshotSeq;
          s.runStatus = response.runStatus;
          s.speed = response.speed;
        });
        break;
      }
      case 'events': {
        const parsed = workerEventsResponseSchema.safeParse(response);
        if (!parsed.success) {
          this.store.update((s) => {
            s.lastError = `invalid-events-payload: ${parsed.error.issues[0]?.message ?? ''}`;
          });
          break;
        }
        this.store.appendEvents(response.events, response.totalCount);
        break;
      }
      case 'run-complete':
        this.store.update((s) => {
          s.finalHash = response.finalStateHash;
          s.runStatus = 'complete';
        });
        break;
      case 'ledger-export':
        this.onDownload(response.fileName, response.json, 'application/json');
        break;
      case 'traces-export':
        this.onDownload(response.fileName, response.json, 'application/json');
        break;
      case 'import-result':
        this.store.update((s) => {
          s.importResult = {
            ok: response.ok,
            errors: response.errors,
            scenarioId: response.scenarioId,
          };
        });
        break;
      case 'replay-result':
        this.store.update((s) => {
          s.replayResult = {
            ok: response.ok,
            match: response.match,
            computedHash: response.computedHash,
            expectedHash: response.expectedHash,
            errors: response.errors,
          };
        });
        break;
      case 'batch-progress':
        this.store.update((s) => {
          s.batch.running = true;
          s.batch.progressText = `${response.completed}/${response.total} (${response.currentScenarioId})`;
        });
        break;
      case 'batch-result':
        this.store.update((s) => {
          s.batch = {
            running: false,
            progressText: `done — ${response.report.ok ? 'PASS' : 'FAIL'}`,
            report: response.report,
            reportJson: response.reportJson,
            reportMarkdown: response.reportMarkdown,
          };
        });
        break;
      case 'validation-result':
        this.store.update((s) => {
          s.validation = { ok: response.ok, issues: response.issues };
        });
        break;
      case 'fatal':
        this.store.update((s) => {
          s.lastError = `worker-fatal: ${response.message}`;
        });
        break;
      default:
        break;
    }
  }
}
