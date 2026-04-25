/**
 * Phase 7 PR 7.2 — picker-call validator tests.
 *
 * Pure-function gate logic; the Express controller is a thin wrapper
 * over `validatePickerToolRequest`. Each gate has a positive + negative
 * case, plus a happy-path test that returns ok with the resolved
 * server config.
 */
import { validatePickerToolRequest, PICKER_ARG_BYTES_CAP } from '../picker';
import type { MCPOptions } from 'librechat-data-provider';

const githubServer = {
  type: 'streamable-http',
  url: 'https://example.test',
  kind: 'github',
} as unknown as MCPOptions;

const genericServer = {
  type: 'streamable-http',
  url: 'https://example.test',
} as unknown as MCPOptions;

const baseInput = {
  flagEnabled: true,
  userId: 'u-1',
  serverName: 'github',
  toolName: 'search_repositories',
  args: { query: 'foo' },
  serverConfig: githubServer,
  argByteLength: 50,
};

describe('validatePickerToolRequest — gates', () => {
  it('returns 404 when flag is off', () => {
    const out = validatePickerToolRequest({ ...baseInput, flagEnabled: false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(404);
  });

  it('returns 401 when userId is missing', () => {
    const out = validatePickerToolRequest({ ...baseInput, userId: undefined });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(401);
  });

  it('returns 400 for missing serverName / toolName', () => {
    const a = validatePickerToolRequest({ ...baseInput, serverName: undefined });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.status).toBe(400);
    const b = validatePickerToolRequest({ ...baseInput, toolName: undefined });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.status).toBe(400);
  });

  it('returns 403 for non-allowlisted tools', () => {
    for (const toolName of ['create_issue', 'merge_pull_request', 'mystery_tool']) {
      const out = validatePickerToolRequest({ ...baseInput, toolName });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(403);
    }
  });

  it('returns 400 when args is not a plain object', () => {
    for (const args of ['str', 42, null, ['a'], undefined]) {
      const out = validatePickerToolRequest({ ...baseInput, args });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(400);
    }
  });

  it('returns 413 when args exceeds size cap', () => {
    const out = validatePickerToolRequest({
      ...baseInput,
      argByteLength: PICKER_ARG_BYTES_CAP + 1,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(413);
  });

  it('returns 404 (not 403) when serverConfig is not kind:github (probe-resistant)', () => {
    const out = validatePickerToolRequest({ ...baseInput, serverConfig: genericServer });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(404);
  });

  it('returns 404 when serverConfig is undefined', () => {
    const out = validatePickerToolRequest({ ...baseInput, serverConfig: undefined });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(404);
  });
});

describe('validatePickerToolRequest — happy path', () => {
  it('returns ok with the resolved server config', () => {
    const out = validatePickerToolRequest(baseInput);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.serverConfig).toBe(githubServer);
  });

  it('accepts each allowlisted tool', () => {
    for (const toolName of [
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
    ]) {
      const out = validatePickerToolRequest({ ...baseInput, toolName });
      expect(out.ok).toBe(true);
    }
  });
});
