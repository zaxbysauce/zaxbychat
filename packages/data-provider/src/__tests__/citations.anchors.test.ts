/**
 * Phase 5 PR 5.1 — inline anchor parser tests.
 *
 * Verifies §D-P5-2 honest middle-ground: parse only `[n]` markers the
 * model actually emitted; never invent anchors; out-of-range markers are
 * dropped silently and reported via `unknownMarkers` so logs/UX surfaces
 * can flag prompt-side issues.
 */
import { parseInlineAnchors, citedSourceIds } from '../citations/anchors';
import type { CitationSource } from '../types/sources';

function source(id: string): CitationSource {
  return {
    id,
    kind: 'web',
    title: id,
    provider: 'p',
    kindSpecific: { kind: 'web', domain: 'example.com', fetchedAt: '2026-04-24T00:00:00Z' },
  };
}

describe('parseInlineAnchors — happy path', () => {
  it('returns one InlineAnchor per [n] marker matching a source', () => {
    const text = 'Foo [1] and bar [2].';
    const sources = [source('a'), source('b')];
    const { anchors, unknownMarkers } = parseInlineAnchors(text, sources);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].sourceId).toBe('a');
    expect(anchors[0].range).toEqual([4, 7]);
    expect(anchors[1].sourceId).toBe('b');
    expect(anchors[1].range).toEqual([16, 19]);
    expect(unknownMarkers).toEqual([]);
  });

  it('records each occurrence even when the same marker repeats', () => {
    const text = '[1] and again [1].';
    const sources = [source('a')];
    const { anchors } = parseInlineAnchors(text, sources);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].sourceId).toBe('a');
    expect(anchors[1].sourceId).toBe('a');
    expect(anchors[0].range).toEqual([0, 3]);
    expect(anchors[1].range).toEqual([14, 17]);
  });

  it('handles multi-digit marker indices', () => {
    const text = 'Per [10] and [11].';
    const sources = Array.from({ length: 12 }, (_, i) => source(`s${i}`));
    const { anchors } = parseInlineAnchors(text, sources);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].sourceId).toBe('s9');
    expect(anchors[1].sourceId).toBe('s10');
  });

  it('returns ranges that point at the literal "[n]" substring (renderer can swap in place)', () => {
    const text = 'Lead-in [1] tail.';
    const sources = [source('a')];
    const { anchors } = parseInlineAnchors(text, sources);
    expect(text.slice(anchors[0].range![0], anchors[0].range![1])).toBe('[1]');
  });
});

describe('parseInlineAnchors — empty cases', () => {
  it('returns empty arrays when text empty', () => {
    expect(parseInlineAnchors('', [source('a')])).toEqual({ anchors: [], unknownMarkers: [] });
  });

  it('returns empty arrays when no sources', () => {
    expect(parseInlineAnchors('[1]', [])).toEqual({ anchors: [], unknownMarkers: [] });
  });

  it('returns empty when text has no markers (no fabrication)', () => {
    const out = parseInlineAnchors('plain text without citations', [source('a')]);
    expect(out.anchors).toHaveLength(0);
    expect(out.unknownMarkers).toHaveLength(0);
  });
});

describe('parseInlineAnchors — out-of-range markers', () => {
  it('drops markers that point past the sources array and reports them once', () => {
    const text = 'Real [1] and fake [5] and again [5].';
    const sources = [source('a')];
    const { anchors, unknownMarkers } = parseInlineAnchors(text, sources);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].sourceId).toBe('a');
    expect(unknownMarkers).toEqual([5]);
  });

  it('drops zero-indexed marker (we are 1-indexed)', () => {
    const text = '[0] real [1].';
    const sources = [source('a')];
    const { anchors, unknownMarkers } = parseInlineAnchors(text, sources);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].sourceId).toBe('a');
    expect(unknownMarkers).toEqual([0]);
  });

  it('does not anchor non-numeric brackets', () => {
    const text = '[foo] and [bar] not citations.';
    const sources = [source('a')];
    const { anchors, unknownMarkers } = parseInlineAnchors(text, sources);
    expect(anchors).toEqual([]);
    expect(unknownMarkers).toEqual([]);
  });
});

describe('citedSourceIds', () => {
  it('returns the unique set of cited source ids', () => {
    const ids = citedSourceIds([
      { sourceId: 'a' },
      { sourceId: 'b' },
      { sourceId: 'a', range: [0, 3] },
    ]);
    expect(ids.size).toBe(2);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
  });

  it('returns an empty set for empty anchors', () => {
    expect(citedSourceIds([]).size).toBe(0);
  });
});
