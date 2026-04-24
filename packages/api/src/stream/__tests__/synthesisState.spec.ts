/**
 * SynthesisState persistence tests for GenerationJobManager.
 *
 * Phase 4 PR B: council-mode synthesis state is persisted on the job record
 * so three-state resume (pre / mid / post synthesis) works across Redis
 * replicas. Non-council jobs never invoke these methods.
 */

import type { SynthesisState } from '../interfaces/IJobStore';

jest.spyOn(console, 'log').mockImplementation();

const mkLegStatus = (overrides: Partial<SynthesisState['legStatus'][0]> = {}) => ({
  legId: 'leg-0',
  agentId: 'primary____0',
  model: 'gpt-4o',
  status: 'succeeded' as const,
  ...overrides,
});

describe('SynthesisState — InMemoryJobStore direct update / read', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('updateJob accepts synthesisState and getJob returns it', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore();
    await store.initialize();

    const streamId = 'synth-1';
    await store.createJob(streamId, 'user-1');

    const state: SynthesisState = {
      strategy: 'compare_and_synthesize',
      started: true,
      completed: false,
      emittedIndex: 5,
      text: 'hello',
      legStatus: [mkLegStatus()],
      partial: false,
    };

    await store.updateJob(streamId, { synthesisState: state });

    const data = await store.getJob(streamId);
    expect(data?.synthesisState).toEqual(state);

    await store.destroy();
  });

  it('synthesisState survives repeated partial updates via updateJob', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore();
    await store.initialize();

    await store.createJob('s2', 'u2');

    await store.updateJob('s2', {
      synthesisState: {
        strategy: 'best_of_three',
        started: false,
        completed: false,
        emittedIndex: 0,
        legStatus: [mkLegStatus()],
        partial: false,
      },
    });

    await store.updateJob('s2', {
      synthesisState: {
        strategy: 'best_of_three',
        started: true,
        completed: false,
        emittedIndex: 10,
        text: 'hello world',
        legStatus: [mkLegStatus()],
        partial: false,
      },
    });

    const data = await store.getJob('s2');
    expect(data?.synthesisState?.started).toBe(true);
    expect(data?.synthesisState?.emittedIndex).toBe(10);
    expect(data?.synthesisState?.text).toBe('hello world');

    await store.destroy();
  });
});

describe('GenerationJobManager.setSynthesisState / getSynthesisState', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('setSynthesisState shallow-merges onto existing state', async () => {
    const mod = await import('../GenerationJobManager');
    const { GenerationJobManagerClass } = mod as unknown as {
      GenerationJobManagerClass: new (arg: Record<string, unknown>) => {
        createJob: (streamId: string, userId: string) => Promise<unknown>;
        setSynthesisState: (
          streamId: string,
          partial: Partial<SynthesisState>,
        ) => Promise<void>;
        getSynthesisState: (streamId: string) => Promise<SynthesisState | undefined>;
      };
    };
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');

    const jobStore = new InMemoryJobStore();
    await jobStore.initialize();
    const eventTransport = new InMemoryEventTransport();

    const manager = new GenerationJobManagerClass({ jobStore, eventTransport });

    const streamId = 'm1';
    await manager.createJob(streamId, 'u');

    await manager.setSynthesisState(streamId, {
      strategy: 'compare_and_synthesize',
      started: false,
      legStatus: [mkLegStatus()],
      partial: false,
    });

    const afterInit = await manager.getSynthesisState(streamId);
    expect(afterInit?.started).toBe(false);
    expect(afterInit?.emittedIndex).toBe(0);

    await manager.setSynthesisState(streamId, { started: true });
    const afterStart = await manager.getSynthesisState(streamId);
    expect(afterStart?.started).toBe(true);
    expect(afterStart?.strategy).toBe('compare_and_synthesize');
    expect(afterStart?.legStatus).toHaveLength(1);

    await manager.setSynthesisState(streamId, { emittedIndex: 42, text: 'progress' });
    const afterDelta = await manager.getSynthesisState(streamId);
    expect(afterDelta?.emittedIndex).toBe(42);
    expect(afterDelta?.text).toBe('progress');
    expect(afterDelta?.started).toBe(true);

    await manager.setSynthesisState(streamId, { completed: true, text: 'final' });
    const afterComplete = await manager.getSynthesisState(streamId);
    expect(afterComplete?.completed).toBe(true);
    expect(afterComplete?.text).toBe('final');
    expect(afterComplete?.emittedIndex).toBe(42);
    expect(afterComplete?.strategy).toBe('compare_and_synthesize');
  });

  it('setSynthesisState on nonexistent job is a safe no-op', async () => {
    const mod = await import('../GenerationJobManager');
    const { GenerationJobManagerClass } = mod as unknown as {
      GenerationJobManagerClass: new (arg: Record<string, unknown>) => {
        setSynthesisState: (
          streamId: string,
          partial: Partial<SynthesisState>,
        ) => Promise<void>;
        getSynthesisState: (streamId: string) => Promise<SynthesisState | undefined>;
      };
    };
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');

    const jobStore = new InMemoryJobStore();
    await jobStore.initialize();
    const eventTransport = new InMemoryEventTransport();

    const manager = new GenerationJobManagerClass({ jobStore, eventTransport });

    await expect(
      manager.setSynthesisState('ghost-stream', { started: true }),
    ).resolves.toBeUndefined();

    const state = await manager.getSynthesisState('ghost-stream');
    expect(state).toBeUndefined();
  });

  it('getSynthesisState returns undefined for non-council jobs', async () => {
    const mod = await import('../GenerationJobManager');
    const { GenerationJobManagerClass } = mod as unknown as {
      GenerationJobManagerClass: new (arg: Record<string, unknown>) => {
        createJob: (streamId: string, userId: string) => Promise<unknown>;
        getSynthesisState: (streamId: string) => Promise<SynthesisState | undefined>;
      };
    };
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');

    const jobStore = new InMemoryJobStore();
    await jobStore.initialize();
    const eventTransport = new InMemoryEventTransport();

    const manager = new GenerationJobManagerClass({ jobStore, eventTransport });

    await manager.createJob('plain', 'u');
    const state = await manager.getSynthesisState('plain');
    expect(state).toBeUndefined();
  });
});
