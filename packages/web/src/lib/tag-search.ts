import type { ClipFeedSort, ClipFeedWindow } from "@alloy/api"

import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["top", "recent"] as const
const WINDOW_KEYS = ["today", "week", "month", "year", "all"] as const

export type TagSearch = {
  sort?: ClipFeedSort
  window?: ClipFeedWindow
  /** steamgriddbId (as a string) to narrow the tag results to a game. */
  game?: string
}

export function parseTagSearch(search: Record<string, unknown>): TagSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const window = searchEnum(search.window, WINDOW_KEYS)
  const game = searchString(search.game)
  return {
    ...(sort ? { sort } : {}),
    ...(window ? { window } : {}),
    ...(game ? { game } : {}),
  }
}

/** Resolve the effective filters, applying the page defaults. */
export function tagFilters(search: TagSearch): {
  sort: ClipFeedSort
  window: ClipFeedWindow
  steamgriddbId?: number
} {
  const steamgriddbId = search.game
    ? Number.parseInt(search.game, 10)
    : Number.NaN
  return {
    sort: search.sort ?? "top",
    window: search.window ?? "all",
    steamgriddbId:
      Number.isSafeInteger(steamgriddbId) && steamgriddbId > 0
        ? steamgriddbId
        : undefined,
  }
}
