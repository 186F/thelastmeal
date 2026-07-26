import type { ScenarioId } from '../shared/ids';
import { OPERATOR_SPEEDS } from '../shared/workerProtocol';
import type { WorkerClient } from '../app/workerClient';
import type { ViewStore } from '../app/store';
import { downloadTextFile } from './fileIO';
import { createImportInput } from './fileIO';
import { button, el } from './dom';

/** Global operator controls (scenario selection, run control, file flows). */
export function mountControls(root: HTMLElement, store: ViewStore, client: WorkerClient): void {
  const scenarioSelect = el('select', { id: 'scenario-select', 'aria-label': 'Scenario' });
  scenarioSelect.addEventListener('change', () => {
    store.update((s) => {
      s.selectedScenarioId = scenarioSelect.value as ScenarioId;
    });
    client.loadScenario(scenarioSelect.value as ScenarioId);
  });

  const importInput = createImportInput((text) => client.importLedger(text));

  const stepCountSelect = el('select', { id: 'step-count', 'aria-label': 'Ticks per step' });
  for (const count of [1, 10, 60, 300]) {
    stepCountSelect.append(el('option', { value: String(count), text: `×${count}` }));
  }

  const speedGroup = el('span', { class: 'group', id: 'speed-group' });
  for (const speed of OPERATOR_SPEEDS) {
    const radio = el('input', {
      type: 'radio',
      name: 'speed',
      id: `speed-${speed}`,
      value: String(speed),
    }) as HTMLInputElement;
    if (speed === 1) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked) client.setSpeed(speed);
    });
    speedGroup.append(
      el('label', { class: 'speed-option', for: `speed-${speed}` }, [radio, `${speed}×`]),
    );
  }

  const groups: HTMLElement[] = [
    el('span', { class: 'group' }, [
      el('label', { for: 'scenario-select', text: 'Scenario' }),
      scenarioSelect,
    ]),
    el('span', { class: 'group' }, [
      button('btn-start', 'Start', () => client.start()),
      button('btn-pause', 'Pause', () => client.pause()),
      button('btn-resume', 'Resume', () => client.resume()),
      button('btn-step', 'Step', () => client.step(Number(stepCountSelect.value))),
      stepCountSelect,
      button('btn-reset', 'Reset', () => client.reset()),
    ]),
    speedGroup,
    el('span', { class: 'group' }, [
      button('btn-run-complete', 'Run to completion', () => client.runToCompletion()),
      button('btn-run-batch', 'Run all scenarios', () => client.runBatch()),
    ]),
    el('span', { class: 'group' }, [
      button('btn-export-ledger', 'Export ledger', () => client.exportLedger()),
      button('btn-import-ledger', 'Import ledger…', () => importInput.click()),
      button('btn-replay-imported', 'Replay imported', () => client.replay('imported')),
      button('btn-replay-live', 'Replay latest', () => client.replay('live')),
    ]),
    el('span', { class: 'group' }, [
      button('btn-export-traces', 'Export traces', () => client.exportTraces()),
      button('btn-export-batch-report', 'Export batch report', () => {
        const { reportJson, reportMarkdown } = store.state.batch;
        if (reportJson) downloadTextFile('batch-report.json', reportJson, 'application/json');
        if (reportMarkdown) downloadTextFile('batch-report.md', reportMarkdown, 'text/markdown');
      }),
    ]),
    el('span', { class: 'group' }, [
      button('btn-validate', 'Validate configuration', () => client.validateConfig()),
      button('toggle-scores', 'Decision scoring', () =>
        store.update((s) => {
          s.showScores = !s.showScores;
        }),
      ),
      button('toggle-event-log', 'Event log', () =>
        store.update((s) => {
          s.showEventLog = !s.showEventLog;
        }),
      ),
    ]),
  ];
  root.append(...groups, importInput);

  const startBtn = root.querySelector<HTMLButtonElement>('#btn-start')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('#btn-pause')!;
  const resumeBtn = root.querySelector<HTMLButtonElement>('#btn-resume')!;
  const stepBtn = root.querySelector<HTMLButtonElement>('#btn-step')!;
  const exportBtn = root.querySelector<HTMLButtonElement>('#btn-export-ledger')!;
  const exportTracesBtn = root.querySelector<HTMLButtonElement>('#btn-export-traces')!;
  const exportReportBtn = root.querySelector<HTMLButtonElement>('#btn-export-batch-report')!;
  const replayImportedBtn = root.querySelector<HTMLButtonElement>('#btn-replay-imported')!;
  const replayLiveBtn = root.querySelector<HTMLButtonElement>('#btn-replay-live')!;
  const scoresBtn = root.querySelector<HTMLButtonElement>('#toggle-scores')!;
  const logBtn = root.querySelector<HTMLButtonElement>('#toggle-event-log')!;

  store.subscribe((s) => {
    if (scenarioSelect.options.length === 0 && s.scenarios.length > 0) {
      for (const scenario of s.scenarios) {
        scenarioSelect.append(
          el('option', {
            value: scenario.id,
            text: `${scenario.id} — ${scenario.title} (seed ${scenario.seed})`,
          }),
        );
      }
      scenarioSelect.value = s.selectedScenarioId;
    }
    const complete = s.runStatus === 'complete';
    const busy = s.runStatus === 'running' || s.runStatus === 'replaying';
    startBtn.disabled = s.snapshot === null || busy || complete;
    pauseBtn.disabled = s.runStatus !== 'running';
    resumeBtn.disabled = s.runStatus !== 'paused';
    stepBtn.disabled = s.snapshot === null || busy || complete;
    exportBtn.disabled = !complete;
    exportTracesBtn.disabled = !complete;
    replayLiveBtn.disabled = !complete;
    replayImportedBtn.disabled = s.importResult === null || !s.importResult.ok;
    exportReportBtn.disabled = s.batch.reportJson === null;
    scoresBtn.classList.toggle('active', s.showScores);
    logBtn.classList.toggle('active', s.showEventLog);
  });
}
