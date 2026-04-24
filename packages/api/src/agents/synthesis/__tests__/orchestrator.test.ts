import {
  extractLegOutputs,
  shouldRunSynthesis,
  prepareSynthesisPhase,
  emitSynthesisStart,
  emitSynthesisDelta,
  emitSynthesisComplete,
  emitSynthesisSkippedAllFailed,
  replaySynthesisEvents,
  SYNTHESIS_AGENT_ID,
} from '../orchestrator';
import type { Response } from 'express';
import type { LegSummary } from '../templates';

function mockRes() {
  const writes: string[] = [];
  const res = {
    writableEnded: false,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  } as unknown as Response;
  return { res, writes };
}

const LEG_IDS = [
  { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o' },
  { legId: 'leg-1', agentId: 'ephemeral____1', model: 'claude-opus-4-7' },
  { legId: 'leg-2', agentId: 'ephemeral____2', model: 'gemini-2.5-pro' },
];

describe('extractLegOutputs', () => {
  it('classifies each leg as succeeded when it produced text', () => {
    const legs = extractLegOutputs({
      contentParts: [
        { type: 'text', text: 'primary says hi', agentId: 'primary____0', groupId: 1 },
        { type: 'text', text: 'claude says hi', agentId: 'ephemeral____1', groupId: 1 },
        { type: 'text', text: 'gemini says hi', agentId: 'ephemeral____2', groupId: 1 },
      ] as never,
      legIdentities: LEG_IDS,
    });
    expect(legs).toHaveLength(3);
    expect(legs.every((l) => l.status === 'succeeded')).toBe(true);
    expect(legs[0].text).toBe('primary says hi');
    expect(legs[2].text).toBe('gemini says hi');
  });

  it('concatenates multiple text parts from the same leg', () => {
    const legs = extractLegOutputs({
      contentParts: [
        { type: 'text', text: 'hello ', agentId: 'primary____0', groupId: 1 },
        { type: 'text', text: 'world', agentId: 'primary____0', groupId: 1 },
      ] as never,
      legIdentities: [LEG_IDS[0]],
    });
    expect(legs[0].text).toBe('hello world');
    expect(legs[0].status).toBe('succeeded');
  });

  it('classifies legs with no text as failed', () => {
    const legs = extractLegOutputs({
      contentParts: [
        { type: 'text', text: 'only primary responded', agentId: 'primary____0', groupId: 1 },
      ] as never,
      legIdentities: LEG_IDS,
    });
    expect(legs[0].status).toBe('succeeded');
    expect(legs[1].status).toBe('failed');
    expect(legs[2].status).toBe('failed');
  });

  it('ignores non-text parts and parts without agentId', () => {
    const legs = extractLegOutputs({
      contentParts: [
        { type: 'text', text: 'ok', agentId: 'primary____0', groupId: 1 },
        { type: 'tool_call', text: 'tool stuff', agentId: 'primary____0', groupId: 1 },
        { type: 'text', text: 'orphan', groupId: 1 },
      ] as never,
      legIdentities: [LEG_IDS[0]],
    });
    expect(legs[0].text).toBe('ok');
  });

  it('returns all-failed when contentParts is empty', () => {
    const legs = extractLegOutputs({ contentParts: [], legIdentities: LEG_IDS });
    expect(legs.every((l) => l.status === 'failed')).toBe(true);
  });
});

describe('shouldRunSynthesis', () => {
  const mkLeg = (status: 'succeeded' | 'failed'): LegSummary => ({
    legId: 'x',
    agentId: 'a',
    model: 'm',
    status,
  });

  it('run=true when ≥2 legs and ≥1 succeeded', () => {
    expect(shouldRunSynthesis([mkLeg('succeeded'), mkLeg('succeeded')])).toEqual({
      run: true,
      reason: 'ok',
    });
    expect(shouldRunSynthesis([mkLeg('succeeded'), mkLeg('failed')])).toEqual({
      run: true,
      reason: 'ok',
    });
    expect(shouldRunSynthesis([mkLeg('failed'), mkLeg('succeeded'), mkLeg('failed')])).toEqual({
      run: true,
      reason: 'ok',
    });
  });

  it('run=false with reason=all_legs_failed when every leg failed', () => {
    expect(shouldRunSynthesis([mkLeg('failed'), mkLeg('failed')])).toEqual({
      run: false,
      reason: 'all_legs_failed',
    });
  });

  it('run=false with reason=single_leg_no_extras when only one leg attempted', () => {
    expect(shouldRunSynthesis([mkLeg('succeeded')])).toEqual({
      run: false,
      reason: 'single_leg_no_extras',
    });
  });

  it('run=false with reason=no_legs when array empty', () => {
    expect(shouldRunSynthesis([])).toEqual({ run: false, reason: 'no_legs' });
  });
});

describe('prepareSynthesisPhase', () => {
  it('bundles initial SynthesisState + built prompt with aligned legStatus', () => {
    const legs: LegSummary[] = [
      { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o', status: 'succeeded', text: 'A' },
      {
        legId: 'leg-1',
        agentId: 'ephemeral____1',
        model: 'claude-opus-4-7',
        status: 'failed',
        error: 'timeout',
      },
    ];
    const { state, prompt } = prepareSynthesisPhase({
      userQuestion: 'Q?',
      strategy: 'compare_and_synthesize',
      legs,
    });
    expect(state.strategy).toBe('compare_and_synthesize');
    expect(state.started).toBe(false);
    expect(state.partial).toBe(true);
    expect(state.legStatus).toHaveLength(2);
    expect(state.legStatus[1].error).toBe('timeout');
    expect(prompt.strategy).toBe('compare_and_synthesize');
    expect(prompt.partial).toBe(true);
  });

  it('state.partial is false when all legs succeeded', () => {
    const legs: LegSummary[] = [
      { legId: 'leg-0', agentId: 'primary____0', model: 'gpt-4o', status: 'succeeded', text: 'A' },
      { legId: 'leg-1', agentId: 'ephemeral____1', model: 'claude', status: 'succeeded', text: 'B' },
    ];
    const { state } = prepareSynthesisPhase({
      userQuestion: 'Q?',
      strategy: 'best_of_three',
      legs,
    });
    expect(state.partial).toBe(false);
  });
});

describe('SSE emitters', () => {
  const legStatus = [
    {
      legId: 'leg-0',
      agentId: 'primary____0',
      model: 'gpt-4o',
      status: 'succeeded' as const,
    },
  ];

  it('emitSynthesisStart writes an event: synthesis_start frame with SYNTHESIS_AGENT_ID', () => {
    const { res, writes } = mockRes();
    emitSynthesisStart(res, { strategy: 'compare_and_synthesize', legStatus, partial: false });
    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith('event: synthesis_start\n')).toBe(true);
    const dataLine = writes[0].split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(dataLine.replace('data: ', ''));
    expect(payload.agentId).toBe(SYNTHESIS_AGENT_ID);
    expect(payload.strategy).toBe('compare_and_synthesize');
    expect(payload.partial).toBe(false);
  });

  it('emitSynthesisDelta carries agentId and text', () => {
    const { res, writes } = mockRes();
    emitSynthesisDelta(res, 'chunk');
    const payload = JSON.parse(
      writes[0].split('\n').find((l) => l.startsWith('data: '))!.replace('data: ', ''),
    );
    expect(payload).toEqual({ agentId: SYNTHESIS_AGENT_ID, text: 'chunk' });
  });

  it('emitSynthesisComplete carries text, partial, legStatus', () => {
    const { res, writes } = mockRes();
    emitSynthesisComplete(res, { text: 'final', partial: true, legStatus });
    const payload = JSON.parse(
      writes[0].split('\n').find((l) => l.startsWith('data: '))!.replace('data: ', ''),
    );
    expect(payload.text).toBe('final');
    expect(payload.partial).toBe(true);
    expect(payload.legStatus).toEqual(legStatus);
  });

  it('emitSynthesisSkippedAllFailed carries only legStatus', () => {
    const { res, writes } = mockRes();
    emitSynthesisSkippedAllFailed(res, { legStatus });
    const payload = JSON.parse(
      writes[0].split('\n').find((l) => l.startsWith('data: '))!.replace('data: ', ''),
    );
    expect(payload.agentId).toBe(SYNTHESIS_AGENT_ID);
    expect(payload.legStatus).toEqual(legStatus);
  });

  it('emit helpers skip and return false when res is undefined', () => {
    expect(
      emitSynthesisStart(undefined, { strategy: 'primary_critic', legStatus, partial: false }),
    ).toBe(false);
    expect(emitSynthesisDelta(undefined, 'x')).toBe(false);
    expect(emitSynthesisComplete(undefined, { text: 'x', partial: false, legStatus })).toBe(false);
    expect(emitSynthesisSkippedAllFailed(undefined, { legStatus })).toBe(false);
  });

  it('emit helpers skip when res.writableEnded is true', () => {
    const res = { writableEnded: true, write: jest.fn() } as unknown as Response;
    expect(emitSynthesisDelta(res, 'x')).toBe(false);
    expect((res as unknown as { write: jest.Mock }).write).not.toHaveBeenCalled();
  });
});

describe('replaySynthesisEvents', () => {
  it('emits each event in order and returns the count written', () => {
    const { res, writes } = mockRes();
    const legStatus = [
      { legId: 'a', agentId: 'a', model: 'm', status: 'succeeded' as const },
    ];
    const written = replaySynthesisEvents(res, [
      { kind: 'synthesis_start', strategy: 'compare_and_synthesize', legStatus, partial: false },
      { kind: 'synthesis_delta', text: 'hello' },
      { kind: 'synthesis_complete', text: 'hello world', partial: false, legStatus },
    ]);
    expect(written).toBe(3);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatch(/^event: synthesis_start\n/);
    expect(writes[1]).toMatch(/^event: synthesis_delta\n/);
    expect(writes[2]).toMatch(/^event: synthesis_complete\n/);
  });

  it('handles synthesis_skipped_all_failed events', () => {
    const { res, writes } = mockRes();
    const legStatus = [
      { legId: 'a', agentId: 'a', model: 'm', status: 'failed' as const },
    ];
    const written = replaySynthesisEvents(res, [
      { kind: 'synthesis_skipped_all_failed', legStatus },
    ]);
    expect(written).toBe(1);
    expect(writes[0]).toMatch(/^event: synthesis_skipped_all_failed\n/);
  });

  it('stops early when res stops accepting writes', () => {
    let count = 0;
    const res = {
      writableEnded: false,
      write: jest.fn(() => {
        count += 1;
        if (count === 2) {
          (res as unknown as { writableEnded: boolean }).writableEnded = true;
        }
        return true;
      }),
    } as unknown as Response;
    const legStatus = [
      { legId: 'a', agentId: 'a', model: 'm', status: 'succeeded' as const },
    ];
    const written = replaySynthesisEvents(res, [
      { kind: 'synthesis_start', strategy: 'best_of_three', legStatus, partial: false },
      { kind: 'synthesis_delta', text: 'chunk' },
      { kind: 'synthesis_delta', text: 'chunk2' },
    ]);
    expect(written).toBe(2);
  });
});
