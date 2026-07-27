import { CONDITION_IDS } from '../sim/decisions/conditions';
import type { ViewStore } from '../app/store';
import type { WorkerClient } from '../app/workerClient';
import type { ModelGatewayClient } from '../app/modelGatewayClient';
import { el, kvRow } from './dom';

/**
 * Model-integration diagnostics panel (milestone 001, section 18).
 * Displays registered-condition selection and gateway/model status; it can
 * NEVER edit prompts, provider IDs, keys, or select actions manually. All
 * values are non-authoritative transport diagnostics. The panel keeps
 * working with no gateway running — the model condition then shows explicit
 * failures while the simulation continues on fallback.
 */
export function mountModelPanel(
  root: HTMLElement,
  store: ViewStore,
  client: WorkerClient,
  gateway: ModelGatewayClient,
): void {
  root.append(el('h2', { class: 'panel-title', text: 'Model integration' }));

  const select = el('select', { id: 'model-condition-select' }) as HTMLSelectElement;
  for (const conditionId of CONDITION_IDS) {
    const option = el('option', { text: conditionId }) as HTMLOptionElement;
    option.value = conditionId;
    select.append(option);
  }
  select.value = store.state.selectedConditionId;
  select.addEventListener('change', () => {
    const conditionId = select.value as (typeof CONDITION_IDS)[number];
    store.update((s) => {
      s.selectedConditionId = conditionId;
    });
    client.loadScenario(store.state.selectedScenarioId);
    if (conditionId === 'mara-model-per-decision-v1') void gateway.connect();
  });
  const selectRow = el('div', { class: 'control-row' });
  selectRow.append(el('label', { text: 'Condition ' }), select);
  root.append(selectRow);

  const dl = el('dl', { class: 'kv-grid', id: 'model-kv' });
  const fields = {
    gateway: kvRow(dl, 'Gateway', 'model-gateway-status'),
    provider: kvRow(dl, 'External provider', 'model-provider-id'),
    prompt: kvRow(dl, 'Prompt version', 'model-prompt-version'),
    model: kvRow(dl, 'Model', 'model-id'),
    run: kvRow(dl, 'Run ID', 'model-run-id'),
    attempted: kvRow(dl, 'Model calls attempted', 'model-calls-attempted'),
    responses: kvRow(dl, 'Gateway responses', 'model-gateway-responses'),
    accepted: kvRow(dl, 'Accepted by engine', 'model-accepted'),
    failures: kvRow(dl, 'Gateway failures', 'model-gateway-failures'),
    rejections: kvRow(dl, 'Engine rejections', 'model-engine-rejections'),
    pending: kvRow(dl, 'Pending Mara request', 'model-pending-request'),
    latency: kvRow(dl, 'Last model latency', 'model-latency'),
    tokens: kvRow(dl, 'Tokens (in / out)', 'model-tokens'),
  };
  root.append(dl);

  store.subscribe((s) => {
    if (select.value !== s.selectedConditionId) select.value = s.selectedConditionId;
    const gw = s.model.gateway;
    fields.gateway.textContent = gw ? (gw.connected ? 'connected' : 'unavailable') : '—';
    fields.gateway.className = gw ? (gw.connected ? 'value-good' : 'value-bad') : '';
    fields.provider.textContent = gw?.providerId ?? '—';
    fields.prompt.textContent = gw?.promptVersion ?? '—';
    fields.model.textContent = gw?.modelId ?? '—';
    fields.run.textContent = gw?.runId ?? '—';
    fields.attempted.textContent = gw ? String(gw.callsAttempted) : '0';
    fields.responses.textContent = gw ? String(gw.gatewayResponses) : '0';
    fields.accepted.textContent = String(s.model.acceptedModelResponses);
    fields.failures.textContent = gw
      ? `${gw.gatewayFailures}${formatBreakdown(gw.failuresByCode)}`
      : '0';
    fields.rejections.textContent = `${Object.values(s.model.engineRejections).reduce(
      (a, b) => a + b,
      0,
    )}${formatBreakdown(s.model.engineRejections)}`;
    fields.pending.textContent = gw?.pendingRequestId ?? 'none';
    fields.latency.textContent = gw?.lastLatencyMs !== null && gw ? `${gw.lastLatencyMs} ms` : '—';
    fields.tokens.textContent = gw ? `${gw.inputTokens} / ${gw.outputTokens}` : '0 / 0';
  });
}

function formatBreakdown(byCode: Record<string, number>): string {
  const parts = Object.entries(byCode)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, count]) => `${code}: ${count}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
