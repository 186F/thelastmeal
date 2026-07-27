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
  adapterKind: 'fake' | 'openai' | 'openrouter';
  port: number;
  requestTimeoutMs: number;
  maxConcurrency: number;
  maxCallsPerRun: number;
  traceDir: string;
  /** Normalized on load: trimmed, trailing slash stripped. */
  allowedBrowserOrigin: string;
  /** Legacy direct-OpenAI adapter fields retained for fixture compatibility;
   * the registered live experiment now uses the OpenRouter fields below. */
  openaiApiKey: string | null;
  openaiModel: string | null;
  /** OpenRouter secret and pinned route. These fields are optional on the
   * interface so existing fake-adapter test literals remain source-compatible;
   * loadGatewayConfig('openrouter') always supplies and validates them. */
  openRouterApiKey?: string | null;
  openRouterModel?: string | null;
  openRouterProvider?: string | null;
  openRouterHttpReferer?: string | null;
  openRouterAppTitle?: string | null;
  maxRequestBodyBytes: number;
  maxOutputTokens: number;
  /** Process-wide upstream spend cap across ALL runs. Optional so older
   * GatewayConfig literals stay valid; loadGatewayConfig always sets it and
   * an absent value means the default 400. */
  maxTotalCalls?: number;
}

export const DEFAULT_MAX_TOTAL_CALLS = 400;

/** The OpenRouter route is deliberately pinned in code for this experiment;
 * it is not an arbitrary proxy URL. */
export const OPENROUTER_RESPONSES_BASE_URL = 'https://openrouter.ai/api/v1';

/** The allowed browser origin is normalized once on load so the server's
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

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function loadGatewayConfig(
  adapterKind: 'fake' | 'openai' | 'openrouter',
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
    openaiApiKey: optional(get('OPENAI_API_KEY')),
    openaiModel: optional(get('OPENAI_MODEL')),
    openRouterApiKey: optional(get('OPENROUTER_API_KEY')),
    openRouterModel: optional(get('OPENROUTER_MODEL')),
    openRouterProvider: optional(get('OPENROUTER_PROVIDER')),
    openRouterHttpReferer: optional(get('OPENROUTER_HTTP_REFERER')),
    openRouterAppTitle: optional(get('OPENROUTER_APP_TITLE')) ?? 'The Last Meal',
    maxRequestBodyBytes: 512 * 1024,
    maxOutputTokens: 300,
    maxTotalCalls: intOr(
      get('MODEL_MAX_TOTAL_CALLS'),
      DEFAULT_MAX_TOTAL_CALLS,
      'MODEL_MAX_TOTAL_CALLS',
    ),
  };

  if (adapterKind === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error(
        'gateway-config-missing: OPENAI_API_KEY is required for the legacy direct OpenAI adapter',
      );
    }
    if (!config.openaiModel) {
      throw new Error(
        'gateway-config-missing: OPENAI_MODEL is required for the legacy direct OpenAI adapter',
      );
    }
  }

  if (adapterKind === 'openrouter') {
    if (!config.openRouterApiKey) {
      throw new Error(
        'gateway-config-missing: OPENROUTER_API_KEY is required for the live OpenRouter gateway (set it in .env.gateway or the environment; use gateway:dev:fake for keyless development)',
      );
    }
    if (!config.openRouterModel) {
      throw new Error(
        'gateway-config-missing: OPENROUTER_MODEL is required and must be an exact provider/model slug',
      );
    }
    if (!config.openRouterModel.includes('/')) {
      throw new Error(
        'gateway-config-invalid: OPENROUTER_MODEL must use the exact provider/model slug form',
      );
    }
    if (!config.openRouterProvider) {
      throw new Error(
        'gateway-config-missing: OPENROUTER_PROVIDER is required so the formal experiment uses one pinned provider endpoint',
      );
    }
    if (config.openRouterProvider.includes(',')) {
      throw new Error(
        'gateway-config-invalid: OPENROUTER_PROVIDER must name exactly one provider slug, not a list',
      );
    }
  }
  return config;
}

/** Nonsecret view exposed by /health and /v1/provider-config. The advertised
 * experimentId/conditionId come straight from the shared experiment literals
 * so the browser client can pin the full contract. */
export function publicConfig(
  config: GatewayConfig,
  providerId: string,
  promptVersion: string,
  requestSchemaVersion: number,
  experimentVersion: string,
): Record<string, unknown> {
  const modelId =
    config.adapterKind === 'openrouter'
      ? (config.openRouterModel ?? null)
      : config.adapterKind === 'openai'
        ? config.openaiModel
        : 'fake-adapter';
  return {
    status: 'ok',
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion,
    conditionId: MODEL_CONDITION_ID,
    providerId,
    promptVersion,
    requestSchemaVersion,
    modelId,
  };
}
