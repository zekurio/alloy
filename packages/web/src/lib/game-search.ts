import type { ClipFeedSort } from "@alloy/api"

import { DEFAULT_CLIP_SORT, parseClipSort } from "./clip-sort"

export type GameSearch = {
  sort?: ClipFeedSort
  /** Narrow the game's feed to a single creator (user id). */
  creator?: string
}

export function parseGameSearch(search: Record<string, unknown>): GameSearch {
  const sort = parseClipSort(search.sort)
  const creator =
    typeof search.creator === "string" && search.creator.length > 0
      ? search.creator
      : undefined
  return {
    ...(sort ? { sort } : {}),
    ...(creator ? { creator } : {}),
  }
}

export function gameClipsSort(search: GameSearch): ClipFeedSort {
  return search.sort ?? DEFAULT_CLIP_SORT
}
