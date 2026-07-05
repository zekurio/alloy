import { searchString } from "./route-search"

export interface AppSearch {
  clip?: string
  comment?: string
  settings?: string
  welcome?: string
}

export function parseAppSearch(search: Record<string, unknown>): AppSearch {
  const clip = searchString(search.clip)
  const comment = searchString(search.comment)
  const settings = searchString(search.settings)
  const welcome = searchString(search.welcome)
  return {
    ...(clip ? { clip } : {}),
    ...(comment ? { comment } : {}),
    ...(settings ? { settings } : {}),
    ...(welcome ? { welcome } : {}),
  }
}
