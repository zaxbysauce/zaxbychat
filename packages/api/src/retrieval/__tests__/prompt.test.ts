/**
 * Phase 6 port test — prompt.ts.
 *
 * Targets donor prompt_builder.py (SHA
 * 1095cb7c5f54f7b3a8832d37cc3ebb0da32472c5):
 *   - `calculate_primary_count` formula (lines 22-41).
 *   - `format_chunk` labeling + headers (lines 149-211).
 *   - Parent-window rendering with `[[MATCH: ...]]` markers.
 *   - `build_messages` shape: system + history tail + structured user
 *     content (lines 68-147).
 *   - Anchor-best-chunk tail repetition gated by token budget.
 */
import {
  PromptBuilder,
  calculatePrimaryCount,
  DEFAULT_SYSTEM_PROMPT,
  CITATION_INSTRUCTION,
} from '../prompt';
import type { RagSource } from '../types';

const chunk = (over: Partial<RagSource> = {}): RagSource => ({
  text: 'body text',
  fileId: 'f1',
  score: 0.12,
  metadata: { source_file: 'doc.pdf', chunk_index: 0 },
  ...over,
});

describe('calculatePrimaryCount', () => {
  it('matches donor formula for small n', () => {
    expect(calculatePrimaryCount(0, 0)).toBe(0);
    expect(calculatePrimaryCount(1, 0)).toBe(1);
    expect(calculatePrimaryCount(2, 0)).toBe(2);
    expect(calculatePrimaryCount(3, 0)).toBe(3);
    expect(calculatePrimaryCount(4, 0)).toBe(3);
    expect(calculatePrimaryCount(5, 0)).toBe(3);
    expect(calculatePrimaryCount(6, 0)).toBe(4);
    expect(calculatePrimaryCount(7, 0)).toBe(5);
    expect(calculatePrimaryCount(100, 0)).toBe(5);
  });

  it('override wins when > 0 (capped by total)', () => {
    expect(calculatePrimaryCount(10, 4)).toBe(4);
    expect(calculatePrimaryCount(3, 10)).toBe(3);
  });
});

describe('PromptBuilder.formatChunk', () => {
  const pb = new PromptBuilder();

  it('uses [S#] stable labels and score/file-id header', () => {
    const out = pb.formatChunk(chunk(), 3);
    expect(out.startsWith('[S3] doc.pdf')).toBe(true);
    expect(out).toContain('score: 0.12');
    expect(out).toContain('id: f1');
    expect(out).toContain('body text');
  });

  it('omits Section when it equals filename', () => {
    const c = chunk({ metadata: { source_file: 'x', section_title: 'x' } });
    const out = pb.formatChunk(c, 1);
    expect(out).not.toContain('Section:');
  });

  it('emits contextual_context snippet (truncated to 200 chars)', () => {
    const c = chunk({ metadata: { source_file: 'x', contextual_context: 'z'.repeat(300) } });
    const out = pb.formatChunk(c, 1);
    expect(out).toContain('context: ' + 'z'.repeat(200));
    expect(out).not.toContain('z'.repeat(201));
  });

  it('renders parent window with [[MATCH: ...]] when enabled', () => {
    const pbParent = new PromptBuilder({ config: { parentRetrievalEnabled: true } });
    const c: RagSource = {
      text: 'middle',
      fileId: 'f',
      score: 0.1,
      metadata: { source_file: 'd', raw_text: 'middle' },
      parentWindowText: 'before middle after',
    };
    const out = pbParent.formatChunk(c, 1);
    expect(out).toContain('[[MATCH: middle]]');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('appends MATCH annotation when match text is not in parent window', () => {
    const pbParent = new PromptBuilder({ config: { parentRetrievalEnabled: true } });
    const c: RagSource = {
      text: 'match',
      fileId: 'f',
      score: 0.1,
      metadata: { source_file: 'd' },
      parentWindowText: 'only parent',
    };
    const out = pbParent.formatChunk(c, 1);
    expect(out).toContain('only parent');
    expect(out).toContain('[[MATCH: match]]');
  });
});

describe('PromptBuilder.buildMessages', () => {
  it('produces [system, ...history_tail, user] shape', () => {
    const pb = new PromptBuilder({ config: { maxHistoryMessages: 2 } });
    const msgs = pb.buildMessages({
      userInput: 'Question?',
      chatHistory: [
        { role: 'user', content: '1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '3' },
      ],
      chunks: [chunk()],
      memories: [],
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(CITATION_INSTRUCTION.trim().split('\n')[0].trim());
    expect(msgs.slice(1, 3).map((m) => m.content)).toEqual(['2', '3']);
    expect(msgs[msgs.length - 1].role).toBe('user');
    expect(msgs[msgs.length - 1].content).toContain('Question: Question?');
    expect(msgs[msgs.length - 1].content).toContain('Primary Evidence:');
  });

  it('groups into Primary + Supporting sections using donor split', () => {
    const pb = new PromptBuilder();
    const six = Array.from({ length: 6 }, (_, i) =>
      chunk({ text: `c${i}`, metadata: { source_file: `${i}.pdf` } }),
    );
    const msgs = pb.buildMessages({
      userInput: 'q',
      chatHistory: [],
      chunks: six,
      memories: [],
    });
    const user = msgs[msgs.length - 1].content;
    expect(user).toContain('Primary Evidence:');
    expect(user).toContain('Supporting Evidence:');
    expect(user.indexOf('Primary Evidence:')).toBeLessThan(user.indexOf('Supporting Evidence:'));
  });

  it('falls back to "No relevant documents" when chunks is empty', () => {
    const pb = new PromptBuilder();
    const msgs = pb.buildMessages({
      userInput: 'q',
      chatHistory: [],
      chunks: [],
      memories: [],
    });
    expect(msgs[msgs.length - 1].content).toContain('No relevant documents found');
  });

  it('anchors best chunk at tail when enabled and under budget', () => {
    const pb = new PromptBuilder({
      config: { anchorBestChunk: true, contextMaxTokens: 10_000 },
    });
    const msgs = pb.buildMessages({
      userInput: 'q',
      chatHistory: [],
      chunks: [chunk()],
      memories: [],
    });
    expect(msgs[msgs.length - 1].content).toContain('[BEST MATCH — repeated for emphasis]');
  });

  it('skips anchor when top chunk exceeds 50% of the context token budget', () => {
    const pb = new PromptBuilder({
      config: { anchorBestChunk: true, contextMaxTokens: 1 },
    });
    const msgs = pb.buildMessages({
      userInput: 'q',
      chatHistory: [],
      chunks: [chunk({ text: 'x'.repeat(1000) })],
      memories: [],
    });
    expect(msgs[msgs.length - 1].content).not.toContain('[BEST MATCH');
  });

  it('includes memory block when memories have non-empty values', () => {
    const pb = new PromptBuilder();
    const msgs = pb.buildMessages({
      userInput: 'q',
      chatHistory: [],
      chunks: [chunk()],
      memories: [{ key: 'k', value: 'remembered' }],
    });
    expect(msgs[msgs.length - 1].content).toContain('Memories:\nremembered');
  });

  it('default system prompt contains citation instruction', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('[S1]');
    expect(DEFAULT_SYSTEM_PROMPT).toContain(CITATION_INSTRUCTION);
  });
});
