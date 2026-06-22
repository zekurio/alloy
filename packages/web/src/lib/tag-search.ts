import type { ClipListSort } from "@alloy/api"

import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["top", "recent"] as const

export type TagSearch = {
  sort?: ClipListSort
  /** Game surrogate id to narrow the tag results to a single game. */
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
  sort: ClipListSort
  gameId?: string
} {
  return {
    sort: search.sort ?? "top",
    ...(search.game ? { gameId: search.game } : {}),
  }
}
