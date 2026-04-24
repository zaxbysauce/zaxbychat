import { buildTextChunks } from '../citations/render';
import type { CitationSource, InlineAnchor } from '../types/sources';

function webSrc(id: string, title = id): CitationSource {
  return {
    id,
    kind: 'web',
    title,
    provider: 'p',
    kindSpecific: { kind: 'web', domain: 'example.com', fetchedAt: 't' },
  };
}

describe('buildTextChunks — empty cases', () => {
  it('returns [] for empty text', () => {
    expect(buildTextChunks({ text: '', sources: [], anchors: [] })).toEqual([]);
  });

  it('returns a single text chunk when no anchors', () => {
    const chunks = buildTextChunks({ text: 'plain', sources: [webSrc('a')], anchors: [] });
    expect(chunks).toEqual([{ kind: 'text', text: 'plain' }]);
  });

  it('returns a single text chunk when anchors empty even if sources exist', () => {
    const chunks = buildTextChunks({ text: 'plain', sources: [webSrc('a')], anchors: [] });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('text');
  });
});

describe('buildTextChunks — anchored cases', () => {
  it('splits text around a single anchor', () => {
    const text = 'hello [1] world';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('src-A')],
      anchors: [{ sourceId: 'src-A', range: [6, 9] }],
    });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ kind: 'text', text: 'hello ' });
    if (chunks[1].kind === 'anchor') {
      expect(chunks[1].text).toBe('[1]');
      expect(chunks[1].source.id).toBe('src-A');
      expect(chunks[1].anchor.range).toEqual([6, 9]);
    } else {
      throw new Error('expected anchor chunk');
    }
    expect(chunks[2]).toEqual({ kind: 'text', text: ' world' });
  });

  it('handles multiple anchors in order', () => {
    const text = 'A [1] mid [2] end';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('src-A'), webSrc('src-B')],
      anchors: [
        { sourceId: 'src-A', range: [2, 5] },
        { sourceId: 'src-B', range: [10, 13] },
      ],
    });
    const kinds = chunks.map((c) => c.kind);
    expect(kinds).toEqual(['text', 'anchor', 'text', 'anchor', 'text']);
  });

  it('sorts anchors by range start if provided out of order', () => {
    const text = 'A [1] mid [2] end';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('src-A'), webSrc('src-B')],
      anchors: [
        { sourceId: 'src-B', range: [10, 13] },
        { sourceId: 'src-A', range: [2, 5] },
      ],
    });
    const anchorChunks = chunks.filter((c) => c.kind === 'anchor');
    expect(anchorChunks[0].kind === 'anchor' && anchorChunks[0].source.id).toBe('src-A');
    expect(anchorChunks[1].kind === 'anchor' && anchorChunks[1].source.id).toBe('src-B');
  });

  it('skips anchors with missing ranges', () => {
    const text = 'no markers';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('src-A')],
      anchors: [{ sourceId: 'src-A' } as InlineAnchor],
    });
    expect(chunks).toEqual([{ kind: 'text', text }]);
  });

  it('skips anchors whose sourceId is not in sources (honest — never fabricate)', () => {
    const text = 'hi [1]';
    const chunks = buildTextChunks({
      text,
      sources: [],
      anchors: [{ sourceId: 'missing', range: [3, 6] }],
    });
    expect(chunks).toEqual([{ kind: 'text', text }]);
  });

  it('skips anchors with out-of-bounds ranges', () => {
    const text = 'short';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('src-A')],
      anchors: [{ sourceId: 'src-A', range: [10, 20] }],
    });
    expect(chunks).toEqual([{ kind: 'text', text }]);
  });

  it('skips overlapping anchors that start before the previous cursor', () => {
    const text = 'A [1][2] end';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a'), webSrc('b')],
      anchors: [
        { sourceId: 'a', range: [2, 5] },
        { sourceId: 'b', range: [4, 8] },
      ],
    });
    const anchorCount = chunks.filter((c) => c.kind === 'anchor').length;
    expect(anchorCount).toBe(1);
  });

  it('supports anchor ranges that start at text[0]', () => {
    const text = '[1] leading';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a')],
      anchors: [{ sourceId: 'a', range: [0, 3] }],
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].kind).toBe('anchor');
  });

  it('supports anchor ranges that end at text.length', () => {
    const text = 'trailing [1]';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a')],
      anchors: [{ sourceId: 'a', range: [9, 12] }],
    });
    expect(chunks[chunks.length - 1].kind).toBe('anchor');
  });
});

describe('buildTextChunks — citation hit rate gate (§D-P5-2)', () => {
  it('valid anchor yields an anchor chunk (marker renders)', () => {
    const text = 'per [1] research';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a')],
      anchors: [{ sourceId: 'a', range: [4, 7] }],
    });
    expect(chunks.some((c) => c.kind === 'anchor')).toBe(true);
  });

  it('out-of-range marker produces NO anchor chunks — drop silently', () => {
    // The parseInlineAnchors server-side pass would have dropped [5] from the
    // persisted inlineAnchors when only 1 source exists; here we emulate the
    // "no anchors persisted" state + verify fallback.
    const text = 'per [5] research';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a')],
      anchors: [],
    });
    expect(chunks.every((c) => c.kind === 'text')).toBe(true);
    expect((chunks[0] as { text: string }).text).toBe(text);
  });

  it('assistant with no markers still preserves sources context (panel remains)', () => {
    const text = 'a thoughtful answer without citations';
    const chunks = buildTextChunks({
      text,
      sources: [webSrc('a'), webSrc('b')],
      anchors: [],
    });
    expect(chunks).toEqual([{ kind: 'text', text }]);
    // Caller still has access to the sources array to render the panel.
  });
});
