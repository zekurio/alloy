import type { ClipFeedSort, FeedFilter } from "@alloy/api"
import type { QueryClient } from "@tanstack/react-query"

import { DEFAULT_CLIP_SORT, parseClipSort } from "./clip-sort"
import { feedChipsQueryOptions, feedInfiniteQueryOptions } from "./feed-queries"
import { searchString } from "./route-search"

export type HomeSearch = {
  sort?: ClipFeedSort
  game?: string
}

interface HomeSearchInput {
  sort?: unknown
  game?: unknown
}

export function parseHomeSearch(search: HomeSearchInput): HomeSearch {
  const sort = parseClipSort(search.sort)
  const game = searchString(search.game)
  const parsed: HomeSearch = {}
  if (sort) parsed.sort = sort
  if (game) parsed.game = game
  return parsed
}

export function homeFeedFilter(search: HomeSearch): FeedFilter {
  if (search.game) return { kind: "game", gameId: search.game }
  return { kind: "all" }
}

/** Starts loading the home feed for a route that shows it. */
export function prefetchHomeFeed(queryClient: QueryClient, search: HomeSearch) {
  void queryClient.prefetchQuery(feedChipsQueryOptions())
  void queryClient.prefetchInfiniteQuery(
    feedInfiniteQueryOptions(
      homeFeedFilter(search),
      search.sort ?? DEFAULT_CLIP_SORT,
    ),
  )
}
