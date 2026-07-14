import type { ClipPage, ClipRow } from "@alloy/api"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import { clipKeys } from "./clip-query-keys"
import { invalidateGameQueries } from "./game-queries"
import { invalidateStorageUsage } from "./user-queries"

export interface ClipsSnapshot {
  lists: Array<[readonly unknown[], ClipRow[] | undefined]>
  infinite: Array<
    [readonly unknown[], InfiniteData<ClipPage, string | null> | undefined]
  >
  details: Array<[readonly unknown[], ClipRow | undefined]>
}

export function patchClipInCaches(
  qc: QueryClient,
  clipId: string,
  patch: Partial<ClipRow>,
) {
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) =>
      old?.map((row) => (row.id === clipId ? { ...row, ...patch } : row)),
  )
  qc.setQueriesData<InfiniteData<ClipPage, string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((row) =>
            row.id === clipId ? { ...row, ...patch } : row,
          ),
        })),
      },
  )
  qc.setQueryData<ClipRow | undefined>(
    clipKeys.detail(clipId),
    (old) => old && { ...old, ...patch },
  )
}

export function removeClipFromCaches(
  qc: QueryClient,
  clipId: string,
  { removeDetail = true }: { removeDetail?: boolean } = {},
) {
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.filter((row) => row.id !== clipId),
  )
  qc.setQueriesData<InfiniteData<ClipPage, string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.filter((row) => row.id !== clipId),
        })),
      },
  )
  if (removeDetail) removeClipDetailFromCache(qc, clipId)
}

export function removeClipDetailFromCache(qc: QueryClient, clipId: string) {
  qc.removeQueries({ queryKey: clipKeys.detail(clipId), exact: true })
}

export function invalidateDeletedClipCaches(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: clipKeys.all })
  void invalidateGameQueries(qc)
  void invalidateStorageUsage(qc)
}

export function snapshotClips(qc: QueryClient): ClipsSnapshot {
  return {
    lists: qc.getQueriesData<ClipRow[]>({ queryKey: clipKeys.lists() }),
    infinite: qc.getQueriesData<InfiniteData<ClipPage, string | null>>({
      queryKey: clipKeys.infinite(),
    }),
    details: qc.getQueriesData<ClipRow>({
      queryKey: clipKeys.details(),
    }),
  }
}

export function restoreClips(qc: QueryClient, snapshot: ClipsSnapshot) {
  for (const [key, data] of snapshot.lists) qc.setQueryData(key, data)
  for (const [key, data] of snapshot.infinite) qc.setQueryData(key, data)
  for (const [key, data] of snapshot.details) qc.setQueryData(key, data)
}

export function adjustClipCountsInCaches(
  qc: QueryClient,
  clipId: string,
  deltas: { commentCount?: number; likeCount?: number; viewCount?: number },
) {
  const apply = (row: ClipRow): ClipRow => {
    if (row.id !== clipId) return row
    return {
      ...row,
      commentCount: Math.max(0, row.commentCount + (deltas.commentCount ?? 0)),
      likeCount: Math.max(0, row.likeCount + (deltas.likeCount ?? 0)),
      viewCount: Math.max(0, row.viewCount + (deltas.viewCount ?? 0)),
    }
  }
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.map(apply),
  )
  qc.setQueriesData<InfiniteData<ClipPage, string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map(apply),
        })),
      },
  )
  qc.setQueryData<ClipRow | undefined>(clipKeys.detail(clipId), (old) =>
    old ? apply(old) : old,
  )
}
