import { describe, expect, it } from 'vitest';
import { loadGatewayConfig, publicConfig } from '../../gateway/config';
import {
  EXTERNAL_MARA_PROVIDER_ID,
  MODEL_EXPERIMENT_VERSION,
} from '../../src/shared/modelExperiment';

describe('OpenRouter gateway configuration', () => {
  const baseEnv = {
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_MODEL: 'anthropic/claude-sonnet-test',
    OPENROUTER_PROVIDER: 'anthropic',
    OPENROUTER_HTTP_REFERER: 'http://localhost:5173',
    OPENROUTER_APP_TITLE: 'The Last Meal',
  };

  it('loads one exact model/provider route without exposing the key', () => {
    const config = loadGatewayConfig('openrouter', baseEnv, '/definitely-not-a-project-root');
    expect(config.adapterKind).toBe('openrouter');
    expect(config.openRouterApiKey).toBe('test-key');
    expect(config.openRouterModel).toBe('anthropic/claude-sonnet-test');
    expect(config.openRouterProvider).toBe('anthropic');
    const view = publicConfig(
      config,
      EXTERNAL_MARA_PROVIDER_ID,
      'prompt-v1',
      1,
      MODEL_EXPERIMENT_VERSION,
    );
    expect(view.modelId).toBe('anthropic/claude-sonnet-test');
    expect(JSON.stringify(view)).not.toContain('test-key');
  });

  it('fails fast when key, model, or pinned provider is missing', () => {
    for (const missing of [
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'OPENROUTER_PROVIDER',
    ] as const) {
      const env: Record<string, string | undefined> = { ...baseEnv, [missing]: undefined };
      expect(() => loadGatewayConfig('openrouter', env, '/definitely-not-a-project-root')).toThrow(
        /gateway-config-missing/,
      );
    }
  });

  it('requires a provider/model slug and exactly one provider endpoint', () => {
    expect(() =>
      loadGatewayConfig(
        'openrouter',
        { ...baseEnv, OPENROUTER_MODEL: 'alias-without-provider' },
        '/definitely-not-a-project-root',
      ),
    ).toThrow(/provider\/model slug/);
    expect(() =>
      loadGatewayConfig(
        'openrouter',
        { ...baseEnv, OPENROUTER_PROVIDER: 'anthropic,openai' },
        '/definitely-not-a-project-root',
      ),
    ).toThrow(/exactly one provider slug/);
  });
});
