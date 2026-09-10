import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Paginated } from '@/types/api';

type Params = Record<string, string | number | undefined>;

/** Shared hook for a server-paginated list endpoint driven by `useDataGrid`. */
export function useListQuery<T>(key: string, path: string, params: Params) {
  return useQuery({
    queryKey: [key, params],
    queryFn: ({ signal }) => api.get<Paginated<T>>(path, params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useResourceQuery<T>(key: string, path: string, enabled = true) {
  return useQuery({
    queryKey: [key, path],
    queryFn: ({ signal }) => api.get<{ data: T }>(path, undefined, signal).then((r) => r.data),
    enabled,
  });
}
