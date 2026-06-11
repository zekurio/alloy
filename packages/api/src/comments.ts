import type { CommentPage, CommentRow, CommentSort } from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  booleanFlagResponseValidator,
  validateCommentLikeState,
  validateCommentPage,
  validateCommentRow,
  validateCommentUpdateResponse,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readDeletedJson, readPostDeleteJson } from "./mutations"
import { queryParams } from "./paths"

export type {
  CommentAuthor,
  CommentPage,
  CommentRow,
  CommentSort,
} from "@alloy/contracts"
export { COMMENT_BODY_MAX_LENGTH } from "@alloy/contracts"

async function fetchComments(
  context: ApiContext,
  clipId: string,
  sort: CommentSort = "top",
  params: { limit?: number; cursor?: string | null } = {},
): Promise<CommentPage> {
  const res = await context.rpc.api.clips[":id"].comments.$get({
    param: { id: clipId },
    query: queryParams({
      sort,
      limit: params.limit,
      cursor: params.cursor,
    }),
  })
  return readJsonOrThrow(res, validateCommentPage)
}

async function createComment(
  context: ApiContext,
  input: { clipId: string; body: string; parentId?: string },
): Promise<CommentRow> {
  const res = await context.rpc.api.clips[":id"].comments.$post({
    param: { id: input.clipId },
    json: { body: input.body, parentId: input.parentId },
  })
  return readJsonOrThrow(res, validateCommentRow)
}

async function updateComment(
  context: ApiContext,
  commentId: string,
  body: string,
): Promise<{ id: string; body: string; editedAt: string | null }> {
  const res = await context.rpc.api.clips.comments[":commentId"].$patch({
    param: { commentId },
    json: { body },
  })
  return readJsonOrThrow(res, validateCommentUpdateResponse)
}

async function deleteComment(
  context: ApiContext,
  commentId: string,
): Promise<void> {
  const res = await context.rpc.api.clips.comments[":commentId"].$delete({
    param: { commentId },
  })
  await readDeletedJson(res)
}

async function setCommentLike(
  context: ApiContext,
  commentId: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  return readPostDeleteJson(
    liked,
    {
      post: () =>
        context.rpc.api.clips.comments[":commentId"].like.$post({
          param: { commentId },
        }),
      delete: () =>
        context.rpc.api.clips.comments[":commentId"].like.$delete({
          param: { commentId },
        }),
    },
    validateCommentLikeState,
  )
}

async function setCommentPinned(
  context: ApiContext,
  commentId: string,
  pinned: boolean,
): Promise<{ pinned: boolean }> {
  const response = await readPostDeleteJson(
    pinned,
    {
      post: () =>
        context.rpc.api.clips.comments[":commentId"].pin.$post({
          param: { commentId },
        }),
      delete: () =>
        context.rpc.api.clips.comments[":commentId"].pin.$delete({
          param: { commentId },
        }),
    },
    booleanFlagResponseValidator("pinned", pinned),
  )
  return { pinned: response.pinned }
}

export function createCommentsApi(context: ApiContext) {
  return {
    fetch: (
      clipId: string,
      sort: CommentSort = "top",
      params: { limit?: number; cursor?: string | null } = {},
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
