import { MEDIA_FILTERS, type MediaFilter } from "@alloy/contracts"

export type LibrarySort = "recent" | "oldest"

export type LibrarySource = "all" | "server" | "local"

export type LibrarySearch = {
  sort?: LibrarySort
  source?: Exclude<LibrarySource, "all">
  /** The default (clips only) stays out of the URL. */
  media?: Exclude<MediaFilter, "video">
}

interface LibrarySearchInput {
  sort?: unknown
  source?: unknown
  media?: unknown
}

export function parseLibrarySearch(search: LibrarySearchInput): LibrarySearch {
  const parsed: LibrarySearch = {}
  // The defaults (newest first, all sources, clips only) stay out of the URL.
  if (search.sort === "oldest") parsed.sort = "oldest"
  if (search.source === "server" || search.source === "local") {
    parsed.source = search.source
  }
  const media = MEDIA_FILTERS.find((value) => value === search.media)
  if (media && media !== "video") parsed.media = media
  return parsed
}

export function librarySort(search: LibrarySearch): LibrarySort {
  return search.sort ?? "recent"
}

export function librarySource(search: LibrarySearch): LibrarySource {
  return search.source ?? "all"
}

export function libraryMedia(search: LibrarySearch): MediaFilter {
  return search.media ?? "video"
}
