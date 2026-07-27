import { loadGatewayConfig } from '../../gateway/config';
import { createGateway } from '../../gateway/server';
import { OpenAIResponsesDecisionAdapter } from '../../gateway/adapters/openaiResponsesAdapter';
import { ModelTraceWriter } from '../../gateway/tracing/modelTraceWriter';
import { PROMPT_VERSION } from '../../gateway/prompts/maraActionSelection';
import {
  EXTERNAL_REQUEST_SCHEMA_VERSION,
  gatewayDecisionResultSchema,
} from '../../src/sim/decisions/externalSchemas';
import { MODEL_EXPERIMENT_ID, MODEL_EXPERIMENT_VERSION } from '../../src/sim/decisions/conditions';
import { createRun, stepTick } from '../../src/sim/runtime/engine';

/**
 * Live opt-in smoke test (milestone 001, section 23.9):
 *
 *   RUN_LIVE_MODEL_TESTS=1 npm run test:model:live
 *
 * Skips by default and never runs on pull requests. Performs ONE small,
 * genuine gateway request against the configured upstream model and
 * validates the response schema — it does not run a full scenario.
 */

if (process.env.RUN_LIVE_MODEL_TESTS !== '1') {
  console.log(
    'live model smoke: skipped (set RUN_LIVE_MODEL_TESTS=1 with a configured key to run)',
  );
  process.exit(0);
}

const config = loadGatewayConfig('openai');
const adapter = new OpenAIResponsesDecisionAdapter(
  config.openaiApiKey!,
  config.openaiModel!,
  config.maxOutputTokens,
);
const gateway = createGateway(
  { ...config, port: 0 },
  adapter,
  new ModelTraceWriter(config.traceDir),
);

const run = createRun('A', { conditionId: 'mara-model-per-decision-v1' });
while (run.externalRequests.length === 0 && run.state.tick < 200) stepTick(run);
const external = run.externalRequests[0];
if (!external) {
  console.error('live model smoke: no external request produced');
  process.exit(1);
}

const envelope = {
  schemaVersion: EXTERNAL_REQUEST_SCHEMA_VERSION,
  experimentId: MODEL_EXPERIMENT_ID,
  experimentVersion: MODEL_EXPERIMENT_VERSION,
  conditionId: 'mara-model-per-decision-v1',
  runId: `live-smoke-${process.pid}-${Date.now()}`,
  providerId: external.request.providerId,
  promptVersion: PROMPT_VERSION,
  contextHash: external.contextHash,
  request: external.request,
  context: external.context,
  truncationCounts: external.truncationCounts,
};

const port = await gateway.start();
try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const parsed = gatewayDecisionResultSchema.safeParse(await response.json());
  if (!parsed.success) {
    console.error('live model smoke: FAILED — gateway result did not validate');
    process.exit(1);
  }
  if (parsed.data.outcome === 'response') {
    console.log(
      `live model smoke: PASSED — model selected ${parsed.data.response.selectedAffordanceId} ` +
        `(reason ${parsed.data.response.reasonCode}, confidence ${parsed.data.response.confidenceBp}bp, ` +
        `tokens in/out ${parsed.data.usage?.inputTokens ?? '?'}/${parsed.data.usage?.outputTokens ?? '?'})`,
    );
  } else {
    console.error(
      `live model smoke: upstream failure ${parsed.data.failure.failureCode} (typed failure path verified; check key/model configuration)`,
    );
    process.exit(1);
  }
} finally {
  await gateway.stop();
}
