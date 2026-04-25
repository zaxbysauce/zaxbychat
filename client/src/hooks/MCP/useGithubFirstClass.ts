import { useGetStartupConfig } from '~/data-provider/Endpoints/queries';
import { useMCPServersQuery } from '~/data-provider/MCP/queries';
import type { MCPServerDBObjectResponse } from 'librechat-data-provider';

export interface GithubMcpServer {
  serverName: string;
  config: MCPServerDBObjectResponse;
}

/**
 * Phase 7 PR 7.2 — runtime feature-flag mirror.
 *
 * Mirrors `process.env.GITHUB_MCP_FIRST_CLASS` from the server's
 * startup config payload; default-off when absent.
 */
export function useGithubFirstClassEnabled(): boolean {
  const { data } = useGetStartupConfig();
  return data?.githubFirstClassEnabled === true;
}

/**
 * Phase 7 PR 7.2 — returns only MCP servers carrying `kind: 'github'`.
 * The picker UI hides itself when this list is empty so users without
 * a configured first-class server never see the entry point.
 */
export function useGithubMcpServers(): GithubMcpServer[] {
  const { data } = useMCPServersQuery();
  if (!data) return [];
  const out: GithubMcpServer[] = [];
  for (const [serverName, server] of Object.entries(data)) {
    if ((server as { kind?: string }).kind === 'github') {
      out.push({ serverName, config: server });
    }
  }
  return out;
}
