import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"

import {
  deleteClip,
  fetchClips,
  fetchLikeState,
  fetchUploadQueue,
  likeClip,
  unlikeClip,
  updateClip,
  type ClipFeedWindow,
  type ClipRow,
  type QueueClip,
  type UpdateClipInput,
} from "./clips-api"
import { fetchUserClips, type UserClip } from "./users-api"

/**
 * Centralised query keys + hooks for the clip surface. One source of
 * truth for "which cache entries represent clip data" means a mutation
 * can invalidate them all with a single prefix without chasing down
 * every caller.
 *
 * Key shape is always a tuple starting with `"clips"` so the broadest
 * invalidation (`["clips"]`) wipes every list/infinite/user cache in
 * one call. The mutations below favour patching caches in place over
 * an invalidate-and-refetch because refetching a 50-row feed just to
 * flip one title is wasteful — but we still schedule a background
 * invalidate so derived values (view counts, other viewers' edits)
 * catch up on the next tick.
 */

// ─── Query keys ─────────────────────────────────────────────────────────

/**
 * Hierarchical key factory. Keep to the convention
 *   `[root, kind, ...args]`
 * so partial matches work reliably — TanStack Query matches by prefix.
 */
export const clipKeys = {
  all: ["clips"] as const,
  /** Every finite list query (top-by-window, user-by-handle). */
  lists: () => [...clipKeys.all, "list"] as const,
  topList: (window: ClipFeedWindow, limit: number) =>
    [...clipKeys.lists(), "top", { window, limit }] as const,
  userList: (handle: string) =>
    [...clipKeys.lists(), "user", { handle }] as const,
  /** Infinite recent feed. Separate branch because its data shape is
   *  `InfiniteData<ClipRow[]>`, not `ClipRow[]`. */
  infinite: () => [...clipKeys.all, "infinite"] as const,
  recentInfinite: (limit: number) =>
    [...clipKeys.infinite(), "recent", { limit }] as const,
  /** Upload-queue poll — its own branch so clip edits don't nudge it. */
  queue: () => [...clipKeys.all, "queue"] as const,
  /** Per-viewer like state for a single clip. */
  like: (clipId: string) => [...clipKeys.all, "like", { clipId }] as const,
}

// ─── Feed queries ───────────────────────────────────────────────────────

export function useTopClipsQuery(
  window: ClipFeedWindow,
  { limit = 5 }: { limit?: number } = {}
) {
  return useQuery({
    queryKey: clipKeys.topList(window, limit),
    queryFn: () => fetchClips({ window, sort: "top", limit }),
  })
}

export function useRecentClipsInfiniteQuery({
  limit = 20,
}: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: clipKeys.recentInfinite(limit),
    queryFn: ({ pageParam }) =>
      fetchClips({
        sort: "recent",
        limit,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    // The server returns rows newest-first; a short batch is our
    // "no more" signal (matches the old hand-rolled pager). Cursor is
    // the last row's createdAt.
    getNextPageParam: (last) => {
      if (last.length < limit) return undefined
      const tail = last[last.length - 1]
      return tail ? tail.createdAt : undefined
    },
  })
}

export function useUserClipsQuery(handle: string) {
  return useQuery({
    queryKey: clipKeys.userList(handle),
    queryFn: () => fetchUserClips(handle),
    enabled: handle.length > 0,
  })
}

// ─── Upload queue ───────────────────────────────────────────────────────

/**
 * Polling query for the upload queue. `enabled` gates the whole query
 * so the network goes quiet when the queue modal is closed. 2s matches
 * the previous hand-rolled `setInterval` — fast enough that encode
 * progress feels live, slow enough that an always-open tab isn't
 * hammering the server.
 */
export function useUploadQueueQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: clipKeys.queue(),
    queryFn: fetchUploadQueue,
    enabled,
    refetchInterval: enabled ? 2000 : false,
    // The queue is fast-moving while visible; don't serve stale data
    // from cache between opens.
    staleTime: 0,
    // Also refetch on window focus so tabbing back gives a fresh view.
    refetchOnWindowFocus: enabled,
  })
}

// ─── Cache helpers (shared by mutations) ────────────────────────────────

/**
 * Apply a partial patch to `clipId` everywhere it appears — finite
 * lists, infinite lists, user lists. Called from `onMutate` (optimistic)
 * and `onSuccess` (canonical) so the visible row updates before the
 * network round-trip completes.
 *
 * Uses `setQueriesData` with the shared `clips/list` and `clips/infinite`
 * prefixes so we don't need to know every active filter (window, limit,
 * handle) at mutation time.
 */
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
}

/** Snapshot shape captured on `onMutate` so `onError` can roll back. */
interface ClipsSnapshot {
  lists: Array<[readonly unknown[], ClipRow[] | undefined]>
  infinite: Array<
    [readonly unknown[], InfiniteData<ClipRow[], string | null> | undefined]
  >
}

function snapshotClips(qc: QueryClient): ClipsSnapshot {
  return {
    lists: qc.getQueriesData<ClipRow[]>({ queryKey: clipKeys.lists() }),
    infinite: qc.getQueriesData<InfiniteData<ClipRow[], string | null>>({
      queryKey: clipKeys.infinite(),
    }),
  }
}

function restoreClips(qc: QueryClient, snap: ClipsSnapshot) {
  for (const [key, data] of snap.lists) qc.setQueryData(key, data)
  for (const [key, data] of snap.infinite) qc.setQueryData(key, data)
}

// ─── Mutations ──────────────────────────────────────────────────────────

/**
 * PATCH /api/clips/:id. Optimistic: we patch visible caches from
 * `onMutate` so the edit feels instant. `onError` rolls back, `onSuccess`
 * writes the server-canonical row (in case the server massaged values —
 * e.g. trimmed title whitespace — differently than we did).
 */
export function useUpdateClipMutation() {
  const qc = useQueryClient()

  return useMutation<
    ClipRow,
    Error,
    { clipId: string; input: UpdateClipInput },
    ClipsSnapshot
  >({
    mutationFn: ({ clipId, input }) => updateClip(clipId, input),
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

/**
 * DELETE /api/clips/:id. Optimistic removal so the card vanishes from
 * the feed immediately; rollback restores the pre-delete snapshot.
 * Upload queue invalidates alongside in case the deleted clip was
 * still encoding.
 */
export function useDeleteClipMutation() {
  const qc = useQueryClient()

  return useMutation<void, Error, { clipId: string }, ClipsSnapshot>({
    mutationFn: ({ clipId }) => deleteClip(clipId),
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

// ─── Likes ──────────────────────────────────────────────────────────────

/**
 * Per-viewer like state. The feed's `ClipRow` only carries the
 * aggregated `likeCount`, not a `liked` boolean — that's per-viewer and
 * separate so a new viewer's first page load doesn't blow a big JOIN
 * onto every feed query. This hook fetches just the boolean on demand
 * (when a clip detail mounts), and is `enabled` only for signed-in
 * viewers since the server 401s anon callers.
 */
export function useLikeStateQuery(
  clipId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: clipKeys.like(clipId),
    queryFn: () => fetchLikeState(clipId),
    enabled: enabled && clipId.length > 0,
    // Like state is per-viewer and rarely changes from other tabs —
    // don't hammer the server on window refocus.
    refetchOnWindowFocus: false,
  })
}

/**
 * Toggle like. Optimistic on both fronts: we flip `liked` in the per-
 * viewer cache and nudge the aggregated `likeCount` in every feed cache
 * by ±1, so the UI updates before the network round-trip. `onSuccess`
 * lands the server-canonical `likeCount` — covers the case where
 * another viewer liked/unliked between our read and our write.
 *
 * `onError` rolls back both the like flag and the count nudge. The
 * feed-cache patch reuses `patchClipInCaches` to keep the code flow
 * identical to the update/delete paths above.
 */
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
      nextLiked ? likeClip(clipId) : unlikeClip(clipId),
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

      // Nudge the aggregated count in every cached feed row. The server
      // will return the true number on success; this keeps the number
      // moving the right way in the meantime.
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
    // No onSettled invalidate — patching the count directly is enough,
    // and a blanket refetch here would wipe optimistic view-count bumps
    // in neighbouring rows.
  })
}

/**
 * Apply a +1/-1 delta to a numeric counter on `clipId` in every cached
 * feed. Used by the optimistic-like path since it only knows the
 * direction, not the target value. `patchClipInCaches` above takes an
 * absolute patch and is the canonical landing in `onSuccess`.
 */
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
}

// ─── Cross-module invalidation hooks ────────────────────────────────────

/**
 * Handle for code paths that mutate clip data without going through the
 * mutation hooks above — currently the upload flow, which runs its own
 * XHR-driven initiate→upload→finalize cycle. Calling this on upload
 * completion nudges every feed to refetch so the new clip shows up
 * without a reload.
 */
export function useInvalidateClips() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: clipKeys.all })
}

// ─── Types re-exports for consumers ─────────────────────────────────────

export type { ClipRow, QueueClip, UpdateClipInput, UserClip }
