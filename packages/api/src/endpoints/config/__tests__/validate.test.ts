import { validateRegistryEntry } from '../validate';

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

const BASE_ENTRY = {
  id: 'ep-openai-1',
  name: 'OpenAI',
  compatibilityType: 'openai',
  providerKind: 'openai',
  baseUrl: 'https://api.openai.com',
  authType: 'api_key',
  authConfig: { keyRef: 'OPENAI_API_KEY', headerName: 'Authorization' },
  enabled: true,
  tags: ['chat'],
  validationStatus: 'unknown',
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      endpointId: 'ep-openai-1',
      enabled: true,
      capabilities: FULL_CAPABILITIES,
    },
  ],
};

describe('validateRegistryEntry — schema validation', () => {
  it('accepts a valid entry without probe → status unknown', async () => {
    const result = await validateRegistryEntry(BASE_ENTRY);
    expect(result.status).toBe('unknown');
    expect(result.error).toBeUndefined();
    expect(result.lastValidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects an entry with missing required field', async () => {
    const bad = { ...BASE_ENTRY, id: undefined };
    const result = await validateRegistryEntry(bad);
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('rejects an unknown compatibilityType', async () => {
    const bad = { ...BASE_ENTRY, compatibilityType: 'unsupported_type' };
    const result = await validateRegistryEntry(bad);
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('rejects a malformed baseUrl', async () => {
    const bad = { ...BASE_ENTRY, baseUrl: 'not-a-url' };
    const result = await validateRegistryEntry(bad);
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('accepts optional fields when absent', async () => {
    const minimal = {
      ...BASE_ENTRY,
      headers: undefined,
      addParams: undefined,
      dropParams: undefined,
      lastValidatedAt: undefined,
    };
    const result = await validateRegistryEntry(minimal);
    expect(result.status).toBe('unknown');
  });

  it('accepts lastValidatedAt as ISO8601', async () => {
    const entry = { ...BASE_ENTRY, lastValidatedAt: '2026-04-24T00:00:00Z' };
    const result = await validateRegistryEntry(entry);
    expect(result.status).toBe('unknown');
  });
});

describe('validateRegistryEntry — probe path', () => {
  let okProbe: jest.Mock;
  let failProbe: jest.Mock;
  let throwProbe: jest.Mock;

  beforeEach(() => {
    okProbe = jest.fn().mockResolvedValue({ ok: true });
    failProbe = jest.fn().mockResolvedValue({ ok: false, statusCode: 401 });
    throwProbe = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  });

  it('returns ok when probe succeeds', async () => {
    const result = await validateRegistryEntry(BASE_ENTRY, okProbe);
    expect(result.status).toBe('ok');
    expect(result.error).toBeUndefined();
    expect(okProbe).toHaveBeenCalledWith('https://api.openai.com', expect.any(Object));
  });

  it('returns failed when probe returns non-ok', async () => {
    const result = await validateRegistryEntry(BASE_ENTRY, failProbe);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('HTTP 401');
  });

  it('returns failed when probe throws', async () => {
    const result = await validateRegistryEntry(BASE_ENTRY, throwProbe);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('skips probe when schema is invalid', async () => {
    const bad = { ...BASE_ENTRY, baseUrl: 'bad' };
    const result = await validateRegistryEntry(bad, okProbe);
    expect(result.status).toBe('failed');
    expect(okProbe).not.toHaveBeenCalled();
  });
});

describe('validateRegistryEntry — all compatibilityType values', () => {
  const types = [
    'openai',
    'google',
    'anthropic',
    'azure_openai',
    'bedrock',
    'generic_openai_compatible',
  ];

  for (const compatibilityType of types) {
    it(`accepts compatibilityType: ${compatibilityType}`, async () => {
      const entry = { ...BASE_ENTRY, compatibilityType };
      const result = await validateRegistryEntry(entry);
      expect(result.status).toBe('unknown');
    });
  }
});

describe('validateRegistryEntry — validationStatus field', () => {
  const statuses = ['unknown', 'ok', 'failed', 'stale'];

  for (const validationStatus of statuses) {
    it(`accepts validationStatus: ${validationStatus}`, async () => {
      const entry = { ...BASE_ENTRY, validationStatus };
      const result = await validateRegistryEntry(entry);
      expect(result.status).toBe('unknown');
    });
  }
});
