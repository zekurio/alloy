import { clip, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { cancelClipEncode } from "@alloy/server/jobs/kinds/clip-encode"
import {
  enqueueWebhookRetract,
  wakeWebhookQueue,
} from "@alloy/server/jobs/kinds/webhook-sync"
import { clipStorageForKey } from "@alloy/server/storage/index"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { eq } from "drizzle-orm"

import { publishClipRemove } from "./events"
import { clipScrubberKey } from "./scrubber"

const logger = createLogger("clips")

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
): Promise<void> {
  await cancelClipEncode(row.id)
  const renditionRows = await db
    .select({ storageKey: clipRendition.storage_key })
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, row.id))
  // The clip row disappears here, so the webhook reconciler could never read
  // it: retract the Discord announcement via a one-shot job that carries the
  // message id, enqueued atomically with the delete.
  await db.transaction(async (tx) => {
    await tx.delete(clip).where(eq(clip.id, row.id))
    if (row.announce_message_id) {
      await enqueueWebhookRetract(row.announce_message_id, { tx })
    }
  })
  if (row.announce_message_id) wakeWebhookQueue()

  const keys = [
    row.source_key,
    row.cut_key,
    row.thumb_key,
    ...renditionRows.map((rendition) => rendition.storageKey),
    // Deterministic derived asset; deleting a never-generated key is a no-op.
    clipScrubberKey(row.id),
  ].filter((key): key is string => Boolean(key))
  for (const key of keys) {
    try {
      await clipStorageForKey(key).delete(key)
    } catch (err) {
      logger.warn(`failed to delete ${key}:`, err)
    }
  }
  await cleanupTickets(
    { type: "clip", id: row.id },
    `clip ${row.id} staged upload`,
  )

  publishClipRemove(row.author_id, row.id)
}
