import { rm, stat } from "node:fs/promises"

import {
  normalizeBlurHash,
  type AcceptedContentType,
  type TranscodingConfig,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { mp4Layout, remuxToFastStart } from "@alloy/server/media/mp4-layout"
import { extractPoster } from "@alloy/server/media/poster"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
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
  runScopedCutKey,
  runScopedRenditionKey,
  runScopedSourceKey,
  runScopedThumbKey,
} from "./media-asset-keys"
import { makeMediaProgressWriter } from "./media-progress"
import {
  type Asset,
  publishOriginalSource,
  type SourceAsset,
} from "./media-publish"
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
 * virtual owner trim when present, publishes playable source/cut + poster, then
 * finishes the encode ladder under the same lease.
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
  if (row.cutKey) retainedKeys.add(row.cutKey)
  if (row.thumbKey) retainedKeys.add(row.thumbKey)
  let sourcePublishedForRetry = false
  try {
    await runPipelineInWorkDir({
      store,
      id,
      row,
      runId,
      signal,
      workDir,
      uploadedKeys,
      retainSourceAsset: (asset, publishedByRun) => {
        retainedKeys.add(asset.storageKey)
        if (publishedByRun) sourcePublishedForRetry = true
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
  retainSourceAsset: (asset: Asset, publishedByRun: boolean) => void
  retainPublishedKey: (key: string) => void
}): Promise<void> {
  const sourceContentType = row.sourceContentType as AcceptedContentType | null
  if (!sourceContentType)
    throw new Error("Recording is missing source content type")

  const rawSourcePath = join(workDir, "source")
  if (row.sourceKey) {
    await clipStorage.downloadToFile(row.sourceKey, rawSourcePath)
  } else {
    const uploadKey = await selectVideoTicketKey({ type: store.target, id })
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await downloadStagedUploadToFile(uploadKey, rawSourcePath)
  }

  let sourcePath = rawSourcePath
  if (!row.sourceKey && sourceContentType === "video/mp4") {
    const layout = await mp4Layout(rawSourcePath)
    if (layout === "trailing-moov") {
      const remuxedPath = join(workDir, "source-faststart.mp4")
      await remuxToFastStart(rawSourcePath, remuxedPath, signal)
      sourcePath = remuxedPath
    }
  }
  await ensureStillPresent(store, id, runId, signal)

  if (!(await store.beginProcessing(id, runId))) throw abortMediaProcessing()
  store.publishUpsert(row.authorId, id)

  const sourceProbe = await probeMedia(sourcePath)
  const trim = trimRange(row)
  let mediaPath = sourcePath
  let cutKey: string | null = null
  let cutProbe: Awaited<ReturnType<typeof probeMedia>> | null = null
  if (trim) {
    const cutPath = join(workDir, "cut.mp4")
    await trimToMp4(sourcePath, cutPath, { ...trim, signal })
    cutProbe = await probeMedia(cutPath)
    cutKey = runScopedCutKey(id, runId)
    await clipStorage.uploadFromFile(cutPath, cutKey, "video/mp4")
    uploadedKeys.push(cutKey)
    mediaPath = cutPath
  }
  await ensureStillPresent(store, id, runId, signal)

  const mediaContentType = trim ? "video/mp4" : sourceContentType
  const durationMs = cutProbe?.durationMs ?? sourceProbe.durationMs
  const browserSafe =
    mediaContentType === "video/mp4" &&
    sourceProbe.videoCodecString?.startsWith("avc1.") === true &&
    (sourceProbe.audioCodec === null ||
      sourceProbe.audioCodecString?.startsWith("mp4a.40.") === true)

  const transcodingConfig = configStore.get("transcoding")
  const ladder = effectiveLadder(transcodingConfig, {
    height: sourceProbe.height,
    fps: sourceProbe.fps,
    browserSafe,
  })

  // Work units: source publish, poster, one per rendition tier, finalize.
  // Rendition units advance fractionally with ffmpeg progress, so the SSE
  // progress bar reflects real encode time.
  const totalWork = 1 + 1 + ladder.length + 1
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

  const sourceAsset: SourceAsset = row.sourceKey
    ? {
        storageKey: row.sourceKey,
        contentType: sourceContentType,
        sizeBytes: row.sourceSizeBytes ?? (await stat(sourcePath)).size,
        width: sourceProbe.width,
        height: sourceProbe.height,
        videoCodec: sourceProbe.videoCodec,
        audioCodec: sourceProbe.audioCodec,
      }
    : await publishOriginalSource({
        sourcePath,
        sourceKey: runScopedSourceKey(id, runId),
        contentType: sourceContentType,
        probe: sourceProbe,
      })
  if (!row.sourceKey) uploadedKeys.push(sourceAsset.storageKey)

  const sourcePatch = {
    sourceKey: sourceAsset.storageKey,
    sourceContentType: sourceAsset.contentType,
    sourceVideoCodec: sourceAsset.videoCodec,
    sourceAudioCodec: sourceAsset.audioCodec,
    sourceCodecs: sourceCodecsString(sourceProbe),
    sourceSizeBytes: sourceAsset.sizeBytes,
    sourceDurationMs: sourceProbe.durationMs,
    cutKey,
    durationMs,
    width: sourceProbe.width,
    height: sourceProbe.height,
  }
  if (!(await store.commitSource(id, runId, sourcePatch)))
    throw abortMediaProcessing()
  retainSourceAsset(sourceAsset, !row.sourceKey)
  if (cutKey) retainPublishedKey(cutKey)
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
    { keepExisting: !trim },
  )
  if (!thumb.thumbKey) {
    const poster = await extractPoster(mediaPath, workDir, {
      durationMs,
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
  if (!(await store.commitPlayable(id, runId))) throw abortMediaProcessing()
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
      durationMs,
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
      codecs: encoded.codecs,
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
    ...(cutKey ? [cutKey] : []),
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

function trimRange(
  row: Pick<MediaRow, "trimStartMs" | "trimEndMs">,
): { startMs: number; endMs: number } | null {
  if (row.trimStartMs == null || row.trimEndMs == null) return null
  if (row.trimEndMs <= row.trimStartMs) return null
  return { startMs: row.trimStartMs, endMs: row.trimEndMs }
}

async function pruneStaleAssets(
  row: Pick<MediaRow, "sourceKey" | "cutKey" | "thumbKey">,
  previousRenditionKeys: readonly string[],
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([
    row.sourceKey,
    row.cutKey,
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
 * otherwise keep the current poster only when the caller says the visible
 * media did not change.
 */
async function republishUploadedThumbnail(
  store: MediaStore,
  id: string,
  runId: string,
  row: MediaRow,
  uploadedKeys: string[],
  options: { keepExisting: boolean },
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
        return options.keepExisting ? publishedThumbnail(row) : noThumbnail()
      }

      const buf = Buffer.from(
        await new Response(stagedThumb.stream()).arrayBuffer(),
      )
      const jpeg = await normalizeStagedPosterToJpeg(buf, id)
      if (!jpeg) {
        return options.keepExisting ? publishedThumbnail(row) : noThumbnail()
      }

      const thumbKey = runScopedThumbKey(id, runId)
      await clipThumbnailStorage.put(thumbKey, jpeg, "image/jpeg")
      uploadedKeys.push(thumbKey)
      return { thumbKey, thumbBlurHash: normalizeBlurHash(row.thumbBlurHash) }
    }
    return options.keepExisting ? publishedThumbnail(row) : noThumbnail()
  }
  return options.keepExisting ? publishedThumbnail(row) : noThumbnail()
}

function noThumbnail(): {
  thumbKey: string | null
  thumbBlurHash: string | null
} {
  return { thumbKey: null, thumbBlurHash: null }
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
    if (fresh?.cutKey) retainedKeys.add(fresh.cutKey)
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
