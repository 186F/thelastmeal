import type { EventEnvelope } from '../shared/events';
import { formatTickClock } from '../shared/units';
import type { ViewStore } from '../app/store';
import { el } from './dom';

/**
 * Collapsible event/decision panel. Human-readable rows are derived from the
 * typed events; the noisy per-tick types are hidden unless verbose mode is on.
 */
const NOISY_TYPES = new Set([
  'TimeAdvanced',
  'RepairProgressed',
  'PerceptionRecorded',
  'BeliefUpdated',
]);

export function mountEventLog(root: HTMLElement, store: ViewStore): void {
  const header = el('div', { id: 'event-log-header' }, [
    el('h2', { class: 'panel-title', text: 'Events & decisions' }),
    el('span', { id: 'event-log-count', class: 'kv-grid', text: '0 events' }),
  ]);
  const verboseBtn = el('button', {
    id: 'toggle-verbose-events',
    type: 'button',
    text: 'Show tick noise',
  });
  verboseBtn.addEventListener('click', () =>
    store.update((s) => {
      s.verboseEvents = !s.verboseEvents;
    }),
  );
  header.append(verboseBtn);
  const body = el('div', { id: 'event-log-body' });
  root.append(header, body);

  const statusLine = el('div', { id: 'status-line', text: '' });
  root.append(statusLine);

  store.subscribe((s) => {
    root.parentElement?.classList.toggle('collapsed', !s.showEventLog);
    verboseBtn.classList.toggle('active', s.verboseEvents);
    const countEl = header.querySelector('#event-log-count')!;
    countEl.textContent = `${s.eventTotal} events total`;

    if (s.showEventLog) {
      const visible = s.eventLog.filter((e) => s.verboseEvents || !NOISY_TYPES.has(e.type));
      const rows = visible.slice(-150).map((event) => renderRow(event));
      body.replaceChildren(...rows);
      body.scrollTop = body.scrollHeight;
    }

    statusLine.replaceChildren(
      el('span', {
        text: `commands sent: ${s.commandsSent} · responses: ${s.responsesReceived} · snapshot #${s.snapshotSeq}`,
      }),
    );
    if (s.lastError) {
      statusLine.append(el('span', { class: 'error', text: ` · last error: ${s.lastError}` }));
    }
  });
}

function renderRow(event: EventEnvelope): HTMLElement {
  const summary = summarize(event);
  return el('div', { class: 'event-row', 'data-event-type': event.type }, [
    `${formatTickClock(event.tick)} `,
    el('b', { text: event.type }),
    ` ${summary} `,
    el('span', {
      text: `[${event.id}${event.correlationId ? ` corr=${event.correlationId}` : ''}${event.causationId ? ` cause=${event.causationId}` : ''}]`,
    }),
  ]);
}

function summarize(event: EventEnvelope): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'DecisionResponseReceived':
      return `${p.npcId}: ${p.selectedAffordanceId} (${p.reasonCode})`;
    case 'DecisionResponseAccepted':
      return `${p.npcId}: ${p.selectedAffordanceId}${p.usedFallback ? ' (fallback)' : ''}`;
    case 'DecisionResponseRejected':
      return `${p.npcId}: ${p.rejectionReason}`;
    case 'DecisionRequestExpired':
    case 'DecisionRequestSuperseded':
      return `${p.npcId}: ${p.requestId}`;
    case 'FallbackDecisionUsed':
      return `${p.npcId}: ${p.affordanceId} (${p.reasonCode})`;
    case 'DecisionProviderFailed':
      return `${p.npcId}: ${p.errorCode}`;
    case 'ActionStarted':
    case 'ActionProposed':
      return `${p.npcId}: ${p.mode}${p.targetNpcId ? ` -> ${p.targetNpcId}` : ''}`;
    case 'ActionCompleted':
      return `${p.npcId}: ${p.mode} (${p.outcomeCode})`;
    case 'ActionRejected':
      return `${p.npcId}: ${p.mode} — ${(p.failedPreconditions as string[]).join(',')}`;
    case 'ActionInterrupted':
      return `${p.npcId}: ${p.mode} (${p.reasonCode})`;
    case 'MovementStarted':
      return `${p.npcId}: ${p.fromLocationId} -> ${p.toLocationId}`;
    case 'MovementCompleted':
      return `${p.npcId} at ${p.locationId}`;
    case 'MealConsumed':
      return `${p.npcId}${p.violation ? ' (VIOLATION)' : ''}`;
    case 'OwnershipViolated':
      return `${p.actorId} took ${p.resourceId} from ${p.ownerNpcId}`;
    case 'RelationshipChanged':
      return `${p.fromNpcId} -> ${p.toNpcId}: ${p.valueMicro}`;
    case 'InjuryOccurred':
    case 'InjuryWorsened':
      return `${p.npcId} severity=${p.severityMicro}`;
    case 'TreatmentStarted':
    case 'TreatmentCompleted':
      return `${p.healerId} treating ${p.patientId}`;
    case 'CommitmentRenegotiationProposed':
      return `${p.proposedByNpcId} proposes ${JSON.stringify(p.proposedTerms)}`;
    case 'CommitmentFulfilled':
    case 'CommitmentBroken':
      return String(p.commitmentId);
    case 'ScenarioEnded':
      return `hash=${p.worldStateHash}`;
    case 'TaskCompleted':
    case 'TaskDeadlineMissed':
      return `progress=${p.progressUnits}`;
    default:
      return event.actorId ?? '';
  }
}
