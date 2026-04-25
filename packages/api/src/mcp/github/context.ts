/**
 * Phase 7 PR 7.2 — GitHub context system-note helper (D-P7-11 lock).
 *
 * Renders a deterministic, terse system instruction describing the
 * user's selected GitHub context. The agent is expected to invoke the
 * scoped GitHub MCP tools to fetch / cite content; this helper does
 * NOT pre-fetch file contents.
 *
 * Honest-shape: only fields explicitly present on the selection are
 * mentioned. No invented values. Empty selection → empty string.
 */

import type { GithubContextSelection } from 'librechat-data-provider';

export function renderGithubContextSystemNote(
  selection: GithubContextSelection | null | undefined,
): string {
  if (!selection) return '';
  const parts: string[] = [`repo=${selection.repo}`];
  if (selection.ref) parts.push(`ref=${selection.ref}`);
  if (selection.path) parts.push(`path=${selection.path}`);
  if (
    typeof selection.lineStart === 'number' &&
    typeof selection.lineEnd === 'number'
  ) {
    parts.push(`lines=${selection.lineStart}-${selection.lineEnd}`);
  } else if (typeof selection.lineStart === 'number') {
    parts.push(`line=${selection.lineStart}`);
  }
  if (selection.itemType && selection.itemId) {
    parts.push(`item=${selection.itemType}#${selection.itemId}`);
  } else if (selection.itemType) {
    parts.push(`item=${selection.itemType}`);
  }
  return (
    `User attached GitHub context: ${parts.join(', ')}. ` +
    'Use the available GitHub MCP tools to consult or quote relevant content. ' +
    'Cite results via the GitHub source contract.'
  );
}
