/**
 * Phase 7 PR 7.2 — GitHub context system-note tests.
 *
 * Asserts the rendered note is terse, deterministic, and only mentions
 * fields explicitly present on the selection (no fabrication).
 */
import { renderGithubContextSystemNote } from '../context';

describe('renderGithubContextSystemNote', () => {
  it('returns empty string for null/undefined selection', () => {
    expect(renderGithubContextSystemNote(null)).toBe('');
    expect(renderGithubContextSystemNote(undefined)).toBe('');
  });

  it('renders a minimal repo-only note', () => {
    const note = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
    });
    expect(note).toContain('repo=a/b');
    expect(note).not.toContain('ref=');
    expect(note).not.toContain('path=');
    expect(note).not.toContain('item=');
    expect(note).toContain('GitHub MCP tools');
    expect(note).toContain('GitHub source contract');
  });

  it('includes ref + path + line range when provided', () => {
    const note = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
      ref: 'main',
      path: 'src/x.ts',
      lineStart: 5,
      lineEnd: 12,
    });
    expect(note).toContain('repo=a/b');
    expect(note).toContain('ref=main');
    expect(note).toContain('path=src/x.ts');
    expect(note).toContain('lines=5-12');
    expect(note).not.toContain('line=');
  });

  it('renders single line= when only lineStart is set', () => {
    const note = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
      lineStart: 7,
    });
    expect(note).toContain('line=7');
    expect(note).not.toContain('lines=');
  });

  it('renders item=type#id for issue/pr/commit', () => {
    const issue = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
      itemType: 'issue',
      itemId: '42',
    });
    expect(issue).toContain('item=issue#42');

    const pr = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
      itemType: 'pr',
      itemId: '7',
    });
    expect(pr).toContain('item=pr#7');

    const commit = renderGithubContextSystemNote({
      serverName: 'github',
      repo: 'a/b',
      itemType: 'commit',
      itemId: 'abcd123',
    });
    expect(commit).toContain('item=commit#abcd123');
  });

  it('is deterministic for the same selection', () => {
    const sel = {
      serverName: 'github',
      repo: 'a/b',
      ref: 'main',
      path: 'x',
    };
    expect(renderGithubContextSystemNote(sel)).toBe(renderGithubContextSystemNote(sel));
  });
});
