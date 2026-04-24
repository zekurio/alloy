import type { ApiContext } from "./client"
import type { CommentRow, CommentSort } from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  CommentAuthor,
  CommentRow,
  CommentSort,
} from "@workspace/contracts"

export function createCommentsApi(context: ApiContext) {
  return {
    async fetch(
      clipId: string,
      sort: CommentSort = "top"
    ): Promise<CommentRow[]> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(clipId)}/comments`,
        {
          query: { sort },
        }
      )
      return readJsonOrThrow<CommentRow[]>(res)
    },

    async create(input: {
      clipId: string
      body: string
      parentId?: string
    }): Promise<CommentRow> {
      const res = await context.request(
        `/api/clips/${encodeURIComponent(input.clipId)}/comments`,
        {
          method: "POST",
          json: { body: input.body, parentId: input.parentId },
        }
      )
      return readJsonOrThrow<CommentRow>(res)
    },

    async update(
      commentId: string,
      body: string
    ): Promise<{ id: string; body: string; editedAt: string | null }> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}`,
        {
          method: "PATCH",
          json: { body },
        }
      )
      return readJsonOrThrow(res)
    },

    async delete(commentId: string): Promise<void> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE" }
      )
      await readJsonOrThrow<{ deleted: true }>(res)
    },

    async like(
      commentId: string
    ): Promise<{ liked: boolean; likeCount: number }> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}/like`,
        { method: "POST" }
      )
      return readJsonOrThrow(res)
    },

    async unlike(
      commentId: string
    ): Promise<{ liked: boolean; likeCount: number }> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}/like`,
        { method: "DELETE" }
      )
      return readJsonOrThrow(res)
    },

    async pin(commentId: string): Promise<{ pinned: boolean }> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}/pin`,
        { method: "POST" }
      )
      return readJsonOrThrow(res)
    },

    async unpin(commentId: string): Promise<{ pinned: boolean }> {
      const res = await context.request(
        `/api/clips/comments/${encodeURIComponent(commentId)}/pin`,
        { method: "DELETE" }
      )
      return readJsonOrThrow(res)
    },
  }
}
