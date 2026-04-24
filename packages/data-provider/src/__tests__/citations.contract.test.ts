/**
 * Phase 5 PR 5.1 — contract lock tests.
 *
 * Locks the persisted JSON shape of CitationSource and InlineAnchor so
 * future phases cannot silently drift the structure. Future contract
 * widening (new optional fields, new SourceKind variants) should be
 * accompanied by extending these tests; structural narrowing or
 * field-renames that break this test are intentional contract breaks
 * and require a coordinated migration.
 */
import {
  citationSourceSchema,
  inlineAnchorSchema,
  citationSourcesArraySchema,
  inlineAnchorsArraySchema,
  legAttributionSchema,
  sourceKindSchema,
} from '../types/sources';
import type { CitationSource, InlineAnchor } from '../types/sources';

describe('CitationSource contract lock', () => {
  it('accepts a fully-populated web source', () => {
    const value: CitationSource = {
      id: 'msg1:web:0',
      kind: 'web',
      title: 'Example Article',
      url: 'https://example.com/article',
      snippet: 'A brief excerpt',
      score: 0.92,
      provider: 'serper',
      legAttribution: { legId: 'leg-1', role: 'direct' },
      kindSpecific: {
        kind: 'web',
        domain: 'example.com',
        publishedAt: '2026-04-24T00:00:00Z',
        fetchedAt: '2026-04-24T00:00:01Z',
      },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('accepts a minimal web source (title + provider + kindSpecific.domain + fetchedAt)', () => {
    const value: CitationSource = {
      id: 'msg1:web:0',
      kind: 'web',
      title: 't',
      provider: 'p',
      kindSpecific: { kind: 'web', domain: 'example.com', fetchedAt: '2026-04-24T00:00:01Z' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('accepts file source with pages', () => {
    const value: CitationSource = {
      id: 'msg1:file:0',
      kind: 'file',
      title: 'Report.pdf',
      provider: 'rag_api',
      kindSpecific: {
        kind: 'file',
        fileId: 'file-1',
        fileName: 'Report.pdf',
        pages: [3, 4],
        fileType: 'pdf',
      },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('accepts github source with line range', () => {
    const value: CitationSource = {
      id: 'msg1:github:0',
      kind: 'github',
      title: 'server.ts',
      provider: 'github_mcp',
      kindSpecific: {
        kind: 'github',
        repo: 'owner/repo',
        ref: 'main',
        path: 'src/server.ts',
        lineStart: 42,
        lineEnd: 58,
        itemType: 'file',
      },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('accepts code source', () => {
    const value: CitationSource = {
      id: 'msg1:code:0',
      kind: 'code',
      title: 'snippet',
      provider: 'execute_code',
      kindSpecific: { kind: 'code', language: 'typescript', origin: 'tool_call' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('accepts memory source', () => {
    const value: CitationSource = {
      id: 'msg1:memory:0',
      kind: 'memory',
      title: 'Stored fact',
      provider: 'memory',
      kindSpecific: { kind: 'memory', entryId: 'mem-1', createdAt: '2026-04-24T00:00:00Z' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(true);
  });

  it('rejects mismatched kind vs kindSpecific.kind', () => {
    const value = {
      id: 'm:0',
      kind: 'web' as const,
      title: 't',
      provider: 'p',
      kindSpecific: { kind: 'file', fileId: 'f', fileName: 'a.pdf' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects empty id', () => {
    const value = {
      id: '',
      kind: 'web' as const,
      title: 't',
      provider: 'p',
      kindSpecific: { kind: 'web', domain: 'x', fetchedAt: 't' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects empty provider', () => {
    const value = {
      id: 'i',
      kind: 'web' as const,
      title: 't',
      provider: '',
      kindSpecific: { kind: 'web', domain: 'x', fetchedAt: 't' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects file source missing fileId', () => {
    const value = {
      id: 'i',
      kind: 'file' as const,
      title: 't',
      provider: 'p',
      kindSpecific: { kind: 'file', fileName: 'a.pdf' },
    };
    expect(citationSourceSchema.safeParse(value).success).toBe(false);
  });
});

describe('LegAttribution contract', () => {
  it('accepts each role', () => {
    for (const role of ['direct', 'inherited', 'synthesized'] as const) {
      expect(legAttributionSchema.safeParse({ legId: 'leg-x', role }).success).toBe(true);
    }
  });

  it('rejects unknown role', () => {
    expect(
      legAttributionSchema.safeParse({ legId: 'l', role: 'unknown' }).success,
    ).toBe(false);
  });
});

describe('SourceKind contract', () => {
  it('locks the five kinds', () => {
    for (const k of ['web', 'file', 'github', 'code', 'memory'] as const) {
      expect(sourceKindSchema.safeParse(k).success).toBe(true);
    }
    expect(sourceKindSchema.safeParse('podcast').success).toBe(false);
  });
});

describe('InlineAnchor contract', () => {
  it('accepts sourceId-only anchor', () => {
    const value: InlineAnchor = { sourceId: 'msg1:web:0' };
    expect(inlineAnchorSchema.safeParse(value).success).toBe(true);
  });

  it('accepts sourceId + range tuple', () => {
    const value: InlineAnchor = { sourceId: 'msg1:web:0', range: [10, 13] };
    expect(inlineAnchorSchema.safeParse(value).success).toBe(true);
  });

  it('rejects empty sourceId', () => {
    expect(inlineAnchorSchema.safeParse({ sourceId: '' }).success).toBe(false);
  });

  it('rejects negative range bounds', () => {
    expect(
      inlineAnchorSchema.safeParse({ sourceId: 'i', range: [-1, 5] }).success,
    ).toBe(false);
  });

  it('rejects inverted range', () => {
    expect(
      inlineAnchorSchema.safeParse({ sourceId: 'i', range: [10, 5] }).success,
    ).toBe(false);
  });
});

describe('Array schemas', () => {
  it('citationSourcesArraySchema accepts empty + populated', () => {
    expect(citationSourcesArraySchema.safeParse([]).success).toBe(true);
    expect(
      citationSourcesArraySchema.safeParse([
        {
          id: 'i',
          kind: 'web',
          title: 't',
          provider: 'p',
          kindSpecific: { kind: 'web', domain: 'x', fetchedAt: 't' },
        },
      ]).success,
    ).toBe(true);
  });

  it('inlineAnchorsArraySchema accepts empty + populated', () => {
    expect(inlineAnchorsArraySchema.safeParse([]).success).toBe(true);
    expect(
      inlineAnchorsArraySchema.safeParse([{ sourceId: 'a' }, { sourceId: 'b', range: [0, 3] }])
        .success,
    ).toBe(true);
  });
});
