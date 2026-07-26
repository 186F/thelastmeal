import { formatTickClock } from '../shared/units';
import type { ViewStore } from '../app/store';
import { el, kvRow } from './dom';

/** Global state panel (brief section 17). */
export function mountGlobalPanel(root: HTMLElement, store: ViewStore): void {
  root.append(el('h2', { class: 'panel-title', text: 'Global state' }));
  const dl = el('dl', { class: 'kv-grid', id: 'global-kv' });
  const fields = {
    scenario: kvRow(dl, 'Scenario', 'scenario'),
    seed: kvRow(dl, 'Seed', 'seed'),
    time: kvRow(dl, 'Logical time', 'time'),
    speed: kvRow(dl, 'Speed', 'speed'),
    status: kvRow(dl, 'Status', 'status'),
    progress: kvRow(dl, 'Purifier progress', 'progress'),
    deadline: kvRow(dl, 'Deadline status', 'deadline'),
    meal: kvRow(dl, 'Meal', 'meal'),
    provider: kvRow(dl, 'Decision provider', 'provider'),
    events: kvRow(dl, 'Event count', 'event-count'),
    workerState: kvRow(dl, 'Worker', 'worker-status'),
    stateVersion: kvRow(dl, 'State version', 'state-version'),
    finalHash: kvRow(dl, 'Final-state hash', 'final-hash'),
    replay: kvRow(dl, 'Replay hash check', 'replay-match'),
    importState: kvRow(dl, 'Imported ledger', 'import-status'),
    batch: kvRow(dl, 'Batch', 'batch-status'),
    validation: kvRow(dl, 'Configuration', 'validation-status'),
  };
  root.append(dl);

  store.subscribe((s) => {
    const snap = s.snapshot;
    fields.scenario.textContent = snap
      ? `${snap.scenarioId} v${snap.scenarioVersion} (${snap.configVersion})`
      : '—';
    fields.seed.textContent = snap ? String(snap.seed) : '—';
    fields.time.textContent = snap
      ? `${formatTickClock(snap.tick)} / ${formatTickClock(snap.endTick)} (tick ${snap.tick})`
      : '—';
    fields.speed.textContent = `${s.speed}×`;
    fields.status.textContent = s.runStatus;
    fields.progress.textContent = snap
      ? `${((snap.purifier.progressUnits / snap.purifier.progressTotalUnits) * 100).toFixed(2)}%${snap.purifier.activeWorkerId ? ` (worker: ${snap.purifier.activeWorkerId})` : ''}`
      : '—';
    fields.deadline.textContent = snap
      ? snap.purifier.taskOutcome === 'pending'
        ? `pending — due ${formatTickClock(snap.purifier.deadlineTick)}`
        : snap.purifier.taskOutcome
      : '—';
    fields.deadline.className = snap
      ? snap.purifier.taskOutcome === 'completed'
        ? 'value-good'
        : snap.purifier.taskOutcome === 'deadline-missed'
          ? 'value-bad'
          : ''
      : '';
    fields.meal.textContent = snap
      ? snap.meal.exists
        ? `present — reserved for ${snap.meal.reservedForNpcId ?? 'nobody'}`
        : snap.meal.consumedByNpcId
          ? `consumed by ${snap.meal.consumedByNpcId}`
          : 'removed'
      : '—';
    fields.provider.textContent = snap ? snap.providerId : '—';
    fields.events.textContent = snap ? String(snap.eventCount) : '—';
    fields.workerState.textContent = `${s.connection} — snapshot #${s.snapshotSeq}`;
    fields.stateVersion.textContent = snap ? String(snap.stateVersion) : '—';
    fields.finalHash.textContent = s.finalHash ?? snap?.finalStateHash ?? '—';
    if (s.replayResult) {
      fields.replay.textContent = s.replayResult.ok
        ? s.replayResult.match
          ? `match (${s.replayResult.computedHash})`
          : `MISMATCH (${s.replayResult.computedHash} != ${s.replayResult.expectedHash})`
        : `failed: ${s.replayResult.errors.join(', ')}`;
      fields.replay.className = s.replayResult.match ? 'value-good' : 'value-bad';
    } else {
      fields.replay.textContent = '—';
      fields.replay.className = '';
    }
    if (s.importResult) {
      fields.importState.textContent = s.importResult.ok
        ? `valid (scenario ${s.importResult.scenarioId})`
        : `rejected: ${s.importResult.errors[0] ?? 'invalid'}`;
      fields.importState.className = s.importResult.ok ? 'value-good' : 'value-bad';
    } else {
      fields.importState.textContent = 'none';
      fields.importState.className = '';
    }
    fields.batch.textContent = s.batch.running
      ? `running ${s.batch.progressText}`
      : s.batch.report
        ? `${s.batch.report.ok ? 'PASS' : 'FAIL'} — ${s.batch.report.scenarios.length} scenarios`
        : '—';
    if (s.validation) {
      const errors = s.validation.issues.filter((i) => i.severity === 'error').length;
      fields.validation.textContent = s.validation.ok
        ? 'valid (0 errors)'
        : `${errors} validation error(s)`;
      fields.validation.className = s.validation.ok ? 'value-good' : 'value-bad';
    } else {
      fields.validation.textContent = 'not checked';
      fields.validation.className = '';
    }
  });
}
