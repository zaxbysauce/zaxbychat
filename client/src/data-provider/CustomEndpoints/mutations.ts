import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

/**
 * Phase 9 — Create / update / delete mutations.
 *
 * On success, all three invalidate the customEndpoints list AND the
 * top-level endpoints query so the chat composer's model dropdown
 * picks up the change without a hard reload.
 */

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries([QueryKeys.customEndpoints]);
  queryClient.invalidateQueries([QueryKeys.endpoints]);
  queryClient.invalidateQueries([QueryKeys.models]);
}

export const useCreateCustomEndpointMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<t.TCustomEndpointResponse, unknown, t.TCustomEndpointCreateParams>({
    mutationFn: (data) => dataService.createCustomEndpoint(data),
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useUpdateCustomEndpointMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<
    t.TCustomEndpointResponse,
    unknown,
    { name: string; params: t.TCustomEndpointUpdateParams }
  >({
    mutationFn: ({ name, params }) => dataService.updateCustomEndpoint(name, params),
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useDeleteCustomEndpointMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, unknown, string>({
    mutationFn: (name) => dataService.deleteCustomEndpoint(name),
    onSuccess: () => invalidateAll(queryClient),
  });
};

export const useTestCustomEndpointMutation = () => {
  return useMutation<t.TTestCustomEndpointResponse, unknown, t.TTestCustomEndpointParams>({
    mutationFn: (data) => dataService.testCustomEndpoint(data),
    retry: false,
  });
};
