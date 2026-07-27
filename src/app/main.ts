import { createWorkshopScene } from '../render/scene';
import { mountControls } from '../ui/controls';
import { mountEventLog } from '../ui/eventLog';
import { mountGlobalPanel } from '../ui/globalPanel';
import { mountInspector } from '../ui/inspector';
import { mountModelPanel } from '../ui/modelPanel';
import { downloadTextFile } from '../ui/fileIO';
import { ViewStore } from './store';
import { WorkerClient } from './workerClient';
import { ModelGatewayClient } from './modelGatewayClient';

/**
 * Browser application composition.
 *
 * Authority flow: DOM command -> this controller -> typed, versioned worker
 * command -> simulation worker -> pure core -> events + read-only snapshots
 * -> renderer and inspectors. The main thread never mutates canonical state.
 */

const store = new ViewStore();
const client = new WorkerClient(store, downloadTextFile);

// Model gateway wiring (milestone 001, section 16). The gateway URL is
// NONSECRET configuration; no secret may ever use a VITE_ prefix.
const gateway = new ModelGatewayClient({
  baseUrl:
    (import.meta.env.VITE_MODEL_GATEWAY_URL as string | undefined) ?? 'http://localhost:8787',
  submitResponse: (response) => client.submitDecisionResponse(response),
  submitFailure: (failure) => client.submitDecisionFailure(failure),
  onStatus: (status) =>
    store.update((s) => {
      s.model.gateway = status;
    }),
});
client.onRunReset = () => {
  gateway.newRun();
  if (store.state.selectedConditionId === 'mara-model-per-decision-v1') void gateway.connect();
};
client.onDecisionRequest = (request) => {
  // Baseline conditions never call the gateway; the client additionally
  // filters to Mara's registered external provider.
  if (store.state.selectedConditionId === 'mara-model-per-decision-v1') {
    gateway.handleDecisionRequest(request);
  }
};

mountControls(document.querySelector('#control-bar')!, store, client);
mountGlobalPanel(document.querySelector('#global-panel')!, store);
mountModelPanel(document.querySelector('#global-panel')!, store, client, gateway);
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
