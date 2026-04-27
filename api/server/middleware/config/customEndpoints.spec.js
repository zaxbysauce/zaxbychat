/**
 * Phase 9 — DB-merge middleware tests.
 *
 * Verifies the in-process TTL cache (review M2): the second request
 * within the TTL window must NOT hit the DB; an explicit
 * invalidation between requests forces a fresh load. Also checks
 * the shallow-clone of req.config so cached AppConfig instances
 * shared across requests do not leak DB-merged endpoints between
 * tenants.
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockListCustomEndpoints = jest.fn();
jest.mock('~/models', () => ({
  listCustomEndpoints: mockListCustomEndpoints,
}));

jest.mock('@librechat/api', () => ({
  mergeCustomEndpointsByName: (yaml, db) => [...(yaml || []), ...(db || [])],
  dbRecordsToEndpoints: (records) => records.map((r) => r.config).filter(Boolean),
}));

const middleware = require('./customEndpoints');
const { invalidateDbCustomEndpointsCache, _resetCacheForTests } = middleware;

const validConfig = (over = {}) => ({
  name: 'ollama-local',
  apiKey: 'user_provided',
  baseURL: 'http://localhost:11434/v1',
  models: { default: ['x'] },
  ...over,
});

const buildReq = (over = {}) => ({
  user: { tenantId: 'tenant-a' },
  config: { endpoints: { custom: [] } },
  ...over,
});

describe('attachDbCustomEndpoints — TTL cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetCacheForTests();
  });

  it('hits the DB on a cold cache and skips it on the next call within TTL', async () => {
    mockListCustomEndpoints.mockResolvedValue([{ config: validConfig({ name: 'a' }) }]);

    let next = jest.fn();
    await middleware(buildReq(), undefined, next);
    expect(next).toHaveBeenCalled();
    expect(mockListCustomEndpoints).toHaveBeenCalledTimes(1);

    next = jest.fn();
    await middleware(buildReq(), undefined, next);
    expect(next).toHaveBeenCalled();
    expect(mockListCustomEndpoints).toHaveBeenCalledTimes(1);
  });

  it('reloads after invalidateDbCustomEndpointsCache()', async () => {
    mockListCustomEndpoints.mockResolvedValue([{ config: validConfig({ name: 'a' }) }]);

    await middleware(buildReq(), undefined, jest.fn());
    expect(mockListCustomEndpoints).toHaveBeenCalledTimes(1);

    invalidateDbCustomEndpointsCache();
    await middleware(buildReq(), undefined, jest.fn());
    expect(mockListCustomEndpoints).toHaveBeenCalledTimes(2);
  });

  it('shallow-clones req.config so cached AppConfig is not mutated', async () => {
    mockListCustomEndpoints.mockResolvedValue([{ config: validConfig({ name: 'a' }) }]);

    const sharedAppConfig = {
      endpoints: { custom: [], something: 'unrelated' },
      somethingElse: { nested: 'value' },
    };
    const req = { user: { tenantId: 't' }, config: sharedAppConfig };

    await middleware(req, undefined, jest.fn());

    // The shared appConfig must not have been mutated.
    expect(sharedAppConfig.endpoints.custom).toEqual([]);
    expect(sharedAppConfig.endpoints.something).toBe('unrelated');
    // But req.config now has the merged endpoints array.
    expect(req.config).not.toBe(sharedAppConfig);
    expect(req.config.endpoints.custom).toHaveLength(1);
    expect(req.config.somethingElse).toEqual({ nested: 'value' });
  });

  it('caches per-tenant separately', async () => {
    mockListCustomEndpoints.mockResolvedValue([{ config: validConfig({ name: 'a' }) }]);
    await middleware(
      { user: { tenantId: 'A' }, config: { endpoints: { custom: [] } } },
      undefined,
      jest.fn(),
    );
    await middleware(
      { user: { tenantId: 'B' }, config: { endpoints: { custom: [] } } },
      undefined,
      jest.fn(),
    );
    // Two distinct tenants, two DB calls.
    expect(mockListCustomEndpoints).toHaveBeenCalledTimes(2);
  });

  it("falls back to YAML-only on DB error (degrade-don't-die)", async () => {
    mockListCustomEndpoints.mockRejectedValue(new Error('mongo down'));
    const req = buildReq();
    const next = jest.fn();
    await middleware(req, undefined, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.config.endpoints.custom).toEqual([]);
  });

  it('skips when req.config is unset', async () => {
    const next = jest.fn();
    await middleware({ user: {} }, undefined, next);
    expect(next).toHaveBeenCalled();
    expect(mockListCustomEndpoints).not.toHaveBeenCalled();
  });
});
