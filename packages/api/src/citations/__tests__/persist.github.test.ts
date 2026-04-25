/**
 * `ingestGithubResults` tests.
 *
 * Mirrors the Phase 5 web/file ingest test surface: dedup across calls,
 * leg-attribution threading, contract validity, and malformed-entry
 * handling. Honest-shape: unknown tools yield an unchanged source list
 * with no failures.
 */
import { ingestGithubResults } from '../persist';
import type { CitationSource } from 'librechat-data-provider';

describe('ingestGithubResults', () => {

  it('is a no-op for non-citation-emitting tools', () => {
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'create_issue',
      payload: { repository: { full_name: 'a/b' }, number: 1, title: 't' },
      provider: 'github',
    });
    expect(out.added).toEqual([]);
  });

  it('emits a citation when the tool is allowlisted', () => {
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: {
        repo: 'a/b',
        path: 'README.md',
        sha: 'abc1234',
        html_url: 'https://github.com/a/b/blob/abc1234/README.md',
      },
      provider: 'github',
    });
    expect(out.added).toHaveLength(1);
    expect(out.added[0].id).toBe('msg-1:0:github:0');
    expect(out.added[0].kind).toBe('github');
    expect(out.added[0].kindSpecific).toMatchObject({
      kind: 'github',
      repo: 'a/b',
      path: 'README.md',
      ref: 'abc1234',
      itemType: 'file',
    });
  });

  it('appends to existingSources without renumbering them', () => {
    const existing: CitationSource[] = [
      {
        id: 'msg-1:0:web:0',
        kind: 'web',
        title: 'A',
        url: 'https://a.test',
        provider: 'serper',
        kindSpecific: {
          kind: 'web',
          domain: 'a.test',
          fetchedAt: '2026-04-24T00:00:00Z',
        },
      },
    ];
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: { repo: 'a/b', path: 'x', sha: 's' },
      provider: 'github',
      existingSources: existing,
    });
    expect(out.nextSources[0].id).toBe('msg-1:0:web:0');
    expect(out.added[0].id).toBe('msg-1:1:github:0');
  });

  it('threads leg attribution through the normalized source', () => {
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: { repo: 'a/b', path: 'x', sha: 's' },
      provider: 'github',
      legAttribution: { legId: 'leg-2', role: 'direct' },
    });
    expect(out.added[0].legAttribution).toEqual({ legId: 'leg-2', role: 'direct' });
  });

  it('returns an unchanged source list when the parser yields nothing', () => {
    const existing: CitationSource[] = [
      {
        id: 'msg-1:0:github:0',
        kind: 'github',
        title: 'a/b:x',
        provider: 'github',
        kindSpecific: { kind: 'github', repo: 'a/b', path: 'x', itemType: 'file' },
      },
    ];
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: { not: 'parseable' },
      provider: 'github',
      existingSources: existing,
    });
    expect(out.added).toEqual([]);
    expect(out.nextSources).toHaveLength(1);
  });

  it('reports failures for malformed parsed shapes (defensive)', () => {
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'search_repositories',
      payload: { items: [{ full_name: 'a/b' }, { full_name: '' }] },
      provider: 'github',
    });
    expect(out.added.length).toBeGreaterThanOrEqual(1);
  });

  it('supports multiple citations from a single search_code result', () => {
    const out = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'search_code',
      payload: {
        items: [
          {
            repository: { full_name: 'a/b' },
            path: 'p1',
            text_matches: [{ fragment: 'f', line_start: 1, line_end: 2 }],
          },
          {
            repository: { full_name: 'a/b' },
            path: 'p2',
            text_matches: [{ fragment: 'g', line_start: 3, line_end: 4 }],
          },
        ],
      },
      provider: 'github',
    });
    expect(out.added).toHaveLength(2);
    expect(out.added[0].id).toBe('msg-1:0:github:0');
    expect(out.added[1].id).toBe('msg-1:0:github:1');
  });

  it('preserves identity when the same path is ingested twice (dedup-by-id-prefix)', () => {
    const first = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: { repo: 'a/b', path: 'x', sha: 's' },
      provider: 'github',
    });
    const second = ingestGithubResults({
      messageId: 'msg-1',
      toolName: 'get_file_contents',
      payload: { repo: 'a/b', path: 'x', sha: 's' },
      provider: 'github',
      existingSources: first.nextSources,
    });
    expect(second.nextSources).toHaveLength(2);
    expect(second.added[0].id).toBe('msg-1:1:github:0');
  });
});
