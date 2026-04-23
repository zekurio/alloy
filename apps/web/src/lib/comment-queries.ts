import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

import type { ClipRow, CommentRow, CommentSort } from "@workspace/api"

import { api } from "./api"
import { clipKeys } from "./clip-queries"

export const commentKeys = {
  all: ["comments"] as const,
  list: (clipId: string, sort: CommentSort) =>
    [...commentKeys.all, "list", { clipId, sort }] as const,
  clipLists: (clipId: string) =>
    [...commentKeys.all, "list", { clipId }] as const,
}

export function useCommentsQuery(clipId: string, sort: CommentSort = "top") {
  return useQuery({
    queryKey: commentKeys.list(clipId, sort),
    queryFn: () => api.comments.fetch(clipId, sort),
    enabled: clipId.length > 0,
    placeholderData: keepPreviousData,
  })
}

function invalidateComments(qc: QueryClient, clipId: string) {
  void qc.invalidateQueries({
    predicate: (q) => {
      const [root, kind, payload] = q.queryKey
      const queryClipId =
        payload && typeof payload === "object" && "clipId" in payload
          ? payload.clipId
          : undefined
      return root === "comments" && kind === "list" && queryClipId === clipId
    },
  })
}

function bumpClipCommentCount(qc: QueryClient, clipId: string, delta: number) {
  const apply = (row: ClipRow): ClipRow =>
    row.id === clipId
      ? { ...row, commentCount: Math.max(0, row.commentCount + delta) }
      : row
  qc.setQueryData<ClipRow | undefined>(clipKeys.detail(clipId), (old) =>
    old ? apply(old) : old
  )
  qc.setQueriesData<ClipRow[] | undefined>(
    { queryKey: clipKeys.lists() },
    (old) => old?.map(apply)
  )
}

type CommentListData = CommentRow[] | undefined

function mapComments(
  data: CommentListData,
  fn: (c: CommentRow) => CommentRow
): CommentListData {
  if (!data) return data
  return data.map((top) => {
    const mapped = fn(top)
    return {
      ...mapped,
      replies: mapped.replies.map(fn),
    }
  })
}

function forEachCommentsQuery(
  qc: QueryClient,
  clipId: string,
  fn: (prev: CommentListData) => CommentListData
) {
  qc.setQueriesData<CommentListData>(
    { queryKey: commentKeys.clipLists(clipId) },
    fn
  )
}

export function useCreateCommentMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { body: string; parentId?: string }) =>
      api.comments.create({
        clipId,
        body: input.body,
        parentId: input.parentId,
      }),
    onSuccess: () => {
      bumpClipCommentCount(qc, clipId, 1)
      invalidateComments(qc, clipId)
    },
  })
}

export function useUpdateCommentMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) =>
      api.comments.update(input.commentId, input.body),
    onSuccess: (res, { commentId }) => {
      forEachCommentsQuery(qc, clipId, (old) =>
        mapComments(old, (c) =>
          c.id === commentId
            ? { ...c, body: res.body, editedAt: res.editedAt }
            : c
        )
      )
    },
  })
}

export function useDeleteCommentMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string }) =>
      api.comments.delete(input.commentId).then(() => input),
    onSuccess: () => {
      invalidateComments(qc, clipId)
      // Decrement is approximate (may include replies) — rely on refetch
      // to reconcile the exact count.
      void qc.invalidateQueries({ queryKey: clipKeys.detail(clipId) })
    },
  })
}

export function useToggleCommentLikeMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; nextLiked: boolean }) =>
      input.nextLiked
        ? api.comments.like(input.commentId).then((r) => ({ ...r, ...input }))
        : api.comments
            .unlike(input.commentId)
            .then((r) => ({ ...r, ...input })),
    onMutate: async ({ commentId, nextLiked }) => {
      await qc.cancelQueries({ queryKey: commentKeys.clipLists(clipId) })
      const snapshot = qc.getQueriesData<CommentListData>({
        queryKey: commentKeys.clipLists(clipId),
      })
      forEachCommentsQuery(qc, clipId, (old) =>
        mapComments(old, (c) =>
          c.id === commentId
            ? {
                ...c,
                likedByViewer: nextLiked,
                likeCount: Math.max(0, c.likeCount + (nextLiked ? 1 : -1)),
              }
            : c
        )
      )
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data)
    },
    onSuccess: (res) => {
      forEachCommentsQuery(qc, clipId, (old) =>
        mapComments(old, (c) =>
          c.id === res.commentId
            ? { ...c, likedByViewer: res.liked, likeCount: res.likeCount }
            : c
        )
      )
    },
  })
}

export function useTogglePinCommentMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; nextPinned: boolean }) =>
      input.nextPinned
        ? api.comments.pin(input.commentId).then(() => input)
        : api.comments.unpin(input.commentId).then(() => input),
    onSuccess: () => {
      // Pinning can affect ordering + unpin a sibling, so invalidate.
      invalidateComments(qc, clipId)
    },
  })
}

export type { CommentRow, CommentSort }
