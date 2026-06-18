import type { ClipFeedSort } from "@alloy/api"

import { parseClipSort } from "./clip-sort"
import { searchString } from "./route-search"

export type HomeSearch = {
  sort?: ClipFeedSort
  feed?: "following" | "recommended"
  game?: string
}

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const sort = parseClipSort(search.sort)
  const game = searchString(search.game)
  return {
    ...(sort ? { sort } : {}),
    ...(search.feed === "following" || search.feed === "recommended"
      ? { feed: search.feed }
      : {}),
    ...(game ? { game } : {}),
  }
}
