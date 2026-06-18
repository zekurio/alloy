import type { ClipFeedSort } from "@alloy/api"

import { DEFAULT_CLIP_SORT, parseClipSort } from "./clip-sort"

export type GameSearch = {
  sort?: ClipFeedSort
}

export function parseGameSearch(search: Record<string, unknown>): GameSearch {
  const sort = parseClipSort(search.sort)
  return sort ? { sort } : {}
}

export function gameClipsSort(search: GameSearch): ClipFeedSort {
  return search.sort ?? DEFAULT_CLIP_SORT
}
