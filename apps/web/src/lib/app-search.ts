import { searchString } from "./route-search"

export interface AppSearch {
  clip?: string
  comment?: string
}

export function parseAppSearch(search: Record<string, unknown>): AppSearch {
  const clip = searchString(search.clip)
  const comment = searchString(search.comment)
  return {
    ...(clip ? { clip } : {}),
    ...(comment ? { comment } : {}),
  }
}
