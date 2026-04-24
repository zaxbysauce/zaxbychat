/**
 * GenerationJobManager council-abort helper tests.
 *
 * setCouncilAbortHierarchy, markCouncilLegCompleted, stopCouncilLeg.
 * Runtime-only — never persisted.
 */

jest.spyOn(console, 'log').mockImplementation();

describe('GenerationJobManager council abort helpers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const mod = await import('../GenerationJobManager');
    const { GenerationJobManagerClass } = mod as unknown as {
      GenerationJobManagerClass: new (arg: Record<string, unknown>) => {
        createJob: (streamId: string, userId: string) => Promise<unknown>;
        setCouncilAbortHierarchy: (
          streamId: string,
          h: { legControllers: AbortController[]; synthesisController: AbortController },
        ) => void;
        markCouncilLegCompleted: (streamId: string, legIndex: number) => void;
        stopCouncilLeg: (
          streamId: string,
          legIndex: number,
        ) =>
          | { status: 'signaled' }
          | {
              status: 'no_op';
              reason: 'council_inactive' | 'unknown_leg' | 'already_complete';
            };
        isCouncilLegAborted: (streamId: string, legIndex: number) => boolean;
      };
    };
    const { InMemoryEventTransport } = await import(
      '../implementations/InMemoryEventTransport'
    );
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');

    const jobStore = new InMemoryJobStore();
    await jobStore.initialize();
    const eventTransport = new InMemoryEventTransport();
    const manager = new GenerationJobManagerClass({ jobStore, eventTransport });
    return { manager };
  }

  function makeHierarchy(legs: number) {
    const parent = new AbortController();
    const legControllers: AbortController[] = [];
    const synthesisController = new AbortController();
    for (let i = 0; i < legs; i++) {
      legControllers.push(new AbortController());
    }
    parent.signal.addEventListener('abort', () => {
      legControllers.forEach((c) => {
        if (!c.signal.aborted) c.abort(parent.signal.reason);
      });
      if (!synthesisController.signal.aborted) {
        synthesisController.abort(parent.signal.reason);
      }
    });
    return { parent, legControllers, synthesisController };
  }

  it('stopCouncilLeg returns council_inactive when no hierarchy registered', async () => {
    const { manager } = await setup();
    await manager.createJob('s1', 'u');
    expect(manager.stopCouncilLeg('s1', 0)).toEqual({
      status: 'no_op',
      reason: 'council_inactive',
    });
  });

  it('stopCouncilLeg returns council_inactive for unknown streamId', async () => {
    const { manager } = await setup();
    expect(manager.stopCouncilLeg('ghost', 0)).toEqual({
      status: 'no_op',
      reason: 'council_inactive',
    });
  });

  it('stopCouncilLeg signals the targeted leg and returns signaled', async () => {
    const { manager } = await setup();
    await manager.createJob('s2', 'u');
    const h = makeHierarchy(3);
    manager.setCouncilAbortHierarchy('s2', {
      legControllers: h.legControllers,
      synthesisController: h.synthesisController,
    });

    expect(manager.stopCouncilLeg('s2', 1)).toEqual({ status: 'signaled' });
    expect(h.legControllers[0].signal.aborted).toBe(false);
    expect(h.legControllers[1].signal.aborted).toBe(true);
    expect(h.legControllers[2].signal.aborted).toBe(false);
    expect(h.synthesisController.signal.aborted).toBe(false);
    expect(manager.isCouncilLegAborted('s2', 1)).toBe(true);
  });

  it('stopCouncilLeg on an out-of-range index returns unknown_leg', async () => {
    const { manager } = await setup();
    await manager.createJob('s3', 'u');
    const h = makeHierarchy(2);
    manager.setCouncilAbortHierarchy('s3', {
      legControllers: h.legControllers,
      synthesisController: h.synthesisController,
    });

    expect(manager.stopCouncilLeg('s3', 5)).toEqual({
      status: 'no_op',
      reason: 'unknown_leg',
    });
    expect(manager.stopCouncilLeg('s3', -1)).toEqual({
      status: 'no_op',
      reason: 'unknown_leg',
    });
  });

  it('stopCouncilLeg returns already_complete when leg was marked completed', async () => {
    const { manager } = await setup();
    await manager.createJob('s4', 'u');
    const h = makeHierarchy(2);
    manager.setCouncilAbortHierarchy('s4', {
      legControllers: h.legControllers,
      synthesisController: h.synthesisController,
    });

    manager.markCouncilLegCompleted('s4', 0);
    expect(manager.stopCouncilLeg('s4', 0)).toEqual({
      status: 'no_op',
      reason: 'already_complete',
    });
    expect(h.legControllers[0].signal.aborted).toBe(false);
  });

  it('stopCouncilLeg returns already_complete when the leg signal is already aborted', async () => {
    const { manager } = await setup();
    await manager.createJob('s5', 'u');
    const h = makeHierarchy(2);
    h.legControllers[1].abort('leg 1 self-terminated');
    manager.setCouncilAbortHierarchy('s5', {
      legControllers: h.legControllers,
      synthesisController: h.synthesisController,
    });
    expect(manager.stopCouncilLeg('s5', 1)).toEqual({
      status: 'no_op',
      reason: 'already_complete',
    });
  });

  it('parent abort cascades to all leg children + synthesis via the addEventListener wiring', async () => {
    const { manager } = await setup();
    await manager.createJob('s6', 'u');
    const h = makeHierarchy(3);
    manager.setCouncilAbortHierarchy('s6', {
      legControllers: h.legControllers,
      synthesisController: h.synthesisController,
    });

    h.parent.abort('stop-all');

    expect(h.legControllers[0].signal.aborted).toBe(true);
    expect(h.legControllers[1].signal.aborted).toBe(true);
    expect(h.legControllers[2].signal.aborted).toBe(true);
    expect(h.synthesisController.signal.aborted).toBe(true);

    expect(manager.stopCouncilLeg('s6', 0)).toEqual({
      status: 'no_op',
      reason: 'already_complete',
    });
  });

  it('setCouncilAbortHierarchy on nonexistent stream is a safe no-op', async () => {
    const { manager } = await setup();
    const h = makeHierarchy(2);
    expect(() =>
      manager.setCouncilAbortHierarchy('ghost', {
        legControllers: h.legControllers,
        synthesisController: h.synthesisController,
      }),
    ).not.toThrow();
    expect(manager.stopCouncilLeg('ghost', 0)).toEqual({
      status: 'no_op',
      reason: 'council_inactive',
    });
  });
});
