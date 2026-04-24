/**
 * Phase 7 PR 7.1 — runtime feature flag for GitHub first-class
 * citation emission.
 *
 * Defaults OFF per cross-cutting gate (§7 of the migration notes).
 * Truthiness of `process.env.GITHUB_MCP_FIRST_CLASS` is read once and
 * cached so the value is stable across a single process lifetime.
 *
 * Hard gate (D-P7-4 lock): when this flag is false, the GitHub
 * `ingest*` path is a no-op even when a `kind: 'github'` MCP server
 * is configured. Identity helpers still report truthfully — only
 * citation persistence is gated.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled']);

let cached: boolean | null = null;

export function isGithubFirstClassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (cached !== null) return cached;
  const raw = env.GITHUB_MCP_FIRST_CLASS;
  cached = typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase());
  return cached;
}

/**
 * Test-only helper: clear the cached flag so a subsequent call re-reads
 * `process.env`. Production code should never call this.
 */
export function _resetGithubFirstClassFlagCache(): void {
  cached = null;
}
