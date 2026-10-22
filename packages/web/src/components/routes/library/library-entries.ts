import { type ClipRow, type GameNameLookupResult } from "@alloy/api"
import type { MediaFilter } from "@alloy/contracts"

import { compareLibraryItemNewestFirst } from "@/components/clip/use-local-clip-playback"
import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@/lib/desktop"
import type { LibrarySort, LibrarySource } from "@/lib/library-search"

import {
  gameNameKey,
  enrichLibraryItem,
  type LibraryGroupView,
  type LibraryItemView,
} from "./library-data"

/** One row of the combined grid: a local capture or an uploaded clip. */
export type LibraryEntry =
  | {
      type: "local"
      key: string
      /** When the entry sorts into the grid; see `clipListedAt`. */
      listedAt: string
      status: "local"
      item: LibraryItemView
    }
  | {
      type: "cloud"
      key: string
      listedAt: string
      status: "cloud" | "synced"
      row: ClipRow
      /**
       * Every on-disk capture linked to this clip (uploaded from /
       * downloaded), newest first.
       */
      localItems: RecordingLibraryItem[]
      /** The newest linked capture, standing in for the clip's local copy. */
      localItem: RecordingLibraryItem | null
    }

function filterLibraryItems(
  items: RecordingLibraryItem[],
  filters: {
    localKeys: string[] | null
    media: MediaFilter
    query: string
  },
): RecordingLibraryItem[] {
  const query = filters.query.trim().toLowerCase()
  const localKeys = filters.localKeys ? new Set(filters.localKeys) : null
  // Local captures call videos "replay" and images "screenshot".
  const captureKind =
    filters.media === "video"
      ? "replay"
      : filters.media === "image"
        ? "screenshot"
        : null
  return items.filter((item) => {
    if (localKeys && !localKeys.has(item.groupKey)) return false
    if (captureKind && item.kind !== captureKind) return false
    if (!query) return true
    return [item.title, item.groupLabel, item.fileName]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

function filterUploadedClips(
  rows: ClipRow[],
  rawQuery: string,
  active: LibraryGroupView | null,
  media: MediaFilter,
): ClipRow[] {
  const query = rawQuery.trim().toLowerCase()
  return rows.filter((row) => {
    if (media !== "all" && row.mediaKind !== media) return false
    if (active) {
      const gameName = row.gameRef?.name ?? row.game
      if (active.kind === "no-game") {
        if (gameName) return false
      } else if (active.nameKey !== gameNameKey(gameName ?? "")) {
        return false
      }
    }
    if (!query) return true
    return [
      row.title,
      row.gameRef?.name ?? row.game ?? "",
      row.description ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

/** The server's listing time, so merged entries keep its page order. */
function clipListedAt(row: ClipRow): string {
  return row.publishedAt ?? row.createdAt
}

function libraryServerIdForItem(item: RecordingLibraryItem): string | null {
  return item.uploadedClipId
}

export function collapsedServerCounts(
  items: RecordingLibraryItem[],
  serverIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const serverId = libraryServerIdForItem(item)
    if (serverId && serverIds.has(serverId)) {
      counts.set(item.groupKey, (counts.get(item.groupKey) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Whether the upload pages loaded so far place a capture. Until every page is
 * in, a capture past the last loaded clip could belong after clips not
 * fetched yet, and one linked to an unloaded clip can't be told apart from an
 * unsynced capture. Both wait for more pages.
 */
export function isPlacedByLoadedUploads(
  item: RecordingLibraryItem,
  uploaded: ClipRow[],
  uploadedComplete: boolean,
  sort: LibrarySort,
): boolean {
  const lastLoaded = uploadedComplete ? undefined : uploaded.at(-1)
  if (!lastLoaded) return true
  const serverId = libraryServerIdForItem(item)
  if (serverId) return uploaded.some((row) => row.id === serverId)
  const direction = sort === "oldest" ? 1 : -1
  const boundary = Date.parse(clipListedAt(lastLoaded))
  return (Date.parse(item.createdAt) - boundary) * direction <= 0
}

export function buildLibraryEntries({
  snapshot,
  gamesByName,
  uploaded,
  uploadedComplete,
  active,
  media,
  source,
  query,
  sort,
}: {
  snapshot: RecordingLibrarySnapshot | null
  gamesByName: Map<string, GameNameLookupResult>
  /** Uploaded clips loaded so far, in server listing order for `sort`. */
  uploaded: ClipRow[]
  /** False while more upload pages remain on the server. */
  uploadedComplete: boolean
  active: LibraryGroupView | null
  media: MediaFilter
  source: LibrarySource
  query: string
  sort: LibrarySort
}): LibraryEntry[] {
  const direction = sort === "oldest" ? 1 : -1
  const cloudIds = new Set(uploaded.map((row) => row.id))
  const localItems = (snapshot?.items ?? []).filter((item) => {
    const serverId = libraryServerIdForItem(item)
    if (serverId && cloudIds.has(serverId)) return false
    return isPlacedByLoadedUploads(item, uploaded, uploadedComplete, sort)
  })
  const localByClipId = new Map<string, RecordingLibraryItem[]>()
  for (const item of snapshot?.items ?? []) {
    const serverId = libraryServerIdForItem(item)
    if (!serverId || !cloudIds.has(serverId)) continue
    const linked = localByClipId.get(serverId)
    if (linked) linked.push(item)
    else localByClipId.set(serverId, [item])
  }
  for (const linked of localByClipId.values()) {
    linked.sort(compareLibraryItemNewestFirst)
  }

  const localVisible = source !== "server"
  const local: LibraryEntry[] = localVisible
    ? filterLibraryItems(localItems, {
        localKeys: active?.localKeys ?? null,
        media,
        query,
      }).map((item) => {
        const view = enrichLibraryItem(item, gamesByName)
        return {
          type: "local",
          key: `local:${view.id}`,
          listedAt: view.createdAt,
          status: "local",
          item: view,
        }
      })
    : []

  const cloud: LibraryEntry[] = filterUploadedClips(
    uploaded,
    query,
    active,
    media,
  )
    .filter((row) => source !== "local" || localByClipId.has(row.id))
    .map((row) => {
      const linked = localByClipId.get(row.id) ?? []
      const localItem = linked[0] ?? null
      return {
        type: "cloud",
        key: `cloud:${row.id}`,
        listedAt: clipListedAt(row),
        status: localItem ? "synced" : "cloud",
        row,
        localItems: linked,
        localItem,
      }
    })

  return [...local, ...cloud].sort(
    (a, b) => (Date.parse(a.listedAt) - Date.parse(b.listedAt)) * direction,
  )
}
