/**
 * End-to-end tests for executeCouncilPhase2 — the orchestrator AgentClient
 * invokes after phase 1 completes. Covers every §D5 branch.
 */

import { Run, GraphEvents } from '@librechat/agents';
import {
  executeCouncilPhase2,
  prepareCouncilAbortHierarchy,
  buildLegIdentities,
} from '../execute';

jest.mock('@librechat/agents', () => {
  const mockRunCreate = jest.fn();
  return {
    Providers: {},
    GraphEvents: {
      ON_MESSAGE_DELTA: 'on_message_delta',
      CHAT_MODEL_END: 'chat_model_end',
    },
    Run: { create: mockRunCreate },
    labelContentByAgent: (c: unknown) => c,
  };
});

const mockRunCreate = (Run as unknown as { create: jest.Mock }).create;

function mockRes() {
  const writes: string[] = [];
  return {
    res: {
      writableEnded: false,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as never,
    writes,
  };
}

interface PartialSynthesisState {
  strategy?: string;
  started?: boolean;
  completed?: boolean;
  emittedIndex?: number;
  text?: string;
  legStatus?: Array<{ legId: string; agentId: string; status: string; model?: string }>;
  partial?: boolean;
}

const legIdentities = [
  { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o' },
  { legId: 'leg-1', agentId: 'ephemeral____1', model: 'claude-opus-4-7' },
];

const llmConfig = { provider: 'openAI', model: 'gpt-4o' } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('executeCouncilPhase2 — inactive short-circuit', () => {
  it('returns inactive when council.active is false', async () => {
    const { res } = mockRes();
    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: new AbortController().signal,
      llmConfig,
      council: { active: false, legAgentIds: ['primary____0'], legIdentities },
      userQuestion: 'Q',
      contentParts: [],
      collectedUsage: [],
      setSynthesisState: async () => {},
    });
    expect(outcome).toEqual({ ran: false, reason: 'inactive' });
    expect(mockRunCreate).not.toHaveBeenCalled();
  });

  it('returns inactive when only the primary leg is present', async () => {
    const { res } = mockRes();
    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: new AbortController().signal,
      llmConfig,
      council: {
        active: true,
        legAgentIds: ['primary____0'],
        legIdentities: [legIdentities[0]],
      },
      userQuestion: 'Q',
      contentParts: [],
      collectedUsage: [],
      setSynthesisState: async () => {},
    });
    expect(outcome.ran).toBe(false);
  });
});

describe('executeCouncilPhase2 — happy path', () => {
  it('runs synthesis when ≥1 leg succeeded and emits to SSE', async () => {
    const { res, writes } = mockRes();
    const stateUpdates: PartialSynthesisState[] = [];
    const collectedUsage: unknown[] = [];

    mockRunCreate.mockImplementation(async ({ customHandlers }) => ({
      async processStream() {
        await customHandlers[GraphEvents.ON_MESSAGE_DELTA].handle(
          GraphEvents.ON_MESSAGE_DELTA,
          { text: 'synthesis output' },
        );
        await customHandlers[GraphEvents.CHAT_MODEL_END].handle(GraphEvents.CHAT_MODEL_END, {
          output: { usage_metadata: { input_tokens: 200, output_tokens: 80 } },
        });
      },
    }));

    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: new AbortController().signal,
      llmConfig,
      council: {
        active: true,
        legAgentIds: ['primary____0', 'ephemeral____1'],
        legIdentities,
        strategy: 'compare_and_synthesize',
      },
      userQuestion: 'Q',
      contentParts: [
        { type: 'text', text: 'A', agentId: 'primary____0', groupId: 1 },
        { type: 'text', text: 'B', agentId: 'ephemeral____1', groupId: 1 },
      ] as never,
      collectedUsage: collectedUsage as never,
      setSynthesisState: async (p) => {
        stateUpdates.push(p);
      },
    });

    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.completed).toBe(true);
      expect(outcome.partial).toBe(false);
      expect(outcome.emittedText).toBe('synthesis output');
    }

    expect(writes.some((w) => w.startsWith('event: synthesis_start\n'))).toBe(true);
    expect(writes.some((w) => w.startsWith('event: synthesis_delta\n'))).toBe(true);
    expect(writes.some((w) => w.startsWith('event: synthesis_complete\n'))).toBe(true);

    expect((collectedUsage[0] as { agentId?: string })?.agentId).toBe('__synthesis__');
  });

  it('flags partial=true when one leg failed but at least one succeeded', async () => {
    const { res, writes } = mockRes();
    mockRunCreate.mockImplementation(async () => ({ async processStream() {} }));

    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: new AbortController().signal,
      llmConfig,
      council: {
        active: true,
        legAgentIds: ['primary____0', 'ephemeral____1'],
        legIdentities,
      },
      userQuestion: 'Q',
      contentParts: [
        { type: 'text', text: 'primary response', agentId: 'primary____0', groupId: 1 },
      ] as never,
      collectedUsage: [],
      setSynthesisState: async () => {},
    });

    expect(outcome.ran).toBe(true);
    if (outcome.ran) {
      expect(outcome.partial).toBe(true);
    }

    const startFrame = writes.find((w) => w.startsWith('event: synthesis_start\n'))!;
    const payload = JSON.parse(
      startFrame.split('\n').find((l) => l.startsWith('data: '))!.replace('data: ', ''),
    );
    expect(payload.partial).toBe(true);
  });
});

describe('executeCouncilPhase2 — all-legs-failed branch (§D5)', () => {
  it('skips synthesis and emits synthesis_skipped_all_failed when all legs failed', async () => {
    const { res, writes } = mockRes();
    const stateUpdates: PartialSynthesisState[] = [];

    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: new AbortController().signal,
      llmConfig,
      council: {
        active: true,
        legAgentIds: ['primary____0', 'ephemeral____1'],
        legIdentities,
      },
      userQuestion: 'Q',
      contentParts: [] as never,
      collectedUsage: [],
      setSynthesisState: async (p) => {
        stateUpdates.push(p);
      },
    });

    expect(outcome.ran).toBe(false);
    if (outcome.ran === false && outcome.reason === 'all_legs_failed') {
      expect(outcome.legStatus).toHaveLength(2);
      expect(outcome.legStatus.every((l) => l.status === 'failed')).toBe(true);
    } else {
      throw new Error(`expected all_legs_failed outcome, got ${JSON.stringify(outcome)}`);
    }

    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith('event: synthesis_skipped_all_failed\n')).toBe(true);
    expect(mockRunCreate).not.toHaveBeenCalled();
    const completedState = stateUpdates.find((u) => u.completed === true);
    expect(completedState?.text).toBeUndefined();
  });
});

describe('executeCouncilPhase2 — aborted short-circuit', () => {
  it('returns aborted without invoking LLM when synthesisSignal is already aborted', async () => {
    const { res, writes } = mockRes();
    const ac = new AbortController();
    ac.abort();

    const outcome = await executeCouncilPhase2({
      res,
      runId: 'r',
      streamId: 's',
      synthesisSignal: ac.signal,
      llmConfig,
      council: {
        active: true,
        legAgentIds: ['primary____0', 'ephemeral____1'],
        legIdentities,
      },
      userQuestion: 'Q',
      contentParts: [] as never,
      collectedUsage: [],
      setSynthesisState: async () => {},
    });

    expect(outcome).toEqual({ ran: false, reason: 'aborted' });
    expect(writes).toHaveLength(0);
    expect(mockRunCreate).not.toHaveBeenCalled();
  });
});

describe('prepareCouncilAbortHierarchy', () => {
  it('creates N leg signals + 1 synthesis signal all cascading from the parent', () => {
    const parent = new AbortController();
    const setup = prepareCouncilAbortHierarchy({ parentController: parent, legCount: 3 });

    expect(setup.legSignals).toHaveLength(3);
    expect(setup.legControllers).toHaveLength(3);
    expect(setup.synthesisSignal.aborted).toBe(false);

    parent.abort();

    expect(setup.legSignals.every((s) => s.aborted)).toBe(true);
    expect(setup.synthesisSignal.aborted).toBe(true);
  });
});

describe('buildLegIdentities', () => {
  it('orders identities by legAgentIds with primary first and resolves models from agentConfigs', () => {
    const configs = new Map<string, { id?: string; model?: string; provider?: string }>();
    configs.set('ephemeral____1', {
      id: 'ephemeral____1',
      model: 'claude-opus-4-7',
      provider: 'anthropic',
    });
    configs.set('ephemeral____2', {
      id: 'ephemeral____2',
      model: 'gemini-2.5-pro',
      provider: 'google',
    });

    const identities = buildLegIdentities({
      legAgentIds: ['primary____0', 'ephemeral____1', 'ephemeral____2'],
      primaryAgentId: 'primary____0',
      primaryModel: 'gpt-4o',
      agentConfigs: configs,
    });

    expect(identities).toEqual([
      { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o' },
      { legId: 'leg-1', agentId: 'ephemeral____1', model: 'claude-opus-4-7' },
      { legId: 'leg-2', agentId: 'ephemeral____2', model: 'gemini-2.5-pro' },
    ]);
  });

  it('falls back to model=unknown when an extra is missing from agentConfigs', () => {
    const identities = buildLegIdentities({
      legAgentIds: ['primary____0', 'orphan____1'],
      primaryAgentId: 'primary____0',
      primaryModel: 'gpt-4o',
      agentConfigs: new Map(),
    });
    expect(identities[1].model).toBe('unknown');
  });
});
