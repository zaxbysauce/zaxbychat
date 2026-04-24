/**
 * Phase 4 PR B c5 — tests for POST /api/agents/chat/stop-leg
 *
 * Gates & outcomes verified:
 *   - 404 when interfaceSchema.council is off (endpoint invisible)
 *   - 400 when streamId or legIndex missing/invalid
 *   - 404 when job not found
 *   - 403 when job belongs to a different user
 *   - 202 'signaled' when stopCouncilLeg aborts the leg child
 *   - 409 'no_op' for council_inactive / already_complete
 *   - 404 'no_op' for unknown_leg
 */

const express = require('express');
const request = require('supertest');

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockGenerationJobManager = {
  getJob: jest.fn(),
  stopCouncilLeg: jest.fn(),
  getActiveJobIdsForUser: jest.fn(),
  abortJob: jest.fn(),
};

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isEnabled: jest.fn().mockReturnValue(false),
  GenerationJobManager: mockGenerationJobManager,
}));

jest.mock('~/models', () => ({
  saveMessage: jest.fn(),
}));

const COUNCIL_FLAG_ENABLED = { interfaceConfig: { council: true } };
let reqConfigOverride = COUNCIL_FLAG_ENABLED;

jest.mock('~/server/middleware', () => ({
  uaParser: (req, res, next) => next(),
  checkBan: (req, res, next) => next(),
  requireJwtAuth: (req, res, next) => {
    req.user = { id: 'test-user-123' };
    next();
  },
  messageIpLimiter: (req, res, next) => next(),
  configMiddleware: (req, res, next) => {
    req.config = reqConfigOverride;
    next();
  },
  messageUserLimiter: (req, res, next) => next(),
}));

jest.mock('~/server/routes/agents/chat', () => require('express').Router());
jest.mock('~/server/routes/agents/v1', () => ({
  v1: require('express').Router(),
}));

const agentRoutes = require('~/server/routes/agents/index');

describe('POST /api/agents/chat/stop-leg', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reqConfigOverride = COUNCIL_FLAG_ENABLED;
    mockGenerationJobManager.getJob.mockResolvedValue({
      streamId: 's1',
      userId: 'test-user-123',
    });
  });

  describe('council flag gating', () => {
    it('returns 404 when interfaceSchema.council is false', async () => {
      reqConfigOverride = { interfaceConfig: { council: false } };
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(404);
      expect(mockGenerationJobManager.stopCouncilLeg).not.toHaveBeenCalled();
    });

    it('returns 404 when interfaceConfig is absent entirely', async () => {
      reqConfigOverride = {};
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(404);
    });

    it('returns 404 when interfaceConfig.council is unset', async () => {
      reqConfigOverride = { interfaceConfig: {} };
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(404);
    });
  });

  describe('input validation', () => {
    it('returns 400 when streamId missing', async () => {
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ legIndex: 0 });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/streamId/);
    });

    it('returns 400 when legIndex missing', async () => {
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1' });
      expect(r.status).toBe(400);
    });

    it('returns 400 when legIndex negative', async () => {
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: -1 });
      expect(r.status).toBe(400);
    });

    it('returns 400 when legIndex is a string', async () => {
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 'zero' });
      expect(r.status).toBe(400);
    });

    it('returns 400 when legIndex is a float', async () => {
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 1.5 });
      expect(r.status).toBe(400);
    });
  });

  describe('authorization', () => {
    it('returns 404 when job not found', async () => {
      mockGenerationJobManager.getJob.mockResolvedValue(null);
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 'ghost', legIndex: 0 });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('Job not found');
    });

    it('returns 403 when job belongs to another user', async () => {
      mockGenerationJobManager.getJob.mockResolvedValue({
        streamId: 's1',
        userId: 'different-user',
      });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(403);
    });

    it('permits when job has no userId (pre-auth legacy job)', async () => {
      mockGenerationJobManager.getJob.mockResolvedValue({ streamId: 's1' });
      mockGenerationJobManager.stopCouncilLeg.mockReturnValue({ status: 'signaled' });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(202);
    });
  });

  describe('stopCouncilLeg outcome mapping', () => {
    it('maps signaled → 202', async () => {
      mockGenerationJobManager.stopCouncilLeg.mockReturnValue({ status: 'signaled' });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 1 });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ status: 'signaled', streamId: 's1', legIndex: 1 });
      expect(mockGenerationJobManager.stopCouncilLeg).toHaveBeenCalledWith('s1', 1);
    });

    it('maps no_op/council_inactive → 409', async () => {
      mockGenerationJobManager.stopCouncilLeg.mockReturnValue({
        status: 'no_op',
        reason: 'council_inactive',
      });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(409);
      expect(r.body.reason).toBe('council_inactive');
    });

    it('maps no_op/already_complete → 409', async () => {
      mockGenerationJobManager.stopCouncilLeg.mockReturnValue({
        status: 'no_op',
        reason: 'already_complete',
      });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 0 });
      expect(r.status).toBe(409);
      expect(r.body.reason).toBe('already_complete');
    });

    it('maps no_op/unknown_leg → 404', async () => {
      mockGenerationJobManager.stopCouncilLeg.mockReturnValue({
        status: 'no_op',
        reason: 'unknown_leg',
      });
      const r = await request(app)
        .post('/api/agents/chat/stop-leg')
        .send({ streamId: 's1', legIndex: 99 });
      expect(r.status).toBe(404);
      expect(r.body.reason).toBe('unknown_leg');
    });
  });
});
