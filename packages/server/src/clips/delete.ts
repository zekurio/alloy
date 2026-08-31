import { clip, clipAudioTrack, clipRendition } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { withClipMediaStopped } from "@alloy/server/queue/clip-media-worker"
import { clipStorageDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletion } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { eq } from "drizzle-orm"

import { publishClipRemove } from "./events"

export interface DeleteClipRowOptions {
  /** Re-check scheduler ownership after taking the row lock. */
  expectedStatus?: (typeof clip.$inferSelect)["status"]
}

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
  options: DeleteClipRowOptions = {},
): Promise<void> {
  await withClipMediaStopped(row.id, () =>
    withUploadActivityStopped(row.id, async () => {
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
            status: clip.status,
          })
          .from(clip)
          .where(eq(clip.id, row.id))
          .limit(1)
          .for("update")
        if (!fresh) return null
        if (
          options.expectedStatus !== undefined &&
          fresh.status !== options.expectedStatus
        ) {
          return null
        }

        const renditionRows = await tx
          .select({ storageKey: clipRendition.storage_key })
          .from(clipRendition)
          .where(eq(clipRendition.clip_id, row.id))
        const audioTrackRows = await tx
          .select({ storageKey: clipAudioTrack.storage_key })
          .from(clipAudioTrack)
          .where(eq(clipAudioTrack.clip_id, row.id))
        const assetIntents = clipStorageDeletionIntents({
          clipId: row.id,
          sourceKey: fresh.sourceKey,
          cutKey: fresh.cutKey,
          thumbKey: fresh.thumbKey,
          renditionKeys: renditionRows.map((rendition) => rendition.storageKey),
          audioTrackKeys: audioTrackRows.map((track) => track.storageKey),
        })
        for (const intent of assetIntents) {
          await enqueueStorageDeletion(intent, { tx })
        }
        const stagedIntents = await deleteUploadTicketsWithStorageIntents(
          { type: "clip", id: row.id },
          `clip ${row.id} deleted`,
          tx,
        )
        await tx.delete(clip).where(eq(clip.id, row.id))
        return {
          authorId: fresh.authorId,
          queuedDeletions: assetIntents.length + stagedIntents,
        }
      })
      if (!deleted) return

      if (deleted.queuedDeletions > 0) wakeStorageDeletionWorker()
      publishClipRemove(deleted.authorId, row.id)
    }),
  )
}
