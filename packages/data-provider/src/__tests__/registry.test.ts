import {
  endpointRegistryEntrySchema,
  modelRegistryEntrySchema,
  validationStatusSchema,
  compatibilityTypeSchema,
} from '../types/registry';

const FULL_CAPABILITIES = {
  chat: true,
  vision: false,
  files: false,
  toolCalling: true,
  structuredOutput: true,
  streaming: true,
  embeddings: false,
  rerank: false,
  reasoning: false,
};

const BASE_MODEL = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  endpointId: 'ep-1',
  enabled: true,
  capabilities: FULL_CAPABILITIES,
};

const BASE_ENTRY = {
  id: 'ep-1',
  name: 'OpenAI',
  compatibilityType: 'openai',
  providerKind: 'openai',
  baseUrl: 'https://api.openai.com',
  authType: 'api_key',
  authConfig: { keyRef: 'OPENAI_API_KEY' },
  enabled: true,
  tags: ['chat'],
  validationStatus: 'unknown',
  models: [BASE_MODEL],
};

describe('validationStatusSchema', () => {
  it.each(['unknown', 'ok', 'failed', 'stale'])('accepts %s', (status) => {
    expect(validationStatusSchema.parse(status)).toBe(status);
  });

  it('rejects unknown value', () => {
    expect(validationStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('compatibilityTypeSchema', () => {
  const types = ['openai', 'google', 'anthropic', 'azure_openai', 'bedrock', 'generic_openai_compatible'];

  it.each(types)('accepts %s', (type) => {
    expect(compatibilityTypeSchema.parse(type)).toBe(type);
  });

  it('rejects unknown type', () => {
    expect(compatibilityTypeSchema.safeParse('ollama').success).toBe(false);
  });
});

describe('modelRegistryEntrySchema', () => {
  it('accepts a valid model entry', () => {
    const result = modelRegistryEntrySchema.safeParse(BASE_MODEL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('gpt-4o');
      expect(result.data.capabilities.chat).toBe(true);
    }
  });

  it('accepts optional contextWindow and maxOutputTokens', () => {
    const model = { ...BASE_MODEL, contextWindow: 128000, maxOutputTokens: 16384, notes: 'fast' };
    expect(modelRegistryEntrySchema.safeParse(model).success).toBe(true);
  });

  it('rejects missing required field', () => {
    const bad = { ...BASE_MODEL, id: undefined };
    expect(modelRegistryEntrySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects non-positive contextWindow', () => {
    const bad = { ...BASE_MODEL, contextWindow: 0 };
    expect(modelRegistryEntrySchema.safeParse(bad).success).toBe(false);
  });
});

describe('endpointRegistryEntrySchema', () => {
  it('accepts a full valid entry', () => {
    const result = endpointRegistryEntrySchema.safeParse(BASE_ENTRY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.validationStatus).toBe('unknown');
      expect(result.data.models).toHaveLength(1);
    }
  });

  it('accepts all authType values', () => {
    const authTypes = ['api_key', 'bearer', 'none', 'oauth', 'custom_header'];
    for (const authType of authTypes) {
      const result = endpointRegistryEntrySchema.safeParse({ ...BASE_ENTRY, authType });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid baseUrl', () => {
    const bad = { ...BASE_ENTRY, baseUrl: 'not-a-url' };
    expect(endpointRegistryEntrySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown compatibilityType', () => {
    const bad = { ...BASE_ENTRY, compatibilityType: 'unknown_protocol' };
    expect(endpointRegistryEntrySchema.safeParse(bad).success).toBe(false);
  });

  it('accepts optional fields: headers, addParams, dropParams', () => {
    const entry = {
      ...BASE_ENTRY,
      headers: { 'X-Custom': 'value' },
      addParams: { stream: true },
      dropParams: ['logprobs'],
    };
    expect(endpointRegistryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('accepts lastValidatedAt as ISO8601 datetime', () => {
    const entry = { ...BASE_ENTRY, lastValidatedAt: '2026-04-24T00:00:00Z' };
    expect(endpointRegistryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects lastValidatedAt that is not a datetime', () => {
    const bad = { ...BASE_ENTRY, lastValidatedAt: 'yesterday' };
    expect(endpointRegistryEntrySchema.safeParse(bad).success).toBe(false);
  });

  it('accepts empty models array', () => {
    const entry = { ...BASE_ENTRY, models: [] };
    expect(endpointRegistryEntrySchema.safeParse(entry).success).toBe(true);
  });
});
