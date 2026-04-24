import type { CitationSource, InlineAnchor, LegAttribution } from '../types/sources';

describe('CitationSource', () => {
  it('accepts a web source', () => {
    const source: CitationSource = {
      id: 'src-1',
      kind: 'web',
      title: 'Example Article',
      url: 'https://example.com/article',
      snippet: 'A brief excerpt',
      score: 0.92,
      provider: 'serper',
      kindSpecific: {
        kind: 'web',
        domain: 'example.com',
        fetchedAt: '2026-04-24T00:00:00Z',
      },
    };
    expect(source.kind).toBe('web');
    expect(source.kindSpecific.kind).toBe('web');
  });

  it('accepts a file source', () => {
    const source: CitationSource = {
      id: 'src-2',
      kind: 'file',
      title: 'Q4 Report',
      snippet: 'Revenue grew 12%',
      provider: 'rag_api',
      kindSpecific: {
        kind: 'file',
        fileId: 'file-abc123',
        fileName: 'q4-report.pdf',
        pages: [3, 4],
        fileType: 'pdf',
      },
    };
    expect(source.kind).toBe('file');
    if (source.kindSpecific.kind === 'file') {
      expect(source.kindSpecific.fileId).toBe('file-abc123');
    }
  });

  it('accepts a github source', () => {
    const source: CitationSource = {
      id: 'src-3',
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
    expect(source.kind).toBe('github');
    if (source.kindSpecific.kind === 'github') {
      expect(source.kindSpecific.repo).toBe('owner/repo');
    }
  });

  it('accepts a leg attribution for council mode', () => {
    const attribution: LegAttribution = { legId: 'leg-0', role: 'direct' };
    const source: CitationSource = {
      id: 'src-4',
      kind: 'web',
      title: 'Council Source',
      provider: 'bing',
      legAttribution: attribution,
      kindSpecific: {
        kind: 'web',
        domain: 'bing.com',
        fetchedAt: '2026-04-24T00:00:00Z',
      },
    };
    expect(source.legAttribution?.legId).toBe('leg-0');
    expect(source.legAttribution?.role).toBe('direct');
  });
});

describe('InlineAnchor', () => {
  it('accepts sourceId only', () => {
    const anchor: InlineAnchor = { sourceId: 'src-1' };
    expect(anchor.sourceId).toBe('src-1');
    expect(anchor.range).toBeUndefined();
  });

  it('accepts sourceId with range', () => {
    const anchor: InlineAnchor = { sourceId: 'src-1', range: [10, 45] };
    expect(anchor.range).toEqual([10, 45]);
  });
});
