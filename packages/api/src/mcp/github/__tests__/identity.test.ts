/**
 * Phase 7 PR 7.1 — identity helper tests.
 *
 * Confirms strictly-opt-in detection (D-P7-1 lock) and MCP delimiter
 * parsing for tool keys produced by the platform's `_mcp_` convention.
 */
import {
  isGithubMcpServer,
  parseGithubMcpToolKey,
  isGithubMcpToolKey,
} from '../identity';
import type { MCPOptions } from 'librechat-data-provider';

const baseConfig = {
  type: 'streamable-http',
  url: 'https://example.test',
} as unknown as MCPOptions;

describe('isGithubMcpServer', () => {
  it('returns true only when kind is exactly "github"', () => {
    expect(isGithubMcpServer({ ...baseConfig, kind: 'github' } as MCPOptions)).toBe(true);
  });

  it('returns false when kind is missing', () => {
    expect(isGithubMcpServer(baseConfig)).toBe(false);
  });

  it('returns false for null/undefined config', () => {
    expect(isGithubMcpServer(undefined)).toBe(false);
    expect(isGithubMcpServer(null)).toBe(false);
  });

  it('does not match by URL or hostname (no magic)', () => {
    const cfg = { ...baseConfig, url: 'https://api.github.com/mcp' } as MCPOptions;
    expect(isGithubMcpServer(cfg)).toBe(false);
  });
});

describe('parseGithubMcpToolKey', () => {
  it('splits on the rightmost _mcp_ delimiter', () => {
    expect(parseGithubMcpToolKey('get_file_contents_mcp_github')).toEqual({
      toolName: 'get_file_contents',
      serverName: 'github',
    });
  });

  it('handles tool names that themselves contain underscores', () => {
    expect(parseGithubMcpToolKey('list_pull_requests_mcp_github')).toEqual({
      toolName: 'list_pull_requests',
      serverName: 'github',
    });
  });

  it('returns null for keys without the delimiter', () => {
    expect(parseGithubMcpToolKey('plain_tool')).toBeNull();
    expect(parseGithubMcpToolKey('')).toBeNull();
  });

  it('returns null for malformed keys', () => {
    expect(parseGithubMcpToolKey('_mcp_github')).toBeNull();
    expect(parseGithubMcpToolKey('toolname_mcp_')).toBeNull();
  });
});

describe('isGithubMcpToolKey', () => {
  const githubServer = { ...baseConfig, kind: 'github' } as MCPOptions;
  const otherServer = baseConfig;

  it('returns true for keys whose server resolves to a github MCP', () => {
    const resolve = (name: string): MCPOptions | undefined =>
      name === 'github' ? githubServer : undefined;
    expect(isGithubMcpToolKey('get_file_contents_mcp_github', resolve)).toBe(true);
  });

  it('returns false when the resolved server lacks kind: github', () => {
    const resolve = (name: string): MCPOptions | undefined =>
      name === 'gh-mirror' ? otherServer : undefined;
    expect(isGithubMcpToolKey('get_file_contents_mcp_gh-mirror', resolve)).toBe(false);
  });

  it('returns false for non-MCP keys', () => {
    const resolve = (): MCPOptions | undefined => githubServer;
    expect(isGithubMcpToolKey('something', resolve)).toBe(false);
  });
});
