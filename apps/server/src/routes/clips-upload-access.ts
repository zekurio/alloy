import { eq } from "drizzle-orm"
import type { Context } from "hono"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../auth/session"
import { selectClipById, toPublicClipRow } from "../clips/select"
import {
  conflict,
  forbidden,
  internalServerError,
  notFound,
} from "../runtime/http-response"

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

async function canAdminMutateClip(c: Context): Promise<boolean> {
  const session = await getSession(c)
  return (
    (session?.user as { role?: string | null } | undefined)?.role === "admin"
  )
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

  const canMutate = row.authorId === input.viewerId ||
    (input.allowAdmin === true && (await canAdminMutateClip(c)))
  if (!canMutate) return { response: forbidden(c) }

  if (input.statuses && !input.statuses.includes(row.status)) {
    return {
      response: conflict(c, `Clip is already ${row.status}`),
    }
  }

  return { row }
}
