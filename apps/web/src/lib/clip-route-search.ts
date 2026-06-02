import { searchString } from "./route-search"

interface ClipRouteSearch {
  comment?: string
}

export function parseClipRouteSearch(
  search: Record<string, unknown>
): ClipRouteSearch {
  const comment = searchString(search.comment)
  return comment ? { comment } : {}
}
