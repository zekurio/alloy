import type { ClipFeedSort, FeedFilter, FeedPageParams } from "@alloy/api"
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"

import { api } from "./api"

function filterKey(filter: FeedFilter): readonly unknown[] {
  if (filter.kind === "game") return ["game", filter.gameId] as const
  return [filter.kind] as const
}

export const feedKeys = {
  all: ["feed"] as const,
  chips: () => [...feedKeys.all, "chips"] as const,
  list: (filter: FeedFilter, sort: ClipFeedSort, limit: number) =>
    [...feedKeys.all, "list", ...filterKey(filter), { sort, limit }] as const,
}

export function useFeedInfiniteQuery(
  filter: FeedFilter,
  sort: ClipFeedSort,
  { limit = 20 }: { limit?: number } = {},
) {
  return useInfiniteQuery({
    queryKey: feedKeys.list(filter, sort, limit),
    queryFn: ({ pageParam }) =>
      api.feed.fetch({
        filter,
        sort,
        limit,
        cursor: pageParam,
      } satisfies FeedPageParams),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useFeedChipsQuery() {
  return useQuery({
    queryKey: feedKeys.chips(),
    queryFn: () => api.feed.fetchChips(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
