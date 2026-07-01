import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { getGameRefById } from "@alloy/server/games/ref"
import { enqueueClipMediaProcessing } from "@alloy/server/queue/index"
import {
  badRequest,
  conflict,
  deleted,
} from "@alloy/server/runtime/http-response"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"

import {
  IdParam,
  TRIM_MIN_RANGE_MS,
  TrimBody,
  UpdateBody,
} from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import { resolveMentionIds } from "./clips-upload-helpers"
import { clipsUploadLifecycleRoutes } from "./clips-upload-lifecycle"
import { zValidator } from "./validation"

/** Slack when deciding whether a requested trim still covers the full clip. */
const TRIM_FULL_RANGE_TOLERANCE_MS = 50

export const clipsUploadRoutes = new Hono()
  .route("/", clipsUploadLifecycleRoutes)
  .patch(
    "/:id",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", UpdateBody),
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

      const mentionedIds =
        body.mentionedUserIds !== undefined
          ? await resolveMentionIds(body.mentionedUserIds, row.author_id)
          : undefined

      const tags =
        body.tags !== undefined ? normalizeTags(body.tags) : undefined

      await db.transaction(async (tx) => {
        await tx.update(clip).set(patch).where(eq(clip.id, id))

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

      return updatedClipResponse(c, id)
    },
  )
  .post(
    "/:id/trim",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", TrimBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const access = await selectClipForMutation(c, {
        id,
        viewerId,
        statuses: ["ready"],
      })
      if ("response" in access) return access.response
      const row = access.row

      if (!row.source_key) return badRequest(c, "Clip has no source media")
      const durationMs = row.duration_ms
      if (durationMs == null || durationMs <= 0) {
        return badRequest(c, "Clip duration is unknown")
      }

      const startMs = Math.max(0, body.startMs)
      const endMs = Math.min(durationMs, body.endMs)
      if (endMs - startMs < TRIM_MIN_RANGE_MS) {
        return badRequest(c, "The trimmed range is too short")
      }
      if (
        startMs <= TRIM_FULL_RANGE_TOLERANCE_MS &&
        endMs >= durationMs - TRIM_FULL_RANGE_TOLERANCE_MS
      ) {
        return badRequest(c, "The trim covers the whole clip")
      }

      // The status flip doubles as the concurrency guard: a clip mid-encode
      // is no longer "ready", so two trims can't race each other.
      const [accepted] = await db
        .update(clip)
        .set({
          trim_start_ms: startMs,
          trim_end_ms: endMs,
          status: "processing",
          encode_progress: 0,
          encode_attempt: 0,
          failure_reason: null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(clip.id, id),
            eq(clip.author_id, row.author_id),
            eq(clip.status, "ready"),
          ),
        )
        .returning({ id: clip.id })
      if (!accepted) return conflict(c, "Clip is already processing")

      void publishClipUpsert(row.author_id, id)
      enqueueClipMediaProcessing(id)

      return updatedClipResponse(c, id)
    },
  )
  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
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
