import { clip } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { selectClipById, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { withClipMediaStopped } from "@alloy/server/queue/clip-media-worker"
import {
  conflict,
  forbidden,
  internalServerError,
  notFound,
} from "@alloy/server/runtime/http-response"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

export async function updatedClipResponse(c: Context, clipId: string) {
  const updated = await selectClipById(clipId)
  if (!updated) {
    return internalServerError(c, "Clip update did not persist")
  }
  return c.json(toPublicClipRow(updated))
}

/**
 * Loads the `:id` clip into `c.var.clip` if the viewer may change it: its
 * author, or an admin when `allowAdmin` is set. A clip outside `statuses`
 * gets a 409. Goes after requireSession and the param validator.
 */
export function loadMutableClip(
  rule: { allowAdmin?: boolean; statuses?: readonly string[] } = {},
) {
  return createMiddleware<{
    Variables: { viewerId: string; clip: typeof clip.$inferSelect }
  }>(async (c, next) => {
    const [row] = await db
      .select()
      .from(clip)
      .where(eq(clip.id, c.req.param("id") ?? ""))
      .limit(1)
    if (!row) return notFound(c)

    const canMutate =
      row.author_id === c.var.viewerId ||
      (rule.allowAdmin === true && (await getSession(c))?.user.role === "admin")
    if (!canMutate) return forbidden(c)

    if (rule.statuses && !rule.statuses.includes(row.status)) {
      return conflict(c, `Clip is already ${row.status}`)
    }

    c.set("clip", row)
    await next()
  })
}

/**
 * Stops media work and uploads on the `:id` clip for the rest of the request,
 * so a later loadMutableClip reads a row neither can change underneath it.
 */
export const withClipLocks = createMiddleware(async (c, next) => {
  const id = c.req.param("id") ?? ""
  await withClipMediaStopped(id, () => withUploadActivityStopped(id, next))
})
