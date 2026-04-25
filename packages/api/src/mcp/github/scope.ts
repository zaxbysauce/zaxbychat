/**
 * Phase 7 PR 7.2 — GitHub MCP tool-exposure scoping (D-P7-7 / D-P7-8 locks).
 *
 * Hard-capped allowlist of tools agents may invoke when an MCP server
 * carries `kind: 'github'` and the runtime feature flag is on. This
 * layer is intentionally separate from `api/server/controllers/agents/v1.js`
 * `filterAuthorizedTools` (PR 7.2 must not reuse that layer).
 *
 * Allowlist composition:
 *   - Citation-emitting set (PR 7.1 `parsers.ts`): `get_file_contents`,
 *     `search_code`, `list_pull_requests`, `pull_request_read`,
 *     `get_pull_request`, `list_issues`, `issue_read`, `get_issue`,
 *     `get_commit`, `list_commits`, `search_repositories`.
 *   - Read-only navigation aid: `list_branches` only (so the picker
 *     can pick a ref). Not citation-emitting; PR 7.1 parsers ignore it.
 *
 * Mutating tools (`create_*`, `update_*`, `add_*`, `delete_*`,
 * `merge_*`, `request_*_review`, `*_pending_review`) and any other
 * read tools are dropped.
 */

import type { MCPOptions } from 'librechat-data-provider';
import { isGithubMcpServer, parseGithubMcpToolKey } from './identity';

export const GITHUB_MCP_PICKER_ALLOWLIST: ReadonlySet<string> = new Set([
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
]);

export function isGithubMcpAllowedTool(toolName: string): boolean {
  return GITHUB_MCP_PICKER_ALLOWLIST.has(toolName);
}

export interface ShouldDropForGithubScopeArgs {
  toolKey: string;
  flagEnabled: boolean;
  getServerConfig: (serverName: string) => MCPOptions | undefined;
}

/**
 * Returns true when a tool key (`<toolName>_mcp_<serverName>`) should be
 * stripped from the agent's exposed tool list.
 *
 * Behavior matrix:
 *   - flag OFF                                            → false (no-op; preserves pre-PR-7.1 behavior).
 *   - flag ON, non-MCP tool key                           → false (untouched).
 *   - flag ON, MCP tool, non-`kind:'github'` server       → false (untouched; generic MCP semantics).
 *   - flag ON, `kind:'github'` server, allowlisted tool   → false (kept).
 *   - flag ON, `kind:'github'` server, non-allowlisted    → TRUE  (dropped).
 */
export function shouldDropForGithubScope(args: ShouldDropForGithubScopeArgs): boolean {
  if (!args.flagEnabled) return false;
  const parsed = parseGithubMcpToolKey(args.toolKey);
  if (!parsed) return false;
  const cfg = args.getServerConfig(parsed.serverName);
  if (!isGithubMcpServer(cfg)) return false;
  return !isGithubMcpAllowedTool(parsed.toolName);
}

export interface ApplyGithubMcpScopeArgs<T> {
  items: ReadonlyArray<T>;
  getName: (item: T) => string | undefined;
  getServerConfig: (serverName: string) => MCPOptions | undefined;
  flagEnabled: boolean;
}

/**
 * Filters an array of tool-bearing items in a single pass, dropping
 * those whose name maps to a `kind:'github'` MCP server with a
 * non-allowlisted tool shortname. Items with no resolvable name (e.g.,
 * non-MCP tools, action tools) pass through unchanged.
 *
 * The pure-function form lets callers reuse the same predicate for
 * `structuredTools` (GenericTool[]) and `toolDefinitions` (definition
 * stubs) without duplicating the filter logic.
 */
export function applyGithubMcpScope<T>(args: ApplyGithubMcpScopeArgs<T>): T[] {
  if (!args.flagEnabled) return [...args.items];
  const kept: T[] = [];
  for (const item of args.items) {
    const name = args.getName(item);
    if (!name) {
      kept.push(item);
      continue;
    }
    const drop = shouldDropForGithubScope({
      toolKey: name,
      flagEnabled: true,
      getServerConfig: args.getServerConfig,
    });
    if (!drop) kept.push(item);
  }
  return kept;
}
