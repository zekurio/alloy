import { clip, clipView } from "@alloy/db/schema"
import { applyViewerCookie, resolveViewer } from "@alloy/server/auth/viewer-key"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import { noContent } from "@alloy/server/runtime/http-response"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { IdParam } from "./clips-helpers"
import { tbValidator } from "./validation"

export const clipsViewRoutes = new Hono().post(
  "/:id/view",
  tbValidator("param", IdParam),
  async (c) => {
    const { id } = c.req.valid("param")

    const target = await resolveClipAccess({ id, c, policy: "engagement" })
    if (!target.accessible) return clipAccessResponse(c, target)

    const viewer = await resolveViewer(c)

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(clipView)
        .values({
          clip_id: id,
          viewer_key: viewer.viewerKey,
          user_id: viewer.userId,
        })
        .onConflictDoNothing()
        .returning({ clipId: clipView.clip_id })
      if (inserted.length > 0) {
        await tx
          .update(clip)
          .set({ view_count: sql`${clip.view_count} + 1` })
          .where(eq(clip.id, id))
      }
    })
    applyViewerCookie(c, viewer.cookieToSet)

    return noContent(c)
  },
)
