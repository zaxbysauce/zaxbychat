/**
 * Phase 7 PR 7.1 — feature-flag tests.
 *
 * Verifies `GITHUB_MCP_FIRST_CLASS` truthiness rules and that the
 * cached value can be reset for tests.
 */
import { isGithubFirstClassEnabled, _resetGithubFirstClassFlagCache } from '../flag';

describe('isGithubFirstClassEnabled', () => {
  beforeEach(() => {
    _resetGithubFirstClassFlagCache();
  });

  it('returns false when env var is undefined', () => {
    expect(isGithubFirstClassEnabled({})).toBe(false);
  });

  it('returns false when env var is empty', () => {
    expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: '' })).toBe(false);
  });

  it('accepts canonical truthy strings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', 'enabled']) {
      _resetGithubFirstClassFlagCache();
      expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: value })).toBe(true);
    }
  });

  it('rejects ambiguous non-truthy values', () => {
    for (const value of ['0', 'false', 'no', 'off', 'random']) {
      _resetGithubFirstClassFlagCache();
      expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: value })).toBe(false);
    }
  });

  it('caches the first read across calls', () => {
    expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: 'true' })).toBe(true);
    expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: 'false' })).toBe(true);
    _resetGithubFirstClassFlagCache();
    expect(isGithubFirstClassEnabled({ GITHUB_MCP_FIRST_CLASS: 'false' })).toBe(false);
  });
});
