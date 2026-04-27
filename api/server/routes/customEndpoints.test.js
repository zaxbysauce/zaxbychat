/**
 * Phase 9 follow-up — route integration spec for /api/custom-endpoints.
 *
 * Aim: catch the class of bugs that landed in production after PR #15:
 *   1. `getRoleByName` imported from the wrong module so the route 500s
 *      on first authed request (PR #17). The spec exercises every route
 *      with real `getRoleByName` resolution to fail loudly if the
 *      `db = require('~/models')` import drifts again.
 *   2. The DELETE / PATCH role gate (review M1): both share the UPDATE
 *      permission, never USE-only.
 *   3. Row-level ownership: PATCH/DELETE for non-owner non-admin = 403.
 *   4. POST /test reaches the probe (not the create handler).
 *
 * Pattern mirrors api/server/routes/prompts.test.js.
 */
const express = require('express');
const request = require('supertest');
const { PermissionTypes, Permissions, SystemRoles } = require('librechat-data-provider');

jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
  };
});

const mockListCustomEndpoints = jest.fn();
const mockFindCustomEndpointByName = jest.fn();
const mockCreateCustomEndpoint = jest.fn();
const mockUpdateCustomEndpoint = jest.fn();
const mockDeleteCustomEndpoint = jest.fn();
const mockGetRoleByName = jest.fn();

jest.mock('~/models', () => ({
  listCustomEndpoints: (...args) => mockListCustomEndpoints(...args),
  findCustomEndpointByName: (...args) => mockFindCustomEndpointByName(...args),
  createCustomEndpoint: (...args) => mockCreateCustomEndpoint(...args),
  updateCustomEndpoint: (...args) => mockUpdateCustomEndpoint(...args),
  deleteCustomEndpoint: (...args) => mockDeleteCustomEndpoint(...args),
  getRoleByName: (...args) => mockGetRoleByName(...args),
}));

const mockInvalidate = jest.fn();
jest.mock('~/server/middleware/config/customEndpoints', () => ({
  invalidateDbCustomEndpointsCache: mockInvalidate,
}));

const mockProbe = jest.fn();
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    validateCustomEndpointBaseUrl: () => ({ ok: true }),
    shouldAllowLocalEndpointAddresses: () => true,
    probeCustomEndpoint: (...args) => mockProbe(...args),
  };
});

let currentUser;
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    if (currentUser) {
      req.user = { ...currentUser };
    }
    next();
  },
}));

const ADMIN_USER = {
  id: 'user-admin-1',
  role: SystemRoles.ADMIN,
};
const OWNER_USER = {
  id: 'user-owner-1',
  role: SystemRoles.USER,
};
const STRANGER_USER = {
  id: 'user-stranger-1',
  role: SystemRoles.USER,
};
const READ_ONLY_USER = {
  id: 'user-readonly-1',
  role: 'READ_ONLY',
};

function rolePerms(useOn = true, createOn = true, updateOn = true) {
  return {
    [PermissionTypes.CUSTOM_ENDPOINTS]: {
      [Permissions.USE]: useOn,
      [Permissions.CREATE]: createOn,
      [Permissions.UPDATE]: updateOn,
    },
  };
}

function setUser(user) {
  currentUser = user;
}

const baseConfig = (over = {}) => ({
  name: 'ollama-local',
  apiKey: 'user_provided',
  baseURL: 'http://localhost:11434/v1',
  models: { default: ['x'] },
  ...over,
});

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  const router = require('./customEndpoints');
  app.use('/api/custom-endpoints', router);
});

beforeEach(() => {
  jest.clearAllMocks();
  setUser(OWNER_USER);
  mockGetRoleByName.mockImplementation(async (roleName) => {
    switch (roleName) {
      case SystemRoles.ADMIN:
        return { permissions: rolePerms(true, true, true) };
      case SystemRoles.USER:
        return { permissions: rolePerms(true, true, true) };
      case 'READ_ONLY':
        return { permissions: rolePerms(true, false, false) };
      default:
        return null;
    }
  });
});

describe('GET /api/custom-endpoints — USE gate', () => {
  it('returns 200 with redacted apiKey when user has USE', async () => {
    mockListCustomEndpoints.mockResolvedValue([
      {
        _id: { toString: () => 'id-1' },
        name: 'a',
        config: { ...baseConfig({ name: 'a' }), apiKey: 'sk-real-secret' },
        author: { toString: () => OWNER_USER.id },
      },
    ]);

    const res = await request(app).get('/api/custom-endpoints');

    expect(res.status).toBe(200);
    expect(res.body[0].config.apiKey).toBeNull();
    expect(res.body[0].config.apiKeyProvided).toBe(true);
  });

  it('returns 403 when role lacks USE', async () => {
    mockGetRoleByName.mockResolvedValue({
      permissions: rolePerms(false, false, false),
    });

    const res = await request(app).get('/api/custom-endpoints');

    expect(res.status).toBe(403);
    expect(mockListCustomEndpoints).not.toHaveBeenCalled();
  });
});

describe('POST /api/custom-endpoints — CREATE gate', () => {
  it('returns 201 when role has USE+CREATE', async () => {
    mockFindCustomEndpointByName.mockResolvedValue(null);
    mockCreateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig({ name: 'a' }),
      author: { toString: () => OWNER_USER.id },
    });

    const res = await request(app)
      .post('/api/custom-endpoints')
      .send({ config: baseConfig({ name: 'a' }) });

    expect(res.status).toBe(201);
    expect(mockCreateCustomEndpoint).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('returns 403 when role lacks CREATE', async () => {
    setUser(READ_ONLY_USER);
    const res = await request(app)
      .post('/api/custom-endpoints')
      .send({ config: baseConfig() });

    expect(res.status).toBe(403);
    expect(mockCreateCustomEndpoint).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/custom-endpoints/:name — UPDATE gate + ownership', () => {
  it('returns 200 when caller is the owner with UPDATE permission', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });
    mockUpdateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: { ...baseConfig(), modelDisplayLabel: 'New Label' },
      author: OWNER_USER.id,
    });

    const res = await request(app)
      .patch('/api/custom-endpoints/a')
      .send({ config: { modelDisplayLabel: 'New Label' } });

    expect(res.status).toBe(200);
    expect(mockUpdateCustomEndpoint).toHaveBeenCalledWith('a', {
      config: { modelDisplayLabel: 'New Label' },
    });
  });

  it('returns 403 when caller is not the owner and not admin', async () => {
    setUser(STRANGER_USER);
    mockFindCustomEndpointByName.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });

    const res = await request(app)
      .patch('/api/custom-endpoints/a')
      .send({ config: { modelDisplayLabel: 'evil' } });

    expect(res.status).toBe(403);
    expect(mockUpdateCustomEndpoint).not.toHaveBeenCalled();
  });

  it('returns 200 for admin even when not the original author', async () => {
    setUser(ADMIN_USER);
    mockFindCustomEndpointByName.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });
    mockUpdateCustomEndpoint.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });

    const res = await request(app)
      .patch('/api/custom-endpoints/a')
      .send({ config: { modelDisplayLabel: 'updated' } });

    expect(res.status).toBe(200);
  });

  it('returns 403 when role lacks UPDATE permission entirely', async () => {
    setUser(READ_ONLY_USER);
    const res = await request(app)
      .patch('/api/custom-endpoints/a')
      .send({ config: { modelDisplayLabel: 'updated' } });

    expect(res.status).toBe(403);
    expect(mockFindCustomEndpointByName).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/custom-endpoints/:name — shares UPDATE gate (review M1)', () => {
  it('returns 200 when owner has UPDATE permission', async () => {
    mockFindCustomEndpointByName.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });
    mockDeleteCustomEndpoint.mockResolvedValue({ deletedCount: 1 });

    const res = await request(app).delete('/api/custom-endpoints/a');

    expect(res.status).toBe(200);
    expect(mockDeleteCustomEndpoint).toHaveBeenCalledWith('a');
  });

  it('returns 403 for a non-owner non-admin even with UPDATE permission', async () => {
    setUser(STRANGER_USER);
    mockFindCustomEndpointByName.mockResolvedValue({
      _id: { toString: () => 'id-1' },
      name: 'a',
      config: baseConfig(),
      author: OWNER_USER.id,
    });

    const res = await request(app).delete('/api/custom-endpoints/a');

    expect(res.status).toBe(403);
    expect(mockDeleteCustomEndpoint).not.toHaveBeenCalled();
  });

  it('returns 403 for a USE-only role (no UPDATE) — DELETE is not USE-only', async () => {
    setUser(READ_ONLY_USER);
    const res = await request(app).delete('/api/custom-endpoints/a');

    expect(res.status).toBe(403);
    expect(mockFindCustomEndpointByName).not.toHaveBeenCalled();
  });
});

describe('POST /api/custom-endpoints/test — USE-only probe', () => {
  it('routes to the probe and returns its result', async () => {
    mockProbe.mockResolvedValue({ ok: true, durationMs: 12, modelsDetected: 3 });

    const res = await request(app)
      .post('/api/custom-endpoints/test')
      .send({ config: baseConfig() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, durationMs: 12, modelsDetected: 3 });
    expect(mockProbe).toHaveBeenCalled();
    expect(mockCreateCustomEndpoint).not.toHaveBeenCalled();
  });

  it('returns 403 when caller lacks USE permission', async () => {
    mockGetRoleByName.mockResolvedValue({
      permissions: rolePerms(false, false, false),
    });

    const res = await request(app)
      .post('/api/custom-endpoints/test')
      .send({ config: baseConfig() });

    expect(res.status).toBe(403);
    expect(mockProbe).not.toHaveBeenCalled();
  });
});

describe('require-shape regression (PR #17)', () => {
  it('imports getRoleByName from ~/models, not ~/db (would 500 otherwise)', async () => {
    // The route file caches `db.getRoleByName` at load time. If the
    // regression returns (`require('~/db')`), this assertion runs against
    // the stub for `~/models` only because `~/models` is what the route
    // actually requires. A 200 here is positive evidence the import path
    // is correct.
    mockListCustomEndpoints.mockResolvedValue([]);
    const res = await request(app).get('/api/custom-endpoints');
    expect(res.status).toBe(200);
    expect(mockGetRoleByName).toHaveBeenCalled();
  });
});
