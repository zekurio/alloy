import type { ApiContext } from "./client"
import type { CommentPage, CommentRow, CommentSort } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  CommentAuthor,
  CommentPage,
  CommentRow,
  CommentSort,
} from "@workspace/contracts"

function commentPath(commentId: string, suffix = "") {
  return `/api/clips/comments/${encodeURIComponent(commentId)}${suffix}`
}

async function fetchComments(
  context: ApiContext,
  clipId: string,
  sort: CommentSort = "top",
  params: { limit?: number; cursor?: string | null } = {}
): Promise<CommentPage> {
  const query: Record<string, string> = { sort }
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor
  const res = await context.request(
    `/api/clips/${encodeURIComponent(clipId)}/comments`,
    { query }
  )
  return readJsonOrThrow<CommentPage>(res)
}

async function createComment(
  context: ApiContext,
  input: { clipId: string; body: string; parentId?: string }
): Promise<CommentRow> {
  const res = await context.request(
    `/api/clips/${encodeURIComponent(input.clipId)}/comments`,
    {
      method: "POST",
      json: { body: input.body, parentId: input.parentId },
    }
  )
  return readJsonOrThrow<CommentRow>(res)
}

async function updateComment(
  context: ApiContext,
  commentId: string,
  body: string
): Promise<{ id: string; body: string; editedAt: string | null }> {
  const res = await context.request(commentPath(commentId), {
    method: "PATCH",
    json: { body },
  })
  return readJsonOrThrow(res)
}

async function deleteComment(
  context: ApiContext,
  commentId: string
): Promise<void> {
  const res = await context.request(commentPath(commentId), {
    method: "DELETE",
  })
  await readJsonOrThrow<{ deleted: true }>(res)
}

async function setCommentLike(
  context: ApiContext,
  commentId: string,
  liked: boolean
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await context.request(commentPath(commentId, "/like"), {
    method: liked ? "POST" : "DELETE",
  })
  return readJsonOrThrow(res)
}

async function setCommentPinned(
  context: ApiContext,
  commentId: string,
  pinned: boolean
): Promise<{ pinned: boolean }> {
  const res = await context.request(commentPath(commentId, "/pin"), {
    method: pinned ? "POST" : "DELETE",
  })
  return readJsonOrThrow(res)
}

export function createCommentsApi(context: ApiContext) {
  return {
    fetch: (
      clipId: string,
      sort: CommentSort = "top",
      params: { limit?: number; cursor?: string | null } = {}
    ) => fetchComments(context, clipId, sort, params),
    create: (input: { clipId: string; body: string; parentId?: string }) =>
      createComment(context, input),
    update: (commentId: string, body: string) =>
      updateComment(context, commentId, body),
    delete: (commentId: string) => deleteComment(context, commentId),
    like: (commentId: string) => setCommentLike(context, commentId, true),
    unlike: (commentId: string) => setCommentLike(context, commentId, false),
    pin: (commentId: string) => setCommentPinned(context, commentId, true),
    unpin: (commentId: string) => setCommentPinned(context, commentId, false),
  }
}
