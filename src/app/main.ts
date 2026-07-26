import { createWorkshopScene } from '../render/scene';
import { mountControls } from '../ui/controls';
import { mountEventLog } from '../ui/eventLog';
import { mountGlobalPanel } from '../ui/globalPanel';
import { mountInspector } from '../ui/inspector';
import { downloadTextFile } from '../ui/fileIO';
import { ViewStore } from './store';
import { WorkerClient } from './workerClient';

/**
 * Browser application composition.
 *
 * Authority flow: DOM command -> this controller -> typed, versioned worker
 * command -> simulation worker -> pure core -> events + read-only snapshots
 * -> renderer and inspectors. The main thread never mutates canonical state.
 */

const store = new ViewStore();
const client = new WorkerClient(store, downloadTextFile);

mountControls(document.querySelector('#control-bar')!, store, client);
mountGlobalPanel(document.querySelector('#global-panel')!, store);
mountInspector(document.querySelector('#inspector-panel')!, store);
mountEventLog(document.querySelector('#event-panel')!, store);

const scene = createWorkshopScene(
  document.querySelector('#viewport')!,
  document.querySelector('#viewport-labels')!,
  (npcId) =>
    store.update((s) => {
      s.selectedNpcId = npcId;
    }),
);

let lastSnapshotSeq = -1;
let lastSelected: string | null = null;
store.subscribe((s) => {
  if (s.snapshot && s.snapshotSeq !== lastSnapshotSeq) {
    lastSnapshotSeq = s.snapshotSeq;
    scene.updateSnapshot(s.snapshot);
  }
  if (s.selectedNpcId !== lastSelected) {
    lastSelected = s.selectedNpcId;
    scene.setSelected(s.selectedNpcId);
  }
});

// Load the default scenario once the worker reports ready.
const unsubscribeInit = store.subscribe((s) => {
  if (s.connection === 'ready') {
    unsubscribeInit();
    client.loadScenario(s.selectedScenarioId);
  }
});

// Single-owner worker/scene lifecycle, torn down cleanly on dev hot reload.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    client.terminate();
    scene.dispose();
  });
}
