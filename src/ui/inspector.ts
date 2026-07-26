import { NPC_IDS } from '../shared/ids';
import { formatMicro, formatTickClock } from '../shared/units';
import type { SnapshotNpc } from '../shared/snapshots';
import type { ViewStore } from '../app/store';
import { el, kvRow } from './dom';

/** Per-NPC inspector; selection comes from the 3D view or the tab buttons. */
export function mountInspector(root: HTMLElement, store: ViewStore): void {
  root.append(el('h2', { class: 'panel-title', text: 'NPC inspector' }));

  const tabs = el('div', { class: 'npc-tabs' });
  for (const npcId of NPC_IDS) {
    const b = el('button', {
      id: `npc-tab-${npcId}`,
      'data-npc-id': npcId,
      type: 'button',
      text: npcId,
    });
    b.addEventListener('click', () =>
      store.update((s) => {
        s.selectedNpcId = npcId;
      }),
    );
    tabs.append(b);
  }
  root.append(tabs);

  const body = el('div', { id: 'inspector-body' });
  const dl = el('dl', { class: 'kv-grid' });
  const fields = {
    location: kvRow(dl, 'Location', 'npc-location'),
    action: kvRow(dl, 'Current action', 'npc-action'),
    hunger: kvRow(dl, 'Hunger', 'npc-hunger'),
    fatigue: kvRow(dl, 'Fatigue', 'npc-fatigue'),
    injury: kvRow(dl, 'Injury severity', 'npc-injury'),
    goal: kvRow(dl, 'Goal', 'npc-goal'),
    commitment: kvRow(dl, 'Commitments', 'npc-commitment'),
    decision: kvRow(dl, 'Chosen affordance', 'npc-decision'),
    confidence: kvRow(dl, 'Decision confidence', 'npc-confidence'),
    reason: kvRow(dl, 'Primary reason', 'npc-reason'),
    request: kvRow(dl, 'Decision request', 'npc-request'),
  };
  const beliefsTitle = el('h2', { class: 'panel-title', text: 'Beliefs' });
  const beliefsList = el('ul', { class: 'sub-list', id: 'npc-beliefs' });
  const memoriesTitle = el('h2', { class: 'panel-title', text: 'Memories' });
  const memoriesList = el('ul', { class: 'sub-list', id: 'npc-memories' });
  const relationshipsTitle = el('h2', { class: 'panel-title', text: 'Relationships' });
  const relationshipsList = el('ul', { class: 'sub-list', id: 'npc-relationships' });
  const changesTitle = el('h2', { class: 'panel-title', text: 'Latest relationship changes' });
  const changesList = el('ul', { class: 'sub-list', id: 'relationship-changes' });
  const scoresTitle = el('h2', { class: 'panel-title', text: 'Decision scoring (diagnostic)' });
  const scoresBox = el('div', { id: 'npc-scores' });

  body.append(
    dl,
    beliefsTitle,
    beliefsList,
    memoriesTitle,
    memoriesList,
    relationshipsTitle,
    relationshipsList,
    changesTitle,
    changesList,
    scoresTitle,
    scoresBox,
  );
  const placeholder = el('p', {
    id: 'inspector-placeholder',
    class: 'kv-grid',
    text: 'Select an NPC in the viewport or via the tabs above.',
  });
  root.append(placeholder, body);
  body.style.display = 'none';

  store.subscribe((s) => {
    for (const npcId of NPC_IDS) {
      const tab = tabs.querySelector(`#npc-tab-${npcId}`);
      tab?.classList.toggle('active', s.selectedNpcId === npcId);
    }
    const npc: SnapshotNpc | undefined = s.snapshot?.npcs.find((n) => n.id === s.selectedNpcId);
    if (!npc || !s.snapshot) {
      body.style.display = 'none';
      placeholder.style.display = '';
      return;
    }
    placeholder.style.display = 'none';
    body.style.display = '';
    root.dataset.selectedNpc = npc.id;

    fields.location.textContent = npc.transit
      ? `in transit ${npc.transit.fromLocationId} → ${npc.transit.toLocationId} (arrives ${formatTickClock(npc.transit.arriveTick)})`
      : npc.locationId;
    fields.action.textContent = npc.currentAction
      ? `${npc.currentAction.category} / ${npc.currentAction.mode} [${npc.currentAction.phase}] until ${formatTickClock(npc.currentAction.completesAtTick)}`
      : npc.incapacitated
        ? 'incapacitated'
        : 'idle';
    fields.hunger.textContent = formatMicro(npc.hungerMicro);
    fields.fatigue.textContent = formatMicro(npc.fatigueMicro);
    fields.injury.textContent = npc.incapacitated
      ? `${formatMicro(npc.injurySeverityMicro)} (incapacitated)`
      : formatMicro(npc.injurySeverityMicro);
    fields.injury.className = npc.injurySeverityMicro > 0 ? 'value-bad' : '';
    fields.goal.textContent = npc.goal;

    const commitments = s.snapshot.commitments.filter(
      (c) => c.debtorId === npc.id || c.creditorId === npc.id,
    );
    fields.commitment.textContent =
      commitments.length === 0
        ? 'none'
        : commitments
            .map(
              (c) =>
                `${c.debtorId === npc.id ? 'owes' : 'is owed'} relief ${formatTickClock(c.startTick)}–${formatTickClock(c.graceTick)}: ${c.status}${c.renegotiated ? ' (renegotiated)' : ''}${c.pendingProposalId ? ' [proposal pending]' : ''}`,
            )
            .join('; ');

    fields.decision.textContent = npc.lastDecision
      ? `${npc.lastDecision.affordanceId}${npc.lastDecision.usedFallback ? ' (fallback)' : ''}`
      : '—';
    fields.confidence.textContent = npc.lastDecision
      ? `${(npc.lastDecision.confidenceBp / 100).toFixed(1)}%`
      : '—';
    fields.reason.textContent = npc.lastDecision?.reasonCode ?? '—';

    // Decision-lifecycle diagnostics (remediation 1): request ID, age,
    // status, and worldRevision at request time. Rejection reasons appear in
    // the event log as DecisionResponseRejected rows.
    if (npc.pendingDecision) {
      const age = s.snapshot.tick - npc.pendingDecision.requestedAtTick;
      fields.request.textContent =
        `${npc.pendingDecision.requestId} PENDING — age ${age} ticks, ` +
        `expires ${formatTickClock(npc.pendingDecision.expiresAtTick)}, ` +
        `worldRev@request ${npc.pendingDecision.worldRevisionAtRequest}, ` +
        `${npc.pendingDecision.offeredAffordanceCount} offered, ` +
        `${npc.pendingDecision.responseIdsSeen.length} response(s) seen`;
    } else if (npc.lastDecision) {
      fields.request.textContent = `${npc.lastDecision.requestId} resolved at ${formatTickClock(npc.lastDecision.tick)}`;
    } else {
      fields.request.textContent = '—';
    }

    beliefsList.replaceChildren(
      ...npc.beliefs.map((b) =>
        el('li', {}, [
          el('b', { text: `${b.subject} = ${b.value}` }),
          ` (conf ${formatMicro(b.confidenceMicro)}, ${b.provenanceKind}, t=${b.updatedTick})`,
        ]),
      ),
    );
    memoriesList.replaceChildren(
      ...npc.memories.map((m) =>
        el('li', {}, [
          el('b', { text: m.canonicalFact }),
          ` — perceived: ${m.perception}; interpreted: ${m.interpretation}; conf ${formatMicro(m.confidenceMicro)}, importance ${formatMicro(m.importanceMicro)}; themes: ${m.themes.join(', ') || 'none'}${m.socialTargetId ? ` (about ${m.socialTargetId})` : ''}, valence ${formatMicro(m.valenceMicro)}`,
        ]),
      ),
    );
    relationshipsList.replaceChildren(
      ...npc.relationships.map((r) =>
        el('li', {}, [el('b', { text: `→ ${r.toNpcId}` }), `: ${formatMicro(r.valueMicro)}`]),
      ),
    );
    changesList.replaceChildren(
      ...(s.snapshot.recentRelationshipChanges.length === 0
        ? [el('li', { text: 'none yet' })]
        : s.snapshot.recentRelationshipChanges.map((c) =>
            el('li', {}, [
              el('b', { text: `${c.fromNpcId} → ${c.toNpcId}` }),
              ` ${c.deltaMicro > 0 ? '+' : ''}${formatMicro(c.deltaMicro)} at ${formatTickClock(c.tick)} (cause: ${c.causeEventIds.join(', ')})`,
            ]),
          )),
    );

    // Optional decision-score decomposition (diagnostics; never authoritative).
    scoresTitle.style.display = s.showScores ? '' : 'none';
    scoresBox.style.display = s.showScores ? '' : 'none';
    if (s.showScores) {
      const scores = s.lastDecisionScores[npc.id];
      if (!scores || scores.length === 0) {
        scoresBox.replaceChildren(el('p', { class: 'kv-grid', text: 'No scored decision yet.' }));
      } else {
        const table = el('table', { class: 'scores-table' });
        table.append(
          el('tr', {}, [
            el('th', { text: 'Affordance' }),
            el('th', { text: 'Total' }),
            el('th', { text: 'Components' }),
          ]),
        );
        for (const record of [...scores].sort((a, b) => b.totalScore - a.totalScore)) {
          table.append(
            el('tr', {}, [
              el('td', { text: record.affordanceId }),
              el('td', { text: String(record.totalScore) }),
              el('td', {
                text: record.components.map((c) => `${c.code}: ${c.value}`).join(', '),
              }),
            ]),
          );
        }
        scoresBox.replaceChildren(table);
      }
    }
  });
}
