/**
 * Phase 7 PR 7.1 — GitHub MCP server identity helpers.
 *
 * Strictly opt-in (D-P7-1 lock): a server is recognized as the
 * canonical GitHub source provider only when its config carries
 * `kind: 'github'`. No hostname heuristics; no URL guessing; no
 * reserved server-name behavior.
 *
 * `parseGithubMcpToolKey` decomposes an MCP tool key produced by the
 * platform's `_mcp_` delimiter convention so callers can match against
 * the per-tool parser registry without committing to a specific
 * delimiter constant. Returns `null` for non-MCP keys.
 */

import type { MCPOptions } from 'librechat-data-provider';

export type GithubMcpServerConfig = MCPOptions & { kind: 'github' };

const MCP_DELIMITER = '_mcp_';

export function isGithubMcpServer(config: MCPOptions | undefined | null): config is GithubMcpServerConfig {
  return !!config && (config as { kind?: unknown }).kind === 'github';
}

export interface ParsedMcpToolKey {
  toolName: string;
  serverName: string;
}

/**
 * Splits a tool key like `get_file_contents_mcp_github` into
 * `{ toolName: 'get_file_contents', serverName: 'github' }`. Returns
 * `null` when the key has no MCP delimiter or has an invalid shape.
 */
export function parseGithubMcpToolKey(key: string): ParsedMcpToolKey | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  const idx = key.lastIndexOf(MCP_DELIMITER);
  if (idx <= 0) return null;
  const toolName = key.slice(0, idx);
  const serverName = key.slice(idx + MCP_DELIMITER.length);
  if (!toolName || !serverName) return null;
  return { toolName, serverName };
}

/**
 * Returns true when the tool key is an MCP tool routed through a
 * server whose config the caller has determined to be `kind: 'github'`.
 * Pure string check; the caller resolves the config separately and
 * passes it through `isGithubMcpServer`.
 */
export function isGithubMcpToolKey(
  toolKey: string,
  resolveServerConfig: (serverName: string) => MCPOptions | undefined,
): boolean {
  const parsed = parseGithubMcpToolKey(toolKey);
  if (!parsed) return false;
  return isGithubMcpServer(resolveServerConfig(parsed.serverName));
}
