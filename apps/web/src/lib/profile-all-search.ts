import { searchEnum, searchString } from "./route-search"

const SORT_KEYS = ["recent", "oldest", "top", "views"] as const

export type ProfileAllSort = (typeof SORT_KEYS)[number]

type ProfileAllSearch = {
  sort?: ProfileAllSort
  game?: string
}

export function profileAllSearchFor(
  sort: ProfileAllSort,
  gameSlug: string | null
): ProfileAllSearch {
  return {
    ...(sort !== "recent" ? { sort } : {}),
    ...(gameSlug ? { game: gameSlug } : {}),
  }
}

export function parseProfileAllSearch(
  search: Record<string, unknown>
): ProfileAllSearch {
  const sort = searchEnum(search.sort, SORT_KEYS)
  const game = searchString(search.game)
  return {
    ...(sort ? { sort } : {}),
    ...(game ? { game } : {}),
  }
}
