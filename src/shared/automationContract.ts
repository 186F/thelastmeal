/**
 * Automation contract for the unattended orchestrator (M2 brief §19.7).
 *
 * The Phase 3 browser driver interacts with the app EXCLUSIVELY through
 * these stable selectors and semantic text patterns — the same controls a
 * human operator uses. This module is the single source of truth binding
 * the driver to the UI: an e2e contract test asserts every selector
 * resolves in the real DOM, so a UI rename fails the contract test instead
 * of silently stranding an unattended sequence.
 *
 * Everything here is presentation-layer identity. Nothing canonical, no
 * window bridge, no privileged mutation (§19.8).
 */

export const AUTOMATION_CONTRACT_VERSION = 'm2-automation-contract-1.0.0';

/** Element ids (use as `#id`). */
export const AUTOMATION_IDS = {
  scenarioSelect: 'scenario-select',
  conditionSelect: 'model-condition-select',
  speedRadioPrefix: 'speed-', // speed-1 | speed-5 | speed-20
  startButton: 'btn-start',
  runToCompletionButton: 'btn-run-complete',
  exportLedgerButton: 'btn-export-ledger',
  exportBundleButton: 'model-export-bundle',
  replayLatestButton: 'btn-replay-live',
} as const;

/** `data-field` attributes (use as `[data-field="…"]`). */
export const AUTOMATION_FIELDS = {
  workerStatus: 'worker-status',
  runStatus: 'status',
  time: 'time',
  replayMatch: 'replay-match',
  gatewayStatus: 'model-gateway-status',
  runId: 'model-run-id',
  callsAttempted: 'model-calls-attempted',
  gatewayResponses: 'model-gateway-responses',
  acceptedModelResponses: 'model-accepted',
  gatewayFailures: 'model-gateway-failures',
  engineRejections: 'model-engine-rejections',
  pendingRequest: 'model-pending-request',
  queuedRequests: 'model-queued-requests',
  modelLatency: 'model-latency',
  providerId: 'model-provider-id',
} as const;

/** Semantic text patterns the driver polls (never pixels). */
export const AUTOMATION_TEXT = {
  workerReady: 'ready',
  runStatusComplete: 'complete',
  runStatusRunning: 'running',
  gatewayConnected: 'connected',
  replayVerdictPending: '—',
  replayMatchPrefix: 'match',
  /** `[data-field="time"]` renders `… (tick N)`. */
  tickPattern: /\(tick (\d+)\)/,
} as const;

/** Operator speed multipliers the UI exposes (ticks per wall-clock second).
 * Formal live evidence uses 1× only (§19.17). */
export const AUTOMATION_SPEEDS = [1, 5, 20] as const;
export type AutomationSpeed = (typeof AUTOMATION_SPEEDS)[number];
