import { loadGatewayConfig } from './config';
import { createGateway, stopWithFallback } from './server';
import { FakeDecisionAdapter } from './adapters/fakeDecisionAdapter';
import { OpenRouterResponsesDecisionAdapter } from './adapters/openRouterResponsesAdapter';
import { ModelTraceWriter } from './tracing/modelTraceWriter';
import { MODEL_CONDITION_ID, requireContractForCondition } from './schemas';

/**
 * Gateway CLI entry.
 *   npm run gateway:dev:fake  -> deterministic fake adapter, no key needed
 *   npm run gateway:dev       -> live OpenRouter Responses adapter (fails fast
 *                                without key/model/provider configuration)
 *
 * Logs never include secrets: only nonsecret configuration is printed.
 */
const useFake = process.argv.includes('--fake');
const config = loadGatewayConfig(useFake ? 'fake' : 'openrouter');
const adapter = useFake
  ? new FakeDecisionAdapter()
  : new OpenRouterResponsesDecisionAdapter({
      apiKey: config.openRouterApiKey!,
      model: config.openRouterModel!,
      provider: config.openRouterProvider!,
      maxOutputTokens: config.maxOutputTokens,
      httpReferer: config.openRouterHttpReferer,
      appTitle: config.openRouterAppTitle,
    });

const gateway = createGateway(config, adapter, new ModelTraceWriter(config.traceDir));

// Graceful shutdown (1.5.0 G1): SIGINT/SIGTERM drain in-flight requests via
// stop(); after a 2s grace stopWithFallback force-closes any stragglers with
// closeAllConnections(), then the process exits 0.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`model gateway: received ${signal} — draining in-flight requests (2s grace)`);
  void stopWithFallback(gateway)
    .catch(() => undefined)
    .then(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

gateway
  .start()
  .then((port) => {
    const model = useFake ? 'fake-adapter' : (config.openRouterModel ?? '');
    const route = useFake ? 'local' : (config.openRouterProvider ?? '');
    const served = requireContractForCondition(config.servedConditionId ?? MODEL_CONDITION_ID);
    console.log(
      `model gateway listening on http://127.0.0.1:${port} ` +
        `(adapter=${adapter.id}, condition=${served.conditionId}, ` +
        `provider=${served.providerId}, prompt=${served.promptVersion}, ` +
        `model=${model}, route=${route}, traceDir=${config.traceDir})`,
    );
  })
  .catch((error: Error) => {
    console.error(`gateway failed to start: ${error.message}`);
    process.exit(1);
  });
