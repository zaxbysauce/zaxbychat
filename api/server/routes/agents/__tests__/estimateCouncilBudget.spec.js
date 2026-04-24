/**
 * Tests for POST /api/agents/chat/estimate-council-budget (Phase 4 PR B c6).
 *
 * Endpoint is informational — never auto-blocks submission. Server is the
 * sole authority on the estimate shape so the client does not duplicate
 * tokenValue lookups.
 */

const express = require('express');
const request = require('supertest');

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockEstimateCouncilBudget = jest.fn();
const mockGenerationJobManager = { getJob: jest.fn() };

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isEnabled: jest.fn().mockReturnValue(false),
  GenerationJobManager: mockGenerationJobManager,
  estimateCouncilBudget: (...args) => mockEstimateCouncilBudget(...args),
}));

jest.mock('~/models', () => ({ saveMessage: jest.fn() }));

const COUNCIL_ENABLED = { interfaceConfig: { council: true } };
let reqConfigOverride = COUNCIL_ENABLED;

jest.mock('~/server/middleware', () => ({
  uaParser: (req, res, next) => next(),
  checkBan: (req, res, next) => next(),
  requireJwtAuth: (req, res, next) => {
    req.user = { id: 'u1' };
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

describe('POST /api/agents/chat/estimate-council-budget', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reqConfigOverride = COUNCIL_ENABLED;
    mockEstimateCouncilBudget.mockReturnValue({
      approximate: true,
      perLeg: [{ endpoint: 'openAI', model: 'gpt-4o', estimatedCompletionTokens: 4096 }],
      synthesis: null,
      totalEstimatedTokens: 4096,
    });
  });

  describe('flag gating', () => {
    it('returns 404 when council flag off', async () => {
      reqConfigOverride = { interfaceConfig: { council: false } };
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({ primary: { endpoint: 'openAI', model: 'gpt-4o' }, extras: [] });
      expect(r.status).toBe(404);
      expect(mockEstimateCouncilBudget).not.toHaveBeenCalled();
    });

    it('returns 404 when interfaceConfig absent', async () => {
      reqConfigOverride = {};
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({ primary: { endpoint: 'openAI', model: 'gpt-4o' }, extras: [] });
      expect(r.status).toBe(404);
    });
  });

  describe('input validation', () => {
    it('returns 400 when primary missing', async () => {
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({ extras: [] });
      expect(r.status).toBe(400);
    });

    it('returns 400 when primary.model empty', async () => {
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({ primary: { endpoint: 'openAI', model: '' }, extras: [] });
      expect(r.status).toBe(400);
    });

    it('returns 400 when extras is malformed', async () => {
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({
          primary: { endpoint: 'openAI', model: 'gpt-4o' },
          extras: [{ endpoint: '' }],
        });
      expect(r.status).toBe(400);
    });

    it('returns 400 when extras array exceeds max length (2)', async () => {
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({
          primary: { endpoint: 'openAI', model: 'gpt-4o' },
          extras: [
            { endpoint: 'anthropic', model: 'claude-opus-4-7' },
            { endpoint: 'google', model: 'gemini-2.5-pro' },
            { endpoint: 'xai', model: 'grok-4' },
          ],
        });
      expect(r.status).toBe(400);
    });
  });

  describe('happy path', () => {
    it('returns the estimate body from estimateCouncilBudget', async () => {
      const stubbed = {
        approximate: true,
        perLeg: [
          { endpoint: 'openAI', model: 'gpt-4o', estimatedCompletionTokens: 4096 },
          {
            endpoint: 'anthropic',
            model: 'claude-opus-4-7',
            estimatedCompletionTokens: 8192,
          },
        ],
        synthesis: {
          endpoint: 'openAI',
          model: 'gpt-4o',
          estimatedPromptTokens: 9000,
          estimatedCompletionTokens: 4096,
        },
        totalEstimatedTokens: 25384,
      };
      mockEstimateCouncilBudget.mockReturnValue(stubbed);
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({
          primary: { endpoint: 'openAI', model: 'gpt-4o' },
          extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
          strategy: 'compare_and_synthesize',
          userQuestionChars: 500,
        });
      expect(r.status).toBe(200);
      expect(r.body).toEqual(stubbed);
      expect(mockEstimateCouncilBudget).toHaveBeenCalledWith({
        primary: { endpoint: 'openAI', model: 'gpt-4o' },
        extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
        strategy: 'compare_and_synthesize',
        userQuestionChars: 500,
      });
    });

    it('falls back to compare_and_synthesize when strategy invalid or absent', async () => {
      await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({
          primary: { endpoint: 'openAI', model: 'gpt-4o' },
          extras: [],
          strategy: 'not_a_strategy',
        });
      expect(mockEstimateCouncilBudget).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'compare_and_synthesize' }),
      );
    });

    it('accepts an empty extras array (primary-only budget)', async () => {
      const r = await request(app)
        .post('/api/agents/chat/estimate-council-budget')
        .send({
          primary: { endpoint: 'openAI', model: 'gpt-4o' },
          extras: [],
        });
      expect(r.status).toBe(200);
    });
  });
});
