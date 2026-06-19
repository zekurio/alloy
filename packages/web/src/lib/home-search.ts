import type { ClipFeedSort } from "@alloy/api"

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
