import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query"

import { api } from "./api"
import type { ClipRow } from "./clips-api"
import type { GameListRow } from "./games-api"
import { readJsonOrThrow } from "./http-error"

export interface UserListRow {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
  /** Count of visible (`ready` + public/unlisted) clips this user owns. */
  clipCount: number
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}

export async function fetchSearch(
  query: string,
  limit = 8
): Promise<SearchResults> {
  const res = await api.api.search.$get({
    query: { q: query, limit: String(limit) },
  })
  return readJsonOrThrow<SearchResults>(res)
}

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
    queryFn: () => fetchSearch(trimmed, limit),
    enabled: enabled && trimmed.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}
