import { clip, clipRendition } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { withClipMediaStopped } from "@alloy/server/queue/clip-media-worker"
import { validateStorageKey } from "@alloy/server/storage/deletion-policy"
import { clipStorageDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { clipAssetDir } from "@alloy/server/storage/driver"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { pendingUploadCleanupStillDue } from "@alloy/server/uploads/deadline"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { eq, sql } from "drizzle-orm"

import { publishClipRemove } from "./events"

const logger = createLogger("clips")

export interface DeleteClipRowOptions {
  /** Re-check scheduler ownership after taking the row lock. */
  expectedStatus?: (typeof clip.$inferSelect)["status"]
  /** Re-check the exact selected upload deadline after both gates drain. */
  expectedUploadCleanupAt?: Date
  /** Caller already holds media-stop outside upload-stop for this clip. */
  ownershipStopped?: boolean
}

export async function deleteClipRowAndAssets(
  row: typeof clip.$inferSelect,
  options: DeleteClipRowOptions = {},
): Promise<boolean> {
  const remove = async () => {
    const storedObjects = await listStoredClipObjects(row.id)
    const deleted = await db.transaction(async (tx) => {
      // Re-read after an active run has stopped: it may have committed fresh
      // base assets before observing cancellation. The row lock keeps later
      // clip mutations from attaching another key after this snapshot.
      const [fresh] = await tx
        .select({
          authorId: clip.author_id,
          sourceKey: clip.source_key,
          waveformKey: clip.waveform_key,
          cutKey: clip.cut_key,
          thumbKey: clip.thumb_key,
          status: clip.status,
          uploadCleanupAt: clip.upload_cleanup_at,
          uploadCleanupDue: sql<
            boolean | null
          >`${clip.upload_cleanup_at} <= now()`,
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
      if (
        options.expectedUploadCleanupAt !== undefined &&
        !pendingUploadCleanupStillDue({
          selectedDeadline: options.expectedUploadCleanupAt,
          currentDeadline: fresh.uploadCleanupAt,
          dueAtLock: fresh.uploadCleanupDue ?? false,
        })
      ) {
        return null
      }

      const renditionRows = await tx
        .select({ storageKey: clipRendition.storage_key })
        .from(clipRendition)
        .where(eq(clipRendition.clip_id, row.id))
      const assetIntents = clipStorageDeletionIntents({
        clipId: row.id,
        sourceKey: fresh.sourceKey,
        waveformKey: fresh.waveformKey,
        cutKey: fresh.cutKey,
        thumbKey: fresh.thumbKey,
        renditionKeys: renditionRows.map((rendition) => rendition.storageKey),
        storedObjects,
      })
      await enqueueStorageDeletions(assetIntents, { tx })
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
    if (!deleted) return false

    if (deleted.queuedDeletions > 0) wakeStorageDeletionWorker()
    publishClipRemove(deleted.authorId, row.id)
    return true
  }
  if (options.ownershipStopped) return remove()
  return withClipMediaStopped(row.id, () =>
    withUploadActivityStopped(row.id, remove),
  )
}

/**
 * Every object in the clip's storage folders. Rows point at most of them,
 * but a run or poster request that died before attaching its object left it
 * there with nothing pointing at it. Media and uploads are stopped while a
 * clip is deleted, so only reserved writes can still add one.
 */
async function listStoredClipObjects(
  clipId: string,
): Promise<{ namespace: "clips" | "thumbnails"; key: string }[]> {
  const prefix = clipAssetDir(clipId)
  const objects: { namespace: "clips" | "thumbnails"; key: string }[] = []
  for (const [namespace, storage] of [
    ["clips", clipStorage],
    ["thumbnails", clipThumbnailStorage],
  ] as const) {
    try {
      for await (const object of storage.list(prefix)) {
        if (isStorageKey(object.key))
          objects.push({ namespace, key: object.key })
      }
    } catch (cause) {
      // The objects rows point at are deleted either way.
      logger.warn(`could not list ${namespace} of clip ${clipId}:`, cause)
    }
  }
  return objects
}

/** A file Alloy did not name, such as one copied in by hand, is left alone. */
function isStorageKey(key: string): boolean {
  try {
    validateStorageKey(key)
    return true
  } catch {
    return false
  }
}
