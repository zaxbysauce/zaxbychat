/**
 * Phase 7 PR 7.1 — per-tool GitHub MCP parser tests.
 *
 * Each parsed result is asserted to validate against
 * `citationSourceSchema` after running through `normalizeGithubResults`,
 * so the parsers stay honest with the Phase 1 / Phase 5 contract.
 *
 * Mutating tools and unknown tool names must yield `[]` (D-P7-3 lock).
 */
import {
  parseGithubMcpResult,
  isCitationEmittingGithubTool,
} from '../parsers';
import {
  normalizeGithubResults,
  citationSourceSchema,
} from 'librechat-data-provider';

function expectAllValid(toolName: string, payload: unknown): void {
  const raws = parseGithubMcpResult(toolName, payload);
  expect(raws.length).toBeGreaterThan(0);
  const { sources, failures } = normalizeGithubResults(raws, {
    idPrefix: 'msg-1:0',
    provider: 'github',
  });
  expect(failures).toHaveLength(0);
  for (const src of sources) {
    expect(citationSourceSchema.safeParse(src).success).toBe(true);
  }
}

describe('isCitationEmittingGithubTool', () => {
  it('flags allowlisted tools only', () => {
    expect(isCitationEmittingGithubTool('get_file_contents')).toBe(true);
    expect(isCitationEmittingGithubTool('search_code')).toBe(true);
    expect(isCitationEmittingGithubTool('list_pull_requests')).toBe(true);
    expect(isCitationEmittingGithubTool('issue_read')).toBe(true);
    expect(isCitationEmittingGithubTool('search_repositories')).toBe(true);
  });

  it('rejects mutating tools', () => {
    for (const tool of [
      'create_issue',
      'update_pull_request',
      'add_issue_comment',
      'merge_pull_request',
      'delete_file',
      'request_copilot_review',
      'add_comment_to_pending_review',
    ]) {
      expect(isCitationEmittingGithubTool(tool)).toBe(false);
    }
  });

  it('rejects unknown tools', () => {
    expect(isCitationEmittingGithubTool('mystery_tool')).toBe(false);
  });
});

describe('parseGithubMcpResult — get_file_contents', () => {
  it('emits a file citation with repo+path+ref', () => {
    const payload = {
      repo: 'zaxbysauce/zaxbychat',
      path: 'packages/api/src/citations/persist.ts',
      sha: 'abc123',
      html_url: 'https://github.com/zaxbysauce/zaxbychat/blob/main/packages/api/src/citations/persist.ts',
    };
    expectAllValid('get_file_contents', payload);
    const raws = parseGithubMcpResult('get_file_contents', payload);
    expect(raws[0]).toMatchObject({
      repo: 'zaxbysauce/zaxbychat',
      path: 'packages/api/src/citations/persist.ts',
      ref: 'abc123',
      itemType: 'file',
    });
  });

  it('synthesizes repo from owner.login + name when full_name missing', () => {
    const payload = {
      owner: { login: 'zaxbysauce' },
      name: 'zaxbychat',
      path: 'README.md',
    };
    const raws = parseGithubMcpResult('get_file_contents', payload);
    expect(raws[0].repo).toBe('zaxbysauce/zaxbychat');
  });

  it('returns [] when repo cannot be derived (honest-shape)', () => {
    expect(parseGithubMcpResult('get_file_contents', { path: 'README.md' })).toEqual([]);
  });

  it('returns [] when path is absent', () => {
    expect(parseGithubMcpResult('get_file_contents', { repo: 'a/b' })).toEqual([]);
  });
});

describe('parseGithubMcpResult — search_code', () => {
  it('emits one citation per item with line ranges from text_matches', () => {
    const payload = {
      items: [
        {
          repository: { full_name: 'zaxbysauce/zaxbychat' },
          path: 'packages/api/src/citations/persist.ts',
          html_url: 'https://github.com/x',
          text_matches: [
            { fragment: 'function ingestGithubResults', line_start: 78, line_end: 80 },
          ],
          score: 0.95,
        },
        {
          repository: { full_name: 'a/b' },
          path: 'src/x.ts',
          text_matches: [
            { fragment: 'foo', line_start: 5, line_end: 10 },
          ],
        },
      ],
    };
    expectAllValid('search_code', payload);
    const raws = parseGithubMcpResult('search_code', payload);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatchObject({
      repo: 'zaxbysauce/zaxbychat',
      path: 'packages/api/src/citations/persist.ts',
      lineStart: 78,
      lineEnd: 80,
      score: 0.95,
    });
  });

  it('drops malformed line ranges (start > end) silently', () => {
    const payload = {
      items: [
        {
          repository: { full_name: 'a/b' },
          path: 'x',
          text_matches: [{ fragment: 'foo', line_start: 10, line_end: 5 }],
        },
      ],
    };
    const raws = parseGithubMcpResult('search_code', payload);
    expect(raws[0].lineStart).toBeUndefined();
    expect(raws[0].lineEnd).toBeUndefined();
  });

  it('skips items without a parseable repo', () => {
    const payload = { items: [{ path: 'x' }] };
    expect(parseGithubMcpResult('search_code', payload)).toEqual([]);
  });
});

describe('parseGithubMcpResult — issue / pull_request', () => {
  it('emits an issue citation for issue_read', () => {
    const payload = {
      repository: { full_name: 'a/b' },
      number: 42,
      title: 'Investigate flaky test',
      html_url: 'https://github.com/a/b/issues/42',
      body: 'The test fails intermittently.',
    };
    expectAllValid('issue_read', payload);
    const [src] = parseGithubMcpResult('issue_read', payload);
    expect(src).toMatchObject({
      repo: 'a/b',
      itemType: 'issue',
      itemId: '42',
      title: 'Investigate flaky test',
    });
  });

  it('emits a pr citation for pull_request_read', () => {
    const payload = {
      repository: { full_name: 'a/b' },
      number: 7,
      title: 'Fix retrieval bug',
      html_url: 'https://github.com/a/b/pull/7',
    };
    expectAllValid('pull_request_read', payload);
    const [src] = parseGithubMcpResult('pull_request_read', payload);
    expect(src.itemType).toBe('pr');
  });

  it('lists pulls / issues from list_* tools', () => {
    const list = [
      { repository: { full_name: 'a/b' }, number: 1, title: 'A', html_url: 'h' },
      { repository: { full_name: 'a/b' }, number: 2, title: 'B', html_url: 'h2' },
    ];
    expect(parseGithubMcpResult('list_pull_requests', list)).toHaveLength(2);
    expect(parseGithubMcpResult('list_issues', list)).toHaveLength(2);
  });

  it('skips items missing number (honest-shape)', () => {
    const payload = { repository: { full_name: 'a/b' }, title: 'no number' };
    expect(parseGithubMcpResult('issue_read', payload)).toEqual([]);
  });
});

describe('parseGithubMcpResult — commits', () => {
  it('emits a commit citation', () => {
    const payload = {
      repo: 'a/b',
      sha: 'deadbeefdeadbeef',
      html_url: 'https://github.com/a/b/commit/deadbeefdeadbeef',
      commit: { message: 'fix: typo' },
    };
    expectAllValid('get_commit', payload);
    const [src] = parseGithubMcpResult('get_commit', payload);
    expect(src).toMatchObject({
      repo: 'a/b',
      itemType: 'commit',
      itemId: 'deadbeefdeadbeef',
      ref: 'deadbeefdeadbeef',
    });
    expect(src.title).toContain('a/b@deadbee');
  });

  it('list_commits emits one citation per entry', () => {
    const payload = [
      { repo: 'a/b', sha: 'aaaaaaa1', commit: { message: 'm1' } },
      { repo: 'a/b', sha: 'bbbbbbb2', commit: { message: 'm2' } },
    ];
    expect(parseGithubMcpResult('list_commits', payload)).toHaveLength(2);
  });
});

describe('parseGithubMcpResult — search_repositories', () => {
  it('emits a repo citation per item', () => {
    const payload = {
      items: [
        { full_name: 'a/b', description: 'x', html_url: 'https://github.com/a/b' },
        { full_name: 'c/d', description: 'y', html_url: 'https://github.com/c/d' },
      ],
    };
    expectAllValid('search_repositories', payload);
    const raws = parseGithubMcpResult('search_repositories', payload);
    expect(raws.map((r) => r.repo)).toEqual(['a/b', 'c/d']);
    expect(raws.every((r) => r.itemType === 'repo')).toBe(true);
  });
});

describe('parseGithubMcpResult — unknown / mutating tools', () => {
  it('returns [] for unknown tool names', () => {
    expect(parseGithubMcpResult('mystery', { repo: 'a/b' })).toEqual([]);
  });

  it('returns [] for mutating tools even if their payload looks parseable', () => {
    expect(
      parseGithubMcpResult('create_issue', {
        repository: { full_name: 'a/b' },
        number: 1,
        title: 't',
      }),
    ).toEqual([]);
  });

  it('returns [] when the parser throws', () => {
    const recursive: Record<string, unknown> = {};
    recursive.self = recursive;
    expect(parseGithubMcpResult('get_file_contents', recursive)).toEqual([]);
  });
});
