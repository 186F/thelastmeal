import type { EventEnvelope } from '../shared/events';
import {
  MODE_TO_CATEGORY,
  NPC_IDS,
  type ActionCategory,
  type ActionMode,
  type NpcId,
} from '../shared/ids';
import {
  CONTEXT_RICH_NOTE,
  type BehaviorOnlyTraceExport,
  type BehaviorTraceRow,
  type BlindingMap,
  type ContextRichTraceExport,
  type TraceRow,
} from '../shared/traces';
import type { ScenarioDefinition } from './scenarios/definitions';
import { severityBand } from './cognition/perception';
import { applyEvent } from './events/reduce';
import type { SimEvent } from './events/types';
import { buildInitialState } from './scenarios/initialState';

/**
 * Individuality traces (brief section 20; remediation 7).
 *
 * Both exports are built by folding the recorded ledger and sampling
 * structured context at every decision. This module is pure and
 * deterministic: the behavior-only export takes an externally generated
 * blinding map as a PARAMETER — no randomness (and no seed-derived label
 * permutation) exists inside the simulation core.
 */

interface DecisionSample {
  npcId: NpcId;
  row: TraceRow;
  behaviorFlags: string[];
  injurySeverityMicro: number;
}

function buildDecisionSamples(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
): Record<NpcId, DecisionSample[]> {
  const samples: Record<NpcId, DecisionSample[]> = { mara: [], jonas: [], rin: [] };
  const state = buildInitialState(scenario);

  interface PendingSample {
    npcId: NpcId;
    affordanceIds: string[];
    partialRow: Omit<TraceRow, 'chosenCategory' | 'chosenMode' | 'usedFallback' | 'outcome'>;
    behaviorFlags: string[];
    injurySeverityMicro: number;
  }
  const pendingByRequest = new Map<string, PendingSample>();
  const chosenAffordanceRows = new Map<string, TraceRow>(); // affordanceId -> row

  const completeSample = (
    requestId: string,
    npcId: NpcId,
    affordanceId: string,
    usedFallback: boolean,
  ): void => {
    const pending = pendingByRequest.get(requestId);
    if (!pending || pending.npcId !== npcId) return;
    const mode = modeFromAffordanceId(affordanceId);
    const row: TraceRow = {
      ...pending.partialRow,
      chosenCategory: mode ? MODE_TO_CATEGORY[mode] : 'rest-or-wait',
      chosenMode: mode ?? 'wait',
      usedFallback,
      outcome: affordanceId.includes(':continue:') ? 'continued' : 'started',
    };
    samples[npcId].push({
      npcId,
      row,
      behaviorFlags: pending.behaviorFlags,
      injurySeverityMicro: pending.injurySeverityMicro,
    });
    chosenAffordanceRows.set(affordanceId, row);
    pendingByRequest.delete(requestId);
  };

  for (const event of events) {
    // Sample the decision context BEFORE the event mutates state.
    if (event.type === 'DecisionRequested') {
      const p = event.payload as {
        npcId: NpcId;
        requestId: string;
        affordanceIds: string[];
      };
      const npc = state.npcs[p.npcId];
      const commitment = state.commitments.find(
        (c) => c.debtorId === p.npcId || c.creditorId === p.npcId,
      );
      const contextFlags: string[] = [];
      const behaviorFlags: string[] = [];
      if (state.meal.exists && state.meal.reservedForNpcId === p.npcId) {
        contextFlags.push('owns-meal-reservation'); // context-rich only (role leak)
      }
      if (!state.meal.exists) {
        contextFlags.push('meal-gone');
        behaviorFlags.push('meal-gone');
      }
      for (const otherId of NPC_IDS) {
        if (otherId !== p.npcId && state.npcs[otherId].injury.severityMicro > 0) {
          contextFlags.push('other-npc-injured');
          behaviorFlags.push('other-agent-injured');
          break;
        }
      }
      if (state.pendingTransferRequests.length > 0) {
        contextFlags.push('transfer-request-pending');
        behaviorFlags.push('resource-conflict-present');
      }
      if (state.commitments.some((c) => c.status === 'active')) {
        // Role-free: present for every actor whenever any obligation is live.
        behaviorFlags.push('obligation-present');
      }
      pendingByRequest.set(p.requestId, {
        npcId: p.npcId,
        affordanceIds: p.affordanceIds,
        partialRow: {
          tick: event.tick,
          hungerMicro: npc.hungerMicro,
          fatigueMicro: npc.fatigueMicro,
          injurySeverityMicro: npc.injury.severityMicro,
          availableCategories: uniqueCategories(p.affordanceIds),
          commitmentState: commitment
            ? `${commitment.debtorId === p.npcId ? 'debtor' : 'creditor'}-${commitment.status}`
            : 'none',
          contextFlags,
        },
        behaviorFlags,
        injurySeverityMicro: npc.injury.severityMicro,
      });
    }

    if (event.type === 'DecisionResponseAccepted') {
      const p = event.payload as {
        npcId: NpcId;
        requestId: string;
        selectedAffordanceId: string;
        usedFallback: boolean;
      };
      completeSample(p.requestId, p.npcId, p.selectedAffordanceId, p.usedFallback);
    }

    // Provisional fallback acts without consuming the request; record the
    // choice but keep the pending sample available for a later acceptance.
    if (event.type === 'FallbackDecisionUsed') {
      const p = event.payload as {
        npcId: NpcId;
        requestId: string;
        affordanceId: string;
        reasonCode: string;
      };
      if (p.reasonCode.startsWith('provisional:')) {
        completeSample(p.requestId, p.npcId, p.affordanceId, true);
      }
    }

    if (event.type === 'ActionRejected') {
      const p = event.payload as { affordanceId: string };
      const row = chosenAffordanceRows.get(p.affordanceId);
      if (row) row.outcome = 'rejected';
    }

    applyEvent(state, event as SimEvent);
  }

  return samples;
}

/** Context-rich diagnostic trace: real NPC ids, full context, labeled unsuitable
 * for role-blind evaluation. */
export function buildContextRichTraces(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
): ContextRichTraceExport {
  const samples = buildDecisionSamples(scenario, events);
  return {
    formatVersion: 2,
    mode: 'context-rich',
    note: CONTEXT_RICH_NOTE,
    scenarioId: scenario.id,
    seed: scenario.seed,
    traces: NPC_IDS.map((npcId) => ({
      actorId: npcId,
      rows: samples[npcId].map((s) => s.row),
    })),
  };
}

/**
 * Behavior-only blinded trace. The blinding map is generated OUTSIDE the
 * simulation core (cryptographic randomness) and injected; this function is
 * a pure projection. No names, no role facts, no scenario identity, no seed,
 * banded injuries, generalized context flags only.
 */
export function buildBehaviorOnlyTraces(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
  blinding: BlindingMap,
): BehaviorOnlyTraceExport {
  const samples = buildDecisionSamples(scenario, events);
  return {
    formatVersion: 2,
    mode: 'behavior-only',
    sessionLabel: blinding.sessionLabel,
    traces: NPC_IDS.map((npcId) => ({
      actorLabel: blinding.labelByNpc[npcId],
      rows: samples[npcId].map((s): BehaviorTraceRow => {
        return {
          tick: s.row.tick,
          hungerMicro: s.row.hungerMicro,
          fatigueMicro: s.row.fatigueMicro,
          injuryBand: severityBand(s.injurySeverityMicro) as BehaviorTraceRow['injuryBand'],
          availableCategories: s.row.availableCategories,
          chosenCategory: s.row.chosenCategory,
          chosenMode: s.row.chosenMode,
          contextFlags: [...s.behaviorFlags],
          usedFallback: s.row.usedFallback,
          outcome: s.row.outcome,
        };
      }),
    })),
  };
}

function uniqueCategories(affordanceIds: string[]): ActionCategory[] {
  const set = new Set<ActionCategory>();
  for (const id of affordanceIds) {
    const mode = modeFromAffordanceId(id);
    if (mode) set.add(MODE_TO_CATEGORY[mode]);
  }
  return [...set].sort();
}

/** Affordance IDs encode the mode: `aff:<npc>:<tick>:<mode>[:<target>]`. */
export function modeFromAffordanceId(id: string): ActionMode | null {
  const parts = id.split(':');
  let raw = parts[3] ?? null;
  if (raw === 'continue') raw = parts[4] ?? null;
  if (raw === null && id.startsWith('scripted:')) raw = id.slice('scripted:'.length);
  const modes = Object.keys(MODE_TO_CATEGORY) as ActionMode[];
  return raw !== null && (modes as string[]).includes(raw) ? (raw as ActionMode) : null;
}
