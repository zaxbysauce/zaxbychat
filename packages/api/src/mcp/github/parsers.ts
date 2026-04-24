/**
 * Phase 7 PR 7.1 — per-tool GitHub MCP result parsers.
 *
 * Each parser maps a single MCP tool's response payload to
 * `RawGithubResult[]` (defined in `librechat-data-provider`'s
 * normalize module). Honest-shape rules apply throughout (D-P7-3 lock):
 *
 *   - **Citation-emitting tools only.** Mutating tools and tools whose
 *     output shape can't be normalized without guessing return `[]`.
 *   - **Required `repo` is never fabricated.** A payload missing repo
 *     identity yields `[]` for that entry.
 *   - **Unknown tool names route to a no-op.** New tools require an
 *     explicit registry entry before they can emit citations.
 *
 * The parser registry here is the single allowlist of GitHub MCP tools
 * that produce citations in PR 7.1. Tools omitted intentionally (per
 * D-P7-3 + the constraints carried into PR 7.2): mutating tools
 * (`create_*`, `update_*`, `add_*`, `delete_*`, `merge_*`,
 * `request_*_review`, `*_pending_review`) and tool outputs whose shape
 * varies enough to risk fabrication.
 */

import type { RawGithubResult } from 'librechat-data-provider';

export type GithubToolParser = (payload: unknown) => RawGithubResult[];

const SUPPORTED_TOOLS: Record<string, GithubToolParser> = {
  get_file_contents: parseGetFileContents,
  search_code: parseSearchCode,
  list_pull_requests: parseListPullRequests,
  get_pull_request: parseGetPullRequest,
  list_issues: parseListIssues,
  get_issue: parseGetIssue,
  issue_read: parseGetIssue,
  pull_request_read: parseGetPullRequest,
  get_commit: parseGetCommit,
  list_commits: parseListCommits,
  search_repositories: parseSearchRepositories,
};

/**
 * Public entry point for the persist layer. Returns `[]` for any tool
 * not in the allowlist or any payload too ambiguous to normalize.
 */
export function parseGithubMcpResult(toolName: string, payload: unknown): RawGithubResult[] {
  const parser = SUPPORTED_TOOLS[toolName];
  if (!parser) return [];
  try {
    return parser(payload);
  } catch {
    return [];
  }
}

export function isCitationEmittingGithubTool(toolName: string): boolean {
  return toolName in SUPPORTED_TOOLS;
}

function parseGetFileContents(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const repo = readRepo(node);
  const path = readString(node, 'path');
  if (!repo || !path) return [];
  const ref = readString(node, 'ref') || readString(node, 'sha');
  const url = readString(node, 'html_url') || readString(node, 'url');
  return [
    {
      repo,
      path,
      ref,
      url,
      itemType: 'file',
      title: `${repo}:${path}`,
    },
  ];
}

function parseSearchCode(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const items = readArray(node, 'items');
  if (!items.length) return [];
  const out: RawGithubResult[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const repo = readRepoFromItem(item);
    const path = readString(item, 'path');
    if (!repo || !path) continue;
    const ref = readString(item, 'ref') || readString(item, 'sha');
    const url = readString(item, 'html_url') || readString(item, 'url');
    const score = typeof item.score === 'number' ? item.score : undefined;
    const { lineStart, lineEnd, snippet } = readSearchMatchLines(item);
    out.push({
      repo,
      path,
      ref,
      url,
      score,
      lineStart,
      lineEnd,
      snippet,
      itemType: 'file',
      title: `${repo}:${path}`,
    });
  }
  return out;
}

function parseListPullRequests(payload: unknown): RawGithubResult[] {
  const list = pickList(payload);
  if (!list) return [];
  return collectIssueLikeItems(list, 'pr');
}

function parseGetPullRequest(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const item = readIssueLikeItem(node, 'pr');
  return item ? [item] : [];
}

function parseListIssues(payload: unknown): RawGithubResult[] {
  const list = pickList(payload);
  if (!list) return [];
  return collectIssueLikeItems(list, 'issue');
}

function parseGetIssue(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const item = readIssueLikeItem(node, 'issue');
  return item ? [item] : [];
}

function parseGetCommit(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const repo = readRepo(node);
  const sha = readString(node, 'sha');
  if (!repo || !sha) return [];
  const url = readString(node, 'html_url') || readString(node, 'url');
  const snippet = readString(commitMessageHost(node), 'message');
  return [
    {
      repo,
      ref: sha,
      itemType: 'commit',
      itemId: sha,
      url,
      snippet,
      title: `${repo}@${sha.slice(0, 7)}`,
    },
  ];
}

function parseListCommits(payload: unknown): RawGithubResult[] {
  const list = pickList(payload);
  if (!list) return [];
  const out: RawGithubResult[] = [];
  for (const item of list) {
    out.push(...parseGetCommit(item));
  }
  return out;
}

function parseSearchRepositories(payload: unknown): RawGithubResult[] {
  const node = pickNode(payload);
  if (!node) return [];
  const items = readArray(node, 'items');
  if (!items.length) return [];
  const out: RawGithubResult[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const repo = readRepo(item);
    if (!repo) continue;
    const url = readString(item, 'html_url') || readString(item, 'url');
    const snippet = readString(item, 'description');
    const score = typeof item.score === 'number' ? item.score : undefined;
    out.push({
      repo,
      url,
      snippet,
      score,
      itemType: 'repo',
      title: repo,
    });
  }
  return out;
}

function pickNode(payload: unknown): Record<string, unknown> | null {
  if (isRecord(payload)) return payload;
  if (Array.isArray(payload)) {
    const first = payload[0];
    return isRecord(first) ? first : null;
  }
  return null;
}

function pickList(payload: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord) as Array<Record<string, unknown>>;
  }
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return payload.items.filter(isRecord) as Array<Record<string, unknown>>;
  }
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(isRecord) as Array<Record<string, unknown>>;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(node: Record<string, unknown> | null, key: string): string | undefined {
  if (!node) return undefined;
  const v = node[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readArray(node: Record<string, unknown>, key: string): unknown[] {
  const v = node[key];
  return Array.isArray(v) ? v : [];
}

function readRepo(node: Record<string, unknown>): string | undefined {
  const direct = readString(node, 'repo') || readString(node, 'full_name');
  if (direct) return direct;
  const owner = readOwnerLogin(node) || readString(node, 'owner');
  const name = readString(node, 'name') || readString(node, 'repo_name');
  if (owner && name) return `${owner}/${name}`;
  return undefined;
}

function readRepoFromItem(item: Record<string, unknown>): string | undefined {
  const fromItem = readRepo(item);
  if (fromItem) return fromItem;
  const repository = item.repository;
  return isRecord(repository) ? readRepo(repository) : undefined;
}

function readOwnerLogin(node: Record<string, unknown>): string | undefined {
  const owner = node.owner;
  if (typeof owner === 'string') return owner;
  if (isRecord(owner)) return readString(owner, 'login');
  return undefined;
}

function readIssueLikeItem(
  node: Record<string, unknown>,
  itemType: 'issue' | 'pr',
): RawGithubResult | null {
  const repo = readRepoFromItem(node);
  const number = node.number;
  if (!repo || (typeof number !== 'number' && typeof number !== 'string')) return null;
  const id = String(number);
  const url = readString(node, 'html_url') || readString(node, 'url');
  const title = readString(node, 'title');
  const snippet = readString(node, 'body') || readString(node, 'body_text');
  return {
    repo,
    itemType,
    itemId: id,
    url,
    title: title ?? `${repo} ${itemType} #${id}`,
    snippet,
  };
}

function collectIssueLikeItems(
  list: Array<Record<string, unknown>>,
  itemType: 'issue' | 'pr',
): RawGithubResult[] {
  const out: RawGithubResult[] = [];
  for (const item of list) {
    const parsed = readIssueLikeItem(item, itemType);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readSearchMatchLines(item: Record<string, unknown>): {
  lineStart?: number;
  lineEnd?: number;
  snippet?: string;
} {
  const matches = item.text_matches;
  if (!Array.isArray(matches) || matches.length === 0) {
    return { snippet: readString(item, 'fragment') };
  }
  const first = matches[0];
  if (!isRecord(first)) return {};
  const fragment = readString(first, 'fragment');
  const lineStart = typeof first.line_start === 'number' ? first.line_start : undefined;
  const lineEnd = typeof first.line_end === 'number' ? first.line_end : undefined;
  if (lineStart != null && lineEnd != null && lineStart > lineEnd) return { snippet: fragment };
  return { lineStart, lineEnd, snippet: fragment };
}

function commitMessageHost(node: Record<string, unknown>): Record<string, unknown> | null {
  const inner = node.commit;
  return isRecord(inner) ? inner : node;
}
