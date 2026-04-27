import { useQuery, UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

/**
 * Phase 9 — list DB-backed custom AI endpoints visible to the user.
 * The chat composer's endpoint dropdown re-renders when this query
 * invalidates (we also invalidate `[QueryKeys.endpoints]` on mutation).
 */
export const useCustomEndpointsQuery = <TData = t.TCustomEndpointsListResponse>(
  config?: UseQueryOptions<t.TCustomEndpointsListResponse, unknown, TData>,
): QueryObserverResult<TData> => {
  return useQuery<t.TCustomEndpointsListResponse, unknown, TData>(
    [QueryKeys.customEndpoints],
    () => dataService.listCustomEndpoints(),
    {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: true,
      retry: false,
      ...config,
    },
  );
};
