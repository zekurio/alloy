import { MEDIA_FILTERS, type MediaFilter } from "@alloy/contracts"

import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const

export type ProfileClipSort = (typeof SORT_KEYS)[number]

export type ProfileClipSearch = {
  media?: MediaFilter
  sort?: ProfileClipSort
  game?: string
}

interface ProfileClipSearchInput {
  media?: unknown
  sort?: unknown
  game?: unknown
}

export function profileClipSearchFor(
  sort: ProfileClipSort,
  gameSlug: string | null,
  media?: MediaFilter,
): ProfileClipSearch {
  const search: ProfileClipSearch = {}
  if (media) search.media = media
  if (sort !== "recent") search.sort = sort
  if (gameSlug) search.game = gameSlug
  return search
}

export function parseProfileClipSearch(
  search: ProfileClipSearchInput,
): ProfileClipSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const game = searchString(search.game)
  const parsed: ProfileClipSearch = {}
  const media = MEDIA_FILTERS.find((value) => value === search.media)
  if (media) parsed.media = media
  if (sort) parsed.sort = sort
  if (game) parsed.game = game
  return parsed
}
