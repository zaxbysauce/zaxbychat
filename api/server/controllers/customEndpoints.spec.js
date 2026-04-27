/**
 * Phase 9 — controller tests for the custom-endpoint CRUD surface.
 *
 * Targets:
 *  - H1 — list redacts apiKey on the response.
 *  - H2 — PATCH rejects empty-string baseURL/apiKey/name.
 *  - Ownership 403 — non-owner non-admin update / delete.
 *  - 409 — duplicate name on create.
 *
 * Mock surface mirrors api/server/controllers/AuthController.spec.js
 * (the dotenv setup file is broken in this sandbox; CI runs cleanly).
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockListCustomEndpoints = jest.fn();
const mockFindCustomEndpointByName = jest.fn();
const mockCreateCustomEndpoint = jest.fn();
const mockUpdateCustomEndpoint = jest.fn();
const mockDeleteCustomEndpoint = jest.fn();

jest.mock('~/models', () => ({
  listCustomEndpoints: mockListCustomEndpoints,
  findCustomEndpointByName: mockFindCustomEndpointByName,
  createCustomEndpoint: mockCreateCustomEndpoint,
  updateCustomEndpoint: mockUpdateCustomEndpoint,
  deleteCustomEndpoint: mockDeleteCustomEndpoint,
}));

const mockInvalidate = jest.fn();
jest.mock('~/server/middleware/config/customEndpoints', () => ({
  invalidateDbCustomEndpointsCache: mockInvalidate,
}));

const mockValidateUrl = jest.fn(() => ({ ok: true }));
const mockShouldAllowLocal = jest.fn(() => true);
const mockProbeCustomEndpoint = jest.fn();
jest.mock('@librechat/api', () => ({
  validateCustomEndpointBaseUrl: (...args) => mockValidateUrl(...args),
  shouldAllowLocalEndpointAddresses: () => mockShouldAllowLocal(),
  probeCustomEndpoint: (...args) => mockProbeCustomEndpoint(...args),
}));

const {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  testEndpoint,
} = require('./customEndpoints');

const baseConfig = (over = {}) => ({
  name: 'ollama-local',
  apiKey: 'user_provided',
  baseURL: 'http://localhost:11434/v1',
  models: { default: ['x'] },
  ...over,
});

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateUrl.mockReturnValue({ ok: true });
});

describe('listEndpoints — H1 redaction', () => {
  it('redacts apiKey on every response config', async () => {
    mockListCustomEndpoints.mockResolvedValue([
      {
        _id: { toString: () => 'id-1' },
        name: 'a',
        config: { ...baseConfig({ name: 'a' }), apiKey: 'sk-real-secret' },
        author: { toString: () => 'user-1' },
      },
      {
        _id: { toString: () => 'id-2' },
        name: 'b',
        config: baseConfig({ name: 'b' }),
      },
    ]);
    const res = buildRes();
    await listEndpoints({ user: { id: 'u' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0].config.apiKey).toBeNull();
    expect(payload[0].config.apiKeyProvided).toBe(true);
    // user_provided sentinel is preserved (not redacted to null) so
    // the UI knows the per-user key flow applies.
    expect(payload[1].config.apiKey).toBe('user_provided');
    expect(payload[1].config.apiKeyProvided).toBe(false);
  });

  it('returns 500 when the model layer throws', async () => {
    mockListCustomEndpoints.mockRejectedValue(new Error('mongo down'));
    const res = buildRes();
    await listEndpoints({ user: { id: 'u' } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('updateEndpoint — H2 empty-string PATCH rejection', () => {
  beforeEach(() => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'user-1',
      config: baseConfig(),
    });
  });

  for (const field of ['baseURL', 'apiKey', 'name']) {
    it(`rejects empty-string ${field}`, async () => {
      const res = buildRes();
      await updateEndpoint(
        {
          params: { name: 'ollama-local' },
          body: { config: { [field]: '' } },
          user: { id: 'user-1', role: 'USER' },
        },
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUpdateCustomEndpoint).not.toHaveBeenCalled();
    });

    it(`rejects whitespace-only ${field}`, async () => {
      const res = buildRes();
      await updateEndpoint(
        {
          params: { name: 'ollama-local' },
          body: { config: { [field]: '   ' } },
          user: { id: 'user-1', role: 'USER' },
        },
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  }

  it('accepts a valid PATCH and invalidates the cache', async () => {
    mockUpdateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id' },
      name: 'ollama-local',
      config: baseConfig({ baseURL: 'http://localhost:8080/v1' }),
      author: 'user-1',
    });
    const res = buildRes();
    await updateEndpoint(
      {
        params: { name: 'ollama-local' },
        body: { config: { baseURL: 'http://localhost:8080/v1' } },
        user: { id: 'user-1', role: 'USER' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockInvalidate).toHaveBeenCalled();
  });
});

describe('updateEndpoint — ownership ACL', () => {
  it('returns 403 when neither admin nor owner', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'someone-else',
      config: baseConfig(),
    });
    const res = buildRes();
    await updateEndpoint(
      {
        params: { name: 'ollama-local' },
        body: { config: { baseURL: 'http://localhost:8080/v1' } },
        user: { id: 'user-1', role: 'USER' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUpdateCustomEndpoint).not.toHaveBeenCalled();
  });

  it('admin can update any record', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'someone-else',
      config: baseConfig(),
    });
    mockUpdateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id' },
      name: 'x',
      config: baseConfig(),
      author: 'someone-else',
    });
    const res = buildRes();
    await updateEndpoint(
      {
        params: { name: 'x' },
        body: { config: { baseURL: 'http://localhost:8080/v1' } },
        user: { id: 'admin-1', role: 'ADMIN' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteEndpoint — ownership ACL', () => {
  it('returns 403 when neither admin nor owner', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'someone-else',
      config: baseConfig(),
    });
    const res = buildRes();
    await deleteEndpoint(
      {
        params: { name: 'x' },
        user: { id: 'user-1', role: 'USER' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockDeleteCustomEndpoint).not.toHaveBeenCalled();
  });

  it('owner can delete and cache invalidates', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'user-1',
      config: baseConfig(),
    });
    mockDeleteCustomEndpoint.mockResolvedValue({ deletedCount: 1 });
    const res = buildRes();
    await deleteEndpoint(
      {
        params: { name: 'x' },
        user: { id: 'user-1', role: 'USER' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockInvalidate).toHaveBeenCalled();
  });
});

describe('createEndpoint', () => {
  it('returns 409 when a name already exists', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      author: 'user-1',
      config: baseConfig(),
    });
    const res = buildRes();
    await createEndpoint(
      {
        body: { config: baseConfig() },
        user: { id: 'user-1' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockCreateCustomEndpoint).not.toHaveBeenCalled();
  });

  it('returns 400 when URL gate rejects baseURL', async () => {
    mockFindCustomEndpointByName.mockResolvedValue(null);
    mockValidateUrl.mockReturnValue({ ok: false, reason: 'Base URL targets a blocked address' });
    const res = buildRes();
    await createEndpoint(
      {
        body: { config: baseConfig({ baseURL: 'http://mongodb:27017/v1' }) },
        user: { id: 'user-1' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('persists and invalidates cache on success', async () => {
    mockFindCustomEndpointByName.mockResolvedValue(null);
    mockCreateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id' },
      name: 'ollama-local',
      config: baseConfig(),
      author: 'user-1',
    });
    const res = buildRes();
    await createEndpoint(
      {
        body: { config: baseConfig() },
        user: { id: 'user-1' },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockInvalidate).toHaveBeenCalled();
  });
});

describe('testEndpoint', () => {
  it('forwards probe failures with reason', async () => {
    mockProbeCustomEndpoint.mockResolvedValue({
      ok: false,
      reason: 'Connection refused',
      durationMs: 12,
    });
    const res = buildRes();
    await testEndpoint(
      { body: { config: baseConfig() }, user: { id: 'u' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('Connection refused');
  });
});
