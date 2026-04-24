/**
 * Phase 4 PR B — processCouncilAgents activation tests.
 *
 * Verifies the JS wrapper's gating, loading, and population of agentConfigs
 * under council-active, flag-off, empty-extras, invalid-extras, and
 * all-extras-fail scenarios.
 */

const mockLoadAddedAgent = jest.fn();
const mockValidateAgentModel = jest.fn();
const mockInitializeAgent = jest.fn();
const mockResolveCouncilExtras = jest.fn();

jest.mock('@librechat/api', () => ({
  ADDED_AGENT_ID: 'added_agent',
  initializeAgent: (...args) => mockInitializeAgent(...args),
  validateAgentModel: (...args) => mockValidateAgentModel(...args),
  loadAddedAgent: (...args) => mockLoadAddedAgent(...args),
  resolveCouncilExtras: (...args) => mockResolveCouncilExtras(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getMCPServerTools: jest.fn(),
}));

jest.mock('~/models', () => ({
  getAgent: jest.fn(),
  getFiles: jest.fn(),
  getUserKey: jest.fn(),
  getMessages: jest.fn(),
  getConvoFiles: jest.fn(),
  updateFilesUsage: jest.fn(),
  getUserCodeFiles: jest.fn(),
  getUserKeyValues: jest.fn(),
  getToolFilesByIds: jest.fn(),
  getCodeGeneratedFiles: jest.fn(),
}));

const { processCouncilAgents } = require('./councilAgents');

function baseParams(overrides = {}) {
  return {
    req: { config: { interfaceConfig: { council: true } } },
    res: {},
    endpointOption: {
      endpoint: 'openAI',
      model: 'gpt-4o',
      councilAgents: [],
    },
    modelsConfig: {},
    logViolation: jest.fn(),
    loadTools: jest.fn(),
    requestFiles: [],
    conversationId: 'conv-1',
    parentMessageId: null,
    allowedProviders: new Set(),
    agentConfigs: new Map(),
    primaryAgentId: 'primary____0',
    primaryAgent: { id: 'primary____0' },
    userMCPAuthMap: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateAgentModel.mockResolvedValue({ isValid: true });
});

describe('processCouncilAgents — gating', () => {
  it('no-op when resolveCouncilExtras returns null (flag off)', async () => {
    mockResolveCouncilExtras.mockReturnValue(null);
    const params = baseParams();

    const result = await processCouncilAgents(params);

    expect(result.active).toBe(false);
    expect(result.legAgentIds).toEqual(['primary____0']);
    expect(params.agentConfigs.size).toBe(0);
    expect(mockLoadAddedAgent).not.toHaveBeenCalled();
  });

  it('no-op when extras empty', async () => {
    mockResolveCouncilExtras.mockReturnValue([]);
    const params = baseParams();

    const result = await processCouncilAgents(params);

    expect(result.active).toBe(false);
    expect(mockLoadAddedAgent).not.toHaveBeenCalled();
  });
});

describe('processCouncilAgents — happy path', () => {
  it('loads each extra with distinct index (1, 2) and populates agentConfigs', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ]);

    mockLoadAddedAgent.mockImplementation(async ({ index }) => ({
      id: `ephemeral____${index}`,
      provider: index === 1 ? 'anthropic' : 'google',
      model: index === 1 ? 'claude-opus-4-7' : 'gemini-2.5-pro',
    }));

    mockInitializeAgent.mockImplementation(async ({ agent }) => ({
      id: agent.id,
      provider: agent.provider,
      model: agent.model,
      attachments: [],
    }));

    const params = baseParams();

    const result = await processCouncilAgents(params);

    expect(result.active).toBe(true);
    expect(result.legAgentIds).toEqual(['primary____0', 'ephemeral____1', 'ephemeral____2']);
    expect(params.agentConfigs.size).toBe(2);
    expect(params.agentConfigs.has('ephemeral____1')).toBe(true);
    expect(params.agentConfigs.has('ephemeral____2')).toBe(true);

    const loadCalls = mockLoadAddedAgent.mock.calls;
    expect(loadCalls).toHaveLength(2);
    expect(loadCalls[0][0].index).toBe(1);
    expect(loadCalls[1][0].index).toBe(2);
  });

  it('single extra → leg count = 2 (primary + 1 extra)', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
    ]);

    mockLoadAddedAgent.mockImplementation(async ({ index }) => ({
      id: `ephemeral____${index}`,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    }));

    mockInitializeAgent.mockImplementation(async ({ agent }) => ({
      id: agent.id,
      provider: agent.provider,
      model: agent.model,
    }));

    const result = await processCouncilAgents(baseParams());

    expect(result.active).toBe(true);
    expect(result.legAgentIds).toHaveLength(2);
  });
});

describe('processCouncilAgents — degraded paths', () => {
  it('skips extras whose loadAddedAgent returns null; continues others', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ]);

    mockLoadAddedAgent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ephemeral____2',
        provider: 'google',
        model: 'gemini-2.5-pro',
      });

    mockInitializeAgent.mockImplementation(async ({ agent }) => ({
      id: agent.id,
      provider: agent.provider,
      model: agent.model,
    }));

    const params = baseParams();
    const result = await processCouncilAgents(params);

    expect(result.active).toBe(true);
    expect(result.legAgentIds).toEqual(['primary____0', 'ephemeral____2']);
    expect(params.agentConfigs.size).toBe(1);
  });

  it('skips extras with failing validation', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
    ]);

    mockLoadAddedAgent.mockResolvedValue({
      id: 'ephemeral____1',
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });

    mockValidateAgentModel.mockResolvedValue({
      isValid: false,
      error: { message: 'model not allowed' },
    });

    const params = baseParams();
    const result = await processCouncilAgents(params);

    expect(result.active).toBe(false);
    expect(result.legAgentIds).toEqual(['primary____0']);
    expect(params.agentConfigs.size).toBe(0);
    expect(mockInitializeAgent).not.toHaveBeenCalled();
  });

  it('catches and logs per-extra errors without aborting other extras', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ]);

    mockLoadAddedAgent
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        id: 'ephemeral____2',
        provider: 'google',
        model: 'gemini-2.5-pro',
      });

    mockInitializeAgent.mockImplementation(async ({ agent }) => ({
      id: agent.id,
      provider: agent.provider,
      model: agent.model,
    }));

    const params = baseParams();
    const result = await processCouncilAgents(params);

    expect(result.active).toBe(true);
    expect(result.legAgentIds).toEqual(['primary____0', 'ephemeral____2']);
    expect(params.agentConfigs.size).toBe(1);
  });

  it('returns active=false when every extra errors (primary runs alone)', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ]);

    mockLoadAddedAgent.mockRejectedValue(new Error('boom'));

    const params = baseParams();
    const result = await processCouncilAgents(params);

    expect(result.active).toBe(false);
    expect(result.legAgentIds).toEqual(['primary____0']);
    expect(params.agentConfigs.size).toBe(0);
  });
});

describe('processCouncilAgents — MCP auth map propagation', () => {
  it('merges auth maps from each successfully-loaded extra', async () => {
    mockResolveCouncilExtras.mockReturnValue([
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ]);

    mockLoadAddedAgent.mockImplementation(async ({ index }) => ({
      id: `ephemeral____${index}`,
      provider: index === 1 ? 'anthropic' : 'google',
      model: index === 1 ? 'claude-opus-4-7' : 'gemini-2.5-pro',
    }));

    mockInitializeAgent
      .mockResolvedValueOnce({
        id: 'ephemeral____1',
        provider: 'anthropic',
        userMCPAuthMap: { foo: { token: 'a' } },
      })
      .mockResolvedValueOnce({
        id: 'ephemeral____2',
        provider: 'google',
        userMCPAuthMap: { bar: { token: 'b' } },
      });

    const params = baseParams({ userMCPAuthMap: { base: { token: 'z' } } });
    const result = await processCouncilAgents(params);

    expect(result.userMCPAuthMap).toEqual({
      base: { token: 'z' },
      foo: { token: 'a' },
      bar: { token: 'b' },
    });
  });
});
