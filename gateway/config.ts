import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_CONDITION_ID, MODEL_EXPERIMENT_ID } from '../src/shared/modelExperiment';

/**
 * Gateway configuration (model integration milestone 001, sections 10/19/26).
 *
 * Secrets exist ONLY in this server-side process environment. `.env.gateway`
 * is a local, git-ignored file loaded here with a tiny parser (no dependency,
 * no `VITE_` exposure); values already present in the process environment
 * win. Limits are central and validated — when one is exceeded the gateway
 * emits a typed failure and the simulation continues through fallback.
 */

export interface GatewayConfig {
  adapterKind: 'fake' | 'openai';
  port: number;
  requestTimeoutMs: number;
  maxConcurrency: number;
  maxCallsPerRun: number;
  traceDir: string;
  /** Normalized on load: trimmed, trailing slash stripped. */
  allowedBrowserOrigin: string;
  /** Present only for the live adapter; never logged, never echoed. */
  openaiApiKey: string | null;
  openaiModel: string | null;
  maxRequestBodyBytes: number;
  maxOutputTokens: number;
  /** Process-wide upstream spend cap across ALL runs (re-audit remediation
   * G4). Optional so pre-1.4.0 GatewayConfig literals (test harnesses) stay
   * valid; loadGatewayConfig always sets it and an absent value means the
   * default 400. */
  maxTotalCalls?: number;
}

export const DEFAULT_MAX_TOTAL_CALLS = 400;

/** G4: the allowed browser origin is normalized once on load so the server's
 * origin-equivalence check always compares canonical forms. */
function normalizeAllowedOrigin(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export function loadEnvFile(root: string, fileName = '.env.gateway'): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(root, fileName), 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

function intOr(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`gateway-config-invalid: ${name} must be a positive integer`);
  }
  return parsed;
}

export function loadGatewayConfig(
  adapterKind: 'fake' | 'openai',
  env: Record<string, string | undefined> = process.env,
  root: string = process.cwd(),
): GatewayConfig {
  const fileEnv = loadEnvFile(root);
  const get = (name: string): string | undefined => env[name] ?? fileEnv[name];

  const config: GatewayConfig = {
    adapterKind,
    port: intOr(get('MODEL_GATEWAY_PORT'), 8787, 'MODEL_GATEWAY_PORT'),
    requestTimeoutMs: intOr(get('MODEL_REQUEST_TIMEOUT_MS'), 20_000, 'MODEL_REQUEST_TIMEOUT_MS'),
    maxConcurrency: intOr(get('MODEL_MAX_CONCURRENCY'), 1, 'MODEL_MAX_CONCURRENCY'),
    maxCallsPerRun: intOr(get('MODEL_MAX_CALLS_PER_RUN'), 80, 'MODEL_MAX_CALLS_PER_RUN'),
    traceDir: get('MODEL_TRACE_DIR') ?? 'artifacts/model-runs',
    allowedBrowserOrigin: normalizeAllowedOrigin(
      get('ALLOWED_BROWSER_ORIGIN') ?? 'http://localhost:5173',
    ),
    openaiApiKey: get('OPENAI_API_KEY') ?? null,
    openaiModel: get('OPENAI_MODEL') ?? null,
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    maxTotalCalls: intOr(
      get('MODEL_MAX_TOTAL_CALLS'),
      DEFAULT_MAX_TOTAL_CALLS,
      'MODEL_MAX_TOTAL_CALLS',
    ),
  };

  if (adapterKind === 'openai') {
    // Fail fast with a clear message (section 19) — and without echoing any
    // configured value.
    if (!config.openaiApiKey) {
      throw new Error(
        'gateway-config-missing: OPENAI_API_KEY is required for the live gateway (set it in .env.gateway or the environment; use gateway:dev:fake for keyless development)',
      );
    }
    if (!config.openaiModel) {
      throw new Error(
        'gateway-config-missing: OPENAI_MODEL is required for the live gateway (the model name is configuration, never source code)',
      );
    }
  }
  return config;
}

/** Nonsecret view exposed by /health and /v1/provider-config. The advertised
 * experimentId/conditionId come straight from the shared experiment literals
 * (re-audit remediation F2/G4) so the browser client can pin the full
 * contract; the shape must stay exactly what the client's strict
 * providerConfigSchema expects. */
export function publicConfig(
  config: GatewayConfig,
  providerId: string,
  promptVersion: string,
  requestSchemaVersion: number,
  experimentVersion: string,
): Record<string, unknown> {
  return {
    status: 'ok',
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion,
    conditionId: MODEL_CONDITION_ID,
    providerId,
    promptVersion,
    requestSchemaVersion,
    modelId: config.adapterKind === 'openai' ? config.openaiModel : 'fake-adapter',
  };
}
