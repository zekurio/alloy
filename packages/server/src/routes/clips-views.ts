import { clip, clipView } from "@alloy/db/schema"
import {
  applyViewerCookie,
  type ResolvedViewer,
  resolveViewer,
} from "@alloy/server/auth/viewer-key"
import {
  clipAccessResponse,
  resolveClipAccess,
} from "@alloy/server/clips/access"
import { db } from "@alloy/server/db/index"
import { noContent } from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { IdParam, tbValidator } from "./validation"

type ViewerEnv = { Variables: { viewer: ResolvedViewer } }

const withViewer = createMiddleware<ViewerEnv>(async (c, next) => {
  c.set("viewer", await resolveViewer(c))
  await next()
})

/**
 * A signed-in view counts once per user. An anonymous one counts once per
 * viewer cookie, which a client can drop to mint another, so anonymous views
 * are bounded per address instead: room for a visitor browsing clips, not for
 * a loop inflating counts and the view table.
 */
const anonymousViewRateLimit = rateLimiter<ViewerEnv>({
  windowMs: 10 * 60 * 1000,
  max: 60,
  key: (c) => (c.var.viewer.userId === null ? requestIp(c) : null),
})

export const clipsViewRoutes = new Hono().post(
  "/:id/view",
  tbValidator("param", IdParam),
  withViewer,
  anonymousViewRateLimit,
  async (c) => {
    const { id } = c.req.valid("param")

    const target = await resolveClipAccess({ id, c, policy: "engagement" })
    if (!target.accessible) return clipAccessResponse(c, target)

    const viewer = c.var.viewer

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
