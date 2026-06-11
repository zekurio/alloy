import { normalizeTags } from "@alloy/contracts"
import { clip, clipMention, clipTag } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { getSteamGridGameRef } from "@alloy/server/games/ref"
import { enqueueClipMediaProcessing } from "@alloy/server/queue/index"
import {
  badRequest,
  conflict,
  deleted,
  errorResult,
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
import { sgdbErrorResponse } from "./games-helpers"
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
        updatedAt: new Date(),
      }
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) {
        patch.description = body.description === "" ? null : body.description
      }
      if (body.steamgriddbId !== undefined) {
        let gameRef: Awaited<ReturnType<typeof getSteamGridGameRef>>
        try {
          gameRef = await getSteamGridGameRef(body.steamgriddbId)
        } catch (err) {
          return errorResult(c, sgdbErrorResponse(err))
        }
        if (!gameRef) return badRequest(c, "Unknown game")
        patch.steamgriddbId = body.steamgriddbId
        patch.game = gameRef.name
      }
      if (body.privacy !== undefined) patch.privacy = body.privacy

      await db.update(clip).set(patch).where(eq(clip.id, id))

      if (body.mentionedUserIds !== undefined) {
        const mentionedIds = await resolveMentionIds(
          body.mentionedUserIds,
          row.authorId,
        )
        await db.delete(clipMention).where(eq(clipMention.clipId, id))
        if (mentionedIds.length > 0) {
          await db.insert(clipMention).values(
            mentionedIds.map((mentionedUserId) => ({
              clipId: id,
              mentionedUserId,
            })),
          )
        }
      }

      if (body.tags !== undefined) {
        const tags = normalizeTags(body.tags)
        await db.delete(clipTag).where(eq(clipTag.clipId, id))
        if (tags.length > 0) {
          await db
            .insert(clipTag)
            .values(tags.map((tag) => ({ clipId: id, tag })))
        }
      }

      void publishClipUpsert(row.authorId, id)

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

      if (!row.sourceKey) return badRequest(c, "Clip has no source media")
      const durationMs = row.durationMs
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
          trimStartMs: startMs,
          trimEndMs: endMs,
          status: "processing",
          encodeProgress: 0,
          encodeAttempt: 0,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clip.id, id),
            eq(clip.authorId, row.authorId),
            eq(clip.status, "ready"),
          ),
        )
        .returning({ id: clip.id })
      if (!accepted) return conflict(c, "Clip is already processing")

      void publishClipUpsert(row.authorId, id)
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
