import { clip } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import { selectClipById, toPublicClipRow } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import {
  conflict,
  forbidden,
  internalServerError,
  notFound,
} from "@alloy/server/runtime/http-response"
import { eq } from "drizzle-orm"
import type { Context } from "hono"

type ClipMutationAccess =
  | { row: typeof clip.$inferSelect }
  | { response: Response }

export async function updatedClipResponse(c: Context, clipId: string) {
  const updated = await selectClipById(clipId)
  if (!updated) {
    return internalServerError(c, "Clip update did not persist")
  }
  return c.json(toPublicClipRow(updated))
}

export async function selectClipForMutation(
  c: Context,
  input: {
    id: string
    viewerId: string
    allowAdmin?: boolean
    statuses?: readonly string[]
  },
): Promise<ClipMutationAccess> {
  const [row] = await db
    .select()
    .from(clip)
    .where(eq(clip.id, input.id))
    .limit(1)
  if (!row) return { response: notFound(c) }

  const canMutate =
    row.author_id === input.viewerId ||
    (input.allowAdmin === true && (await getSession(c))?.user.role === "admin")
  if (!canMutate) return { response: forbidden(c) }

  if (input.statuses && !input.statuses.includes(row.status)) {
    return {
      response: conflict(c, `Clip is already ${row.status}`),
    }
  }

  return { row }
}
