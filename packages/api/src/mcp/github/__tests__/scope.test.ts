/**
 * Phase 7 PR 7.2 — scope-layer tests.
 *
 * Verifies the hard-capped allowlist + filter behavior:
 *   - Flag-off → no-op (preserves pre-PR-7.1 behavior).
 *   - Non-MCP tools untouched.
 *   - Generic MCP servers untouched.
 *   - `kind:'github'` servers: allowlisted tools kept, others dropped.
 *   - Mutating tool families dropped even when an attacker mismarks
 *     them with the GitHub kind.
 */
import {
  GITHUB_MCP_PICKER_ALLOWLIST,
  isGithubMcpAllowedTool,
  shouldDropForGithubScope,
  applyGithubMcpScope,
} from '../scope';
import type { MCPOptions } from 'librechat-data-provider';

const githubServer = {
  type: 'streamable-http',
  url: 'https://example.test',
  kind: 'github',
} as unknown as MCPOptions;

const genericServer = {
  type: 'streamable-http',
  url: 'https://example.test',
} as unknown as MCPOptions;

const resolveOnly = (target: string, cfg: MCPOptions | undefined) =>
  (name: string): MCPOptions | undefined =>
    name === target ? cfg : undefined;

describe('GITHUB_MCP_PICKER_ALLOWLIST', () => {
  it('contains the citation-emitting set + list_branches', () => {
    const expected = [
      'get_file_contents',
      'search_code',
      'list_pull_requests',
      'pull_request_read',
      'get_pull_request',
      'list_issues',
      'issue_read',
      'get_issue',
      'get_commit',
      'list_commits',
      'search_repositories',
      'list_branches',
    ];
    for (const tool of expected) {
      expect(GITHUB_MCP_PICKER_ALLOWLIST.has(tool)).toBe(true);
    }
    expect(GITHUB_MCP_PICKER_ALLOWLIST.size).toBe(expected.length);
  });

  it('rejects mutating and unknown tools', () => {
    for (const tool of [
      'create_issue',
      'update_pull_request',
      'add_issue_comment',
      'delete_file',
      'merge_pull_request',
      'request_copilot_review',
      'add_comment_to_pending_review',
      'mystery_tool',
    ]) {
      expect(isGithubMcpAllowedTool(tool)).toBe(false);
    }
  });
});

describe('shouldDropForGithubScope', () => {
  it('returns false for non-MCP tool keys (no delimiter)', () => {
    expect(
      shouldDropForGithubScope({
        toolKey: 'web_search',
        getServerConfig: () => undefined,
      }),
    ).toBe(false);
  });

  it('returns false for tools on a generic (non-github) MCP server', () => {
    expect(
      shouldDropForGithubScope({
        toolKey: 'something_mcp_other',
        getServerConfig: resolveOnly('other', genericServer),
      }),
    ).toBe(false);
  });

  it('returns false for allowlisted tools on a kind:github server', () => {
    for (const tool of [
      'get_file_contents',
      'search_repositories',
      'list_branches',
      'list_commits',
    ]) {
      expect(
        shouldDropForGithubScope({
          toolKey: `${tool}_mcp_github`,
          getServerConfig: resolveOnly('github', githubServer),
        }),
      ).toBe(false);
    }
  });

  it('returns true for non-allowlisted tools on a kind:github server', () => {
    for (const tool of [
      'create_issue',
      'update_pull_request',
      'add_issue_comment',
      'delete_file',
      'merge_pull_request',
      'mystery_tool',
    ]) {
      expect(
        shouldDropForGithubScope({
          toolKey: `${tool}_mcp_github`,
          getServerConfig: resolveOnly('github', githubServer),
        }),
      ).toBe(true);
    }
  });

  it('returns false when the resolver yields no config (defensive)', () => {
    expect(
      shouldDropForGithubScope({
        toolKey: 'create_issue_mcp_unknown',
        getServerConfig: () => undefined,
      }),
    ).toBe(false);
  });
});

describe('applyGithubMcpScope', () => {
  type ToolItem = { name?: string; payload?: number };
  const tools: ToolItem[] = [
    { name: 'web_search' },
    { name: 'get_file_contents_mcp_github', payload: 1 },
    { name: 'create_issue_mcp_github', payload: 2 },
    { name: 'list_branches_mcp_github', payload: 3 },
    { name: 'merge_pull_request_mcp_github', payload: 4 },
    { name: 'something_mcp_other', payload: 5 },
    { payload: 99 },
  ];

  const getName = (t: ToolItem): string | undefined => t.name;

  it('drops only non-allowlisted tools on kind:github servers', () => {
    const out = applyGithubMcpScope({
      items: tools,
      getName,
      getServerConfig: resolveOnly('github', githubServer),
    });
    expect(out.map((t) => t.payload)).toEqual([undefined, 1, 3, 5, 99]);
  });

  it('preserves order of kept items', () => {
    const out = applyGithubMcpScope({
      items: tools,
      getName,
      getServerConfig: resolveOnly('github', githubServer),
    });
    expect(out[0].name).toBe('web_search');
    expect(out[1].name).toBe('get_file_contents_mcp_github');
    expect(out[2].name).toBe('list_branches_mcp_github');
  });

  it('returns a fresh array (no in-place mutation)', () => {
    const original = [...tools];
    applyGithubMcpScope({
      items: tools,
      getName,
      getServerConfig: resolveOnly('github', githubServer),
    });
    expect(tools).toEqual(original);
  });
});
