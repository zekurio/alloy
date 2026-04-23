import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"

import type { SearchResults, UserListRow } from "@workspace/api"

import { api } from "./api"

export const searchKeys = {
  all: ["search"] as const,
  query: (q: string, limit: number) =>
    [...searchKeys.all, { q, limit }] as const,
}

export function useSearchQuery(
  query: string,
  { enabled = true, limit = 8 }: { enabled?: boolean; limit?: number } = {}
): UseQueryResult<SearchResults> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: searchKeys.query(trimmed, limit),
    queryFn: () => api.search.fetch(trimmed, limit),
    enabled: enabled && trimmed.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

export type { SearchResults, UserListRow }
