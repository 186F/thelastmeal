import type { ActionCategory, ActionMode, ScenarioId } from './ids';

/**
 * Anonymized individuality traces (brief section 20).
 *
 * Traces deliberately omit NPC names, trait labels, and biography text.
 * Actor labels are stable but scrambled per export so a reviewer must infer
 * identity from behavior alone.
 */

export interface TraceRow {
  tick: number;
  hungerMicro: number;
  fatigueMicro: number;
  injurySeverityMicro: number;
  availableCategories: ActionCategory[];
  chosenCategory: ActionCategory;
  chosenMode: ActionMode;
  /** Structured commitment context, e.g. 'debtor-active', 'creditor-active', 'none'. */
  commitmentState: string;
  /** Structured context flags, e.g. 'owns-meal-reservation', 'other-npc-injured'. */
  contextFlags: string[];
  usedFallback: boolean;
  outcome: 'started' | 'rejected' | 'continued';
}

export interface AnonymizedTrace {
  scenarioId: ScenarioId;
  seed: number;
  actorLabel: string; // 'actor-1' | 'actor-2' | 'actor-3'
  rows: TraceRow[];
}

export interface TraceExport {
  formatVersion: number;
  scenarioId: ScenarioId;
  seed: number;
  traces: AnonymizedTrace[];
}
