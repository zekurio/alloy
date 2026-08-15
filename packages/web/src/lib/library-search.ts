export type LibrarySort = "recent" | "oldest"

export type LibrarySource = "all" | "server" | "local"

export type LibrarySearch = {
  sort?: LibrarySort
  source?: Exclude<LibrarySource, "all">
}

interface LibrarySearchInput {
  sort?: unknown
  source?: unknown
}

export function parseLibrarySearch(search: LibrarySearchInput): LibrarySearch {
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
