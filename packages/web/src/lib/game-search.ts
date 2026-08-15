import type { ClipFeedSort } from "@alloy/api"

import { DEFAULT_CLIP_SORT, parseClipSort } from "./clip-sort"
import { searchString } from "./route-search"

export type GameSearch = {
  sort?: ClipFeedSort
  /** Narrow the game's feed to a single creator (user id). */
  creator?: string
}

interface GameSearchInput {
  sort?: unknown
  creator?: unknown
}

export function parseGameSearch(search: GameSearchInput): GameSearch {
  const sort = parseClipSort(search.sort)
  const creator = searchString(search.creator)
  const parsed: GameSearch = {}
  if (sort) parsed.sort = sort
  if (creator) parsed.creator = creator
  return parsed
}

export function gameClipsSort(search: GameSearch): ClipFeedSort {
  return search.sort ?? DEFAULT_CLIP_SORT
}
