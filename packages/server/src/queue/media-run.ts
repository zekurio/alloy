import { rm, stat } from "node:fs/promises"

import {
  normalizeBlurHash,
  type AcceptedContentType,
  type TranscodingConfig,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { extractPoster } from "@alloy/server/media/poster"
import { probeMedia } from "@alloy/server/media/probe"
import {
  effectiveLadder,
  encodeRendition,
} from "@alloy/server/media/renditions"
import { trimToMp4 } from "@alloy/server/media/trim"
import { join } from "@alloy/server/runtime/path"
import {
  clipStorage,
  clipStorageForKey,
  clipThumbnailStorage,
} from "@alloy/server/storage/index"
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
import {
  runScopedRenditionKey,
  runScopedSourceKey,
  runScopedThumbKey,
} from "./media-asset-keys"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, publishOriginalSource } from "./media-publish"
import { makeMediaWorkDir } from "./media-run-helpers"
import type { MediaRenditionRecord, MediaRow, MediaStore } from "./media-store"

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

  const transcodingConfig = configStore.get("transcoding")
  const ladder = effectiveLadder(transcodingConfig, {
    height: probed.height,
    fps: probed.fps,
  })
  if (ladder.length === 0) {
    throw new Error("No rendition tiers apply to this source")
  }

  // Work units: source publish, poster, one per rendition tier, finalize.
  // Rendition units advance fractionally with ffmpeg progress, so the SSE
  // progress bar reflects real encode time.
  const totalWork = 1 + ladder.length + 2
  let completedWork = 0
  const writeProgress = makeMediaProgressWriter({
    id,
    commit: (pct) => store.commitProgress(id, runId, pct),
    onCommitted: (pct) => store.publishProgress(row.authorId, id, pct),
  })
  const progressAt = (fraction: number) =>
    writeProgress(
      Math.min(99, Math.floor(((completedWork + fraction) / totalWork) * 100)),
    )
  const completeWork = () => {
    completedWork += 1
    progressAt(0)
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
        probe: probed,
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
  // Publish the poster before the encode ladder so viewers see a real
  // thumbnail for the whole encode instead of only the BlurHash. Posters
  // normally come from clients (rendered image + BlurHash shipped at
  // initiate); the server only validates and republishes them. When no client
  // poster exists at all, extract a frame server-side so every clip has an
  // og:image and card thumbnail.
  let thumb = await republishUploadedThumbnail(
    store,
    id,
    runId,
    row,
    uploadedKeys,
  )
  if (!thumb.thumbKey) {
    const poster = await extractPoster(mediaPath, workDir, {
      durationMs: outputDurationMs,
      signal,
    })
    if (poster) {
      const thumbKey = runScopedThumbKey(id, runId)
      await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")
      uploadedKeys.push(thumbKey)
      thumb = { thumbKey, thumbBlurHash: poster.blurHash }
    }
  }
  const { thumbKey, thumbBlurHash } = thumb
  if (!(await store.commitThumb(id, runId, { thumbKey, thumbBlurHash })))
    throw abortMediaProcessing()
  if (thumbKey) retainPublishedKey(thumbKey)
  store.publishUpsert(row.authorId, id)
  completeWork()

  // Encode the quality ladder. Uploaded under run-scoped keys; committed
  // atomically with the ready transition below.
  const renditions: MediaRenditionRecord[] = []
  let hardwareFailed = false
  for (const step of ladder) {
    await ensureStillPresent(store, id, runId, signal)
    const encodeConfig =
      hardwareFailed || transcodingConfig.hardwareAcceleration === "none"
        ? { ...transcodingConfig, hardwareAcceleration: "none" as const }
        : transcodingConfig
    const encoded = await encodeRenditionWithFallback({
      srcPath: mediaPath,
      outDir: join(workDir, `rendition-${step.name}`),
      config: encodeConfig,
      step,
      durationMs: outputDurationMs,
      signal,
      onProgress: progressAt,
      onHardwareFailed: () => {
        hardwareFailed = true
      },
    })
    const renditionKey = runScopedRenditionKey(id, runId, step.name)
    await clipStorage.uploadFromFile(
      encoded.filePath,
      renditionKey,
      "video/mp4",
    )
    uploadedKeys.push(renditionKey)
    await rm(encoded.filePath, { force: true }).catch(() => undefined)
    renditions.push({
      name: step.name,
      isOg: step.og,
      height: encoded.height,
      width: encoded.width,
      fps: encoded.fps,
      storageKey: renditionKey,
      playlist: encoded.playlist,
      codecs: encoded.codecs,
      bandwidth: encoded.bandwidth,
      sizeBytes: encoded.sizeBytes,
    })
    completeWork()
  }

  await ensureStillPresent(store, id, runId, signal)
  // Snapshot the outgoing rendition keys before commitReady replaces the rows.
  const previousAssets = await store.currentAssetKeys(id)
  const committed = await store.commitReady(
    id,
    runId,
    {
      ...sourcePatch,
      thumbKey,
      thumbBlurHash,
    },
    renditions,
  )
  if (!committed) throw abortMediaProcessing()
  // The row now points at the newly published assets. Any previous asset that
  // was not retained is orphaned; prune it best-effort after publish.
  await pruneStaleAssets(row, previousAssets?.renditionKeys ?? [], [
    sourceAsset.storageKey,
    ...renditions.map((rendition) => rendition.storageKey),
    ...(thumbKey ? [thumbKey] : []),
  ])
  await cleanupTickets({ type: store.target, id }, "completed staged upload")
  completeWork()
  store.publishUpsert(row.authorId, id)
}

async function encodeRenditionWithFallback(options: {
  srcPath: string
  outDir: string
  config: TranscodingConfig
  step: Parameters<typeof encodeRendition>[3]
  durationMs: number
  signal: AbortSignal
  onProgress: (fraction: number) => void
  onHardwareFailed: () => void
}) {
  try {
    return await encodeRendition(
      options.srcPath,
      options.outDir,
      options.config,
      options.step,
      {
        durationMs: options.durationMs,
        signal: options.signal,
        onProgress: options.onProgress,
      },
    )
  } catch (err) {
    // A cancelled run rejects with AbortError — not an encoder failure, so it
    // must not trigger the software fallback.
    if (options.signal.aborted) throw err
    if (options.config.hardwareAcceleration === "none") throw err
    logger.warn(
      `hardware ${options.config.hardwareAcceleration} encode failed for ${options.step.height}p; falling back to software:`,
      err,
    )
    options.onHardwareFailed()
    return encodeRendition(
      options.srcPath,
      options.outDir,
      { ...options.config, hardwareAcceleration: "none" },
      options.step,
      {
        durationMs: options.durationMs,
        signal: options.signal,
        onProgress: options.onProgress,
      },
    )
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
  previousRenditionKeys: readonly string[],
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([
    row.sourceKey,
    row.thumbKey,
    ...previousRenditionKeys,
  ])
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
        return publishedThumbnail(row)
      }

      const buf = Buffer.from(
        await new Response(stagedThumb.stream()).arrayBuffer(),
      )
      const jpeg = await normalizeStagedPosterToJpeg(buf, id)
      if (!jpeg) {
        return publishedThumbnail(row)
      }

      const thumbKey = runScopedThumbKey(id, runId)
      await clipThumbnailStorage.put(thumbKey, jpeg, "image/jpeg")
      uploadedKeys.push(thumbKey)
      return { thumbKey, thumbBlurHash: normalizeBlurHash(row.thumbBlurHash) }
    }
    return publishedThumbnail(row)
  }
  return publishedThumbnail(row)
}

function publishedThumbnail(
  row: Pick<MediaRow, "thumbKey" | "thumbBlurHash">,
): { thumbKey: string | null; thumbBlurHash: string | null } {
  if (!row.thumbKey) return { thumbKey: null, thumbBlurHash: null }
  return {
    thumbKey: row.thumbKey,
    thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
  }
}

/**
 * The published poster is always JPEG. Older clients may upload WebP, so keep
 * accepting it and normalize during publish.
 */
async function normalizeStagedPosterToJpeg(
  buf: Buffer,
  id: string,
): Promise<Buffer | null> {
  const asJpeg = validateImageBytes(buf, "image/jpeg")
  if (asJpeg.ok) return buf

  const asWebp = validateImageBytes(buf, "image/webp")
  if (!asWebp.ok) {
    logger.warn(`rejected staged poster for ${id}: ${asWebp.error}`)
    return null
  }

  try {
    return await sharp(buf).jpeg({ quality: 82 }).toBuffer()
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
    for (const key of fresh?.renditionKeys ?? []) retainedKeys.add(key)
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
          await clipStorageForKey(key).delete(key)
        } catch (err) {
          logger.warn(`failed to delete ${label} ${key}:`, err)
        }
      }),
  )
}
