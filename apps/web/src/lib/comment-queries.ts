import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  type QueryFilters,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import type { CommentPage, CommentRow, CommentSort } from "@workspace/api"

import { api } from "./api"
import { adjustClipCountsInCaches } from "./clip-queries"
import { isoDateString } from "./date-format"

const commentKeys = {
  all: ["comments"] as const,
  list: (clipId: string, sort: CommentSort, limit: number) =>
    [...commentKeys.all, "list", { clipId, sort, limit }] as const,
}

function commentListFilter(clipId: string): QueryFilters {
  return {
    predicate: (q) => {
      const [root, kind, payload] = q.queryKey
      const queryClipId =
        payload && typeof payload === "object" && "clipId" in payload
          ? payload.clipId
          : undefined
      return root === "comments" && kind === "list" && queryClipId === clipId
    },
  }
}

export function useCommentsQuery(
  clipId: string,
  sort: CommentSort = "top",
  { limit = 30 }: { limit?: number } = {},
) {
  return useInfiniteQuery(commentListQueryOptions(clipId, sort, limit))
}

export function commentListQueryOptions(
  clipId: string,
  sort: CommentSort = "top",
  limit = 30,
) {
  return infiniteQueryOptions({
    queryKey: commentKeys.list(clipId, sort, limit),
    queryFn: ({ pageParam }) =>
      api.comments.fetch(clipId, sort, {
        limit,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: clipId.length > 0,
    placeholderData: keepPreviousData,
  })
}

function invalidateComments(qc: QueryClient, clipId: string) {
  void qc.invalidateQueries(commentListFilter(clipId))
}

type CommentListData = InfiniteData<CommentPage, string | null> | undefined

function mapComments(
  data: CommentListData,
  fn: (c: CommentRow) => CommentRow,
): CommentListData {
  if (!data) return data
  const mapComment = (comment: CommentRow): CommentRow => {
    const mapped = fn(comment)
    return {
      ...mapped,
      replies: mapped.replies.map(mapComment),
    }
  }
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map(mapComment),
    })),
  }
}

function forEachCommentsQuery(
  qc: QueryClient,
  clipId: string,
  fn: (prev: CommentListData) => CommentListData,
) {
  qc.setQueriesData<CommentListData>(commentListFilter(clipId), fn)
}

function softDeletedComment(row: CommentRow): CommentRow {
  return {
    ...row,
    body: "",
    editedAt: isoDateString(),
    pinned: false,
    pinnedAt: null,
  }
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
      adjustClipCountsInCaches(qc, clipId, { commentCount: 1 })
      invalidateComments(qc, clipId)
    },
  })
}

export function useDeleteCommentMutation(clipId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string }) =>
      api.comments.delete(input.commentId).then(() => input),
    onSuccess: (_res, { commentId }) => {
      forEachCommentsQuery(
        qc,
        clipId,
        (old) =>
          mapComments(
            old,
            (c) => c.id === commentId ? softDeletedComment(c) : c,
          ),
      )
      invalidateComments(qc, clipId)
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
      const listFilter = commentListFilter(clipId)
      await qc.cancelQueries(listFilter)
      const snapshot = qc.getQueriesData<CommentListData>(listFilter)
      forEachCommentsQuery(
        qc,
        clipId,
        (old) =>
          mapComments(old, (c) =>
            c.id === commentId
              ? {
                ...c,
                likedByViewer: nextLiked,
                likeCount: Math.max(0, c.likeCount + (nextLiked ? 1 : -1)),
              }
              : c),
      )
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data)
    },
    onSuccess: (res) => {
      forEachCommentsQuery(
        qc,
        clipId,
        (old) =>
          mapComments(
            old,
            (c) =>
              c.id === res.commentId
                ? { ...c, likedByViewer: res.liked, likeCount: res.likeCount }
                : c,
          ),
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
