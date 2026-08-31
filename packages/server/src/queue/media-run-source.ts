import { stat } from "node:fs/promises"

import type { AcceptedContentType } from "@alloy/contracts"
import { faststartPath } from "@alloy/server/media/mp4-layout"
import type { MediaProbe } from "@alloy/server/media/probe"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"
import { downloadStagedUploadToFile } from "@alloy/server/uploads/staged"
import { selectVideoTicketKey } from "@alloy/server/uploads/tickets"

import { abortMediaProcessing } from "./media-abort"
import { runScopedSourceKey } from "./media-asset-keys"
import { publishOriginalSource, type SourceAsset } from "./media-publish"
import type { MediaRow, MediaStore } from "./media-store"

/**
 * Download the committed or staged source into the run workspace. Committed
 * sources were normalized at first ingest (or by the probe backfill); only
 * fresh uploads need the faststart check.
 */
export async function acquireSourceFile(options: {
  store: MediaStore
  id: string
  runId: string
  row: MediaRow
  sourceContentType: AcceptedContentType
  workDir: string
  signal: AbortSignal
}): Promise<string> {
  const rawSourcePath = join(options.workDir, "source")
  if (
    !(await options.store.commitStage(options.id, options.runId, "downloading"))
  )
    throw abortMediaProcessing()
  if (options.row.sourceKey) {
    await clipStorage.downloadToFile(options.row.sourceKey, rawSourcePath)
    return rawSourcePath
  }
  const uploadKey = await selectVideoTicketKey({
    type: options.store.target,
    id: options.id,
  })
  if (!uploadKey) throw new Error("Uploaded source is missing")
  await downloadStagedUploadToFile(uploadKey, rawSourcePath)
  return faststartPath(
    rawSourcePath,
    join(options.workDir, "source-faststart.mp4"),
    options.sourceContentType,
    options.signal,
  )
}

/**
 * Reuse the already-committed source asset when present; otherwise publish
 * the fresh upload under a run-scoped key.
 */
export async function resolveSourceAsset(options: {
  id: string
  runId: string
  row: MediaRow
  sourcePath: string
  sourceContentType: AcceptedContentType
  probe: MediaProbe
  uploadedKeys: string[]
}): Promise<SourceAsset> {
  if (options.row.sourceKey) {
    return {
      storageKey: options.row.sourceKey,
      contentType: options.sourceContentType,
      sizeBytes:
        options.row.sourceSizeBytes ?? (await stat(options.sourcePath)).size,
      width: options.probe.width,
      height: options.probe.height,
      videoCodec: options.probe.videoCodec,
      audioCodec: options.probe.audioCodec,
    }
  }
  const sourceKey = runScopedSourceKey(options.id, options.runId)
  // Register before IO so a throwing driver cannot leave an untracked partial
  // object. Deleting a key that was never created remains idempotent.
  options.uploadedKeys.push(sourceKey)
  return publishOriginalSource({
    sourcePath: options.sourcePath,
    sourceKey,
    contentType: options.sourceContentType,
    probe: options.probe,
  })
}
