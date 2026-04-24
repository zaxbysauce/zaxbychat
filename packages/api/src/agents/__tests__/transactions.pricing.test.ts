/**
 * Pricing parity tests for prepareTokenSpend / prepareStructuredTokenSpend.
 *
 * Verifies that transaction token-value calculation is byte-identical for all 7
 * provider families mapped in compatibilityTypeInitMap, regardless of whether
 * pricing comes from:
 *   (a) named-model lookup via injected getMultiplier (default path), or
 *   (b) endpointTokenConfig (dynamic per-model config, e.g. OpenRouter).
 *
 * These tests are intentionally arithmetic — they pin exact tokenValue outputs
 * so a future change to getMultiplier logic or CANCEL_RATE surfaces immediately.
 */
import { prepareTokenSpend, prepareStructuredTokenSpend } from '../transactions';
import type { PricingFns, TxMetadata } from '../transactions';
import type { EndpointTokenConfig } from '~/types/tokens';

/** Rates sourced from packages/data-schemas/src/methods/tx.ts tokenValues ($ per 1M tokens). */
const MODEL_RATES: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o':            { prompt: 2.5,   completion: 10    }, // openai
  'gpt-4':             { prompt: 30,    completion: 60    }, // azure_openai → '8k' bucket
  'gemini-2.0-flash':  { prompt: 0.1,   completion: 0.4   }, // google
  'claude-3-5-sonnet': { prompt: 3,     completion: 15    }, // anthropic
  'nova-lite':         { prompt: 0.06,  completion: 0.24  }, // bedrock
  'grok-3':            { prompt: 3.0,   completion: 15.0  }, // generic_openai_compatible
  'custom-model-v1':   { prompt: 1.0,   completion: 4.0   }, // endpointTokenConfig path
};

function buildPricing(
  model: string,
  endpointTokenConfig?: EndpointTokenConfig,
): PricingFns {
  return {
    getMultiplier({ model: m, tokenType, endpointTokenConfig: etc }) {
      if (etc && m && tokenType) {
        return etc[m]?.[tokenType as string] ?? 6;
      }
      const rates = MODEL_RATES[model];
      if (tokenType === 'prompt' || tokenType === 'completion') {
        return rates?.[tokenType] ?? 6;
      }
      return 6;
    },
    getCacheMultiplier({ model: m, cacheType, endpointTokenConfig: etc }) {
      if (etc && m && cacheType) {
        return etc[m]?.[cacheType as string] ?? null;
      }
      return null;
    },
  };
}

const BASE_META: TxMetadata = {
  user: 'u1',
  conversationId: 'c1',
  context: 'message',
  balance: { enabled: true },
  transactions: { enabled: true },
};

const PROMPT_TOKENS = 1000;
const COMPLETION_TOKENS = 200;

describe('prepareTokenSpend — 7 provider pricing paths', () => {
  const cases: Array<{ provider: string; model: string }> = [
    { provider: 'openai',                   model: 'gpt-4o' },
    { provider: 'azure_openai',             model: 'gpt-4' },
    { provider: 'google',                   model: 'gemini-2.0-flash' },
    { provider: 'anthropic',                model: 'claude-3-5-sonnet' },
    { provider: 'bedrock',                  model: 'nova-lite' },
    { provider: 'generic_openai_compatible', model: 'grok-3' },
    { provider: 'endpointTokenConfig',      model: 'custom-model-v1' },
  ];

  for (const { provider, model } of cases) {
    describe(`provider: ${provider} (${model})`, () => {
      const rates = MODEL_RATES[model];
      const expectedPromptValue = -(PROMPT_TOKENS * rates.prompt);
      const expectedCompletionValue = -(COMPLETION_TOKENS * rates.completion);

      const endpointTokenConfig: EndpointTokenConfig | undefined =
        provider === 'endpointTokenConfig'
          ? { [model]: { prompt: rates.prompt, completion: rates.completion, context: 128000 } }
          : undefined;

      const meta: TxMetadata = { ...BASE_META, model, endpointTokenConfig };
      const pricing = buildPricing(model, endpointTokenConfig);

      it('prompt entry: tokenValue = -(promptTokens × promptRate)', () => {
        const results = prepareTokenSpend(
          meta,
          { promptTokens: PROMPT_TOKENS, completionTokens: undefined },
          pricing,
        );
        expect(results).toHaveLength(1);
        expect(results[0].tokenValue).toBeCloseTo(expectedPromptValue, 10);
        expect(results[0].doc.tokenType).toBe('prompt');
        expect(results[0].doc.rawAmount).toBe(-PROMPT_TOKENS);
      });

      it('completion entry: tokenValue = -(completionTokens × completionRate)', () => {
        const results = prepareTokenSpend(
          meta,
          { promptTokens: undefined, completionTokens: COMPLETION_TOKENS },
          pricing,
        );
        expect(results).toHaveLength(1);
        expect(results[0].tokenValue).toBeCloseTo(expectedCompletionValue, 10);
        expect(results[0].doc.tokenType).toBe('completion');
        expect(results[0].doc.rawAmount).toBe(-COMPLETION_TOKENS);
      });

      it('both entries sum correctly', () => {
        const results = prepareTokenSpend(
          meta,
          { promptTokens: PROMPT_TOKENS, completionTokens: COMPLETION_TOKENS },
          pricing,
        );
        expect(results).toHaveLength(2);
        const total = results.reduce((sum, e) => sum + e.tokenValue, 0);
        expect(total).toBeCloseTo(expectedPromptValue + expectedCompletionValue, 10);
      });
    });
  }
});

describe('prepareTokenSpend — endpointTokenConfig takes priority over model-name lookup', () => {
  it('uses endpointTokenConfig rates when provided, ignoring model-name rates', () => {
    const dynamicRates = { prompt: 99, completion: 199, context: 8000 };
    const endpointTokenConfig: EndpointTokenConfig = { 'gpt-4o': dynamicRates };

    const pricing = buildPricing('gpt-4o', endpointTokenConfig);
    const results = prepareTokenSpend(
      { ...BASE_META, model: 'gpt-4o', endpointTokenConfig },
      { promptTokens: 100, completionTokens: undefined },
      pricing,
    );

    expect(results).toHaveLength(1);
    // dynamic rate 99 × 100 tokens = 9900
    expect(results[0].tokenValue).toBeCloseTo(-9900, 10);
  });
});

describe('prepareTokenSpend — transactions.enabled=false short-circuits', () => {
  it('returns empty array when transactions disabled', () => {
    const pricing = buildPricing('gpt-4o');
    const results = prepareTokenSpend(
      { ...BASE_META, model: 'gpt-4o', transactions: { enabled: false } },
      { promptTokens: 1000, completionTokens: 200 },
      pricing,
    );
    expect(results).toHaveLength(0);
  });
});

describe('prepareStructuredTokenSpend — anthropic cache pricing', () => {
  it('applies cache-write and cache-read multipliers from endpointTokenConfig', () => {
    const model = 'claude-3-5-sonnet';
    const endpointTokenConfig: EndpointTokenConfig = {
      [model]: { prompt: 3, completion: 15, write: 3.75, read: 0.3, context: 200000 },
    };

    const pricing: PricingFns = {
      getMultiplier({ tokenType, endpointTokenConfig: etc, model: m }) {
        if (etc && m && tokenType) return etc[m]?.[tokenType as string] ?? 6;
        return 6;
      },
      getCacheMultiplier({ cacheType, endpointTokenConfig: etc, model: m }) {
        if (etc && m && cacheType) return etc[m]?.[cacheType as string] ?? null;
        return null;
      },
    };

    const inputTokens = 500;
    const writeTokens = 100;
    const readTokens = 50;

    const results = prepareStructuredTokenSpend(
      { ...BASE_META, model, endpointTokenConfig },
      {
        promptTokens: { input: inputTokens, write: writeTokens, read: readTokens },
        completionTokens: 200,
      },
      pricing,
    );

    expect(results).toHaveLength(2);
    const promptEntry = results.find((e) => e.doc.tokenType === 'prompt');
    const completionEntry = results.find((e) => e.doc.tokenType === 'completion');

    expect(promptEntry).toBeDefined();
    expect(completionEntry).toBeDefined();

    // prompt tokenValue = -(input×3 + write×3.75 + read×0.3) = -(1500 + 375 + 15) = -1890
    expect(promptEntry!.tokenValue).toBeCloseTo(-1890, 10);
    // completion tokenValue = -(200×15) = -3000
    expect(completionEntry!.tokenValue).toBeCloseTo(-3000, 10);
  });
});
