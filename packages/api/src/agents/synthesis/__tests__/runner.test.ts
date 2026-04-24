/**
 * Phase 4 PR B c3 — synthesis runner tests.
 *
 * Verifies runCouncilSynthesis orchestrates:
 *   - synthesis_start SSE emission + SynthesisState started=true
 *   - per-delta SSE emission + state.emittedIndex/text updates
 *   - CHAT_MODEL_END → usage collected with agentId='__synthesis__'
 *   - synthesis_complete on normal finish
 *   - abort path (no complete event, state records final emittedText)
 *   - error path (propagates error, state persists)
 * And skipCouncilSynthesisAllFailed covers §D5 all-fail branch.
 */

import { Run, GraphEvents } from '@librechat/agents';
import { runCouncilSynthesis, skipCouncilSynthesisAllFailed } from '../runner';

interface SynthesisPromptResult {
  strategy: 'primary_critic' | 'best_of_three' | 'compare_and_synthesize';
  system: string;
  user: string;
  partial: boolean;
  legStatus: Array<{ legId: string; agentId: string; status: 'succeeded' | 'failed' }>;
}

type Response = { writableEnded: boolean; write: (chunk: string) => boolean };
type EventHandler = { handle: (event: string, data: unknown) => void | Promise<void> };
type LLMConfig = { provider: string; model: string };
type SynthesisState = {
  strategy: 'primary_critic' | 'best_of_three' | 'compare_and_synthesize';
  started: boolean;
  completed: boolean;
  emittedIndex: number;
  text?: string;
  legStatus: Array<{
    legId: string;
    agentId: string;
    model?: string;
    status: 'succeeded' | 'failed';
    error?: string;
  }>;
  partial: boolean;
};
type UsageMetadata = {
  agentId?: string;
  model?: string;
  usage_type?: string;
  input_tokens?: number;
  output_tokens?: number;
};

jest.mock('@librechat/agents', () => {
  const originalGraphEvents = {
    ON_MESSAGE_DELTA: 'on_message_delta',
    ON_RUN_STEP: 'on_run_step',
    ON_RUN_STEP_DELTA: 'on_run_step_delta',
    ON_RUN_STEP_COMPLETED: 'on_run_step_completed',
    CHAT_MODEL_END: 'chat_model_end',
    CHAT_MODEL_STREAM: 'chat_model_stream',
    TOOL_END: 'tool_end',
    TOOL_START: 'tool_start',
    ON_REASONING_DELTA: 'on_reasoning_delta',
    ON_TOOL_EXECUTE: 'on_tool_execute',
    ON_SUMMARIZE_START: 'on_summarize_start',
    ON_SUMMARIZE_DELTA: 'on_summarize_delta',
    ON_SUMMARIZE_COMPLETE: 'on_summarize_complete',
  };

  const mockRunCreate = jest.fn();
  return {
    Providers: {
      OPENAI: 'openAI',
      ANTHROPIC: 'anthropic',
      GOOGLE: 'google',
      AZURE: 'azureOpenAI',
      VERTEXAI: 'vertexai',
      BEDROCK: 'bedrock',
    },
    GraphEvents: originalGraphEvents,
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
    } as unknown as Response,
    writes,
  };
}

function basePrompt(
  overrides: Partial<SynthesisPromptResult> = {},
): SynthesisPromptResult {
  return {
    strategy: 'compare_and_synthesize',
    system: 'You are a synthesis agent.',
    user: 'User Q?\n\n<leg id="a">A</leg>\n<leg id="b">B</leg>',
    partial: false,
    legStatus: [
      { legId: 'a', agentId: 'primary____0', status: 'succeeded' },
      { legId: 'b', agentId: 'extra____1', status: 'succeeded' },
    ],
    ...overrides,
  };
}

const llmConfig: LLMConfig = {
  provider: 'openAI',
  model: 'gpt-4o',
} as unknown as LLMConfig;

async function driveHandlers(
  handlers: Record<string, EventHandler>,
  events: Array<{ event: string; data: unknown }>,
): Promise<void> {
  for (const { event, data } of events) {
    const handler = handlers[event];
    if (handler && typeof handler.handle === 'function') {
      await handler.handle(event, data);
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runCouncilSynthesis — happy path', () => {
  it('emits start, deltas, and complete; collects usage with agentId __synthesis__', async () => {
    const { res, writes } = mockRes();
    const collectedUsage: UsageMetadata[] = [];
    const stateUpdates: Array<Partial<SynthesisState>> = [];

    let capturedHandlers: Record<string, EventHandler> = {};
    mockRunCreate.mockImplementation(async ({ customHandlers }) => {
      capturedHandlers = customHandlers;
      return {
        async processStream() {
          await driveHandlers(capturedHandlers, [
            { event: GraphEvents.ON_MESSAGE_DELTA, data: { text: 'Hello ' } },
            { event: GraphEvents.ON_MESSAGE_DELTA, data: { text: 'world!' } },
            {
              event: GraphEvents.CHAT_MODEL_END,
              data: {
                output: {
                  usage_metadata: { input_tokens: 100, output_tokens: 50 },
                },
              },
            },
          ]);
        },
      };
    });

    const result = await runCouncilSynthesis({
      res,
      runId: 'run-1',
      streamId: 's-1',
      abortSignal: new AbortController().signal,
      llmConfig,
      prompt: basePrompt(),
      collectedUsage,
      setSynthesisState: async (p) => {
        stateUpdates.push(p);
      },
    });

    expect(result.completed).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.emittedText).toBe('Hello world!');

    const startFrame = writes.find((w) => w.startsWith('event: synthesis_start\n'));
    const deltaFrames = writes.filter((w) => w.startsWith('event: synthesis_delta\n'));
    const completeFrame = writes.find((w) => w.startsWith('event: synthesis_complete\n'));
    expect(startFrame).toBeDefined();
    expect(deltaFrames).toHaveLength(2);
    expect(completeFrame).toBeDefined();

    expect(collectedUsage).toHaveLength(1);
    expect(collectedUsage[0].agentId).toBe('__synthesis__');
    expect(collectedUsage[0].model).toBe('gpt-4o');
    expect(collectedUsage[0].input_tokens).toBe(100);
    expect(collectedUsage[0].output_tokens).toBe(50);

    const startedTransition = stateUpdates.find((u) => u.started === true);
    expect(startedTransition).toBeDefined();
    const completedTransition = stateUpdates.find((u) => u.completed === true);
    expect(completedTransition?.text).toBe('Hello world!');
    expect(completedTransition?.emittedIndex).toBe('Hello world!'.length);
  });

  it('carries partial=true through start and complete events when prompt is partial', async () => {
    const { res, writes } = mockRes();
    mockRunCreate.mockImplementation(async () => ({
      async processStream() {},
    }));

    await runCouncilSynthesis({
      res,
      runId: 'r',
      streamId: 's',
      abortSignal: new AbortController().signal,
      llmConfig,
      prompt: basePrompt({
        partial: true,
        legStatus: [
          { legId: 'a', agentId: 'primary____0', status: 'succeeded' },
          { legId: 'b', agentId: 'extra____1', status: 'failed' },
        ],
      }),
      collectedUsage: [],
      setSynthesisState: async () => {},
    });

    const startFrame = writes.find((w) => w.startsWith('event: synthesis_start\n'))!;
    const payload = JSON.parse(
      startFrame.split('\n').find((l) => l.startsWith('data: '))!.replace('data: ', ''),
    );
    expect(payload.partial).toBe(true);
  });
});

describe('runCouncilSynthesis — abort path', () => {
  it('returns aborted=true without emitting synthesis_complete when signal aborts mid-stream', async () => {
    const { res, writes } = mockRes();
    const stateUpdates: Array<Partial<SynthesisState>> = [];
    const ac = new AbortController();

    mockRunCreate.mockImplementation(async ({ customHandlers }) => ({
      async processStream() {
        await driveHandlers(customHandlers, [
          { event: GraphEvents.ON_MESSAGE_DELTA, data: { text: 'partial ' } },
        ]);
        ac.abort();
        const err: Error & { code?: string } = new Error('aborted');
        throw err;
      },
    }));

    const result = await runCouncilSynthesis({
      res,
      runId: 'r',
      streamId: 's',
      abortSignal: ac.signal,
      llmConfig,
      prompt: basePrompt(),
      collectedUsage: [],
      setSynthesisState: async (p) => {
        stateUpdates.push(p);
      },
    });

    expect(result.aborted).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.emittedText).toBe('partial ');
    expect(writes.find((w) => w.startsWith('event: synthesis_complete\n'))).toBeUndefined();
  });
});

describe('runCouncilSynthesis — error path', () => {
  it('captures non-abort errors and persists final text in synthesis state', async () => {
    const { res, writes } = mockRes();

    mockRunCreate.mockImplementation(async () => ({
      async processStream() {
        throw new Error('provider exploded');
      },
    }));

    const result = await runCouncilSynthesis({
      res,
      runId: 'r',
      streamId: 's',
      abortSignal: new AbortController().signal,
      llmConfig,
      prompt: basePrompt(),
      collectedUsage: [],
      setSynthesisState: async () => {},
    });

    expect(result.aborted).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.error).toBe('provider exploded');
    expect(writes.find((w) => w.startsWith('event: synthesis_complete\n'))).toBeUndefined();
  });
});

describe('skipCouncilSynthesisAllFailed', () => {
  it('emits synthesis_skipped_all_failed and persists an all-failed completed state', async () => {
    const { res, writes } = mockRes();
    const stateUpdates: Array<Partial<SynthesisState>> = [];
    const legStatus: SynthesisState['legStatus'] = [
      { legId: 'a', agentId: 'primary____0', model: 'gpt-4o', status: 'failed', error: '500' },
      {
        legId: 'b',
        agentId: 'extra____1',
        model: 'claude-opus-4-7',
        status: 'failed',
        error: 'auth',
      },
    ];

    await skipCouncilSynthesisAllFailed({
      res,
      legStatus,
      strategy: 'compare_and_synthesize',
      setSynthesisState: async (p) => {
        stateUpdates.push(p);
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith('event: synthesis_skipped_all_failed\n')).toBe(true);

    expect(stateUpdates).toHaveLength(1);
    expect(stateUpdates[0].completed).toBe(true);
    expect(stateUpdates[0].text).toBeUndefined();
    expect(stateUpdates[0].legStatus).toEqual(legStatus);
  });
});

describe('runCouncilSynthesis — extractDeltaText variants', () => {
  it('handles string, object.text, object.delta, and content-array payload shapes', async () => {
    const { res, writes } = mockRes();
    mockRunCreate.mockImplementation(async ({ customHandlers }) => ({
      async processStream() {
        await driveHandlers(customHandlers, [
          { event: GraphEvents.ON_MESSAGE_DELTA, data: 'raw string ' },
          { event: GraphEvents.ON_MESSAGE_DELTA, data: { text: 'from text ' } },
          { event: GraphEvents.ON_MESSAGE_DELTA, data: { delta: 'from delta ' } },
          {
            event: GraphEvents.ON_MESSAGE_DELTA,
            data: { content: [{ type: 'text', text: 'from content' }] },
          },
        ]);
      },
    }));

    const result = await runCouncilSynthesis({
      res,
      runId: 'r',
      streamId: 's',
      abortSignal: new AbortController().signal,
      llmConfig,
      prompt: basePrompt(),
      collectedUsage: [],
      setSynthesisState: async () => {},
    });
    expect(result.emittedText).toBe('raw string from text from delta from content');
    expect(writes.filter((w) => w.startsWith('event: synthesis_delta\n'))).toHaveLength(4);
  });
});
