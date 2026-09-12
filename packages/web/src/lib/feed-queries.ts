import type { ClipFeedSort, FeedFilter, FeedPageParams } from "@alloy/api"
import type { MediaFilter } from "@alloy/contracts"
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"

import { api } from "./api"

function filterKey(filter: FeedFilter): readonly unknown[] {
  const media = filter.media ?? "video"
  if (filter.kind !== "game") return [filter.kind, media] as const
  if (filter.authorId) {
    return ["game", filter.gameId, filter.authorId, media] as const
  }
  return ["game", filter.gameId, media] as const
}

/**
 * Stable string identity for a feed filter — derived from the query key so
 * cache keys and UI ids (toasts, list keys) can never disagree about what
 * distinguishes two filters.
 */
export function feedFilterId(filter: FeedFilter): string {
  return filterKey(filter).join(":")
}

export const feedKeys = {
  all: ["feed"] as const,
  chips: () => [...feedKeys.all, "chips"] as const,
  list: (filter: FeedFilter, sort: ClipFeedSort, limit: number) =>
    [...feedKeys.all, "list", ...filterKey(filter), { sort, limit }] as const,
}

export function feedInfiniteQueryOptions(
  filter: FeedFilter,
  sort: ClipFeedSort,
  { limit = 20 }: { limit?: number } = {},
) {
  return infiniteQueryOptions({
    queryKey: feedKeys.list(filter, sort, limit),
    queryFn: ({ pageParam }) =>
      api.feed.fetch({
        filter,
        sort,
        limit,
        cursor: pageParam,
      } satisfies FeedPageParams),
    // SAFETY: The API cursor domain is string or null; null is its first page.
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export function useFeedInfiniteQuery(
  filter: FeedFilter,
  sort: ClipFeedSort,
  { limit = 20 }: { limit?: number } = {},
) {
  return useInfiniteQuery(feedInfiniteQueryOptions(filter, sort, { limit }))
}

export function feedChipsQueryOptions(media: MediaFilter = "video") {
  return queryOptions({
    queryKey: [...feedKeys.chips(), media],
    queryFn: () => api.feed.fetchChips(media),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useFeedChipsQuery(media: MediaFilter = "video") {
  return useQuery(feedChipsQueryOptions(media))
}

export function recommendedClipsQueryOptions(
  clipId: string,
  viewerId: string | null,
) {
  return queryOptions({
    queryKey: [...feedKeys.all, "recommendations", clipId, viewerId],
    queryFn: () =>
      api.feed.fetch({
        filter: { kind: "all", media: "video" },
        sort: "recommended",
        excludeClipId: clipId,
        limit: 8,
      }),
    staleTime: 30_000,
  })
}
