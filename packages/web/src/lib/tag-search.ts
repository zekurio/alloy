import type { ClipFeedSort } from "@alloy/api"

import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["top", "recent"] as const

export type TagSearch = {
  sort?: ClipFeedSort
  /** steamgriddbId (as a string) to narrow the tag results to a game. */
  game?: string
}

export function parseTagSearch(search: Record<string, unknown>): TagSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const game = searchString(search.game)
  return {
    ...(sort ? { sort } : {}),
    ...(game ? { game } : {}),
  }
}

/** Resolve the effective filters, applying the page defaults. */
export function tagFilters(search: TagSearch): {
  sort: ClipFeedSort
  steamgriddbId?: number
} {
  const steamgriddbId = search.game
    ? Number.parseInt(search.game, 10)
    : Number.NaN
  return {
    sort: search.sort ?? "top",
    steamgriddbId:
      Number.isSafeInteger(steamgriddbId) && steamgriddbId > 0
        ? steamgriddbId
        : undefined,
  }
}
