import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { cancelClipMediaProcessing } from "@alloy/server/queue/media-worker"
import { clipStorage } from "@alloy/server/storage/index"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { eq } from "drizzle-orm"

import { publishClipRemove } from "./events"

const logger = createLogger("clips")

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
): Promise<void> {
  await cancelClipMediaProcessing(row.id)
  await db.delete(clip).where(eq(clip.id, row.id))

  const keys = [row.sourceKey, row.thumbKey].filter((key): key is string =>
    Boolean(key),
  )
  for (const key of keys) {
    try {
      await clipStorage.delete(key)
    } catch (err) {
      logger.warn(`failed to delete ${key}:`, err)
    }
  }
  await cleanupTickets(
    { type: "clip", id: row.id },
    `clip ${row.id} staged upload`,
  )

  publishClipRemove(row.authorId, row.id)
}
