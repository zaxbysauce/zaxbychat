/**
 * Three-state synthesis resume protocol tests (Phase 4 §Resume protocol).
 * Pure-function tests; GenerationJobManager wiring is a separate integration.
 */
import { buildSynthesisResumeReplay, initialSynthesisState } from '../resume';
import type { SynthesisState } from '../../../stream/interfaces/IJobStore';

function state(overrides: Partial<SynthesisState> = {}): SynthesisState {
  return {
    strategy: 'compare_and_synthesize',
    started: false,
    completed: false,
    emittedIndex: 0,
    legStatus: [],
    partial: false,
    ...overrides,
  };
}

const okLegs = [
  { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o', status: 'succeeded' as const },
  { legId: 'leg-1', agentId: 'extra____1', model: 'claude-opus-4-7', status: 'succeeded' as const },
];

const partialLegs = [
  { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o', status: 'succeeded' as const },
  {
    legId: 'leg-1',
    agentId: 'extra____1',
    model: 'claude-opus-4-7',
    status: 'failed' as const,
    error: 'timeout',
  },
];

const allFailed = [
  { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o', status: 'failed' as const, error: '500' },
  {
    legId: 'leg-1',
    agentId: 'extra____1',
    model: 'claude-opus-4-7',
    status: 'failed' as const,
    error: 'auth',
  },
];

describe('buildSynthesisResumeReplay — no state', () => {
  it('returns no_state when state absent', () => {
    const r = buildSynthesisResumeReplay({ state: undefined });
    expect(r.phase).toBe('no_state');
    expect(r.events).toEqual([]);
  });
});

describe('buildSynthesisResumeReplay — pre-synthesis', () => {
  it('phase=pre_synthesis with no events when synthesis has not started', () => {
    const r = buildSynthesisResumeReplay({ state: state({ started: false, legStatus: okLegs }) });
    expect(r.phase).toBe('pre_synthesis');
    expect(r.events).toEqual([]);
  });
});

describe('buildSynthesisResumeReplay — mid-synthesis', () => {
  it('emits synthesis_start + delta for a resumer with 0 chars', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: false,
        emittedIndex: 12,
        text: 'Hello world!',
        legStatus: okLegs,
      }),
      clientAlreadyHas: 0,
    });
    expect(r.phase).toBe('mid_synthesis');
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ kind: 'synthesis_start', strategy: 'compare_and_synthesize' });
    expect(r.events[1]).toEqual({ kind: 'synthesis_delta', text: 'Hello world!' });
  });

  it('skips synthesis_start when resumer already has some chars', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: false,
        emittedIndex: 12,
        text: 'Hello world!',
        legStatus: okLegs,
      }),
      clientAlreadyHas: 6,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual({ kind: 'synthesis_delta', text: 'world!' });
  });

  it('emits only synthesis_start when no delta has been emitted yet', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: false,
        emittedIndex: 0,
        text: '',
        legStatus: okLegs,
      }),
      clientAlreadyHas: 0,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe('synthesis_start');
  });

  it('propagates partial=true when any leg failed', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: false,
        emittedIndex: 3,
        text: 'abc',
        legStatus: partialLegs,
        partial: true,
      }),
      clientAlreadyHas: 0,
    });
    const start = r.events.find((e) => e.kind === 'synthesis_start') as {
      kind: 'synthesis_start';
      partial: boolean;
    };
    expect(start.partial).toBe(true);
  });
});

describe('buildSynthesisResumeReplay — post-synthesis', () => {
  it('emits start + full-text delta + complete for a fresh resumer', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: true,
        emittedIndex: 12,
        text: 'Hello world!',
        legStatus: okLegs,
      }),
      clientAlreadyHas: 0,
    });
    expect(r.phase).toBe('post_synthesis');
    expect(r.events).toHaveLength(3);
    expect(r.events[0].kind).toBe('synthesis_start');
    expect(r.events[1]).toEqual({ kind: 'synthesis_delta', text: 'Hello world!' });
    expect(r.events[2]).toMatchObject({
      kind: 'synthesis_complete',
      text: 'Hello world!',
      partial: false,
    });
  });

  it('emits only remaining delta when resumer has partial text + complete', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: true,
        emittedIndex: 12,
        text: 'Hello world!',
        legStatus: okLegs,
      }),
      clientAlreadyHas: 6,
    });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toEqual({ kind: 'synthesis_delta', text: 'world!' });
    expect(r.events[1].kind).toBe('synthesis_complete');
  });

  it('synthesis_complete carries partial=true and legStatus for partial runs', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: true,
        emittedIndex: 5,
        text: 'final',
        legStatus: partialLegs,
        partial: true,
      }),
      clientAlreadyHas: 0,
    });
    const complete = r.events.find((e) => e.kind === 'synthesis_complete') as {
      kind: 'synthesis_complete';
      partial: boolean;
      legStatus: typeof partialLegs;
    };
    expect(complete.partial).toBe(true);
    expect(complete.legStatus).toEqual(partialLegs);
  });
});

describe('buildSynthesisResumeReplay — all-failed branch (D5)', () => {
  it('emits synthesis_skipped_all_failed when all legs failed and synthesis did not run', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: true,
        emittedIndex: 0,
        text: undefined,
        legStatus: allFailed,
        partial: false,
      }),
    });
    expect(r.phase).toBe('post_synthesis');
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual({
      kind: 'synthesis_skipped_all_failed',
      legStatus: allFailed,
    });
  });

  it('does NOT emit skipped_all_failed when at least one leg succeeded', () => {
    const r = buildSynthesisResumeReplay({
      state: state({
        started: true,
        completed: true,
        emittedIndex: 5,
        text: 'short',
        legStatus: partialLegs,
        partial: true,
      }),
    });
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).not.toContain('synthesis_skipped_all_failed');
    expect(kinds).toContain('synthesis_complete');
  });
});

describe('initialSynthesisState', () => {
  it('creates a fresh state with started=false, completed=false', () => {
    const s = initialSynthesisState('compare_and_synthesize', okLegs);
    expect(s.started).toBe(false);
    expect(s.completed).toBe(false);
    expect(s.emittedIndex).toBe(0);
    expect(s.strategy).toBe('compare_and_synthesize');
    expect(s.legStatus).toEqual(okLegs);
  });

  it('computes partial=true when one leg failed and one succeeded', () => {
    const s = initialSynthesisState('compare_and_synthesize', partialLegs);
    expect(s.partial).toBe(true);
  });

  it('computes partial=false when all legs succeeded', () => {
    const s = initialSynthesisState('compare_and_synthesize', okLegs);
    expect(s.partial).toBe(false);
  });

  it('computes partial=false when all legs failed (no succeeded to synthesize with)', () => {
    const s = initialSynthesisState('compare_and_synthesize', allFailed);
    expect(s.partial).toBe(false);
  });
});
