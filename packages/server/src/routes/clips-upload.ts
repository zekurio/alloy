import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { requireSession } from "@alloy/server/auth/require-session"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { getGameRefById } from "@alloy/server/games/ref"
import { createNotification } from "@alloy/server/notifications/service"
import { badRequest, deleted } from "@alloy/server/runtime/http-response"
import { announceClipPublished } from "@alloy/server/webhooks/publish"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam, UpdateBody } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import { resolveMentionIds } from "./clips-upload-helpers"
import { clipsUploadLifecycleRoutes } from "./clips-upload-lifecycle"
import { clipsUploadMediaRoutes } from "./clips-upload-media"
import { tbValidator } from "./validation"

const logger = createLogger("clips-upload")

export const clipsUploadRoutes = new Hono()
  .route("/", clipsUploadLifecycleRoutes)
  .route("/", clipsUploadMediaRoutes)
  .patch(
    "/:id",
    requireSession,
    tbValidator("param", IdParam),
    tbValidator("json", UpdateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        allowAdmin: true,
      })
      if ("response" in access) return access.response
      const row = access.row

      const patch: Partial<typeof clip.$inferInsert> = {
        updated_at: new Date(),
      }
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) {
        patch.description = body.description === "" ? null : body.description
      }
      if (body.gameId !== undefined) {
        if (body.gameId === null) {
          patch.game_id = null
          patch.game = null
        } else {
          const gameRef = await getGameRefById(body.gameId)
          if (!gameRef) return badRequest(c, "Unknown game")
          patch.game_id = gameRef.id
          patch.game = gameRef.name
        }
      }
      if (body.privacy !== undefined) patch.privacy = body.privacy
      // Write-once: a privacy round-trip keeps the first stamp so re-publishing
      // can't bump feed position.
      const publishRequested =
        body.privacy === "public" && row.privacy !== "public"

      const mentionedIds =
        body.mentionedUserIds !== undefined
          ? await resolveMentionIds(body.mentionedUserIds, row.author_id)
          : undefined
      const existingMentionedIds =
        mentionedIds !== undefined
          ? (
              await db
                .select({ mentionedUserId: clipMention.mentioned_user_id })
                .from(clipMention)
                .where(eq(clipMention.clip_id, id))
            ).map((mention) => mention.mentionedUserId)
          : []

      const tags =
        body.tags !== undefined ? normalizeTags(body.tags) : undefined

      await db.transaction(async (tx) => {
        await tx
          .update(clip)
          .set({
            ...patch,
            ...(body.privacy === "public"
              ? {
                  // Evaluate under the update lock: a processing clip can
                  // become ready between the access read above and this write.
                  // The encode pipeline stamps rows that are not ready yet.
                  published_at: sql`case when ${clip.status} = 'ready' then coalesce(${clip.published_at}, now()) else ${clip.published_at} end`,
                }
              : {}),
          })
          .where(eq(clip.id, id))

        if (mentionedIds !== undefined) {
          await tx.delete(clipMention).where(eq(clipMention.clip_id, id))
          if (mentionedIds.length > 0) {
            await tx.insert(clipMention).values(
              mentionedIds.map((mentionedUserId) => ({
                clip_id: id,
                mentioned_user_id: mentionedUserId,
              })),
            )
          }
        }

        if (tags === undefined) return
        await tx.delete(clipTag).where(eq(clipTag.clip_id, id))
        if (tags.length > 0) {
          await tx
            .insert(clipTag)
            .values(tags.map((tag) => ({ clip_id: id, tag })))
        }
      })

      void publishClipUpsert(row.author_id, id)
      // A clip that was already encoded and is only now being made public
      // never passes through the encode job's announce path. The dispatcher
      // re-checks ready+public, so a still-processing clip is announced by the
      // pipeline when it gets there instead.
      if (publishRequested) {
        announceClipPublished(id)
      }
      if (mentionedIds !== undefined && row.status === "ready") {
        const existingMentionedIdSet = new Set(existingMentionedIds)
        for (const mentionedId of mentionedIds) {
          if (existingMentionedIdSet.has(mentionedId)) continue
          void createNotification({
            recipientId: mentionedId,
            actorId: viewerId,
            kind: "clip_mention",
            clipId: id,
            dedupKey: `clip_mention:${id}`,
          }).catch((error) =>
            logger.error("notification fan-out failed", error),
          )
        }
      }

      return updatedClipResponse(c, id)
    },
  )
  .delete("/:id", requireSession, tbValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")

    const access = await selectClipForMutation(c, {
      id,
      viewerId,
      allowAdmin: true,
    })
    if ("response" in access) return access.response
    const row = access.row

    await deleteClipRowAndAssets(row)
    return deleted(c)
  })
