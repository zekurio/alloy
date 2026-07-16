import { type ClipRow, type GameNameLookupResult } from "@alloy/api"

import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@/lib/desktop"
import type { LibrarySource } from "@/lib/library-search"

import {
  gameNameKey,
  enrichLibraryItem,
  type LibraryGroupView,
  type LibraryItemView,
} from "./library-data"

export type LibraryKindFilter = "all" | "replay"

/** One row of the combined grid: a local capture or an uploaded clip. */
export type LibraryEntry =
  | {
      type: "local"
      key: string
      createdAt: string
      status: "local"
      item: LibraryItemView
    }
  | {
      type: "cloud"
      key: string
      createdAt: string
      status: "cloud" | "synced"
      row: ClipRow
      /** The on-disk capture backing this clip (uploaded from / downloaded). */
      localItem: RecordingLibraryItem | null
    }

export function filterLibraryItems(
  items: RecordingLibraryItem[],
  filters: {
    localKeys: string[] | null
    kind: LibraryKindFilter
    query: string
  },
): RecordingLibraryItem[] {
  const query = filters.query.trim().toLowerCase()
  const localKeys = filters.localKeys ? new Set(filters.localKeys) : null
  return items.filter((item) => {
    if (localKeys && !localKeys.has(item.groupKey)) return false
    if (filters.kind !== "all" && item.kind !== filters.kind) return false
    if (!query) return true
    return [item.title, item.groupLabel, item.fileName]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}

export function filterUploadedClips(
  rows: ClipRow[],
  rawQuery: string,
  active: LibraryGroupView | null,
): ClipRow[] {
  const query = rawQuery.trim().toLowerCase()
  return rows.filter((row) => {
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

export function libraryServerIdForItem(
  item: RecordingLibraryItem,
): string | null {
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

export function buildLibraryEntries({
  snapshot,
  gamesByName,
  uploaded,
  active,
  kind,
  source,
  query,
}: {
  snapshot: RecordingLibrarySnapshot | null
  gamesByName: Map<string, GameNameLookupResult>
  uploaded: ClipRow[]
  active: LibraryGroupView | null
  kind: LibraryKindFilter
  source: LibrarySource
  query: string
}): LibraryEntry[] {
  const cloudIds = new Set(uploaded.map((row) => row.id))
  const localItems = (snapshot?.items ?? []).filter((item) => {
    const serverId = libraryServerIdForItem(item)
    return !(serverId && cloudIds.has(serverId))
  })
  const localByClipId = new Map<string, RecordingLibraryItem>()
  for (const item of snapshot?.items ?? []) {
    const serverId = libraryServerIdForItem(item)
    if (serverId && cloudIds.has(serverId)) localByClipId.set(serverId, item)
  }

  const localVisible = source !== "server"
  const local: LibraryEntry[] = localVisible
    ? filterLibraryItems(localItems, {
        localKeys: active?.localKeys ?? null,
        kind,
        query,
      }).map((item) => {
        const view = enrichLibraryItem(item, gamesByName)
        return {
          type: "local",
          key: `local:${view.id}`,
          createdAt: view.createdAt,
          status: "local",
          item: view,
        }
      })
    : []

  const cloudVisible =
    source !== "local" && (kind === "all" || kind === "replay")
  const cloud: LibraryEntry[] = cloudVisible
    ? filterUploadedClips(uploaded, query, active).map((row) => {
        const localItem = localByClipId.get(row.id) ?? null
        return {
          type: "cloud",
          key: `cloud:${row.id}`,
          createdAt: row.createdAt,
          status: localItem ? "synced" : "cloud",
          row,
          localItem,
        }
      })
    : []

  return [...local, ...cloud].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}
