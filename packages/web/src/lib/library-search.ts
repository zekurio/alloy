import { MEDIA_FILTERS, type MediaFilter } from "@alloy/contracts"

export type LibrarySort = "recent" | "oldest"

export type LibrarySource = "all" | "server" | "local"

export type LibrarySearch = {
  sort?: LibrarySort
  source?: Exclude<LibrarySource, "all">
  /** The default (clips only) stays out of the URL. */
  media?: Exclude<MediaFilter, "video">
}

export function parseLibrarySearch(
  search: Record<string, unknown>,
): LibrarySearch {
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

/** The URL form of a filter set, with the defaults left out. */
export function toLibrarySearch({
  sort,
  source,
  media,
}: {
  sort: LibrarySort
  source: LibrarySource
  media: MediaFilter
}): LibrarySearch {
  const search: LibrarySearch = {}
  if (sort !== "recent") search.sort = sort
  if (source !== "all") search.source = source
  if (media !== "video") search.media = media
  return search
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
