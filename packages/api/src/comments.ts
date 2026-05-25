import type { ApiContext } from "./client"
import type { CommentPage, CommentRow, CommentSort } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import { validateBooleanFlag, validateObject } from "./contract-validators"

export type {
  CommentAuthor,
  CommentPage,
  CommentRow,
  CommentSort,
} from "@workspace/contracts"

async function fetchComments(
  context: ApiContext,
  clipId: string,
  sort: CommentSort = "top",
  params: { limit?: number; cursor?: string | null } = {}
): Promise<CommentPage> {
  const query: Record<string, string> = { sort }
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor
  const res = await context.rpc.api.clips[":id"].comments.$get({
    param: { id: clipId },
    query,
  })
  return readJsonOrThrow(res, (value) =>
    validateObject<CommentPage>(value, "comments")
  )
}

async function createComment(
  context: ApiContext,
  input: { clipId: string; body: string; parentId?: string }
): Promise<CommentRow> {
  const res = await context.rpc.api.clips[":id"].comments.$post({
    param: { id: input.clipId },
    json: { body: input.body, parentId: input.parentId },
  })
  return readJsonOrThrow(res, (value) =>
    validateObject<CommentRow>(value, "comment")
  )
}

async function updateComment(
  context: ApiContext,
  commentId: string,
  body: string
): Promise<{ id: string; body: string; editedAt: string | null }> {
  const res = await context.rpc.api.clips.comments[":commentId"].$patch({
    param: { commentId },
    json: { body },
  })
  return readJsonOrThrow(res, (value) =>
    validateObject<{ id: string; body: string; editedAt: string | null }>(
      value,
      "comment update"
    )
  )
}

async function deleteComment(
  context: ApiContext,
  commentId: string
): Promise<void> {
  const res = await context.rpc.api.clips.comments[":commentId"].$delete({
    param: { commentId },
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "deleted", true)
}

async function setCommentLike(
  context: ApiContext,
  commentId: string,
  liked: boolean
): Promise<{ liked: boolean; likeCount: number }> {
  const res = liked
    ? await context.rpc.api.clips.comments[":commentId"].like.$post({
        param: { commentId },
      })
    : await context.rpc.api.clips.comments[":commentId"].like.$delete({
        param: { commentId },
      })
  return readJsonOrThrow(res, (value) =>
    validateObject<{ liked: boolean; likeCount: number }>(value, "comment like")
  )
}

async function setCommentPinned(
  context: ApiContext,
  commentId: string,
  pinned: boolean
): Promise<{ pinned: boolean }> {
  const res = pinned
    ? await context.rpc.api.clips.comments[":commentId"].pin.$post({
        param: { commentId },
      })
    : await context.rpc.api.clips.comments[":commentId"].pin.$delete({
        param: { commentId },
      })
  const response = validateBooleanFlag(
    await readJsonOrThrow<unknown>(res),
    "pinned",
    pinned
  )
  return { pinned: response.pinned }
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
