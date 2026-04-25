import { useMutation } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';

export interface CallPickerToolArgs {
  serverName: string;
  toolName: string;
  args?: Record<string, unknown>;
}

/**
 * Picker-side mutation hook for the hard-gated
 * `POST /api/mcp/:serverName/tools/:toolName/call` endpoint.
 *
 * The server enforces:
 *   - resolved server has `kind: 'github'` (404 otherwise)
 *   - `toolName` is in the picker allowlist (403 otherwise)
 *   - 8KB args size cap (413 otherwise)
 *   - 5s hard timeout (504 otherwise)
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
