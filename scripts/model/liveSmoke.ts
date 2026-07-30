import { pathToFileURL } from 'node:url';
import { loadGatewayConfig } from '../../gateway/config';
import { createGateway } from '../../gateway/server';
import { OpenRouterResponsesDecisionAdapter } from '../../gateway/adapters/openRouterResponsesAdapter';
import { ModelTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import { PROMPT_VERSION } from '../../gateway/prompts/maraActionSelection';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  gatewayDecisionResultSchema,
} from '../../src/sim/decisions/externalSchemas';
import {
  MODEL_CONDITION_ID,
  MODEL_EXPERIMENT_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../src/shared/modelExperiment';
import { createRun, stepTick } from '../../src/sim/runtime/engine';

/**
 * Live opt-in smoke test:
 *
 *   RUN_LIVE_MODEL_TESTS=1 npm run test:model:live
 *
 * Skips by default and never runs on pull requests. Performs ONE small,
 * genuine OpenRouter Responses request and validates the gateway response
 * schema. It does not run a full scenario and is not formal experiment data.
 *
 * Shutdown contract (M2 brief §27.8): nothing on the smoke path may call
 * `process.exit()`. `runSmokeOnce` returns an exit code (or throws on a
 * transport error) and its `finally` awaits `gateway.stop()`, so gateway
 * shutdown always completes; the CLI wrapper only ever sets
 * `process.exitCode` and returns, letting the process exit naturally.
 */

export interface SmokeGateway {
  start(): Promise<number>;
  stop(): Promise<void>;
}

export interface SmokeDeps {
  gateway: SmokeGateway;
  envelope: unknown;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

/**
 * Runs the single smoke request against an already-constructed gateway and
 * returns the process exit code. Never calls `process.exit`. On a fetch or
 * transport exception the error propagates to the caller AFTER the `finally`
 * block has awaited `gateway.stop()`.
 */
export async function runSmokeOnce(deps: SmokeDeps): Promise<number> {
  const { gateway, envelope, fetchFn = fetch, log = console.log, errorLog = console.error } = deps;
  const port = await gateway.start();
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/v1/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const parsed = gatewayDecisionResultSchema.safeParse(await response.json());
    if (!parsed.success) {
      errorLog('live model smoke: FAILED — gateway result did not validate');
      return 1;
    }
    if (parsed.data.outcome === 'response') {
      log(
        `live model smoke: PASSED — OpenRouter model selected ${parsed.data.response.selectedAffordanceId} ` +
          `(reason ${parsed.data.response.reasonCode}, confidence ${parsed.data.response.confidenceBp}bp, ` +
          `tokens in/out ${parsed.data.usage?.inputTokens ?? '?'}/${parsed.data.usage?.outputTokens ?? '?'})`,
      );
      return 0;
    }
    errorLog(
      `live model smoke: upstream failure ${parsed.data.failure.failureCode} ` +
        '(typed failure path verified; check OpenRouter key/model/provider configuration)',
    );
    return 1;
  } finally {
    await gateway.stop();
  }
}

async function main(): Promise<void> {
  const config = loadGatewayConfig('openrouter');
  const adapter = new OpenRouterResponsesDecisionAdapter({
    apiKey: config.openRouterApiKey!,
    model: config.openRouterModel!,
    provider: config.openRouterProvider!,
    maxOutputTokens: config.maxOutputTokens,
    httpReferer: config.openRouterHttpReferer,
    appTitle: config.openRouterAppTitle,
  });
  const gateway = createGateway(
    { ...config, port: 0 },
    adapter,
    new ModelTraceWriter(config.traceDir),
  );

  const run = createRun('A', { conditionId: MODEL_CONDITION_ID });
  while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
  const external = run.externalRequests[0];
  if (!external) {
    console.error('live model smoke: no external request produced');
    process.exitCode = 1;
    return;
  }

  const envelope = {
    schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
    experimentId: MODEL_EXPERIMENT_ID,
    experimentVersion: MODEL_EXPERIMENT_VERSION,
    conditionId: MODEL_CONDITION_ID,
    runId: `live-smoke-${process.pid}-${Date.now()}`,
    providerId: external.request.providerId,
    promptVersion: PROMPT_VERSION,
    contextHash: external.contextHash,
    request: external.request,
    context: external.context,
    truncationCounts: external.truncationCounts,
  };

  process.exitCode = await runSmokeOnce({ gateway, envelope });
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  if (process.env.RUN_LIVE_MODEL_TESTS !== '1') {
    console.log(
      'live model smoke: skipped (set RUN_LIVE_MODEL_TESTS=1 with OpenRouter configuration to run)',
    );
  } else {
    main().catch((error: unknown) => {
      console.error(
        `live model smoke: FAILED — ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
  }
}
