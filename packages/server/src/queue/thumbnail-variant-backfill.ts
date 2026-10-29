import { readFile } from "node:fs/promises"

import { CLIP_THUMBNAIL_WIDTHS } from "@alloy/contracts"
import { clip, instanceSetting } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import {
  putThumbnailVariants,
  thumbnailVariantKeys,
} from "@alloy/server/media/thumbnail-variants"
import { shutdownSignal } from "@alloy/server/runtime/shutdown"
import { isOsErrorCode } from "@alloy/server/storage/fs-driver-helpers"
import { clipThumbnailStorage } from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import { eq, isNotNull } from "drizzle-orm"

const logger = createLogger("thumbnail-variants")

const MARKER_KEY = "thumbnailVariants"
// Changing the widths makes every thumbnail due again.
const MARKER = { widths: [...CLIP_THUMBNAIL_WIDTHS] }

type BackfillResult = "present" | "written" | "skipped" | "failed"

/**
 * Write variants for thumbnails made before variants existed, one at a time
 * in the background. New thumbnails get theirs when written, so a pass without
 * failures is recorded and later starts skip the scan.
 */
export function startThumbnailVariantBackfill(): void {
  void backfillThumbnailVariants().catch((cause) => {
    logger.warn("thumbnail variant backfill stopped:", cause)
  })
}

async function backfillThumbnailVariants(): Promise<void> {
  const [marker] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, MARKER_KEY))
    .limit(1)
  if (JSON.stringify(marker?.value) === JSON.stringify(MARKER)) return

  const rows = await db
    .select({ id: clip.id, thumbKey: clip.thumb_key })
    .from(clip)
    .where(isNotNull(clip.thumb_key))
  let written = 0
  let failed = 0
  for (const row of rows) {
    if (shutdownSignal.aborted) return
    if (!row.thumbKey) continue
    const result = await backfillClip(row.id, row.thumbKey)
    if (result === "written") written += 1
    if (result === "failed") failed += 1
  }
  if (written > 0 || failed > 0) {
    logger.info(
      `wrote thumbnail variants for ${written} ${written === 1 ? "clip" : "clips"}${failed > 0 ? `; ${failed} failed and retry on the next start` : ""}`,
    )
  }
  if (failed > 0) return

  const now = new Date()
  await db
    .insert(instanceSetting)
    .values({ key: MARKER_KEY, value: MARKER, updated_at: now })
    .onConflictDoUpdate({
      target: instanceSetting.key,
      set: { value: MARKER, updated_at: now },
    })
}

async function backfillClip(
  clipId: string,
  thumbKey: string,
): Promise<BackfillResult> {
  // Storage errors fail this clip alone, so one bad file can't stop the pass
  // short of the others. Database errors still end it: they hit every clip.
  let variants: unknown[]
  try {
    variants = await Promise.all(
      thumbnailVariantKeys(thumbKey).map((key) =>
        clipThumbnailStorage.resolve(key),
      ),
    )
  } catch (cause) {
    logger.warn(`could not check thumbnail variants of ${thumbKey}:`, cause)
    return "failed"
  }
  if (variants.every(Boolean)) return "present"

  // Fenced like any thumbnail write: deleting this thumbnail, and its
  // variants with it, now waits for this write. A deletion that already
  // passed the fence found the thumbnail unreferenced, so re-reading the row
  // after fencing catches a poster swap that happened before.
  return withStorageObjectWriteActivity("thumbnails", thumbKey, async () => {
    const [current] = await db
      .select({ thumbKey: clip.thumb_key })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    if (current?.thumbKey !== thumbKey) return "skipped"

    let jpeg: Buffer
    try {
      jpeg = await clipThumbnailStorage.withLocalFile(thumbKey, (path) =>
        readFile(path),
      )
    } catch (cause) {
      if (isOsErrorCode(cause, "ENOENT")) return "skipped"
      logger.warn(`could not read thumbnail ${thumbKey} for variants:`, cause)
      return "failed"
    }
    const ok = await putThumbnailVariants(clipThumbnailStorage, thumbKey, jpeg)
    return ok ? "written" : "failed"
  })
}
