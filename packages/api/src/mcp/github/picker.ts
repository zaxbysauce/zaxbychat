/**
 * Phase 7 PR 7.2 — picker-call request validation (D-P7-9 lock).
 *
 * Pure-function gate logic for the
 * `POST /api/mcp/:serverName/tools/:toolName/call` endpoint. The
 * Express controller calls `validatePickerToolRequest` to decide
 * whether to proceed; this lets the four hard-gates be unit-tested
 * without a server harness.
 *
 * The validator deliberately returns *status codes*, not Errors: the
 * controller maps them to HTTP responses. Status semantics follow
 * the migration-notes "GitHub-only behavior even with a generic
 * path" rule — non-`kind:'github'` configs collapse to 404 (not 403)
 * so a probe cannot distinguish "wrong server" from "wrong tool".
 */

import type { MCPOptions } from 'librechat-data-provider';
import { isGithubMcpServer } from './identity';
import { isGithubMcpAllowedTool } from './scope';

export const PICKER_TOOL_TIMEOUT_MS = 5000;
export const PICKER_ARG_BYTES_CAP = 8 * 1024;

export type PickerValidationOk = {
  ok: true;
  serverConfig: MCPOptions;
};

export type PickerValidationError = {
  ok: false;
  status: 401 | 400 | 403 | 404 | 413;
  message: string;
};

export interface PickerValidationInput {
  flagEnabled: boolean;
  userId: string | undefined;
  serverName: string | undefined;
  toolName: string | undefined;
  args: unknown;
  serverConfig: MCPOptions | undefined;
  argByteLength: number;
}

export function validatePickerToolRequest(
  input: PickerValidationInput,
): PickerValidationOk | PickerValidationError {
  if (!input.flagEnabled) {
    return { ok: false, status: 404, message: 'Not found' };
  }
  if (!input.userId) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }
  if (typeof input.serverName !== 'string' || typeof input.toolName !== 'string') {
    return { ok: false, status: 400, message: 'Invalid serverName or toolName' };
  }
  if (!isGithubMcpAllowedTool(input.toolName)) {
    return { ok: false, status: 403, message: 'Tool not allowed' };
  }
  if (
    typeof input.args !== 'object' ||
    input.args === null ||
    Array.isArray(input.args)
  ) {
    return { ok: false, status: 400, message: 'args must be an object' };
  }
  if (input.argByteLength > PICKER_ARG_BYTES_CAP) {
    return { ok: false, status: 413, message: 'args exceeds size cap' };
  }
  if (!isGithubMcpServer(input.serverConfig)) {
    return { ok: false, status: 404, message: 'Not found' };
  }
  return { ok: true, serverConfig: input.serverConfig };
}
