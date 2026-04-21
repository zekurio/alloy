import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { followGame, unfollowGame } from "./games-api"
import {
  fetchFeed,
  fetchFeedChips,
  type FeedFilter,
  type FeedPageParams,
} from "./feed-api"

function filterKey(filter: FeedFilter): readonly unknown[] {
  if (filter.kind === "game") return ["game", filter.gameId] as const
  return [filter.kind] as const
}

export const feedKeys = {
  all: ["feed"] as const,
  chips: () => [...feedKeys.all, "chips"] as const,
  list: (filter: FeedFilter, limit: number) =>
    [...feedKeys.all, "list", ...filterKey(filter), { limit }] as const,
}

export function useFeedInfiniteQuery(
  filter: FeedFilter,
  { limit = 20 }: { limit?: number } = {}
) {
  return useInfiniteQuery({
    queryKey: feedKeys.list(filter, limit),
    queryFn: ({ pageParam }) =>
      fetchFeed({ filter, limit, offset: pageParam } satisfies FeedPageParams),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, lastPageParam) => {
      if (last.length < limit) return undefined
      return (lastPageParam as number) + last.length
    },
  })
}

export function useFeedChipsQuery() {
  return useQuery({
    queryKey: feedKeys.chips(),
    queryFn: fetchFeedChips,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useToggleGameFollowMutation() {
  const qc = useQueryClient()

  return useMutation<
    { following: boolean },
    Error,
    { slug: string; next: boolean }
  >({
    mutationFn: ({ slug, next }) =>
      next ? followGame(slug) : unfollowGame(slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedKeys.all })
    },
  })
}
