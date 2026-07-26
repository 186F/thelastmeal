import type { ActionCategory, NpcId, ScenarioId } from './ids';

/** Machine-readable batch report structures (brief section 18). */

export interface RelationshipValue {
  fromNpcId: NpcId;
  toNpcId: NpcId;
  valueMicro: number;
}

export interface TreatmentOutcome {
  healerId: NpcId;
  patientId: NpcId;
  finalSeverityMicro: number;
  completedTick: number;
}

export type PromiseOutcome =
  'fulfilled' | 'fulfilled-after-renegotiation' | 'broken' | 'broken-after-renegotiation' | 'none';

export interface NpcActionStats {
  /** Number of started actions per category. */
  actionCounts: Record<ActionCategory, number>;
  /** Ticks spent in the active phase per category. */
  ticksByCategory: Record<ActionCategory, number>;
}

export interface FinalSummary {
  tick: number;
  taskOutcome: 'completed' | 'deadline-missed';
  progressUnits: number;
  mealConsumedBy: NpcId | null;
  promiseOutcome: PromiseOutcome;
  ownershipViolationCount: number;
  eventCount: number;
}

export interface ScenarioReportRow {
  scenarioId: ScenarioId;
  scenarioVersion: string;
  seed: number;
  finalProgressUnits: number;
  finalProgressPctTimes100: number; // integer: percent * 100, e.g. 10000 == 100.00%
  taskOutcome: 'completed' | 'deadline-missed';
  mealConsumedBy: NpcId | null;
  mealConsumedViaViolation: boolean;
  ownershipViolationCount: number;
  promiseOutcome: PromiseOutcome;
  treatmentOutcome: TreatmentOutcome | null;
  decisionProviderFailureCount: number;
  rejectedActionCount: number;
  interruptedActionCount: number;
  finalRelationships: RelationshipValue[];
  eventCount: number;
  worldStateHash: string;
  canonicalLedgerHash: string;
  /** Reducer-only replay reproduced the semantic world-state hash. */
  replayHashMatch: boolean;
  npcStats: Record<NpcId, NpcActionStats>;
}

/** Comparison of Mara's persistence between B1 (memory) and B2 (no memory). */
export interface MaraPersistenceStats {
  workTicks: number;
  workActionCount: number;
  breakRequestCount: number;
  firstBreakRequestTick: number | null;
  restOrWaitTicks: number;
  helpRequestCount: number;
  firstNonWorkChoiceTick: number | null;
}

export interface MemoryComparison {
  b1: MaraPersistenceStats;
  b2: MaraPersistenceStats;
  workTickDelta: number;
  distinctBehaviorObserved: boolean;
}

export interface DeterminismReport {
  runsPerScenario: number;
  allHashesStable: boolean;
  /** Every repeat run's complete canonical event stream matched run 1. */
  allEventStreamsStable: boolean;
  invariantViolations: string[];
}

export interface BatchReport {
  experimentId: string;
  configVersion: string;
  schemaVersion: number;
  scenarios: ScenarioReportRow[];
  determinism: DeterminismReport;
  memoryComparison: MemoryComparison;
  ok: boolean;
}
