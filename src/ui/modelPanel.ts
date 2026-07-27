import { CONDITION_IDS } from '../sim/decisions/conditions';
import { MODEL_CONDITION_ID } from '../shared/modelExperiment';
import { buildRunBundle, canExportRunBundle, validateRunBundle } from '../app/runBundle';
import type { ViewStore } from '../app/store';
import type { WorkerClient } from '../app/workerClient';
import type { ModelGatewayClient } from '../app/modelGatewayClient';
import { downloadTextFile } from './fileIO';
import { button, el, kvRow } from './dom';

/**
 * Model-integration diagnostics panel (milestone 001, section 18).
 * Displays registered-condition selection and gateway/model status; it can
 * NEVER edit prompts, provider IDs, keys, or select actions manually. All
 * values are non-authoritative transport diagnostics. The panel keeps
 * working with no gateway running — the model condition then shows explicit
 * failures while the simulation continues on fallback. A gateway that
 * answers but advertises a different contract shows as 'incompatible',
 * distinct from 'unavailable'.
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
    if (conditionId === MODEL_CONDITION_ID) void gateway.connect();
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
    queued: kvRow(dl, 'Queued requests', 'model-queued-requests'),
    latency: kvRow(dl, 'Last model latency', 'model-latency'),
    tokens: kvRow(dl, 'Tokens (in / out)', 'model-tokens'),
  };
  root.append(dl);

  // Run-bundle export (re-audit remediation F5, assembly extracted to
  // src/app/runBundle.ts by F9; bundle v2 in 1.5.0): the terminal
  // client-side handoff for the finalizer — hashes come from the existing
  // terminal snapshot surface (null when genuinely unavailable), the slim
  // client trace AND the exact-request archive ride along, and NO worker
  // command or protocol message is added. The click SETTLES the gateway
  // client first (F1): entries are only recorded at terminal client
  // outcomes, so snapshotting while a request is queued, pumping, or in
  // flight would silently drop the tail of the run from the bundle. The
  // archive-coverage assertion runs POST-settle only (A6) — it is never part
  // of the enable predicate.
  //
  // Panel-local export state (1.5.0 C7). `exportBundle.disabled = true` at
  // click time is NOT a latch: ViewStore.update notifies subscribers
  // synchronously, and this panel's own subscriber ends in
  // refreshExportEnabled, so any store write during an export — including
  // the refusal's own lastError write, and the client's idle publish from
  // pump()'s finally — recomputes `disabled` from the store alone and
  // re-enables the button. Both flags therefore live in the predicate:
  //   refusedRunId — the run whose bundle failed validateRunBundle. Refusal
  //     is terminal for that run (the archive and trace are already
  //     terminal, so re-clicking can only rebuild the same bad bundle);
  //     ModelGatewayClient.newRun() mints a fresh runId and republishes, so
  //     a scenario load or reset clears the latch with no extra bookkeeping.
  //   exporting — an export is mid-flight; keeps a second click from
  //     starting a concurrent settle+build+download.
  let refusedRunId: string | null = null;
  let exporting = false;
  // Keyed exactly as buildRunBundle derives handoff.runId, so the latch
  // survives status republishes for the same run and clears on the next one.
  const refusedForCurrentRun = (s: typeof store.state): boolean =>
    refusedRunId !== null && refusedRunId === (s.model.gateway?.runId ?? gateway.currentRunId);
  const exportBundle = button('model-export-bundle', 'Export run bundle', () => {
    if (!canExportRunBundle(store.state) || exporting || refusedForCurrentRun(store.state)) return;
    exporting = true;
    exportBundle.disabled = true;
    void gateway
      .settle(30_000)
      .then(() => {
        // Build the bundle AFTER settle so the client trace, the archive,
        // and the handoff counters are terminal, then validate the whole
        // bundle (C3: envelope schemas, pinned literals, hash recompute,
        // runId-scoped coverage) before letting a single byte leave.
        const bundle = buildRunBundle(
          store.state,
          gateway.clientTraceEntries(),
          gateway.currentRunId,
          new Date().toISOString(),
          gateway.exactRequestEnvelopes(),
          gateway.archiveDiagnostics(),
        );
        const problems = validateRunBundle(bundle);
        if (problems.length > 0) {
          // Refuse the export: a bundle that fails its own producer-side
          // validation must never be downloaded. The button stays disabled
          // for this run — the latch is set BEFORE the store write so the
          // synchronous subscriber fan-out below already honours it.
          console.error('run-bundle validation failed; export refused', problems);
          refusedRunId = bundle.handoff.runId;
          store.update((s) => {
            s.lastError = `run-bundle-validation-failed: ${problems[0] ?? 'unknown'}`;
          });
          return;
        }
        downloadTextFile(
          `model-run-bundle-${bundle.handoff.runId}.json`,
          JSON.stringify(bundle, null, 2),
          'application/json',
        );
      })
      .catch(() => {
        // Still in flight after the timeout: do NOT emit a partial bundle.
        // The recompute below keeps the button disabled while the client is
        // busy, and the subscribe handler re-enables it once the client
        // publishes an idle status.
      })
      .finally(() => {
        // The single re-enable point for all three outcomes (downloaded,
        // refused, settle timeout): it clears `exporting` and recomputes the
        // predicate, which keeps a refused run latched.
        exporting = false;
        refreshExportEnabled(store.state);
      });
  });
  exportBundle.disabled = true;
  const refreshExportEnabled = (s: typeof store.state): void => {
    const gw = s.model.gateway;
    // busy closes the false-idle window between queue.shift() and
    // pendingRequestId being set (1.5.0 C4).
    const gatewayIdle = gw === null || !gw.busy;
    exportBundle.disabled = !(
      canExportRunBundle(s) &&
      gatewayIdle &&
      !refusedForCurrentRun(s) &&
      !exporting
    );
  };
  const exportRow = el('div', { class: 'control-row' });
  exportRow.append(exportBundle);
  root.append(exportRow);

  store.subscribe((s) => {
    if (select.value !== s.selectedConditionId) select.value = s.selectedConditionId;
    const gw = s.model.gateway;
    fields.gateway.textContent = gw
      ? gw.connected
        ? 'connected'
        : gw.contractMismatchField !== null
          ? `incompatible (${gw.contractMismatchField})`
          : 'unavailable'
      : '—';
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
    fields.queued.textContent = gw ? String(gw.queuedRequests) : '0';
    fields.latency.textContent = gw?.lastLatencyMs !== null && gw ? `${gw.lastLatencyMs} ms` : '—';
    fields.tokens.textContent = gw ? `${gw.inputTokens} / ${gw.outputTokens}` : '0 / 0';
    refreshExportEnabled(s);
  });
}

function formatBreakdown(byCode: Record<string, number>): string {
  const parts = Object.entries(byCode)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, count]) => `${code}: ${count}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
