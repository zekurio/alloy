import {
  clipThumbnailUrl,
  type ClipRow,
  type GameNameLookupResult,
} from "@alloy/api"

import type {
  RecordingLibraryItem,
  RecordingLibraryProjectDraft,
  RecordingLibrarySnapshot,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"

import {
  gameNameKey,
  enrichLibraryItem,
  type LibraryGroupView,
  type LibraryItemView,
} from "./library-data"

export type LibraryKindFilter = "all" | "replay"
export type LibraryStatusFilter = "all" | "local" | "cloud" | "synced"

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
  | {
      type: "draft"
      key: string
      createdAt: string
      status: "local"
      draft: RecordingLibraryProjectDraft
      thumbnailUrl: string | null
      thumbBlurHash: string | null
    }

export function filterLibraryEntriesByStatus(
  entries: LibraryEntry[],
  status: LibraryStatusFilter,
): LibraryEntry[] {
  if (status === "all") return entries
  return entries.filter((entry) => entry.status === status)
}

export function countLibraryEntriesByStatus(
  entries: LibraryEntry[],
): Record<Exclude<LibraryStatusFilter, "all">, number> {
  return entries.reduce(
    (counts, entry) => {
      counts[entry.status] += 1
      return counts
    },
    { local: 0, cloud: 0, synced: 0 },
  )
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

export function filterProjectDrafts(
  drafts: RecordingLibraryProjectDraft[],
  rawQuery: string,
  active: LibraryGroupView | null,
  localItems: RecordingLibraryItem[],
  uploaded: ClipRow[],
): RecordingLibraryProjectDraft[] {
  const query = rawQuery.trim().toLowerCase()
  const localById = new Map(localItems.map((item) => [item.id, item]))
  const uploadedById = new Map(uploaded.map((row) => [row.id, row]))
  return drafts.filter((draft) => {
    if (active && !draftMatchesGroup(draft, active, localById, uploadedById)) {
      return false
    }
    if (!query) return true
    const sourceLabels = draft.project.clips.map((clip) => {
      const local = localById.get(clip.sourceId)
      const row = uploadedById.get(clip.sourceId)
      return [
        clip.label,
        local?.title ?? "",
        local?.groupLabel ?? "",
        row?.title ?? "",
        row?.gameRef?.name ?? row?.game ?? "",
      ].join(" ")
    })
    return [draft.title, ...sourceLabels]
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
  query,
  includeDrafts = true,
}: {
  snapshot: RecordingLibrarySnapshot | null
  gamesByName: Map<string, GameNameLookupResult>
  uploaded: ClipRow[]
  active: LibraryGroupView | null
  kind: LibraryKindFilter
  query: string
  includeDrafts?: boolean
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

  const local: LibraryEntry[] = filterLibraryItems(localItems, {
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

  const cloudVisible = kind === "all" || kind === "replay"
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

  const drafts: LibraryEntry[] =
    includeDrafts && (kind === "all" || kind === "replay")
      ? filterProjectDrafts(
          snapshot?.projectDrafts ?? [],
          query,
          active,
          snapshot?.items ?? [],
          uploaded,
        ).map((draft) => ({
          type: "draft",
          key: `draft:${draft.id}`,
          createdAt: draft.updatedAt,
          status: "local",
          draft,
          ...projectDraftThumbnail(draft, snapshot?.items ?? [], uploaded),
        }))
      : []

  return [...local, ...cloud, ...drafts].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}

export function projectDraftThumbnail(
  draft: RecordingLibraryProjectDraft,
  localItems: RecordingLibraryItem[],
  uploaded: ClipRow[],
): { thumbnailUrl: string | null; thumbBlurHash: string | null } {
  const sourceId =
    draft.thumbnailSourceId ?? draft.project.clips[0]?.sourceId ?? null
  if (!sourceId) return { thumbnailUrl: null, thumbBlurHash: null }

  const local = localItems.find((item) => item.id === sourceId)
  if (local) {
    return {
      thumbnailUrl: local.thumbnailUrl,
      thumbBlurHash: local.thumbBlurHash,
    }
  }

  const row = uploaded.find((entry) => entry.id === sourceId)
  if (row?.thumbKey) {
    return {
      thumbnailUrl: clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt),
      thumbBlurHash: row.thumbBlurHash,
    }
  }
  return { thumbnailUrl: null, thumbBlurHash: null }
}

function draftMatchesGroup(
  draft: RecordingLibraryProjectDraft,
  active: LibraryGroupView,
  localById: Map<string, RecordingLibraryItem>,
  uploadedById: Map<string, ClipRow>,
): boolean {
  return draft.project.clips.some((clip) => {
    const local = localById.get(clip.sourceId)
    if (local) {
      if (active.kind === "no-game")
        return active.localKeys.includes(local.groupKey)
      return active.nameKey === gameNameKey(local.gameName ?? local.groupLabel)
    }

    const row = uploadedById.get(clip.sourceId)
    if (!row) return false
    const gameName = row.gameRef?.name ?? row.game
    if (active.kind === "no-game") return !gameName
    return active.nameKey === gameNameKey(gameName ?? "")
  })
}
