import { rm, stat } from "node:fs/promises"

import type { AcceptedContentType } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  ensureDirectHlsPackage,
  makeDirectHlsSpec,
} from "@alloy/server/clips/direct-hls"
import * as imageValidation from "@alloy/server/media/image-validation"
import { probeMedia } from "@alloy/server/media/probe"
import { trimToMp4 } from "@alloy/server/media/trim"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"
import {
  deleteStagedUpload,
  downloadStagedUploadToFile,
  resolveStagedUpload,
} from "@alloy/server/uploads/staged"
import {
  cleanupTickets,
  selectThumbTicketKey,
  selectVideoTicketKey,
  THUMB_UPLOAD_MAX_BYTES,
} from "@alloy/server/uploads/tickets"
import sharp from "sharp"

import { abortMediaProcessing } from "./media-abort"
import { runScopedSourceKey, runScopedThumbKey } from "./media-asset-keys"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, publishOriginalSource } from "./media-publish"
import { makeMediaWorkDir } from "./media-run-helpers"
import type { MediaRow, MediaStore } from "./media-store"

const logger = createLogger("queue")

async function ensureStillPresent(
  store: MediaStore,
  id: string,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (await store.stillPresent(id, runId)) return
  throw abortMediaProcessing()
}

/**
 * Run the media pipeline for one leased clip. Downloads the source, applies a
 * pending owner trim, probes, publishes the source + poster under run-scoped
 * keys, and transitions the row to ready.
 */
export async function runMediaProcessing(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const workDir = await makeMediaWorkDir(id)
  const uploadedKeys: string[] = []
  const retainedKeys = new Set<string>()
  if (row.sourceKey) retainedKeys.add(row.sourceKey)
  if (row.thumbKey) retainedKeys.add(row.thumbKey)
  let sourcePublishedForRetry = !!row.sourceKey
  try {
    await runPipelineInWorkDir({
      store,
      id,
      row,
      runId,
      signal,
      workDir,
      uploadedKeys,
      retainSourceAsset: (asset) => {
        retainedKeys.add(asset.storageKey)
        sourcePublishedForRetry = true
      },
      retainPublishedKey: (key) => retainedKeys.add(key),
    })
  } catch (err) {
    await retainRowAssetKeys(store, id, retainedKeys)
    await cleanupFailedRun(uploadedKeys, retainedKeys)
    if (sourcePublishedForRetry) {
      await deleteStagedUpload(
        await selectVideoTicketKey({ type: store.target, id }),
      )
    }
    throw err
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(`failed to remove media processing work dir ${workDir}:`, err)
    })
  }
}

async function runPipelineInWorkDir({
  store,
  id,
  row,
  runId,
  signal,
  workDir,
  uploadedKeys,
  retainSourceAsset,
  retainPublishedKey,
}: {
  store: MediaStore
  id: string
  row: MediaRow
  runId: string
  signal: AbortSignal
  workDir: string
  uploadedKeys: string[]
  retainSourceAsset: (asset: Asset) => void
  retainPublishedKey: (key: string) => void
}): Promise<void> {
  const sourceContentType = row.sourceContentType as AcceptedContentType | null
  if (!sourceContentType)
    throw new Error("Recording is missing source content type")

  const sourcePath = join(workDir, "source")
  if (row.sourceKey) {
    await clipStorage.downloadToFile(row.sourceKey, sourcePath)
  } else {
    const uploadKey = await selectVideoTicketKey({ type: store.target, id })
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await downloadStagedUploadToFile(uploadKey, sourcePath)
  }
  await ensureStillPresent(store, id, runId, signal)

  if (!(await store.beginProcessing(id, runId))) throw abortMediaProcessing()
  store.publishUpsert(row.authorId, id)

  // A pending owner trim cuts the source before anything else is derived. The
  // cut file is published under a fresh versioned key, so the original source
  // stays intact until the new one is committed — a retry after a mid-run
  // failure re-trims from the untouched original.
  const trim = pendingTrimRange(row)
  let mediaPath = sourcePath
  let mediaContentType = sourceContentType
  if (trim) {
    const trimmedPath = join(workDir, "trimmed.mp4")
    await trimToMp4(sourcePath, trimmedPath, { ...trim, signal })
    mediaPath = trimmedPath
    mediaContentType = "video/mp4"
  }
  await ensureStillPresent(store, id, runId, signal)

  const probed = await probeMedia(mediaPath)
  const outputDurationMs = probed.durationMs

  const totalWork = 3
  let completedWork = 0
  const writeProgress = makeMediaProgressWriter({
    id,
    commit: (pct) => store.commitProgress(id, runId, pct),
    onCommitted: (pct) => store.publishProgress(row.authorId, id, pct),
  })
  const completeWork = () => {
    completedWork += 1
    writeProgress(Math.min(99, Math.floor((completedWork / totalWork) * 100)))
  }

  const sourceKey = trim
    ? runScopedSourceKey(id, runId)
    : (row.sourceKey ?? runScopedSourceKey(id, runId))
  const canReuseSource = !trim && row.sourceKey === sourceKey
  const sourceAsset = canReuseSource
    ? {
        storageKey: sourceKey,
        contentType: sourceContentType,
        sizeBytes: row.sourceSizeBytes ?? (await stat(mediaPath)).size,
        width: probed.width,
        height: probed.height,
        videoCodec: probed.videoCodec,
        audioCodec: probed.audioCodec,
      }
    : await publishOriginalSource({
        sourcePath: mediaPath,
        sourceKey,
        contentType: mediaContentType,
      })
  if (!canReuseSource) uploadedKeys.push(sourceKey)

  const sourcePatch = {
    sourceKey: sourceAsset.storageKey,
    sourceContentType: sourceAsset.contentType,
    sourceVideoCodec: sourceAsset.videoCodec,
    sourceAudioCodec: sourceAsset.audioCodec,
    sourceSizeBytes: sourceAsset.sizeBytes,
    durationMs: outputDurationMs,
    width: sourceAsset.width,
    height: sourceAsset.height,
  }
  if (!(await store.commitSource(id, runId, sourcePatch)))
    throw abortMediaProcessing()
  retainSourceAsset(sourceAsset)
  completeWork()

  await ensureStillPresent(store, id, runId, signal)
  // The desktop client is the only producer of posters: it ships a rendered
  // webp plus a BlurHash at initiate. The server never extracts frames — when
  // no poster was uploaded (an owner trim reprocess), the existing one is kept.
  const { thumbKey, thumbBlurHash } = await republishUploadedThumbnail(
    store,
    id,
    runId,
    row,
    uploadedKeys,
  )
  if (!(await store.commitThumb(id, runId, { thumbKey, thumbBlurHash })))
    throw abortMediaProcessing()
  if (thumbKey) retainPublishedKey(thumbKey)
  store.publishUpsert(row.authorId, id)
  completeWork()

  await ensureStillPresent(store, id, runId, signal)
  const committed = await store.commitReady(id, runId, {
    ...sourcePatch,
    thumbKey,
    thumbBlurHash,
  })
  if (!committed) throw abortMediaProcessing()
  // The row now points at the newly published assets. Any previous asset that
  // was not retained is orphaned; prune it best-effort after publish.
  await pruneStaleAssets(row, [
    sourceAsset.storageKey,
    ...(thumbKey ? [thumbKey] : []),
  ])
  await cleanupTickets({ type: store.target, id }, "completed staged upload")
  completeWork()
  store.publishUpsert(row.authorId, id)
  void prewarmDirectHls(store, id)
}

/** Build the recording's HLS package ahead of the first viewer. Best-effort. */
async function prewarmDirectHls(store: MediaStore, id: string): Promise<void> {
  try {
    const fresh = await store.prewarmInput(id)
    if (!fresh?.sourceKey) return
    await ensureDirectHlsPackage(
      makeDirectHlsSpec({ ...fresh, sourceKey: fresh.sourceKey }),
    )
  } catch (err) {
    logger.warn(`direct HLS prewarm failed for ${id}:`, err)
  }
}

function pendingTrimRange(
  row: Pick<MediaRow, "trimStartMs" | "trimEndMs">,
): { startMs: number; endMs: number } | null {
  if (row.trimStartMs == null || row.trimEndMs == null) return null
  if (row.trimEndMs <= row.trimStartMs) return null
  return { startMs: row.trimStartMs, endMs: row.trimEndMs }
}

async function pruneStaleAssets(
  row: Pick<MediaRow, "sourceKey" | "thumbKey">,
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([row.sourceKey, row.thumbKey])
  previousKeys.delete(null)

  await deleteAssetsBestEffort(
    [...previousKeys].filter((key): key is string => key !== null),
    retained,
    "stale recording asset",
  )
}

/**
 * Republish the desktop-uploaded poster when one was staged for this run,
 * otherwise keep whatever the row already points at (owner trim reprocess).
 */
async function republishUploadedThumbnail(
  store: MediaStore,
  id: string,
  runId: string,
  row: MediaRow,
  uploadedKeys: string[],
): Promise<{ thumbKey: string | null; thumbBlurHash: string | null }> {
  const uploadedThumbKey = await selectThumbTicketKey({
    type: store.target,
    id,
  })
  if (uploadedThumbKey) {
    const stagedThumb = await resolveStagedUpload(uploadedThumbKey)
    if (stagedThumb) {
      if (stagedThumb.size > THUMB_UPLOAD_MAX_BYTES) {
        logger.warn(
          `rejected oversized staged poster for ${id}: ${stagedThumb.size} bytes`,
        )
        return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
      }

      const buf = Buffer.from(
        await new Response(stagedThumb.stream()).arrayBuffer(),
      )
      const webp = await normalizeStagedPosterToWebp(buf, id)
      if (!webp) {
        return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
      }

      const thumbKey = runScopedThumbKey(id, runId)
      await clipStorage.put(thumbKey, webp, "image/webp")
      uploadedKeys.push(thumbKey)
      return { thumbKey, thumbBlurHash: row.thumbBlurHash }
    }
  }
  return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
}

/**
 * The published poster is always webp. Clients may upload webp directly, or
 * JPEG when reusing a locally cached poster.
 */
async function normalizeStagedPosterToWebp(
  buf: Buffer,
  id: string,
): Promise<Buffer | null> {
  const asWebp = imageValidation.validateImageBytes(buf, "image/webp")
  if (asWebp.ok) return buf

  const asJpeg = imageValidation.validateImageBytes(buf, "image/jpeg")
  if (!asJpeg.ok) {
    logger.warn(`rejected staged poster for ${id}: ${asJpeg.error}`)
    return null
  }
  try {
    return await sharp(buf).webp({ quality: 82 }).toBuffer()
  } catch (err) {
    logger.warn(`failed to convert staged poster for ${id}:`, err)
    return null
  }
}

async function cleanupFailedRun(
  uploadedKeys: readonly string[],
  retainedKeys: ReadonlySet<string>,
): Promise<void> {
  await deleteAssetsBestEffort(
    new Set(uploadedKeys),
    retainedKeys,
    "failed media processing asset",
  )
}

/**
 * A competing run may have published while this run was failing; never delete
 * whatever the row currently points at. Best-effort: if the read fails,
 * uploadedKeys are run-scoped, so deleting them is safe regardless.
 */
async function retainRowAssetKeys(
  store: MediaStore,
  id: string,
  retainedKeys: Set<string>,
): Promise<void> {
  try {
    const fresh = await store.currentAssetKeys(id)
    if (fresh?.sourceKey) retainedKeys.add(fresh.sourceKey)
    if (fresh?.thumbKey) retainedKeys.add(fresh.thumbKey)
  } catch (err) {
    logger.warn(`failed to retain row asset keys for ${id}:`, err)
  }
}

async function deleteAssetsBestEffort(
  keys: Iterable<string>,
  retainedKeys: ReadonlySet<string>,
  label: string,
): Promise<void> {
  await Promise.all(
    [...keys]
      .filter((key) => !retainedKeys.has(key))
      .map(async (key) => {
        try {
          await clipStorage.delete(key)
        } catch (err) {
          logger.warn(`failed to delete ${label} ${key}:`, err)
        }
      }),
  )
}
