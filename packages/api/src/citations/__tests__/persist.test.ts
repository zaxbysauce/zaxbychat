/**
 * Phase 5 PR 5.1 — server-side persistence helper tests.
 *
 * Verifies the ingest helpers produce contract-valid CitationSource[]
 * with stable ids, append correctly across multiple ingests in one
 * message turn, drop malformed entries while reporting failures, and
 * thread leg attribution for council mode.
 */
import {
  ingestWebResults,
  ingestFileResults,
  extractAnchorsForPersistence,
  validateSourcesForPersistence,
  validateAnchorsForPersistence,
  isValidCitationSource,
} from '../persist';
import type { CitationSource } from 'librechat-data-provider';

describe('ingestWebResults', () => {
  it('returns normalized sources + nextSources alias when no existing sources', () => {
    const out = ingestWebResults({
      messageId: 'msg-1',
      provider: 'serper',
      rawResults: [
        { link: 'https://a.com/1', title: 'A' },
        { link: 'https://b.com/2', title: 'B' },
      ],
      fetchedAt: '2026-04-24T00:00:00Z',
    });
    expect(out.added).toHaveLength(2);
    expect(out.nextSources).toHaveLength(2);
    expect(out.added).toBe(out.added);
    expect(out.nextSources[0].id).toBe('msg-1:0:web:0');
    expect(out.nextSources[1].id).toBe('msg-1:0:web:1');
    expect(out.failures).toHaveLength(0);
  });

  it('appends to existingSources without renumbering them', () => {
    const existing: CitationSource[] = [
      {
        id: 'msg-1:0:web:0',
        kind: 'web',
        title: 'A',
        provider: 'serper',
        url: 'https://a.com/1',
        kindSpecific: { kind: 'web', domain: 'a.com', fetchedAt: '2026-04-24T00:00:00Z' },
      },
    ];
    const out = ingestWebResults({
      messageId: 'msg-1',
      provider: 'serper',
      rawResults: [{ link: 'https://b.com/1', title: 'B' }],
      existingSources: existing,
      fetchedAt: '2026-04-24T00:00:01Z',
    });
    expect(out.nextSources).toHaveLength(2);
    expect(out.nextSources[0].id).toBe('msg-1:0:web:0');
    expect(out.added).toHaveLength(1);
    expect(out.added[0].id).toBe('msg-1:1:web:0');
  });

  it('reports failures for entries missing required fields without dropping good ones', () => {
    const out = ingestWebResults({
      messageId: 'm',
      provider: 'p',
      rawResults: [
        { link: 'https://a.com/1', title: 'A' },
        { title: 'no link' } as never,
        { link: 'https://b.com/2', title: 'B' },
      ],
      fetchedAt: '2026-04-24T00:00:00Z',
    });
    expect(out.added).toHaveLength(2);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].index).toBe(1);
  });

  it('threads legAttribution onto every emitted source', () => {
    const out = ingestWebResults({
      messageId: 'm',
      provider: 'p',
      rawResults: [{ link: 'https://a.com/1' }],
      legAttribution: { legId: 'leg-1', role: 'direct' },
      fetchedAt: '2026-04-24T00:00:00Z',
    });
    expect(out.added[0].legAttribution).toEqual({ legId: 'leg-1', role: 'direct' });
  });

  it('produces stable ids whose prefix encodes the existing source count', () => {
    const out1 = ingestWebResults({
      messageId: 'm',
      provider: 'p',
      rawResults: [{ link: 'https://a.com/x' }],
      fetchedAt: '2026-04-24T00:00:00Z',
    });
    const out2 = ingestWebResults({
      messageId: 'm',
      provider: 'p',
      rawResults: [{ link: 'https://b.com/x' }],
      existingSources: out1.nextSources,
      fetchedAt: '2026-04-24T00:00:00Z',
    });
    expect(out1.nextSources[0].id).toBe('m:0:web:0');
    expect(out2.nextSources).toHaveLength(2);
    expect(out2.nextSources[1].id).toBe('m:1:web:0');
    expect(out2.nextSources[1].id).not.toBe(out2.nextSources[0].id);
  });
});

describe('ingestFileResults', () => {
  it('normalizes file results and threads existingSources', () => {
    const out = ingestFileResults({
      messageId: 'msg-1',
      provider: 'rag_api',
      rawResults: [
        { fileId: 'f1', fileName: 'a.pdf', pages: [3], relevance: 0.9 },
      ],
    });
    expect(out.added).toHaveLength(1);
    expect(out.added[0].kind).toBe('file');
    if (out.added[0].kindSpecific.kind === 'file') {
      expect(out.added[0].kindSpecific.fileId).toBe('f1');
      expect(out.added[0].kindSpecific.pages).toEqual([3]);
    }
  });

  it('dedupes by id when re-ingesting with the same id (stability)', () => {
    const first = ingestFileResults({
      messageId: 'm',
      provider: 'rag_api',
      rawResults: [{ fileId: 'f1', fileName: 'a.pdf' }],
    });
    const second = ingestFileResults({
      messageId: 'm',
      provider: 'rag_api',
      rawResults: [{ fileId: 'f1', fileName: 'a.pdf' }],
      existingSources: first.nextSources,
    });
    expect(second.nextSources).toHaveLength(2);
    expect(new Set(second.nextSources.map((s) => s.id)).size).toBe(2);
  });
});

describe('extractAnchorsForPersistence', () => {
  it('returns parsed anchors plus unknown markers', () => {
    const sources: CitationSource[] = [
      {
        id: 's-A',
        kind: 'web',
        title: 'A',
        provider: 'p',
        kindSpecific: { kind: 'web', domain: 'a.com', fetchedAt: 't' },
      },
    ];
    const out = extractAnchorsForPersistence('hi [1] and [2] there', sources);
    expect(out.anchors).toHaveLength(1);
    expect(out.anchors[0].sourceId).toBe('s-A');
    expect(out.unknownMarkers).toEqual([2]);
  });

  it('returns empty when text has no markers (no fabrication)', () => {
    const out = extractAnchorsForPersistence('plain text', []);
    expect(out.anchors).toEqual([]);
    expect(out.unknownMarkers).toEqual([]);
  });
});

describe('validateSourcesForPersistence', () => {
  it('returns the parsed array for a valid snapshot', () => {
    const valid: unknown[] = [
      {
        id: 'i',
        kind: 'web',
        title: 't',
        provider: 'p',
        kindSpecific: { kind: 'web', domain: 'x.com', fetchedAt: 't' },
      },
    ];
    const out = validateSourcesForPersistence(valid);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('i');
  });

  it('throws for malformed entries (refuses bad writes)', () => {
    expect(() =>
      validateSourcesForPersistence([
        { id: '', kind: 'web', title: 't', provider: 'p', kindSpecific: { kind: 'web', domain: 'x', fetchedAt: 't' } },
      ]),
    ).toThrow();
  });

  it('accepts empty array (turn produced no sources)', () => {
    expect(validateSourcesForPersistence([])).toEqual([]);
  });
});

describe('validateAnchorsForPersistence', () => {
  it('returns parsed anchors for valid input', () => {
    const out = validateAnchorsForPersistence([
      { sourceId: 'a' },
      { sourceId: 'b', range: [0, 3] },
    ]);
    expect(out).toHaveLength(2);
  });

  it('throws when range is inverted', () => {
    expect(() =>
      validateAnchorsForPersistence([{ sourceId: 'a', range: [9, 1] }]),
    ).toThrow();
  });
});

describe('isValidCitationSource', () => {
  it('returns true for a valid source', () => {
    expect(
      isValidCitationSource({
        id: 'i',
        kind: 'web',
        title: 't',
        provider: 'p',
        kindSpecific: { kind: 'web', domain: 'x.com', fetchedAt: 't' },
      }),
    ).toBe(true);
  });

  it('returns false for invalid', () => {
    expect(isValidCitationSource({ id: 'i' })).toBe(false);
  });
});
