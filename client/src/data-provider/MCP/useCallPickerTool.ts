import { useMutation } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';

export interface CallPickerToolArgs {
  serverName: string;
  toolName: string;
  args?: Record<string, unknown>;
}

/**
 * Phase 7 PR 7.2 — picker-side mutation hook for the hard-gated
 * `POST /api/mcp/:serverName/tools/:toolName/call` endpoint.
 *
 * The server enforces:
 *   - `GITHUB_MCP_FIRST_CLASS=true`
 *   - resolved server has `kind: 'github'`
 *   - `toolName` is in the picker allowlist
 *   - 8KB args size cap
 *   - 5s hard timeout
 *
 * Caller surfaces failures via the standard React Query `error`
 * channel; no client-side retry (the picker UI prefers a single fast
 * attempt and a clear error message over a slow retry).
 */
export const useCallPickerTool = () => {
  return useMutation({
    mutationFn: async ({ serverName, toolName, args }: CallPickerToolArgs) =>
      dataService.callMcpPickerTool(serverName, toolName, args ?? {}),
    retry: false,
  });
};
