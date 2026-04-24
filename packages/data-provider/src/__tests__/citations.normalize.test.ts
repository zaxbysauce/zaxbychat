/**
 * Phase 5 PR 5.1 — citation normalizer tests.
 *
 * Verifies pure-function conversion from raw web/file tool outputs into
 * the binding `CitationSource` shape. No fabrication, honest skips on
 * missing required fields, leg attribution threading.
 */
import {
  toWebCitationSource,
  toFileCitationSource,
  normalizeWebResults,
  normalizeFileResults,
} from '../citations/normalize';

describe('toWebCitationSource', () => {
  it('returns ok with normalized source when link, title, snippet present', () => {
    const result = toWebCitationSource(
      {
        link: 'https://example.com/page?x=1',
        title: 'Example',
        snippet: 'short summary',
        date: '2026-04-01',
      },
      0,
      { idPrefix: 'msg-1', provider: 'serper' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.id).toBe('msg-1:web:0');
      expect(result.source.kind).toBe('web');
      expect(result.source.title).toBe('Example');
      expect(result.source.url).toBe('https://example.com/page?x=1');
      expect(result.source.snippet).toBe('short summary');
      expect(result.source.provider).toBe('serper');
      if (result.source.kindSpecific.kind === 'web') {
        expect(result.source.kindSpecific.domain).toBe('example.com');
        expect(result.source.kindSpecific.publishedAt).toBe('2026-04-01');
        expect(typeof result.source.kindSpecific.fetchedAt).toBe('string');
      }
    }
  });

  it('falls back to link as title when title missing', () => {
    const result = toWebCitationSource(
      { link: 'https://example.com/x' },
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.title).toBe('https://example.com/x');
    }
  });

  it('omits publishedAt when raw.date absent (no fabrication)', () => {
    const result = toWebCitationSource(
      { link: 'https://example.com/x', title: 'X' },
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    if (result.ok && result.source.kindSpecific.kind === 'web') {
      expect(result.source.kindSpecific.publishedAt).toBeUndefined();
    }
  });

  it('returns failure when link is missing', () => {
    const result = toWebCitationSource(
      { title: 'No URL' } as never,
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('missing_required_field');
    }
  });

  it('extracts domain from URL when raw.domain absent', () => {
    const result = toWebCitationSource(
      { link: 'https://sub.foo.org/page', title: 'X' },
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    if (result.ok && result.source.kindSpecific.kind === 'web') {
      expect(result.source.kindSpecific.domain).toBe('sub.foo.org');
    }
  });

  it('uses raw.domain when provided (preserves provider intent)', () => {
    const result = toWebCitationSource(
      { link: 'https://shortener.com/abc', title: 'X', domain: 'real-publisher.com' },
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    if (result.ok && result.source.kindSpecific.kind === 'web') {
      expect(result.source.kindSpecific.domain).toBe('real-publisher.com');
    }
  });

  it('threads legAttribution when provided', () => {
    const result = toWebCitationSource(
      { link: 'https://example.com/x' },
      0,
      {
        idPrefix: 'm',
        provider: 'p',
        legAttribution: { legId: 'leg-1', role: 'direct' },
      },
    );
    if (result.ok) {
      expect(result.source.legAttribution).toEqual({ legId: 'leg-1', role: 'direct' });
    }
  });

  it('respects fetchedAt override', () => {
    const result = toWebCitationSource(
      { link: 'https://example.com/x' },
      0,
      { idPrefix: 'm', provider: 'p', fetchedAt: '2026-04-24T00:00:00.000Z' },
    );
    if (result.ok && result.source.kindSpecific.kind === 'web') {
      expect(result.source.kindSpecific.fetchedAt).toBe('2026-04-24T00:00:00.000Z');
    }
  });

  it('returns invalid_field when domain cannot be derived', () => {
    const result = toWebCitationSource(
      { link: 'not-a-url' },
      0,
      { idPrefix: 'm', provider: 'p' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('invalid_field');
    }
  });
});

describe('toFileCitationSource', () => {
  it('returns ok with normalized source for valid raw file result', () => {
    const result = toFileCitationSource(
      {
        fileId: 'file-abc',
        fileName: 'q4-report.pdf',
        pages: [3, 4],
        relevance: 0.92,
        fileType: 'pdf',
      },
      0,
      { idPrefix: 'msg-1', provider: 'rag_api' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.id).toBe('msg-1:file:0');
      expect(result.source.kind).toBe('file');
      expect(result.source.title).toBe('q4-report.pdf');
      expect(result.source.score).toBe(0.92);
      if (result.source.kindSpecific.kind === 'file') {
        expect(result.source.kindSpecific.fileId).toBe('file-abc');
        expect(result.source.kindSpecific.pages).toEqual([3, 4]);
        expect(result.source.kindSpecific.fileType).toBe('pdf');
      }
    }
  });

  it('returns failure when fileId missing', () => {
    const result = toFileCitationSource(
      { fileName: 'x.pdf' } as never,
      0,
      { idPrefix: 'm', provider: 'rag_api' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('missing_required_field');
      expect(result.failure.details).toContain('fileId');
    }
  });

  it('returns failure when fileName missing', () => {
    const result = toFileCitationSource(
      { fileId: 'f1' } as never,
      0,
      { idPrefix: 'm', provider: 'rag_api' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.details).toContain('fileName');
    }
  });

  it('omits pages when array empty (no fabrication)', () => {
    const result = toFileCitationSource(
      { fileId: 'f', fileName: 'a.pdf', pages: [] },
      0,
      { idPrefix: 'm', provider: 'rag_api' },
    );
    if (result.ok && result.source.kindSpecific.kind === 'file') {
      expect(result.source.kindSpecific.pages).toBeUndefined();
    }
  });
});

describe('normalizeWebResults — batch', () => {
  it('preserves order of successful results and reports per-index failures', () => {
    const raw = [
      { link: 'https://a.com/1', title: 'A' },
      { title: 'no link' },
      { link: 'https://b.com/2', title: 'B' },
      { link: 'not-a-url' },
    ];
    const { sources, failures } = normalizeWebResults(raw, {
      idPrefix: 'm',
      provider: 'serper',
    });
    expect(sources).toHaveLength(2);
    expect(sources[0].id).toBe('m:web:0');
    expect(sources[1].id).toBe('m:web:2');
    expect(failures).toHaveLength(2);
    expect(failures[0].index).toBe(1);
    expect(failures[1].index).toBe(3);
  });

  it('returns empty arrays for empty input', () => {
    const out = normalizeWebResults([], { idPrefix: 'm', provider: 'p' });
    expect(out.sources).toHaveLength(0);
    expect(out.failures).toHaveLength(0);
  });
});

describe('normalizeFileResults — batch', () => {
  it('preserves order and reports failures per index', () => {
    const raw = [
      { fileId: 'f1', fileName: 'a.pdf' },
      { fileId: 'f2' },
      { fileId: 'f3', fileName: 'b.pdf', pages: [1] },
    ];
    const { sources, failures } = normalizeFileResults(raw, {
      idPrefix: 'm',
      provider: 'rag_api',
    });
    expect(sources).toHaveLength(2);
    expect(sources[0].id).toBe('m:file:0');
    expect(sources[1].id).toBe('m:file:2');
    expect(failures).toHaveLength(1);
    expect(failures[0].index).toBe(1);
  });
});
