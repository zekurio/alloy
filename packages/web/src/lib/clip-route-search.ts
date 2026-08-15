import { searchString } from "./route-search"

interface ClipRouteSearch {
  comment?: string
}

interface ClipRouteSearchInput {
  comment?: unknown
}

export function parseClipRouteSearch(
  search: ClipRouteSearchInput,
): ClipRouteSearch {
  const comment = searchString(search.comment)
  return comment ? { comment } : {}
}
