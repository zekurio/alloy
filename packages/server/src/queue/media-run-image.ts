import { readFile, stat } from "node:fs/promises"

import { SCREENSHOT_MAX_BYTES } from "@alloy/contracts"
import { prepareScreenshot } from "@alloy/server/media/screenshot"
import { join } from "@alloy/server/runtime/path"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { downloadStagedUploadToFile } from "@alloy/server/uploads/staged"
import { selectVideoTicketKey } from "@alloy/server/uploads/tickets"

import { abortMediaProcessing } from "./media-abort"
import { runScopedSourceKey, runScopedThumbKey } from "./media-asset-keys"
import {
  ensureStillPresent,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type { MediaCompletion, MediaRow, MediaStore } from "./media-store"

export async function runImageProcessing(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
  completion: MediaCompletion,
): Promise<void> {
  await withMediaRunWorkspace(
    { store, id, row, runId, cleanupLabel: "screenshot" },
    async ({ workDir, uploadedKeys, retainedKeys }) => {
      if (!(await store.beginProcessing(id, runId)))
        throw abortMediaProcessing()
      const path = join(workDir, "image")
      if (row.sourceKey) await clipStorage.downloadToFile(row.sourceKey, path)
      else {
        const key = await selectVideoTicketKey({ type: store.target, id })
        if (!key) throw new Error("Uploaded screenshot is missing")
        await downloadStagedUploadToFile(key, path)
      }
      await ensureStillPresent(store, id, runId, signal)
      if ((await stat(path)).size > SCREENSHOT_MAX_BYTES)
        throw new Error("Screenshot exceeds 50 MiB")
      const image = await prepareScreenshot(
        await readFile(path),
        row.sourceContentType ?? "",
      )
      await ensureStillPresent(store, id, runId, signal)
      const sourceKey = runScopedSourceKey(id, runId)
      const thumbKey = runScopedThumbKey(id, runId)
      uploadedKeys.push(sourceKey, thumbKey)
      await clipStorage.put(sourceKey, image.bytes, "image/png")
      await clipThumbnailStorage.put(thumbKey, image.thumbnail, "image/jpeg")
      await ensureStillPresent(store, id, runId, signal)
      const committed = await store.commitReady(
        id,
        runId,
        {
          sourceKey,
          sourceContentType: "image/png",
          sourceSizeBytes: image.bytes.length,
          width: image.width,
          height: image.height,
          thumbKey,
          thumbBlurHash: image.blurHash,
          sourceVideoCodec: null,
          sourceAudioCodec: null,
          sourceCodecs: null,
          sourceFps: null,
          sourceDurationMs: null,
          durationMs: null,
          waveformKey: null,
          cutKey: null,
          cutCodecs: null,
          encodeFingerprint: "screenshot:1",
        },
        [],
        completion,
      )
      if (!committed) throw abortMediaProcessing()
      retainedKeys.add(sourceKey)
      retainedKeys.add(thumbKey)
      store.publishUpsert(row.authorId, id)
    },
  )
}
