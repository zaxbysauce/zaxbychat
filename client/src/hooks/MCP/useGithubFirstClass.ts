import { useMCPServersQuery } from '~/data-provider/MCP/queries';
import type { MCPServerDBObjectResponse } from 'librechat-data-provider';

export interface GithubMcpServer {
  serverName: string;
  config: MCPServerDBObjectResponse;
}

/**
 * Returns only MCP servers carrying `kind: 'github'`. The GitHub
 * context picker hides itself when this list is empty so users
 * without a configured first-class server never see the entry point.
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
