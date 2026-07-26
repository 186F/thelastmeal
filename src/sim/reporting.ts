import type { EventEnvelope } from '../shared/events';
import { ACTION_CATEGORIES, NPC_IDS, type ActionCategory, type NpcId } from '../shared/ids';
import type {
  FinalSummary,
  NpcActionStats,
  PromiseOutcome,
  ScenarioReportRow,
  TreatmentOutcome,
  BatchReport,
} from '../shared/reports';
import { REPAIR_UNITS_PER_PERCENT_POINT } from './config';
import type { CanonicalState } from './domain/state';
import type { ScenarioDefinition } from './scenarios/definitions';
import { formatTickClock } from '../shared/units';

/** Ledger + final-state analysis shared by exports, reports, and tests. */

export function promiseOutcomeOf(state: CanonicalState): PromiseOutcome {
  const c = state.commitments[0];
  if (!c) return 'none';
  if (c.status === 'fulfilled') {
    return c.renegotiated ? 'fulfilled-after-renegotiation' : 'fulfilled';
  }
  if (c.status === 'broken') {
    return c.renegotiated ? 'broken-after-renegotiation' : 'broken';
  }
  return 'none';
}

export function buildFinalSummary(
  state: CanonicalState,
  events: readonly EventEnvelope[],
): FinalSummary {
  if (state.taskOutcome === 'pending') {
    throw new Error('summary-requires-terminal-state');
  }
  return {
    tick: state.tick,
    taskOutcome: state.taskOutcome,
    progressUnits: state.purifier.progressUnits,
    mealConsumedBy: state.meal.consumedByNpcId,
    promiseOutcome: promiseOutcomeOf(state),
    ownershipViolationCount: events.filter((e) => e.type === 'OwnershipViolated').length,
    eventCount: events.length,
  };
}

export function buildNpcStats(events: readonly EventEnvelope[]): Record<NpcId, NpcActionStats> {
  const stats = {} as Record<NpcId, NpcActionStats>;
  for (const npcId of NPC_IDS) {
    const actionCounts = {} as Record<ActionCategory, number>;
    const ticksByCategory = {} as Record<ActionCategory, number>;
    for (const c of ACTION_CATEGORIES) {
      actionCounts[c] = 0;
      ticksByCategory[c] = 0;
    }
    stats[npcId] = { actionCounts, ticksByCategory };
  }
  const openStarts = new Map<string, { npcId: NpcId; category: ActionCategory; tick: number }>();
  for (const e of events) {
    if (e.type === 'ActionStarted') {
      const p = e.payload as { actionId: string; npcId: NpcId; category: ActionCategory };
      stats[p.npcId].actionCounts[p.category] += 1;
      openStarts.set(p.actionId, { npcId: p.npcId, category: p.category, tick: e.tick });
    } else if (e.type === 'ActionCompleted' || e.type === 'ActionInterrupted') {
      const p = e.payload as { actionId: string };
      const open = openStarts.get(p.actionId);
      if (open) {
        stats[open.npcId].ticksByCategory[open.category] += e.tick - open.tick;
        openStarts.delete(p.actionId);
      }
    }
  }
  return stats;
}

export function buildTreatmentOutcome(events: readonly EventEnvelope[]): TreatmentOutcome | null {
  for (const e of events) {
    if (e.type === 'TreatmentCompleted') {
      const p = e.payload as {
        healerId: NpcId;
        patientId: NpcId;
        severityAfterMicro: number;
      };
      return {
        healerId: p.healerId,
        patientId: p.patientId,
        finalSeverityMicro: p.severityAfterMicro,
        completedTick: e.tick,
      };
    }
  }
  return null;
}

export function buildScenarioReportRow(
  scenario: ScenarioDefinition,
  state: CanonicalState,
  events: readonly EventEnvelope[],
  finalStateHash: string,
  replayHashMatch: boolean,
): ScenarioReportRow {
  const mealConsumedEvent = events.find((e) => e.type === 'MealConsumed');
  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    seed: scenario.seed,
    finalProgressUnits: state.purifier.progressUnits,
    finalProgressPctTimes100: Math.round(
      (state.purifier.progressUnits / REPAIR_UNITS_PER_PERCENT_POINT) * 100,
    ),
    taskOutcome: state.taskOutcome === 'completed' ? 'completed' : 'deadline-missed',
    mealConsumedBy: state.meal.consumedByNpcId,
    mealConsumedViaViolation: mealConsumedEvent
      ? Boolean((mealConsumedEvent.payload as { violation: boolean }).violation)
      : false,
    ownershipViolationCount: events.filter((e) => e.type === 'OwnershipViolated').length,
    promiseOutcome: promiseOutcomeOf(state),
    treatmentOutcome: buildTreatmentOutcome(events),
    decisionProviderFailureCount: events.filter((e) => e.type === 'DecisionProviderFailed').length,
    rejectedActionCount: events.filter((e) => e.type === 'ActionRejected').length,
    interruptedActionCount: events.filter((e) => e.type === 'ActionInterrupted').length,
    finalRelationships: state.relationships.map((r) => ({
      fromNpcId: r.fromNpcId,
      toNpcId: r.toNpcId,
      valueMicro: r.valueMicro,
    })),
    eventCount: events.length,
    finalStateHash,
    replayHashMatch,
    npcStats: buildNpcStats(events),
  };
}

/** Mara persistence metrics for the B1/B2 memory-ablation comparison. */
export function buildMaraPersistenceStats(events: readonly EventEnvelope[]) {
  let workTicks = 0;
  let workActionCount = 0;
  let breakRequestCount = 0;
  let firstBreakRequestTick: number | null = null;
  let restOrWaitTicks = 0;
  let helpRequestCount = 0;
  let firstNonWorkChoiceTick: number | null = null;

  const openStarts = new Map<string, { category: ActionCategory; tick: number }>();
  for (const e of events) {
    if (e.type === 'ActionStarted') {
      const p = e.payload as { actionId: string; npcId: NpcId; category: ActionCategory };
      if (p.npcId !== 'mara') continue;
      openStarts.set(p.actionId, { category: p.category, tick: e.tick });
      if (p.category === 'work-on-purifier') workActionCount += 1;
      if (p.category === 'request-break') {
        breakRequestCount += 1;
        if (firstBreakRequestTick === null) firstBreakRequestTick = e.tick;
      }
      if (p.category === 'ask-for-help') helpRequestCount += 1;
      if (
        e.tick > 0 &&
        firstNonWorkChoiceTick === null &&
        p.category !== 'work-on-purifier' &&
        p.category !== 'relieve-worker'
      ) {
        firstNonWorkChoiceTick = e.tick;
      }
    } else if (e.type === 'ActionCompleted' || e.type === 'ActionInterrupted') {
      const p = e.payload as { actionId: string; npcId: NpcId };
      if (p.npcId !== 'mara') continue;
      const open = openStarts.get(p.actionId);
      if (open) {
        if (open.category === 'work-on-purifier' || open.category === 'relieve-worker') {
          workTicks += e.tick - open.tick;
        }
        if (open.category === 'rest-or-wait') {
          restOrWaitTicks += e.tick - open.tick;
        }
        openStarts.delete(p.actionId);
      }
    }
  }
  return {
    workTicks,
    workActionCount,
    breakRequestCount,
    firstBreakRequestTick,
    restOrWaitTicks,
    helpRequestCount,
    firstNonWorkChoiceTick,
  };
}

export function renderMarkdownReport(report: BatchReport): string {
  const lines: string[] = [];
  lines.push(`# Vertical Slice 001 — Batch Report`);
  lines.push('');
  lines.push(`- Experiment: ${report.experimentId}`);
  lines.push(`- Config version: ${report.configVersion}`);
  lines.push(`- Overall: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push(
    `- Determinism: ${report.determinism.runsPerScenario} run(s)/scenario, hashes stable: ${report.determinism.allHashesStable}`,
  );
  if (report.determinism.invariantViolations.length > 0) {
    lines.push(`- Invariant violations:`);
    for (const v of report.determinism.invariantViolations) lines.push(`  - ${v}`);
  }
  lines.push('');
  lines.push(
    '| Scenario | Seed | Progress | Task | Meal eaten by | Violations | Promise | Treatment | Provider failures | Rejected | Interrupted | Events | Hash | Replay |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of report.scenarios) {
    const progress = (row.finalProgressPctTimes100 / 100).toFixed(2) + '%';
    const treatment = row.treatmentOutcome
      ? `${row.treatmentOutcome.healerId}→${row.treatmentOutcome.patientId}@${formatTickClock(row.treatmentOutcome.completedTick)}`
      : '—';
    lines.push(
      `| ${row.scenarioId} | ${row.seed} | ${progress} | ${row.taskOutcome} | ${row.mealConsumedBy ?? '—'}${row.mealConsumedViaViolation ? ' (violation)' : ''} | ${row.ownershipViolationCount} | ${row.promiseOutcome} | ${treatment} | ${row.decisionProviderFailureCount} | ${row.rejectedActionCount} | ${row.interruptedActionCount} | ${row.eventCount} | \`${row.finalStateHash}\` | ${row.replayHashMatch ? 'match' : 'MISMATCH'} |`,
    );
  }
  lines.push('');
  lines.push('## Per-NPC time by action category (ticks)');
  lines.push('');
  for (const row of report.scenarios) {
    lines.push(`### Scenario ${row.scenarioId}`);
    lines.push('');
    lines.push('| NPC | ' + ACTION_CATEGORIES.join(' | ') + ' |');
    lines.push('|---' + ACTION_CATEGORIES.map(() => '|---').join('') + '|');
    for (const npcId of NPC_IDS) {
      const stats = row.npcStats[npcId];
      lines.push(
        `| ${npcId} | ` +
          ACTION_CATEGORIES.map(
            (c) => `${stats.ticksByCategory[c]} (${stats.actionCounts[c]}x)`,
          ).join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  lines.push('## B1 vs B2 — effect of Mara’s criticism memory');
  lines.push('');
  const cmp = report.memoryComparison;
  lines.push('| Metric | B1 (memory present) | B2 (memory absent) |');
  lines.push('|---|---|---|');
  lines.push(`| Work ticks | ${cmp.b1.workTicks} | ${cmp.b2.workTicks} |`);
  lines.push(`| Work actions | ${cmp.b1.workActionCount} | ${cmp.b2.workActionCount} |`);
  lines.push(`| Break requests | ${cmp.b1.breakRequestCount} | ${cmp.b2.breakRequestCount} |`);
  lines.push(
    `| First break request | ${cmp.b1.firstBreakRequestTick === null ? 'never' : formatTickClock(cmp.b1.firstBreakRequestTick)} | ${cmp.b2.firstBreakRequestTick === null ? 'never' : formatTickClock(cmp.b2.firstBreakRequestTick)} |`,
  );
  lines.push(`| Rest/wait ticks | ${cmp.b1.restOrWaitTicks} | ${cmp.b2.restOrWaitTicks} |`);
  lines.push(`| Help requests | ${cmp.b1.helpRequestCount} | ${cmp.b2.helpRequestCount} |`);
  lines.push(`| Work-tick delta (B1 − B2) | ${cmp.workTickDelta} | |`);
  lines.push(`| Distinct behavior observed | ${cmp.distinctBehaviorObserved ? 'yes' : 'NO'} | |`);
  lines.push('');
  return lines.join('\n');
}
