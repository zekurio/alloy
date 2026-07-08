export type LibrarySort = "recent" | "oldest"

export type LibrarySearch = {
  sort?: LibrarySort
}

export function parseLibrarySearch(
  search: Record<string, unknown>,
): LibrarySearch {
  // The default (newest first) stays out of the URL.
  return search.sort === "oldest" ? { sort: "oldest" } : {}
}

export function librarySort(search: LibrarySearch): LibrarySort {
  return search.sort ?? "recent"
}
