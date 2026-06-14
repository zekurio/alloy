import { stagingRecording } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  conflict,
  internalServerError,
  notFound,
} from "@alloy/server/runtime/http-response"
import { eq } from "drizzle-orm"
import type { Context } from "hono"

import { selectStagingById, toStagingRow } from "./select"

type StagingAccess =
  | { row: typeof stagingRecording.$inferSelect }
  | { response: Response }

/**
 * Staging recordings are strictly owner-only and never registered in the clip
 * namespace, so a non-owner (or unknown id) gets a flat 404 — existence is not
 * revealed.
 */
export async function selectStagingForOwner(
  c: Context,
  input: { id: string; viewerId: string; statuses?: readonly string[] },
): Promise<StagingAccess> {
  const [row] = await db
    .select()
    .from(stagingRecording)
    .where(eq(stagingRecording.id, input.id))
    .limit(1)
  if (!row || row.authorId !== input.viewerId) return { response: notFound(c) }
  if (input.statuses && !input.statuses.includes(row.status)) {
    return { response: conflict(c, `Recording is already ${row.status}`) }
  }
  return { row }
}

export async function stagingRowResponse(
  c: Context,
  id: string,
  viewerId: string,
) {
  const row = await selectStagingById(id, viewerId)
  if (!row) return internalServerError(c, "Recording did not persist")
  return c.json(toStagingRow(row))
}
