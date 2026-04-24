import {
  useInfiniteQuery,
  useMutation,
  queryOptions,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"

import type {
  ClipFeedWindow,
  ClipRow,
  QueueClip,
  UpdateClipInput,
  UserClip,
} from "@workspace/api"

import { api } from "./api"
import { clipKeys } from "./clip-query-keys"
import { useUploadQueueStream } from "./clip-queue-stream"

export { clipKeys }

export function useClipQuery(clipId: string) {
  return useQuery({
    queryKey: clipKeys.detail(clipId),
    queryFn: () => api.clips.fetchById(clipId),
    enabled: clipId.length > 0,
    refetchInterval: (query) => {
      const row = query.state.data
      if (!row) return false
      return row.status === "encoding" || row.encodeProgress < 100
        ? 2500
        : false
    },
    // Keep the previous clip visible while the next one loads so
    // route-driven modal navigation feels continuous.
    placeholderData: (previous) => previous,
  })
}

export function useTopClipsQuery(
  window: ClipFeedWindow,
  { limit = 5 }: { limit?: number } = {}
) {
  return useQuery({
    queryKey: clipKeys.topList(window, limit),
    queryFn: () => api.clips.fetch({ window, sort: "top", limit }),
  })
}

export function useRecentClipsInfiniteQuery({
  limit = 20,
}: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: clipKeys.recentInfinite(limit),
    queryFn: ({ pageParam }) =>
      api.clips.fetch({
        sort: "recent",
        limit,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => {
      if (last.length < limit) return undefined
      const tail = last[last.length - 1]
      return tail ? tail.createdAt : undefined
    },
  })
}

export function useUserClipsQuery(handle: string) {
  return useQuery(userClipsQueryOptions(handle))
}

export function userClipsQueryOptions(handle: string) {
  return queryOptions({
    queryKey: clipKeys.userList(handle),
    queryFn: () => api.users.fetchClips(handle),
    enabled: handle.length > 0,
  })
}

export function useUploadQueueQuery({ enabled }: { enabled: boolean }) {
  useUploadQueueStream({ enabled })
  return useQuery({
    queryKey: clipKeys.queue(),
    queryFn: () => {
      throw new Error("queue stream drives the cache; queryFn is inert")
    },
    enabled: false,
    staleTime: Infinity,
  })
}

function patchClipInCaches(
  qc: QueryClient,
  clipId: string,
  patch: Partial<ClipRow>
) {
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.map((r) => (r.id === clipId ? { ...r, ...patch } : r))
  )
  qc.setQueriesData<InfiniteData<ClipRow[], string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) =>
          page.map((r) => (r.id === clipId ? { ...r, ...patch } : r))
        ),
      }
  )
  qc.setQueryData<ClipRow | undefined>(
    clipKeys.detail(clipId),
    (old) => old && { ...old, ...patch }
  )
}

function removeClipFromCaches(qc: QueryClient, clipId: string) {
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.filter((r) => r.id !== clipId)
  )
  qc.setQueriesData<InfiniteData<ClipRow[], string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => page.filter((r) => r.id !== clipId)),
      }
  )
  qc.removeQueries({ queryKey: clipKeys.detail(clipId) })
}

/** Snapshot shape captured on `onMutate` so `onError` can roll back. */
interface ClipsSnapshot {
  lists: Array<[readonly unknown[], ClipRow[] | undefined]>
  infinite: Array<
    [readonly unknown[], InfiniteData<ClipRow[], string | null> | undefined]
  >
  details: Array<[readonly unknown[], ClipRow | undefined]>
}

function snapshotClips(qc: QueryClient): ClipsSnapshot {
  return {
    lists: qc.getQueriesData<ClipRow[]>({ queryKey: clipKeys.lists() }),
    infinite: qc.getQueriesData<InfiniteData<ClipRow[], string | null>>({
      queryKey: clipKeys.infinite(),
    }),
    details: qc.getQueriesData<ClipRow>({
      queryKey: [...clipKeys.all, "detail"],
    }),
  }
}

function restoreClips(qc: QueryClient, snap: ClipsSnapshot) {
  for (const [key, data] of snap.lists) qc.setQueryData(key, data)
  for (const [key, data] of snap.infinite) qc.setQueryData(key, data)
  for (const [key, data] of snap.details) qc.setQueryData(key, data)
}

export function useUpdateClipMutation() {
  const qc = useQueryClient()

  return useMutation<
    ClipRow,
    Error,
    { clipId: string; input: UpdateClipInput },
    ClipsSnapshot
  >({
    mutationFn: ({ clipId, input }) => api.clips.update(clipId, input),
    onMutate: async ({ clipId, input }) => {
      // Pause in-flight refetches so our optimistic write isn't
      // immediately overwritten by a stale response.
      await qc.cancelQueries({ queryKey: clipKeys.all })
      const snap = snapshotClips(qc)
      patchClipInCaches(qc, clipId, input as Partial<ClipRow>)
      return snap
    },
    onError: (_err, _vars, context) => {
      if (context) restoreClips(qc, context)
    },
    onSuccess: (row) => {
      // Server-canonical patch — fields the server reshaped (e.g. null
      // vs empty string for description) land here.
      patchClipInCaches(qc, row.id, row)
    },
    onSettled: () => {
      // Schedule a background refresh so we don't drift from the server
      // on fields we don't patch locally (view count, etc.).
      void qc.invalidateQueries({ queryKey: clipKeys.all })
    },
  })
}

export function useDeleteClipMutation() {
  const qc = useQueryClient()

  return useMutation<void, Error, { clipId: string }, ClipsSnapshot>({
    mutationFn: ({ clipId }) => api.clips.delete(clipId),
    onMutate: async ({ clipId }) => {
      await qc.cancelQueries({ queryKey: clipKeys.all })
      const snap = snapshotClips(qc)
      removeClipFromCaches(qc, clipId)
      return snap
    },
    onError: (_err, _vars, context) => {
      if (context) restoreClips(qc, context)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clipKeys.all })
    },
  })
}

export function useLikeStateQuery(
  clipId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: clipKeys.like(clipId),
    queryFn: () => api.clips.fetchLikeState(clipId),
    enabled: enabled && clipId.length > 0,
    // Like state is per-viewer and rarely changes from other tabs —
    // don't hammer the server on window refocus.
    refetchOnWindowFocus: false,
  })
}

export function useToggleLikeMutation() {
  const qc = useQueryClient()

  interface Context {
    previousLiked: boolean
    clipsSnapshot: ClipsSnapshot
  }

  return useMutation<
    { liked: boolean; likeCount: number },
    Error,
    { clipId: string; nextLiked: boolean },
    Context
  >({
    mutationFn: ({ clipId, nextLiked }) =>
      nextLiked ? api.clips.like(clipId) : api.clips.unlike(clipId),
    onMutate: async ({ clipId, nextLiked }) => {
      // Pause in-flight fetches so the optimistic values aren't
      // overwritten by a stale refetch landing mid-mutation.
      await qc.cancelQueries({ queryKey: clipKeys.like(clipId) })
      await qc.cancelQueries({ queryKey: clipKeys.all })

      const previousLiked =
        qc.getQueryData<{ liked: boolean }>(clipKeys.like(clipId))?.liked ??
        !nextLiked
      const clipsSnapshot = snapshotClips(qc)

      qc.setQueryData<{ liked: boolean }>(clipKeys.like(clipId), {
        liked: nextLiked,
      })

      const delta = nextLiked ? 1 : -1
      patchClipCounts(qc, clipId, { likeCount: delta })

      return { previousLiked, clipsSnapshot }
    },
    onError: (_err, { clipId }, context) => {
      if (!context) return
      qc.setQueryData<{ liked: boolean }>(clipKeys.like(clipId), {
        liked: context.previousLiked,
      })
      restoreClips(qc, context.clipsSnapshot)
    },
    onSuccess: (data, { clipId }) => {
      // Server-canonical state. The boolean rarely differs from what we
      // optimistically set, but the count often does (other viewers).
      qc.setQueryData<{ liked: boolean }>(clipKeys.like(clipId), {
        liked: data.liked,
      })
      patchClipInCaches(qc, clipId, { likeCount: data.likeCount })
    },
  })
}

function patchClipCounts(
  qc: QueryClient,
  clipId: string,
  deltas: { likeCount?: number; viewCount?: number }
) {
  const apply = (row: ClipRow): ClipRow => {
    if (row.id !== clipId) return row
    return {
      ...row,
      likeCount: Math.max(0, row.likeCount + (deltas.likeCount ?? 0)),
      viewCount: Math.max(0, row.viewCount + (deltas.viewCount ?? 0)),
    }
  }
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.map(apply)
  )
  qc.setQueriesData<InfiniteData<ClipRow[], string | null> | undefined>(
    { queryKey: clipKeys.infinite() },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => page.map(apply)),
      }
  )
  qc.setQueryData<ClipRow | undefined>(clipKeys.detail(clipId), (old) =>
    old ? apply(old) : old
  )
}

export function useInvalidateClips() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: clipKeys.all })
}

export type { ClipRow, QueueClip, UpdateClipInput, UserClip }
