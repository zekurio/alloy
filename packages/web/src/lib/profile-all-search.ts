import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const

export type ProfileAllSort = (typeof SORT_KEYS)[number]

type ProfileAllSearch = {
  sort?: ProfileAllSort
  game?: string
}

interface ProfileAllSearchInput {
  sort?: unknown
  game?: unknown
}

export function profileAllSearchFor(
  sort: ProfileAllSort,
  gameSlug: string | null,
): ProfileAllSearch {
  const search: ProfileAllSearch = {}
  if (sort !== "recent") search.sort = sort
  if (gameSlug) search.game = gameSlug
  return search
}

export function parseProfileAllSearch(
  search: ProfileAllSearchInput,
): ProfileAllSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const game = searchString(search.game)
  const parsed: ProfileAllSearch = {}
  if (sort) parsed.sort = sort
  if (game) parsed.game = game
  return parsed
}
