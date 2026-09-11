import { SCREENSHOT_MAX_BYTES } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { clip } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { clipAssetVersion } from "@alloy/server/clips/asset-version"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { prepareScreenshot } from "@alloy/server/media/screenshot"
import {
  runScopedSourceKey,
  runScopedThumbKey,
} from "@alloy/server/queue/media-asset-keys"
import { badRequest, conflict } from "@alloy/server/runtime/http-response"
import { mediaAssetDeletionIntents } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { enqueueUnownedMediaAssets } from "@alloy/server/storage/media-deletion"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"

import { IdParam } from "./clips-helpers"
import {
  selectClipForMutation,
  updatedClipResponse,
} from "./clips-upload-access"
import { tbValidator } from "./validation"

const ImageEditForm = t.object({
  file: t.instanceof(File),
  sourceVersion: t.string().min(1).max(128),
})

export const clipsUploadImageRoutes = new Hono().post(
  "/:id/image",
  requireSession,
  bodyLimit({ maxSize: SCREENSHOT_MAX_BYTES + 16 * 1024 }),
  tbValidator("param", IdParam),
  tbValidator("form", ImageEditForm),
  async (c) => {
    const { id } = c.req.valid("param")
    const { file, sourceVersion } = c.req.valid("form")
    const access = await selectClipForMutation(c, {
      id,
      viewerId: c.var.viewerId,
      statuses: ["ready"],
    })
    if ("response" in access) return access.response
    const row = access.row
    if (row.media_kind !== "image" || !row.source_key)
      return badRequest(c, "This operation requires a screenshot")
    if (
      row.encode_run_id !== null ||
      clipAssetVersion(row.source_key) !== sourceVersion
    )
      return conflict(c, "Screenshot changed. Reload before editing")
    if (
      file.type !== "image/png" ||
      file.size === 0 ||
      file.size > SCREENSHOT_MAX_BYTES
    )
      return badRequest(c, "Expected a PNG image up to 50 MiB")
    let image
    try {
      image = await prepareScreenshot(
        Buffer.from(await file.arrayBuffer()),
        file.type,
      )
    } catch {
      return badRequest(c, "Invalid screenshot")
    }
    const attemptId = crypto.randomUUID()
    const sourceKey = runScopedSourceKey(id, attemptId)
    const thumbKey = runScopedThumbKey(id, attemptId)
    try {
      await clipStorage.put(sourceKey, image.bytes, "image/png")
      await clipThumbnailStorage.put(thumbKey, image.thumbnail, "image/jpeg")
      const accepted = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(clip)
          .where(eq(clip.id, id))
          .for("update")
        if (
          !current ||
          current.source_key !== row.source_key ||
          current.author_id !== row.author_id ||
          current.status !== "ready" ||
          current.encode_run_id !== null
        )
          return false
        await tx
          .update(clip)
          .set({
            source_key: sourceKey,
            source_content_type: "image/png",
            source_size_bytes: image.bytes.length,
            width: image.width,
            height: image.height,
            thumb_key: thumbKey,
            thumb_blur_hash: image.blurHash,
            thumb_failed_at: null,
            updated_at: new Date(),
          })
          .where(eq(clip.id, id))
        await enqueueStorageDeletions(
          mediaAssetDeletionIntents({
            keys: [current.source_key, current.thumb_key],
            reason: "screenshot edit replaced media",
            source: { type: "screenshot-edit", id: attemptId },
          }),
          { tx },
        )
        return true
      })
      if (!accepted) {
        await enqueueUnownedMediaAssets({
          keys: [sourceKey, thumbKey],
          reason: "screenshot edit superseded",
          source: { type: "screenshot-edit", id: attemptId },
        })
        return conflict(c, "Screenshot changed. Reload before editing")
      }
    } catch (cause) {
      await enqueueUnownedMediaAssets({
        keys: [sourceKey, thumbKey],
        reason: "screenshot edit failed",
        source: { type: "screenshot-edit", id: attemptId },
      })
      throw cause
    }
    wakeStorageDeletionWorker()
    void publishClipUpsert(row.author_id, id)
    return updatedClipResponse(c, id)
  },
)
