import type { ClipListSort, TagClipsParams } from "@alloy/api"
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"

import { api } from "./api"

type TagClipsFilters = {
  sort: ClipListSort
  gameId?: string
}

export const tagKeys = {
  all: ["tags"] as const,
  games: (tag: string) => [...tagKeys.all, "games", tag] as const,
  summary: (tag: string) => [...tagKeys.all, "summary", tag] as const,
  search: (query: string) => [...tagKeys.all, "search", query] as const,
  clips: (tag: string, filters: TagClipsFilters) =>
    [...tagKeys.all, "clips", tag, filters] as const,
}

const TAG_PAGE_LIMIT = 24

export function useTagClipsInfiniteQuery(
  tag: string,
  filters: TagClipsFilters,
) {
  return useInfiniteQuery({
    queryKey: tagKeys.clips(tag, filters),
    queryFn: ({ pageParam }) =>
      api.tags.fetchClipPage(tag, {
        sort: filters.sort,
        gameId: filters.gameId,
        limit: TAG_PAGE_LIMIT,
        cursor: pageParam,
      } satisfies TagClipsParams),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: tag.length > 0,
  })
}

export function useTagGamesQuery(tag: string) {
  return useQuery({
    queryKey: tagKeys.games(tag),
    queryFn: () => api.tags.fetchGames(tag),
    enabled: tag.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useTagSummaryQuery(tag: string) {
  return useQuery({
    queryKey: tagKeys.summary(tag),
    queryFn: () => api.tags.fetchSummary(tag),
    enabled: tag.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

/**
 * Prefix autocomplete for the hashtag editor. Pass an already-debounced query;
 * the query is disabled while empty and keeps the previous suggestions visible
 * between keystrokes so the list doesn't flash.
 */
export function useTagSearchQuery(query: string) {
  return useQuery({
    queryKey: tagKeys.search(query),
    queryFn: () => api.tags.search(query),
    enabled: query.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
}
