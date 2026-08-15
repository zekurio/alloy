import type { ClipListSort } from "@alloy/api"

import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["top", "recent"] as const

export type TagSearch = {
  sort?: ClipListSort
  /** Game surrogate id to narrow the tag results to a single game. */
  game?: string
}

interface TagSearchInput {
  sort?: unknown
  game?: unknown
}

export function parseTagSearch(search: TagSearchInput): TagSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const game = searchString(search.game)
  const parsed: TagSearch = {}
  if (sort) parsed.sort = sort
  if (game) parsed.game = game
  return parsed
}

/** Resolve the effective filters, applying the page defaults. */
export function tagFilters(search: TagSearch) {
  const sort: ClipListSort = search.sort ?? "top"
  return search.game ? { sort, gameId: search.game } : { sort }
}
