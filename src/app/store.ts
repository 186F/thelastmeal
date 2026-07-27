import type { ExternalDecisionRequest } from '../shared/decisionContracts';
import { BASELINE_CONDITION_ID } from '../shared/modelExperiment';
import type { ConditionId } from '../sim/decisions/conditions';
import type { ModelGatewayStatus } from './modelGatewayClient';
import type { EventEnvelope } from '../shared/events';
import type { NpcId, ScenarioId } from '../shared/ids';
import type { BatchReport } from '../shared/reports';
import type { PresentationSnapshot, RunStatus } from '../shared/snapshots';
import type { OperatorSpeed, ScenarioListing } from '../shared/workerProtocol';
import type { ValidationIssue } from '../shared/validation';
import type { AffordanceScoreRecord } from '../sim/events/types';

/**
 * Main-thread view store. Holds ONLY presentation state derived from worker
 * snapshots and responses. Nothing here is authoritative; the UI issues typed
 * commands and renders what comes back.
 */

export interface ViewState {
  connection: 'connecting' | 'ready';
  scenarios: ScenarioListing[];
  selectedScenarioId: ScenarioId;
  runStatus: RunStatus;
  speed: OperatorSpeed;
  snapshot: PresentationSnapshot | null;
  snapshotSeq: number;
  selectedNpcId: NpcId | null;
  eventLog: EventEnvelope[];
  eventTotal: number;
  lastDecisionScores: Partial<Record<NpcId, AffordanceScoreRecord[]>>;
  finalWorldHash: string | null;
  finalLedgerHash: string | null;
  /** Diagnostics log of external-gateway decision requests (capped). */
  externalDecisionRequests: ExternalDecisionRequest[];
  /** Registered experimental condition selected for the next load. */
  selectedConditionId: ConditionId;
  /** Model-integration diagnostics (milestone 001, section 18). */
  model: {
    gateway: ModelGatewayStatus | null;
    /** Engine acceptances of gateway-constructed responses (gw- prefix). */
    acceptedModelResponses: number;
    /** Engine DecisionResponseRejected counts by structured reason. */
    engineRejections: Record<string, number>;
  };
  replayResult: {
    ok: boolean;
    match: boolean;
    computedWorldStateHash: string | null;
    expectedWorldStateHash: string | null;
    computedLedgerHash: string | null;
    expectedLedgerHash: string | null;
    errors: string[];
  } | null;
  importResult: { ok: boolean; errors: string[]; scenarioId: ScenarioId | null } | null;
  batch: {
    running: boolean;
    progressText: string;
    report: BatchReport | null;
    reportJson: string | null;
    reportMarkdown: string | null;
  };
  validation: { ok: boolean; issues: ValidationIssue[] } | null;
  showScores: boolean;
  showEventLog: boolean;
  verboseEvents: boolean;
  commandsSent: number;
  responsesReceived: number;
  lastError: string | null;
}

const EVENT_LOG_CAP = 400;

export type Listener = (state: ViewState) => void;

export class ViewStore {
  readonly state: ViewState = {
    connection: 'connecting',
    scenarios: [],
    selectedScenarioId: 'A',
    runStatus: 'idle',
    speed: 1,
    snapshot: null,
    snapshotSeq: 0,
    selectedNpcId: null,
    eventLog: [],
    eventTotal: 0,
    lastDecisionScores: {},
    finalWorldHash: null,
    finalLedgerHash: null,
    externalDecisionRequests: [],
    selectedConditionId: BASELINE_CONDITION_ID,
    model: {
      gateway: null,
      acceptedModelResponses: 0,
      engineRejections: {},
    },
    replayResult: null,
    importResult: null,
    batch: {
      running: false,
      progressText: '',
      report: null,
      reportJson: null,
      reportMarkdown: null,
    },
    validation: null,
    showScores: false,
    showEventLog: true,
    verboseEvents: false,
    commandsSent: 0,
    responsesReceived: 0,
    lastError: null,
  };

  private listeners: Listener[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  update(mutate: (state: ViewState) => void): void {
    mutate(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  appendEvents(events: EventEnvelope[], totalCount: number): void {
    this.update((s) => {
      s.eventTotal = totalCount;
      for (const event of events) {
        if (event.type === 'DecisionResponseReceived') {
          const payload = event.payload as {
            npcId: NpcId;
            scores: AffordanceScoreRecord[];
          };
          if (payload.scores.length > 0) {
            s.lastDecisionScores[payload.npcId] = payload.scores;
          }
        } else if (event.type === 'DecisionResponseAccepted') {
          const payload = event.payload as { responseId: string };
          if (payload.responseId.startsWith('gw-')) {
            s.model.acceptedModelResponses += 1;
          }
        } else if (event.type === 'DecisionResponseRejected') {
          const payload = event.payload as { rejectionReason: string };
          s.model.engineRejections[payload.rejectionReason] =
            (s.model.engineRejections[payload.rejectionReason] ?? 0) + 1;
        }
      }
      s.eventLog.push(...events);
      if (s.eventLog.length > EVENT_LOG_CAP) {
        s.eventLog.splice(0, s.eventLog.length - EVENT_LOG_CAP);
      }
    });
  }

  resetRunViews(): void {
    this.update((s) => {
      s.eventLog = [];
      s.eventTotal = 0;
      s.lastDecisionScores = {};
      s.finalWorldHash = null;
      s.finalLedgerHash = null;
      s.externalDecisionRequests = [];
      s.model.acceptedModelResponses = 0;
      s.model.engineRejections = {};
      s.replayResult = null;
    });
  }
}
