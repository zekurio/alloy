import { HttpError } from "@alloy/api"
import type { ClipRow, QueueClip, UpdateClipInput, UserClip } from "@alloy/api"
import type { ProfileMediaParams } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import {
  type QueryClient,
  queryOptions,
  infiniteQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"

import { api } from "./api"
import { clipEncodingActive } from "./clip-encoding"
import {
  adjustClipCountsInCaches,
  type ClipsSnapshot,
  findClipInCaches,
  invalidateClipCaches,
  patchClipInCaches,
  removeClipDetailFromCache,
  removeClipFromCaches,
  restoreClips,
  snapshotClips,
} from "./clip-query-cache"
import { clipKeys } from "./clip-query-keys"
import { useUploadQueueStream } from "./clip-queue-stream"
import { compareDateAsc, compareDateDesc } from "./date-format"
import { errorMessage } from "./error-message"
import { invalidateGameQueries } from "./game-queries"
import type { ProfileClipSort } from "./profile-all-search"
import { invalidateStorageUsage } from "./user-queries"

export {
  adjustClipCountsInCaches,
  invalidateClipCaches,
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
      return clipEncodingActive(row) ? 2500 : false
    },
    // Keep the previous clip visible while the next one loads so
    // route-driven modal navigation feels continuous.
    placeholderData: keepPreviousData
      ? (previous: ClipRow | undefined) => previous
      : undefined,
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
    queryFn: async () => {
      try {
        return await api.users.fetchMedia(handle, { media: "all", limit: 50 })
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          return api.users.fetchClips(handle)
        throw error
      }
    },
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
      // SAFETY: UpdateClipInput contains only mutable ClipRow fields with the
      // same value types.
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

export function useUpdateClipImageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      clipId,
      file,
      sourceVersion,
    }: {
      clipId: string
      file: File
      sourceVersion: string
    }) => api.clips.updateImage(clipId, file, sourceVersion),
    onSuccess: (row) => patchClipInCaches(qc, row.id, row),
    onSettled: () => {
      void invalidateClipCaches(qc)
      void invalidateStorageUsage(qc)
    },
  })
}

export function useReEncodeClipMutation() {
  const qc = useQueryClient()

  return useMutation<
    ClipRow,
    Error,
    { clipId: string },
    Partial<ClipRow> | null
  >({
    mutationFn: ({ clipId }) => api.clips.reEncode(clipId),
    onMutate: async ({ clipId }) => {
      await qc.cancelQueries({ queryKey: clipKeys.all })
      // A ready clip remains playable from its committed media. encodeActive
      // exposes the background work without overloading its publication state.
      const current = findClipInCaches(qc, clipId)
      if (!current) return null

      const previous: Partial<ClipRow> = {
        status: current.status,
        encodeActive: current.encodeActive,
        encodeProgress: current.encodeProgress,
        encodeStage: current.encodeStage,
        encodeTier: current.encodeTier,
        encodeTierIndex: current.encodeTierIndex,
        encodeTierCount: current.encodeTierCount,
        failureReason: current.failureReason,
      }
      patchClipInCaches(qc, clipId, {
        status: current.status === "failed" ? "processing" : current.status,
        encodeActive: true,
        encodeProgress: 0,
        encodeStage: null,
        encodeTier: null,
        encodeTierIndex: null,
        encodeTierCount: null,
        failureReason: null,
      })
      return previous
    },
    onError: (cause, { clipId }, previous) => {
      if (previous) patchClipInCaches(qc, clipId, previous)
      toast.error(errorMessage(cause, t("Couldn't start re-encode")))
    },
    onSuccess: (row) => {
      // Server-canonical state; the detail query's refetch interval takes over
      // polling until the re-encode publishes.
      patchClipInCaches(qc, row.id, row)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clipKeys.all })
    },
  })
}

export function useReannounceClipMutation() {
  return useMutation({
    mutationFn: ({ clipId }: { clipId: string }) =>
      api.clips.reannounce(clipId),
    onSuccess: () => toast.success(t("Clip announcement queued")),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't reannounce clip"))),
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
      invalidateClipCaches(qc)
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

export function profileMediaQueryOptions(
  username: string,
  params: Pick<ProfileMediaParams, "tab" | "media" | "sort" | "game">,
) {
  return infiniteQueryOptions({
    queryKey: [...clipKeys.infinite(), "profile-media", username, params],
    // SAFETY: The offset cursor is a string; null denotes the first page.
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      try {
        const items = await api.users.fetchMedia(username, {
          ...params,
          limit: 30,
          offset: Number(pageParam ?? 0),
        })
        return {
          items,
          nextCursor:
            items.length === 30
              ? String(Number(pageParam ?? 0) + items.length)
              : null,
        }
      } catch (cause) {
        if (!(cause instanceof HttpError) || cause.status !== 404) throw cause
        if (pageParam !== null || params.media === "image")
          return { items: [], nextCursor: null }
        const rows = await (params.tab === "liked"
          ? api.users.fetchLikedClips(username)
          : params.tab === "tagged"
            ? api.users.fetchTaggedClips(username)
            : api.users.fetchClips(username))
        const items = sortClips(
          params.game
            ? rows.filter((row) => row.gameRef?.slug === params.game)
            : rows,
          params.sort ?? "recent",
        )
        return { items, nextCursor: null }
      }
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

function sortClips(clips: UserClip[], sort: ProfileClipSort): UserClip[] {
  const copy = clips.slice()
  switch (sort) {
    case "recent":
      copy.sort((a, b) => compareDateDesc(a.createdAt, b.createdAt))
      break
    case "oldest":
      copy.sort((a, b) => compareDateAsc(a.createdAt, b.createdAt))
      break
    case "top":
      copy.sort(
        (a, b) =>
          b.likeCount - a.likeCount ||
          compareDateDesc(a.createdAt, b.createdAt),
      )
      break
    case "views":
      copy.sort(
        (a, b) =>
          b.viewCount - a.viewCount ||
          compareDateDesc(a.createdAt, b.createdAt),
      )
      break
  }
  return copy
}
