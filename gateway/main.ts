import { loadGatewayConfig } from './config';
import { createGateway } from './server';
import { FakeDecisionAdapter } from './adapters/fakeDecisionAdapter';
import { OpenAIResponsesDecisionAdapter } from './adapters/openaiResponsesAdapter';
import { ModelTraceWriter } from './tracing/modelTraceWriter';
import { PROMPT_VERSION } from './prompts/maraActionSelection';
import { EXTERNAL_MARA_PROVIDER_ID } from './schemas';

/**
 * Gateway CLI entry.
 *   npm run gateway:dev:fake  -> deterministic fake adapter, no key needed
 *   npm run gateway:dev       -> live OpenAI adapter (fails fast without
 *                                OPENAI_API_KEY / OPENAI_MODEL)
 *
 * Logs never include secrets: only nonsecret configuration is printed.
 */
const useFake = process.argv.includes('--fake');
const config = loadGatewayConfig(useFake ? 'fake' : 'openai');
const adapter = useFake
  ? new FakeDecisionAdapter()
  : new OpenAIResponsesDecisionAdapter(
      config.openaiApiKey!,
      config.openaiModel!,
      config.maxOutputTokens,
    );

const gateway = createGateway(config, adapter, new ModelTraceWriter(config.traceDir));
gateway
  .start()
  .then((port) => {
    console.log(
      `model gateway listening on http://127.0.0.1:${port} ` +
        `(adapter=${adapter.id}, provider=${EXTERNAL_MARA_PROVIDER_ID}, prompt=${PROMPT_VERSION}, ` +
        `model=${useFake ? 'fake-adapter' : (config.openaiModel ?? '')}, traceDir=${config.traceDir})`,
    );
  })
  .catch((error: Error) => {
    console.error(`gateway failed to start: ${error.message}`);
    process.exit(1);
  });
