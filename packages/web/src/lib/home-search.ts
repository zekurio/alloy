import type { ClipFeedSort, FeedFilter } from "@alloy/api"

import { parseClipSort } from "./clip-sort"
import { searchString } from "./route-search"

export type HomeSearch = {
  sort?: ClipFeedSort
  feed?: "following"
  game?: string
}

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const sort =
    search.feed === "recommended" ? "recommended" : parseClipSort(search.sort)
  const game = searchString(search.game)
  return {
    ...(sort ? { sort } : {}),
    ...(search.feed === "following" ? { feed: search.feed } : {}),
    ...(game ? { game } : {}),
  }
}

export function homeFeedFilter(search: HomeSearch): FeedFilter {
  if (search.game) return { kind: "game", gameId: search.game }
  if (search.feed === "following") return { kind: "following" }
  return { kind: "all" }
}
