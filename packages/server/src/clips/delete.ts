import { clip, clipUploadTicket } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { eq } from "drizzle-orm"

import { db } from "../db"
import { cancelClipMediaProcessing } from "../queue/media-worker"
import { clipStorage } from "../storage"
import { deleteScratchUploads } from "../uploads/scratch"
import { publishClipRemove } from "./events"

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
): Promise<void> {
  await cancelClipMediaProcessing(row.id)
  const tickets = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(eq(clipUploadTicket.clipId, row.id))
  await db.delete(clip).where(eq(clip.id, row.id))

  const keys = [
    row.sourceKey,
    row.openGraphKey,
    ...row.variants.map((variant) => variant.storageKey),
    row.thumbKey,
  ].filter((key): key is string => Boolean(key))
  for (const key of keys) {
    try {
      await clipStorage.delete(key)
    } catch (err) {
      logger.warn(`[clips] failed to delete ${key}:`, err)
    }
  }
  await deleteScratchUploads(
    tickets.map((ticket) => ticket.storageKey),
    `clip ${row.id} staged upload`,
  )

  publishClipRemove(row.authorId, row.id)
}
