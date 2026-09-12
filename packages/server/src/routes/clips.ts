import { clip } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { selectClipById, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { notFound, success } from "@alloy/server/runtime/http-response"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { clipsAnnouncementRoutes } from "./clips-announcements"
import { IdParam } from "./clips-helpers"
import { clipsPlaybackRoutes } from "./clips-playback"
import { clipsUploadRoutes } from "./clips-upload"
import { clipsViewRoutes } from "./clips-views"
import { tbValidator } from "./validation"

export const clips = new Hono()
  .post(
    "/:id/queue-dismissal",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      const authorId = c.var.viewerId
      const [updated] = await db
        .update(clip)
        .set({
          queue_dismissed_at: sql`coalesce(${clip.queue_dismissed_at}, now())`,
        })
        .where(and(eq(clip.id, id), eq(clip.author_id, authorId)))
        .returning({ id: clip.id })
      if (!updated) return notFound(c)
      await publishClipUpsert(authorId, id)
      return success(c)
    },
  )
  .get("/:id", tbValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      c,
      policy: "metadata",
    })
    if (!access.accessible) return clipAccessResponse(c, access)

    const row = await selectClipById(id)
    if (!row) return notFound(c)
    return c.json(toPublicClipRow(row))
  })
  .route("/", clipsUploadRoutes)
  .route("/", clipsAnnouncementRoutes)
  .route("/", clipsViewRoutes)
  .route("/", clipsPlaybackRoutes)
