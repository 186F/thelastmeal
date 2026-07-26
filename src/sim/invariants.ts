import type { EventEnvelope } from '../shared/events';
import type { CanonicalState } from './domain/state';
import type { ScenarioDefinition } from './scenarios/definitions';

/**
 * Post-run invariant checker (pre-registered correctness criteria, brief
 * section 2). Operates purely on the recorded ledger and final state, so the
 * batch runner and tests share one implementation.
 *
 * Split (remediation 3): STRUCTURAL invariants hold for any well-formed run
 * of any provider and hard-reject a ledger at import; scenario EXPECTATIONS
 * encode pre-registered behavioral outcomes of the frozen v1.0 provider and
 * are reported as warnings at import (a genuine ledger from a different
 * provider may legitimately violate them without being corrupt).
 */
export function checkInvariants(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
  finalState: CanonicalState,
): string[] {
  return [
    ...checkStructuralInvariants(events, finalState),
    ...checkScenarioExpectations(scenario, events),
  ];
}

export function checkStructuralInvariants(
  events: readonly EventEnvelope[],
  finalState: CanonicalState,
): string[] {
  const violations: string[] = [];
  const count = (type: string): number => events.filter((e) => e.type === type).length;

  // Meal consumed at most once — globally pre-registered.
  if (count('MealConsumed') > 1) {
    violations.push('meal-consumed-more-than-once');
  }

  // No duplicate simultaneous exclusive reservation, reconstructed from events.
  {
    const held = new Map<string, string>();
    for (const e of events) {
      if (e.type === 'ResourceReserved') {
        const p = e.payload as { resourceId: string; holderNpcId: string };
        if (held.has(p.resourceId)) {
          violations.push(`duplicate-exclusive-reservation:${p.resourceId}@${e.id}`);
        }
        held.set(p.resourceId, p.holderNpcId);
      } else if (e.type === 'ReservationReleased' || e.type === 'ResourceRemoved') {
        held.delete((e.payload as { resourceId: string }).resourceId);
      } else if (e.type === 'ReservationTransferred') {
        const p = e.payload as { resourceId: string; toNpcId: string };
        held.set(p.resourceId, p.toNpcId);
      } else if (e.type === 'MealConsumed') {
        held.delete((e.payload as { resourceId: string }).resourceId);
      }
    }
  }

  // A promise may not be both fulfilled and broken.
  {
    const fulfilled = new Set(
      events
        .filter((e) => e.type === 'CommitmentFulfilled')
        .map((e) => (e.payload as { commitmentId: string }).commitmentId),
    );
    const broken = events
      .filter((e) => e.type === 'CommitmentBroken')
      .map((e) => (e.payload as { commitmentId: string }).commitmentId);
    for (const id of broken) {
      if (fulfilled.has(id)) violations.push(`commitment-both-fulfilled-and-broken:${id}`);
    }
    const brokenCounts = new Map<string, number>();
    for (const id of broken) brokenCounts.set(id, (brokenCounts.get(id) ?? 0) + 1);
    for (const [id, n] of brokenCounts) {
      if (n > 1) violations.push(`commitment-broken-recorded-${n}-times:${id}`);
    }
  }

  // Exactly one final task outcome.
  {
    const outcomes = count('TaskCompleted') + count('TaskDeadlineMissed');
    if (outcomes !== 1) violations.push(`task-outcome-count-${outcomes}`);
  }

  // Terminal state reached.
  if (!finalState.terminal || count('ScenarioEnded') !== 1) {
    violations.push('terminal-state-not-reached');
  }

  // Rejected actions must not mutate: a rejected action ID never starts or
  // completes afterward.
  {
    const rejectedAt = new Map<string, number>();
    for (const e of events) {
      if (e.type === 'ActionRejected') {
        const id = (e.payload as { actionId: string | null }).actionId;
        if (id) rejectedAt.set(id, e.seq);
      }
    }
    for (const e of events) {
      if (e.type === 'ActionStarted' || e.type === 'ActionCompleted') {
        const id = (e.payload as { actionId: string }).actionId;
        const rejSeq = rejectedAt.get(id);
        if (rejSeq !== undefined && e.seq > rejSeq) {
          violations.push(`rejected-action-mutated:${id}`);
        }
      }
    }
  }

  return violations;
}

/** Pre-registered scenario expectations (warnings at import, see above). */
export function checkScenarioExpectations(
  scenario: ScenarioDefinition,
  events: readonly EventEnvelope[],
): string[] {
  const violations: string[] = [];
  const has = (code: string): boolean => scenario.expectedInvariants.includes(code);
  const count = (type: string): number => events.filter((e) => e.type === type).length;

  if (has('no-injury-events')) {
    const injuryEvents =
      count('InjuryOccurred') +
      count('InjuryWorsened') +
      count('TreatmentStarted') +
      count('TreatmentCompleted');
    if (injuryEvents > 0) violations.push('unexpected-injury-events');
  }

  if (has('stale-eat-rejected-or-interrupted')) {
    const staleEat = events.some((e) => {
      if (e.type === 'ActionRejected') {
        const p = e.payload as { category: string; failedPreconditions: string[] };
        return p.category === 'eat-meal' && p.failedPreconditions.includes('meal-missing');
      }
      if (e.type === 'ActionInterrupted') {
        const p = e.payload as { category: string; reasonCode: string };
        return p.category === 'eat-meal' && p.reasonCode.includes('meal-missing');
      }
      return false;
    });
    if (!staleEat) violations.push('stale-eat-not-rejected-or-interrupted');
  }

  if (has('no-phantom-meal-consumption') && count('MealConsumed') > 0) {
    violations.push('phantom-meal-consumed');
  }

  if (has('ownership-outcome-recorded')) {
    const violationsRecorded = count('OwnershipViolated');
    const relChanges = events.filter(
      (e) =>
        e.type === 'RelationshipChanged' &&
        (e.payload as { reasonCode: string }).reasonCode === 'meal-taken',
    ).length;
    if (violationsRecorded !== relChanges) {
      violations.push('ownership-violation-without-relationship-consequence');
    }
  }

  if (has('provider-failures-recorded') && count('DecisionProviderFailed') === 0) {
    violations.push('no-provider-failures-recorded');
  }
  if (has('fallback-decisions-recorded')) {
    if (count('FallbackDecisionUsed') === 0) violations.push('no-fallback-decisions-recorded');
    if (count('FallbackDecisionUsed') !== count('DecisionProviderFailed')) {
      violations.push('fallback-count-mismatch');
    }
  }

  if (has('no-simultaneous-treat-and-bench')) {
    violations.push(...checkNoTreatBenchOverlap(events));
  }

  return violations;
}

/** No NPC may be recorded as treating and bench-working at the same time. */
function checkNoTreatBenchOverlap(events: readonly EventEnvelope[]): string[] {
  const out: string[] = [];
  interface Interval {
    start: number;
    end: number;
  }
  const treat = new Map<string, Interval[]>();
  const bench = new Map<string, Interval[]>();
  const openTreat = new Map<string, number>();
  const openBench = new Map<string, number>();

  for (const e of events) {
    if (e.type === 'TreatmentStarted') {
      openTreat.set((e.payload as { healerId: string }).healerId, e.tick);
    } else if (e.type === 'TreatmentCompleted') {
      const healer = (e.payload as { healerId: string }).healerId;
      const start = openTreat.get(healer);
      if (start !== undefined) {
        (treat.get(healer) ?? treat.set(healer, []).get(healer)!).push({ start, end: e.tick });
        openTreat.delete(healer);
      }
    } else if (e.type === 'ActionStarted') {
      const p = e.payload as { npcId: string; mode: string };
      if (p.mode === 'work' || p.mode === 'relieve') openBench.set(p.npcId, e.tick);
      if (p.mode === 'treat') openTreat.set(p.npcId, e.tick);
    } else if (e.type === 'ActionCompleted' || e.type === 'ActionInterrupted') {
      const p = e.payload as { npcId: string; mode: string };
      if (p.mode === 'work' || p.mode === 'relieve') {
        const start = openBench.get(p.npcId);
        if (start !== undefined) {
          (bench.get(p.npcId) ?? bench.set(p.npcId, []).get(p.npcId)!).push({
            start,
            end: e.tick,
          });
          openBench.delete(p.npcId);
        }
      }
      if (p.mode === 'treat') {
        const start = openTreat.get(p.npcId);
        if (start !== undefined) {
          (treat.get(p.npcId) ?? treat.set(p.npcId, []).get(p.npcId)!).push({
            start,
            end: e.tick,
          });
          openTreat.delete(p.npcId);
        }
      }
    }
  }

  for (const [npc, treatIntervals] of treat) {
    const benchIntervals = bench.get(npc) ?? [];
    for (const t of treatIntervals) {
      for (const b of benchIntervals) {
        if (t.start < b.end && b.start < t.end) {
          out.push(`simultaneous-treat-and-bench:${npc}@${Math.max(t.start, b.start)}`);
        }
      }
    }
  }
  return out;
}
