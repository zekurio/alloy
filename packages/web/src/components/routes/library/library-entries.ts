import {
  clipThumbnailUrl,
  type ClipRow,
  type GameNameLookupResult,
  type StagingRecordingRow,
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

export type LibraryKindFilter =
  | "all"
  | "replay"
  | "long-recording"
  | "screenshot"

/** One row of the combined grid: a local capture or an uploaded clip. */
export type LibraryEntry =
  | { type: "local"; key: string; createdAt: string; item: LibraryItemView }
  | {
      type: "cloud"
      key: string
      createdAt: string
      row: ClipRow
      /** The on-disk capture backing this clip (uploaded from / downloaded). */
      localItem: RecordingLibraryItem | null
    }
  | {
      type: "staging"
      key: string
      createdAt: string
      row: StagingRecordingRow
      /** The on-disk capture backing this synced draft, when it still exists. */
      localItem: RecordingLibraryItem | null
    }
  | {
      type: "draft"
      key: string
      createdAt: string
      draft: RecordingLibraryProjectDraft
      thumbnailUrl: string | null
      thumbBlurHash: string | null
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
      // A desktop source holds no uploaded clips; a game source matches by
      // name; the cloud catch-all keeps only clips without a game.
      if (active.kind === "desktop") return false
      const gameName = row.gameRef?.name ?? row.game
      if (active.kind === "cloud") {
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

export function filterStagingRecordings(
  rows: StagingRecordingRow[],
  rawQuery: string,
  active: LibraryGroupView | null,
  kind: LibraryKindFilter,
): StagingRecordingRow[] {
  if (kind === "screenshot") return []
  const query = rawQuery.trim().toLowerCase()
  return rows.filter((row) => {
    if (kind === "replay" && row.kind !== "clip") return false
    if (kind === "long-recording" && row.kind !== "session") return false
    if (active) {
      // Staging recordings live on the server, not the desktop; match the
      // cloud catch-all (no game) or a specific game like uploaded clips do.
      if (active.kind === "desktop") return false
      const gameName = row.gameRef?.name ?? row.game
      if (active.kind === "cloud") {
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
  return item.uploadedClipId ?? item.syncedRecordingId
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
  staging,
  active,
  kind,
  query,
  includeDrafts = true,
}: {
  snapshot: RecordingLibrarySnapshot | null
  gamesByName: Map<string, GameNameLookupResult>
  uploaded: ClipRow[]
  staging: StagingRecordingRow[]
  active: LibraryGroupView | null
  kind: LibraryKindFilter
  query: string
  includeDrafts?: boolean
}): LibraryEntry[] {
  const cloudIds = new Set(uploaded.map((row) => row.id))
  const stagingIds = new Set(staging.map((row) => row.id))
  const localItems = (snapshot?.items ?? []).filter((item) => {
    const serverId = libraryServerIdForItem(item)
    return !(serverId && (cloudIds.has(serverId) || stagingIds.has(serverId)))
  })
  const localByClipId = new Map<string, RecordingLibraryItem>()
  const localByStagingId = new Map<string, RecordingLibraryItem>()
  for (const item of snapshot?.items ?? []) {
    const serverId = libraryServerIdForItem(item)
    if (serverId && cloudIds.has(serverId)) localByClipId.set(serverId, item)
    if (serverId && stagingIds.has(serverId)) {
      localByStagingId.set(serverId, item)
    }
  }

  const local: LibraryEntry[] =
    active?.kind === "cloud"
      ? []
      : filterLibraryItems(localItems, {
          localKeys: active?.localKeys ?? null,
          kind,
          query,
        }).map((item) => {
          const view = enrichLibraryItem(item, gamesByName)
          return {
            type: "local",
            key: `local:${view.id}`,
            createdAt: view.createdAt,
            item: view,
          }
        })

  const cloudVisible = kind === "all" || kind === "replay"
  const cloud: LibraryEntry[] = cloudVisible
    ? filterUploadedClips(uploaded, query, active).map((row) => ({
        type: "cloud",
        key: `cloud:${row.id}`,
        createdAt: row.createdAt,
        row,
        localItem: localByClipId.get(row.id) ?? null,
      }))
    : []

  const stagingEntries: LibraryEntry[] = filterStagingRecordings(
    staging,
    query,
    active,
    kind,
  ).map((row) => ({
    type: "staging",
    key: `staging:${row.id}`,
    createdAt: row.createdAt,
    row,
    localItem: localByStagingId.get(row.id) ?? null,
  }))

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
          draft,
          ...projectDraftThumbnail(draft, snapshot?.items ?? [], uploaded),
        }))
      : []

  return [...local, ...cloud, ...stagingEntries, ...drafts].sort(
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
      if (active.kind === "cloud") return false
      if (active.kind === "desktop")
        return active.localKeys.includes(local.groupKey)
      return active.nameKey === gameNameKey(local.gameName ?? local.groupLabel)
    }

    const row = uploadedById.get(clip.sourceId)
    if (!row || active.kind === "desktop") return false
    const gameName = row.gameRef?.name ?? row.game
    if (active.kind === "cloud") return !gameName
    return active.nameKey === gameNameKey(gameName ?? "")
  })
}

export function emptyKindLabel(kind: LibraryKindFilter) {
  switch (kind) {
    case "replay":
      return "clips"
    case "long-recording":
      return "sessions"
    case "screenshot":
      return "screenshots"
    default:
      return "captures"
  }
}
