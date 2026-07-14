import type { ClipRow, QueueClip, UpdateClipInput, UserClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { api } from "./api"
import {
  adjustClipCountsInCaches,
  type ClipsSnapshot,
  invalidateDeletedClipCaches,
  patchClipInCaches,
  removeClipDetailFromCache,
  removeClipFromCaches,
  restoreClips,
  snapshotClips,
} from "./clip-query-cache"
import { clipKeys } from "./clip-query-keys"
import { useUploadQueueStream } from "./clip-queue-stream"
import { errorMessage } from "./error-message"
import { invalidateGameQueries } from "./game-queries"
import { invalidateStorageUsage } from "./user-queries"

export {
  adjustClipCountsInCaches,
  invalidateDeletedClipCaches,
  removeClipDetailFromCache,
}
export { clipKeys }

interface ClipDetailQueryOptions {
  keepPreviousData?: boolean
}

export function useClipQuery(clipId: string, options?: ClipDetailQueryOptions) {
  return useQuery(clipDetailQueryOptions(clipId, options))
}

export function clipDetailQueryOptions(
  clipId: string,
  { keepPreviousData = true }: ClipDetailQueryOptions = {},
) {
  return queryOptions({
    queryKey: clipKeys.detail(clipId),
    queryFn: () => api.clips.fetchById(clipId),
    enabled: clipId.length > 0,
    refetchInterval: (query) => {
      const row = query.state.data
      if (!row) return false
      return row.status === "processing" || row.encodeProgress < 100
        ? 2500
        : false
    },
    // Keep the previous clip visible while the next one loads so
    // route-driven modal navigation feels continuous.
    ...(keepPreviousData
      ? { placeholderData: (previous: ClipRow | undefined) => previous }
      : {}),
  })
}

export function seedClipDetailInCache(qc: QueryClient, row: ClipRow) {
  qc.setQueryData<ClipRow>(clipKeys.detail(row.id), (current) => current ?? row)
}

export function warmClipDetailCache(qc: QueryClient, row: ClipRow): void {
  seedClipDetailInCache(qc, row)
  void qc.prefetchQuery(clipDetailQueryOptions(row.id))
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

export function userLikedClipsQueryOptions(handle: string) {
  return queryOptions({
    queryKey: clipKeys.userLikedList(handle),
    queryFn: () => api.users.fetchLikedClips(handle),
    enabled: handle.length > 0,
  })
}

export function useUserLikedClipsQuery(handle: string) {
  return useQuery(userLikedClipsQueryOptions(handle))
}

export function useUploadQueueQuery({ enabled }: { enabled: boolean }) {
  const stream = useUploadQueueStream({ enabled })
  const query = useQuery({
    queryKey: clipKeys.queue(),
    queryFn: async (): Promise<QueueClip[]> => [],
    enabled: false,
    staleTime: Infinity,
  })
  return { ...query, stream }
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
    onSettled: (_data, _error, variables) => {
      // Schedule a background refresh so we don't drift from the server
      // on fields we don't patch locally (view count, etc.).
      void qc.invalidateQueries({ queryKey: clipKeys.all })
      if (
        variables.input.gameId !== undefined ||
        variables.input.privacy !== undefined
      ) {
        void invalidateGameQueries(qc)
      }
    },
  })
}

export function useTrimClipMutation() {
  const qc = useQueryClient()

  return useMutation<
    ClipRow,
    Error,
    { clipId: string; startMs: number; endMs: number }
  >({
    mutationFn: ({ clipId, startMs, endMs }) =>
      api.clips.trim(clipId, { startMs, endMs }),
    onSuccess: (row) => {
      // The clip flips to "processing"; the detail query's refetch interval
      // takes over polling until the trimmed media is published.
      patchClipInCaches(qc, row.id, row)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clipKeys.all })
      void invalidateGameQueries(qc)
      void invalidateStorageUsage(qc)
    },
  })
}

export function useReEncodeClipMutation() {
  const qc = useQueryClient()

  return useMutation<ClipRow, Error, { clipId: string }, ClipsSnapshot>({
    mutationFn: ({ clipId }) => api.clips.reEncode(clipId),
    onMutate: async ({ clipId }) => {
      await qc.cancelQueries({ queryKey: clipKeys.all })
      const snap = snapshotClips(qc)
      // Only a failed clip visibly changes state. A ready clip stays playable
      // from its committed renditions while it re-encodes, so leave its player
      // alone rather than flashing it into a "preparing" placeholder.
      const current = qc.getQueryData<ClipRow>(clipKeys.detail(clipId))
      if (current?.status === "failed") {
        patchClipInCaches(qc, clipId, {
          status: "processing",
          encodeProgress: 0,
          encodeStage: null,
          encodeTier: null,
          encodeTierIndex: null,
          encodeTierCount: null,
          failureReason: null,
        })
      }
      return snap
    },
    onError: (cause, _vars, context) => {
      if (context) restoreClips(qc, context)
      toast.error(errorMessage(cause, t("Couldn't start re-encode")))
    },
    onSuccess: (row) => {
      // Server-canonical state; the detail query's refetch interval takes over
      // polling until the re-encode publishes.
      patchClipInCaches(qc, row.id, row)
      toast.success(t("Re-encode started."))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clipKeys.all })
    },
  })
}

export function useSetClipPosterMutation() {
  const qc = useQueryClient()

  return useMutation<ClipRow, Error, { clipId: string; timeMs: number }>({
    mutationFn: ({ clipId, timeMs }) => api.clips.setPoster(clipId, { timeMs }),
    onSuccess: (row) => {
      // thumbVersion changes with the new thumb key, so cards and players
      // pick up the new poster without a manual cache bust.
      patchClipInCaches(qc, row.id, row)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clipKeys.all })
    },
  })
}

export function useDeleteClipMutation() {
  const qc = useQueryClient()

  return useMutation<
    void,
    Error,
    {
      clipId: string
      removeDetail?: boolean
      deferInvalidation?: boolean
    },
    ClipsSnapshot
  >({
    mutationFn: ({ clipId }) => api.clips.delete(clipId),
    onMutate: async ({ clipId, removeDetail = true }) => {
      await qc.cancelQueries({ queryKey: clipKeys.all })
      const snap = snapshotClips(qc)
      removeClipFromCaches(qc, clipId, { removeDetail })
      return snap
    },
    onError: (_err, _vars, context) => {
      if (context) restoreClips(qc, context)
    },
    onSettled: (_data, _error, variables) => {
      if (variables.deferInvalidation) return
      invalidateDeletedClipCaches(qc)
    },
  })
}

export function useLikeStateQuery(
  clipId: string,
  { enabled = true }: { enabled?: boolean } = {},
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
      adjustClipCountsInCaches(qc, clipId, { likeCount: delta })

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

export function useInvalidateClips() {
  const qc = useQueryClient()
  // Stable identity: callers put this in effect/callback dependency arrays, so
  // a fresh function per render would cascade re-runs through their hooks.
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: clipKeys.all })
    void invalidateStorageUsage(qc)
  }, [qc])
}

export type { ClipRow, QueueClip, UpdateClipInput, UserClip }
