import { searchString } from "./route-search"

export interface AppSearch {
  clip?: string
  comment?: string
  settings?: string
  welcome?: string
}

interface AppSearchInput {
  clip?: unknown
  comment?: unknown
  settings?: unknown
  welcome?: unknown
}

export function parseAppSearch(search: AppSearchInput): AppSearch {
  const clip = searchString(search.clip)
  const comment = searchString(search.comment)
  const settings = searchString(search.settings)
  const welcome = searchString(search.welcome)
  const parsed: AppSearch = {}
  if (clip) parsed.clip = clip
  if (comment) parsed.comment = comment
  if (settings) parsed.settings = settings
  if (welcome) parsed.welcome = welcome
  return parsed
}
