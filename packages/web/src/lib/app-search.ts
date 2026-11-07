import { searchFlag, searchString } from "./route-search"

export interface AppSearch {
  clip?: string
  settings?: string
  /** Open the profile setup prompt, set after sign-up. */
  welcome?: true
}

interface AppSearchInput {
  clip?: unknown
  settings?: unknown
  welcome?: unknown
}

export function parseAppSearch(search: AppSearchInput): AppSearch {
  const clip = searchString(search.clip)
  const settings = searchString(search.settings)
  const parsed: AppSearch = {}
  if (clip) parsed.clip = clip
  if (settings) parsed.settings = settings
  if (searchFlag(search.welcome)) {
    parsed.welcome = true
  }
  return parsed
}
