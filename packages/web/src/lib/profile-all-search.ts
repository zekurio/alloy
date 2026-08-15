import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const

export type ProfileClipSort = (typeof SORT_KEYS)[number]

export type ProfileClipSearch = {
  sort?: ProfileClipSort
  game?: string
}

interface ProfileClipSearchInput {
  sort?: unknown
  game?: unknown
}

export function profileClipSearchFor(
  sort: ProfileClipSort,
  gameSlug: string | null,
): ProfileClipSearch {
  const search: ProfileClipSearch = {}
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
  if (sort) parsed.sort = sort
  if (game) parsed.game = game
  return parsed
}
