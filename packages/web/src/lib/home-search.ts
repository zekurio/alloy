import type { ClipFeedSort, FeedFilter } from "@alloy/api"

import { parseClipSort } from "./clip-sort"
import { searchString } from "./route-search"

export type HomeSearch = {
  sort?: ClipFeedSort
  feed?: "following"
  game?: string
}

interface HomeSearchInput {
  sort?: unknown
  feed?: unknown
  game?: unknown
}

export function parseHomeSearch(search: HomeSearchInput): HomeSearch {
  const sort =
    search.feed === "recommended" ? "recommended" : parseClipSort(search.sort)
  const game = searchString(search.game)
  const parsed: HomeSearch = {}
  if (sort) parsed.sort = sort
  if (search.feed === "following") parsed.feed = search.feed
  if (game) parsed.game = game
  return parsed
}

export function homeFeedFilter(search: HomeSearch): FeedFilter {
  if (search.game) return { kind: "game", gameId: search.game }
  if (search.feed === "following") return { kind: "following" }
  return { kind: "all" }
}
