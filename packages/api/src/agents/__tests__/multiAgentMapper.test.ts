import { createMultiAgentMapper } from '../mapper';
import type { Agent } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

function agent(id: string, name?: string): Agent {
  return { id, name } as unknown as Agent;
}

type ContentPart = { type: string; text: string; agentId?: string; groupId?: number };

function message(content: ContentPart[]): TMessage {
  return {
    messageId: 'm1',
    isCreatedByUser: false,
    content,
  } as unknown as TMessage;
}

function userMessage(text: string): TMessage {
  return {
    messageId: 'u1',
    isCreatedByUser: true,
    content: [{ type: 'text', text }],
  } as unknown as TMessage;
}

describe('createMultiAgentMapper — default (addedConvo behavior preserved)', () => {
  const primary = agent('primary____0', 'Primary');
  const extraA = agent('anthropic__claude-opus_______1', 'Claude');
  const configs = new Map<string, Agent>([[extraA.id, extraA]]);

  it('returns user messages unchanged', () => {
    const mapper = createMultiAgentMapper(primary, configs);
    const m = userMessage('hi');
    expect(mapper(m)).toBe(m);
  });

  it('passes messages with no agent metadata through', () => {
    const mapper = createMultiAgentMapper(primary, configs);
    const m = message([{ type: 'text', text: 'plain' }]);
    expect(mapper(m).content).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('filters parallel parts to primary agent only (default behavior)', () => {
    const mapper = createMultiAgentMapper(primary, configs);
    const m = message([
      { type: 'text', text: 'primary answer', agentId: primary.id, groupId: 1 },
      { type: 'text', text: 'extra answer', agentId: extraA.id, groupId: 1 },
    ]);
    const result = mapper(m);
    const contents = result.content as unknown as ContentPart[];
    expect(contents).toHaveLength(1);
    expect(contents[0].text).toBe('primary answer');
    expect(contents[0].agentId).toBeUndefined();
    expect(contents[0].groupId).toBeUndefined();
  });

  it('keeps handoff parts (agentId without groupId) from all agents', () => {
    const mapper = createMultiAgentMapper(primary, configs);
    const m = message([
      { type: 'text', text: 'handoff A', agentId: primary.id },
      { type: 'text', text: 'handoff B', agentId: extraA.id },
    ]);
    const result = mapper(m);
    const contents = result.content as unknown as ContentPart[];
    expect(contents).toHaveLength(2);
  });
});

describe('createMultiAgentMapper — retainAllLegs: true (Phase 4 council)', () => {
  const primary = agent('primary____0', 'Primary');
  const extraA = agent('anthropic__claude-opus___________1', 'Claude');
  const extraB = agent('google__gemini___________2', 'Gemini');
  const configs = new Map<string, Agent>([
    [extraA.id, extraA],
    [extraB.id, extraB],
  ]);

  it('retains every leg part in a parallel group', () => {
    const mapper = createMultiAgentMapper(primary, configs, { retainAllLegs: true });
    const m = message([
      { type: 'text', text: 'primary answer', agentId: primary.id, groupId: 1 },
      { type: 'text', text: 'A answer', agentId: extraA.id, groupId: 1 },
      { type: 'text', text: 'B answer', agentId: extraB.id, groupId: 1 },
    ]);
    const result = mapper(m);
    const contents = result.content as unknown as ContentPart[];
    expect(contents).toHaveLength(3);
    const texts = contents.map((c) => c.text).sort();
    expect(texts).toEqual(['A answer', 'B answer', 'primary answer']);
  });

  it('still strips agentId/groupId from emitted parts', () => {
    const mapper = createMultiAgentMapper(primary, configs, { retainAllLegs: true });
    const m = message([
      { type: 'text', text: 'primary', agentId: primary.id, groupId: 1 },
      { type: 'text', text: 'A', agentId: extraA.id, groupId: 1 },
    ]);
    const result = mapper(m);
    const contents = result.content as unknown as ContentPart[];
    for (const part of contents) {
      expect(part.agentId).toBeUndefined();
      expect(part.groupId).toBeUndefined();
    }
  });

  it('retains handoff parts just like default mode', () => {
    const mapper = createMultiAgentMapper(primary, configs, { retainAllLegs: true });
    const m = message([
      { type: 'text', text: 'handoff', agentId: primary.id },
      { type: 'text', text: 'other handoff', agentId: extraA.id },
    ]);
    expect((mapper(m).content as unknown as ContentPart[])).toHaveLength(2);
  });

  it('retains every leg across multiple distinct groups', () => {
    const mapper = createMultiAgentMapper(primary, configs, { retainAllLegs: true });
    const m = message([
      { type: 'text', text: 'g1 primary', agentId: primary.id, groupId: 1 },
      { type: 'text', text: 'g1 A', agentId: extraA.id, groupId: 1 },
      { type: 'text', text: 'g2 primary', agentId: primary.id, groupId: 2 },
      { type: 'text', text: 'g2 B', agentId: extraB.id, groupId: 2 },
    ]);
    expect((mapper(m).content as unknown as ContentPart[])).toHaveLength(4);
  });

  it('omitting the options arg behaves identically to passing retainAllLegs: false', () => {
    const defaultMapper = createMultiAgentMapper(primary, configs);
    const explicitMapper = createMultiAgentMapper(primary, configs, { retainAllLegs: false });
    const m = () =>
      message([
        { type: 'text', text: 'primary', agentId: primary.id, groupId: 1 },
        { type: 'text', text: 'A', agentId: extraA.id, groupId: 1 },
      ]);
    const a = defaultMapper(m()).content as unknown as ContentPart[];
    const b = explicitMapper(m()).content as unknown as ContentPart[];
    expect(a.length).toBe(b.length);
    expect(a[0].text).toBe(b[0].text);
  });
});

describe('createMultiAgentMapper — no-metadata short circuit', () => {
  const primary = agent('p', 'P');
  it('retainAllLegs=true still short-circuits for no-metadata messages', () => {
    const mapper = createMultiAgentMapper(primary, undefined, { retainAllLegs: true });
    const m = message([{ type: 'text', text: 'plain only' }]);
    expect(mapper(m).content).toEqual([{ type: 'text', text: 'plain only' }]);
  });
});
