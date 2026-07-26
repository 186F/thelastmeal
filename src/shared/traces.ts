import type { ActionCategory, ActionMode, NpcId, ScenarioId } from './ids';

/**
 * Individuality traces (brief section 20; hardened per remediation 7).
 *
 * Two distinct export modes:
 *
 * CONTEXT-RICH — full structured context under REAL NPC ids, for qualitative
 * debugging. Explicitly labeled unsuitable for measuring personality
 * recognition independently of role: unique role facts (meal ownership,
 * debtor/creditor role, exact injury magnitudes) identify each actor
 * trivially.
 *
 * BEHAVIOR-ONLY — blinded rows for reviewer evaluation. Contains no NPC
 * names, no meal-owner identity, no debtor/creditor role, no trait names, no
 * biography or memory prose, no scenario id or seed, and no exact injury
 * magnitude (banded instead). Actor labels come from an externally supplied
 * blinding map generated with cryptographic randomness OUTSIDE the
 * deterministic simulation core; the map is never derived from the public
 * scenario seed and never affects simulation state or hashes. The label ->
 * NPC mapping ships only in a separate answer-key file.
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

export type InjuryBand = 'none' | 'minor' | 'serious' | 'incapacitating';

export interface BehaviorTraceRow {
  tick: number;
  hungerMicro: number;
  fatigueMicro: number;
  injuryBand: InjuryBand;
  availableCategories: ActionCategory[];
  chosenCategory: ActionCategory;
  chosenMode: ActionMode;
  /** Generalized, role-free context flags only: 'resource-conflict-present',
   * 'obligation-present', 'other-agent-injured', 'meal-gone'. */
  contextFlags: string[];
  usedFallback: boolean;
  outcome: 'started' | 'rejected' | 'continued';
}

export interface ContextRichTrace {
  actorId: NpcId;
  rows: TraceRow[];
}

export interface ContextRichTraceExport {
  formatVersion: 2;
  mode: 'context-rich';
  /** Explicit suitability label (remediation 7, section 11.2). */
  note: string;
  scenarioId: ScenarioId;
  seed: number;
  traces: ContextRichTrace[];
}

export interface BlindedTrace {
  actorLabel: string;
  rows: BehaviorTraceRow[];
}

export interface BehaviorOnlyTraceExport {
  formatVersion: 2;
  mode: 'behavior-only';
  /** Opaque session label; the scenario identity ships only in the answer key. */
  sessionLabel: string;
  traces: BlindedTrace[];
}

/** Externally generated blinding assignment (crypto randomness, not seed-derived). */
export interface BlindingMap {
  sessionLabel: string;
  labelByNpc: Record<NpcId, string>;
}

/** The answer key: exported separately, never inside a reviewer package. */
export interface BlindingAnswerKey {
  sessionLabel: string;
  scenarioId: ScenarioId;
  seed: number;
  evalVersion: string | null;
  labelByNpc: Record<NpcId, string>;
}

export const CONTEXT_RICH_NOTE =
  'Context-rich diagnostic trace. UNSUITABLE for measuring personality recognition independently of role: role facts (meal ownership, commitment roles, injury magnitudes) identify actors regardless of labels.';
