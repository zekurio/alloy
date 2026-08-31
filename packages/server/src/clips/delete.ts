import { clip, clipAudioTrack, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { withClipMediaStopped } from "@alloy/server/queue/clip-media-worker"
import { clipStorageForKey } from "@alloy/server/storage/index"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { eq } from "drizzle-orm"

import { publishClipRemove } from "./events"

const logger = createLogger("clips")

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
): Promise<void> {
  await withClipMediaStopped(row.id, async () => {
    const deleted = await db.transaction(async (tx) => {
      // Re-read after an active run has stopped: it may have committed fresh
      // base assets before observing cancellation. The row lock keeps later
      // clip mutations from attaching another key after this snapshot.
      const [fresh] = await tx
        .select({
          authorId: clip.author_id,
          sourceKey: clip.source_key,
          cutKey: clip.cut_key,
          thumbKey: clip.thumb_key,
        })
        .from(clip)
        .where(eq(clip.id, row.id))
        .limit(1)
        .for("update")
      if (!fresh) return null

      const renditionRows = await tx
        .select({ storageKey: clipRendition.storage_key })
        .from(clipRendition)
        .where(eq(clipRendition.clip_id, row.id))
      const audioTrackRows = await tx
        .select({ storageKey: clipAudioTrack.storage_key })
        .from(clipAudioTrack)
        .where(eq(clipAudioTrack.clip_id, row.id))
      await tx.delete(clip).where(eq(clip.id, row.id))
      return {
        authorId: fresh.authorId,
        keys: [
          fresh.sourceKey,
          fresh.cutKey,
          fresh.thumbKey,
          ...renditionRows.map((rendition) => rendition.storageKey),
          ...audioTrackRows.map((track) => track.storageKey),
        ].filter((key): key is string => Boolean(key)),
      }
    })
    if (!deleted) return

    for (const key of deleted.keys) {
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

    publishClipRemove(deleted.authorId, row.id)
  })
}
