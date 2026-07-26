import type { EventEnvelope } from '../shared/events';
import {
  MODE_TO_CATEGORY,
  NPC_IDS,
  type ActionCategory,
  type ActionMode,
  type NpcId,
} from '../shared/ids';
import type { AnonymizedTrace, TraceExport, TraceRow } from '../shared/traces';
import type { ScenarioDefinition } from './scenarios/definitions';
import { applyEvent } from './events/reduce';
import type { SimEvent } from './events/types';
import { buildInitialState } from './scenarios/initialState';

/**
 * Anonymized individuality traces (brief section 20).
 *
 * Built by folding the recorded ledger and sampling structured context at
 * every decision. NPC names are replaced with stable scrambled actor labels
 * (a deterministic seed-derived permutation) so a human reviewer must infer
 * identity from behavior alone. No trait labels or biography text appear.
 */
export function buildAnonymizedTraces(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
): TraceExport {
  const rowsByNpc: Record<NpcId, TraceRow[]> = { mara: [], jonas: [], rin: [] };
  const state = buildInitialState(scenario);

  interface PendingDecision {
    npcId: NpcId;
    tick: number;
    affordanceIds: string[];
    row: Partial<TraceRow>;
  }
  const pendingByRequest = new Map<string, PendingDecision>();
  const chosenAffordanceRows = new Map<string, TraceRow>(); // affordanceId -> row

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
      if (state.meal.exists && state.meal.reservedForNpcId === p.npcId) {
        contextFlags.push('owns-meal-reservation');
      }
      if (!state.meal.exists) contextFlags.push('meal-gone');
      for (const otherId of NPC_IDS) {
        if (otherId !== p.npcId && state.npcs[otherId].injury.severityMicro > 0) {
          contextFlags.push('other-npc-injured');
          break;
        }
      }
      if (state.pendingTransferRequests.length > 0) contextFlags.push('transfer-request-pending');
      pendingByRequest.set(p.requestId, {
        npcId: p.npcId,
        tick: event.tick,
        affordanceIds: p.affordanceIds,
        row: {
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
      });
    }

    if (event.type === 'DecisionReturned' || event.type === 'FallbackDecisionUsed') {
      const p = event.payload as { npcId: NpcId; requestId: string; affordanceId: string };
      const pending = pendingByRequest.get(p.requestId);
      if (pending) {
        const mode = modeFromAffordanceId(p.affordanceId);
        const row: TraceRow = {
          ...(pending.row as TraceRow),
          chosenCategory: mode ? MODE_TO_CATEGORY[mode] : 'rest-or-wait',
          chosenMode: mode ?? 'wait',
          usedFallback: event.type === 'FallbackDecisionUsed',
          outcome: p.affordanceId.includes(':continue:') ? 'continued' : 'started',
        };
        rowsByNpc[p.npcId].push(row);
        chosenAffordanceRows.set(p.affordanceId, row);
        pendingByRequest.delete(p.requestId);
      }
    }

    if (event.type === 'ActionRejected') {
      const p = event.payload as { affordanceId: string };
      const row = chosenAffordanceRows.get(p.affordanceId);
      if (row) row.outcome = 'rejected';
    }

    applyEvent(state, event as SimEvent);
  }

  // Deterministic, seed-derived label permutation.
  const perms: NpcId[][] = permutations(NPC_IDS as readonly NpcId[]);
  const perm = perms[scenario.seed % perms.length]!;
  const traces: AnonymizedTrace[] = perm.map((npcId, index) => ({
    scenarioId: scenario.id,
    seed: scenario.seed,
    actorLabel: `actor-${index + 1}`,
    rows: rowsByNpc[npcId],
  }));

  return { formatVersion: 1, scenarioId: scenario.id, seed: scenario.seed, traces };
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

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}
