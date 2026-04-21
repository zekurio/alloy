import { api } from "./api"
import { readJsonOrThrow } from "./http-error"

export interface CommentAuthor {
  id: string
  username: string | null
  displayUsername: string | null
  name: string
  image: string | null
}

export interface CommentRow {
  id: string
  clipId: string
  parentId: string | null
  body: string
  likeCount: number
  pinned: boolean
  pinnedAt: string | null
  likedByViewer: boolean
  likedByAuthor: boolean
  createdAt: string
  editedAt: string | null
  author: CommentAuthor
  replies: CommentRow[]
}

export type CommentSort = "top" | "new"

export async function fetchComments(
  clipId: string,
  sort: CommentSort = "top"
): Promise<CommentRow[]> {
  const res = await api.api.clips[":id"].comments.$get({
    param: { id: clipId },
    query: { sort },
  })
  return readJsonOrThrow<CommentRow[]>(res)
}

export async function createComment(input: {
  clipId: string
  body: string
  parentId?: string
}): Promise<CommentRow> {
  const res = await api.api.clips[":id"].comments.$post({
    param: { id: input.clipId },
    json: { body: input.body, parentId: input.parentId },
  })
  return readJsonOrThrow<CommentRow>(res)
}

export async function updateComment(
  commentId: string,
  body: string
): Promise<{ id: string; body: string; editedAt: string | null }> {
  const res = await api.api.clips.comments[":commentId"].$patch({
    param: { commentId },
    json: { body },
  })
  return readJsonOrThrow(res)
}

export async function deleteComment(commentId: string): Promise<void> {
  const res = await api.api.clips.comments[":commentId"].$delete({
    param: { commentId },
  })
  await readJsonOrThrow<{ deleted: true }>(res)
}

export async function likeComment(
  commentId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await api.api.clips.comments[":commentId"].like.$post({
    param: { commentId },
  })
  return readJsonOrThrow(res)
}

export async function unlikeComment(
  commentId: string
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await api.api.clips.comments[":commentId"].like.$delete({
    param: { commentId },
  })
  return readJsonOrThrow(res)
}

export async function pinComment(
  commentId: string
): Promise<{ pinned: boolean }> {
  const res = await api.api.clips.comments[":commentId"].pin.$post({
    param: { commentId },
  })
  return readJsonOrThrow(res)
}

export async function unpinComment(
  commentId: string
): Promise<{ pinned: boolean }> {
  const res = await api.api.clips.comments[":commentId"].pin.$delete({
    param: { commentId },
  })
  return readJsonOrThrow(res)
}
