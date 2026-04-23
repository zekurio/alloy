import type { ApiContext } from "./client"
import type { CommentRow, CommentSort } from "@workspace/db/contracts"
import { readJsonOrThrow } from "./http"

export type { CommentAuthor, CommentRow, CommentSort } from "@workspace/db/contracts"

export function createCommentsApi(context: ApiContext) {
  return {
    async fetch(clipId: string, sort: CommentSort = "top"): Promise<CommentRow[]> {
      const res = await context.client.api.clips[":id"].comments.$get({
        param: { id: clipId },
        query: { sort },
      })
      return readJsonOrThrow<CommentRow[]>(res)
    },

    async create(input: {
      clipId: string
      body: string
      parentId?: string
    }): Promise<CommentRow> {
      const res = await context.client.api.clips[":id"].comments.$post({
        param: { id: input.clipId },
        json: { body: input.body, parentId: input.parentId },
      })
      return readJsonOrThrow<CommentRow>(res)
    },

    async update(
      commentId: string,
      body: string
    ): Promise<{ id: string; body: string; editedAt: string | null }> {
      const res = await context.client.api.clips.comments[":commentId"].$patch({
        param: { commentId },
        json: { body },
      })
      return readJsonOrThrow(res)
    },

    async delete(commentId: string): Promise<void> {
      const res = await context.client.api.clips.comments[":commentId"].$delete({
        param: { commentId },
      })
      await readJsonOrThrow<{ deleted: true }>(res)
    },

    async like(
      commentId: string
    ): Promise<{ liked: boolean; likeCount: number }> {
      const res = await context.client.api.clips.comments[":commentId"].like.$post(
        {
          param: { commentId },
        }
      )
      return readJsonOrThrow(res)
    },

    async unlike(
      commentId: string
    ): Promise<{ liked: boolean; likeCount: number }> {
      const res = await context.client.api.clips.comments[
        ":commentId"
      ].like.$delete({
        param: { commentId },
      })
      return readJsonOrThrow(res)
    },

    async pin(commentId: string): Promise<{ pinned: boolean }> {
      const res = await context.client.api.clips.comments[":commentId"].pin.$post(
        {
          param: { commentId },
        }
      )
      return readJsonOrThrow(res)
    },

    async unpin(commentId: string): Promise<{ pinned: boolean }> {
      const res = await context.client.api.clips.comments[
        ":commentId"
      ].pin.$delete({
        param: { commentId },
      })
      return readJsonOrThrow(res)
    },
  }
}
