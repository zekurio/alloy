export type LibrarySort = "recent" | "oldest"

export type LibrarySource = "all" | "server" | "local"

export type LibrarySearch = {
  sort?: LibrarySort
  source?: Exclude<LibrarySource, "all">
}

export function parseLibrarySearch(
  search: Record<string, unknown>,
): LibrarySearch {
  const parsed: LibrarySearch = {}
  // The defaults (newest first, all sources) stay out of the URL.
  if (search.sort === "oldest") parsed.sort = "oldest"
  if (search.source === "server" || search.source === "local") {
    parsed.source = search.source
  }
  return parsed
}

export function librarySort(search: LibrarySearch): LibrarySort {
  return search.sort ?? "recent"
}

export function librarySource(search: LibrarySearch): LibrarySource {
  return search.source ?? "all"
}
