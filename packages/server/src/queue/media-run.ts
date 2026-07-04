import { rm, stat } from "node:fs/promises"

import {
  normalizeBlurHash,
  type AcceptedContentType,
  type TranscodingConfig,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipScrubberKey,
  publishScrubberSheet,
} from "@alloy/server/clips/scrubber"
import { configStore } from "@alloy/server/config/store"
import {
  encodeFingerprint,
  expectedLadder,
  persistedSourceFps,
} from "@alloy/server/media/encode-fingerprint"
import { faststartPath } from "@alloy/server/media/mp4-layout"
import { extractPoster, type ExtractedPoster } from "@alloy/server/media/poster"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
import {
  encodeRendition,
  type LadderStep,
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
} from "@alloy/server/uploads/staged"
import {
  cleanupTickets,
  selectVideoTicketKey,
} from "@alloy/server/uploads/tickets"

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
const SOURCE_PHASE_COST = 1
const POSTER_PHASE_COST = 0.4
const FINALIZE_PHASE_COST = 0.4
// Must equal SOURCE + POSTER + FINALIZE phase costs; kept as an exact decimal
// literal because float summation (1 + 0.4 + 0.4) drifts off 1.8.
const BASE_PHASE_COST = 1.8

interface EncodeProgressStep {
  height: number
  fps: number
}

export function encodeProgressTotalCost(
  steps: readonly EncodeProgressStep[],
): number {
  return (
    BASE_PHASE_COST +
    steps.reduce((total, step) => total + encodeTierCost(step), 0)
  )
}

export function encodeProgressPercent(options: {
  totalCost: number
  completedCost: number
  phaseCost: number
  fraction: number
}): number {
  const fraction = Math.max(0, Math.min(1, options.fraction))
  return Math.min(
    99,
    Math.floor(
      ((options.completedCost + options.phaseCost * fraction) /
        options.totalCost) *
        100,
    ),
  )
}

function encodeTierCost(step: EncodeProgressStep): number {
  return step.height * step.fps
}

function makeEncodeProgressTracker(
  steps: readonly LadderStep[],
  writeProgress: (pct: number) => void,
) {
  const totalCost = encodeProgressTotalCost(steps)
  let completedCost = 0
  const writeAt = (phaseCost: number, fraction: number) =>
    writeProgress(
      encodeProgressPercent({
        totalCost,
        completedCost,
        phaseCost,
        fraction,
      }),
    )
  return {
    writeAt,
    complete(phaseCost: number) {
      completedCost += phaseCost
      writeAt(0, 0)
    },
  }
}

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

export async function runThumbnailBackfill(
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

  try {
    const media = await materializeEffectiveMedia(store, id, row, runId, {
      workDir,
      signal,
    })
    await ensureStillPresent(store, id, runId, signal)

    const poster = await extractPosterBestEffort(media.path, workDir, {
      durationMs: media.durationMs,
      signal,
    })
    if (poster.kind === "transient-error") {
      await store.finishThumbnailBackfill(id, runId)
      return
    }
    if (poster.kind === "permanent-empty") {
      await store.commitThumbFailed(id, runId)
      return
    }

    const thumb = await publishRunThumbnail(
      id,
      runId,
      poster.poster,
      uploadedKeys,
    )
    if (!(await store.commitThumb(id, runId, thumb)))
      throw abortMediaProcessing()
    retainedKeys.add(thumb.thumbKey)
    if (!(await store.finishThumbnailBackfill(id, runId)))
      throw abortMediaProcessing()
    store.publishUpsert(row.authorId, id)
  } catch (err) {
    await retainRowAssetKeys(store, id, retainedKeys)
    await cleanupFailedRun(uploadedKeys, retainedKeys)
    throw err
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(`failed to remove thumbnail work dir ${workDir}:`, err)
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
  if (!(await store.commitStage(id, runId, "downloading")))
    throw abortMediaProcessing()
  if (row.sourceKey) {
    await clipStorage.downloadToFile(row.sourceKey, rawSourcePath)
  } else {
    const uploadKey = await selectVideoTicketKey({ type: store.target, id })
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await downloadStagedUploadToFile(uploadKey, rawSourcePath)
  }

  // Committed sources were normalized at first ingest (or by the probe
  // backfill); only fresh uploads need the faststart check.
  const sourcePath = row.sourceKey
    ? rawSourcePath
    : await faststartPath(
        rawSourcePath,
        join(workDir, "source-faststart.mp4"),
        sourceContentType,
        signal,
      )
  await ensureStillPresent(store, id, runId, signal)

  if (!(await store.beginProcessing(id, runId))) throw abortMediaProcessing()
  if (!(await store.commitStage(id, runId, "processing")))
    throw abortMediaProcessing()

  const sourceProbe = await probeMedia(sourcePath)
  const trim = trimRange(row, sourceProbe.durationMs)
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

  const durationMs = cutProbe?.durationMs ?? sourceProbe.durationMs
  const sourceCodecs = sourceCodecsString(sourceProbe)
  const sourceFps = persistedSourceFps(sourceProbe.fps)
  const fingerprintFacts = {
    height: sourceProbe.height,
    sourceFps,
    sourceContentType,
    sourceCodecs,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
  }
  const transcodingConfig = configStore.get("transcoding")
  const ladder = expectedLadder(transcodingConfig, fingerprintFacts)
  const fingerprint = encodeFingerprint(transcodingConfig, fingerprintFacts)

  const writeProgress = makeMediaProgressWriter({
    id,
    commit: (pct) => store.commitProgress(id, runId, pct),
    onCommitted: (pct) => store.publishProgress(row.authorId, id, pct),
  })
  const progress = makeEncodeProgressTracker(ladder, writeProgress)

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
    sourceCodecs,
    sourceFps,
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
  progress.complete(SOURCE_PHASE_COST)

  await ensureStillPresent(store, id, runId, signal)
  // Publish the poster before the encode ladder so viewers see a real
  // thumbnail for the whole encode instead of only the BlurHash. Extraction is
  // best-effort: first publishes can proceed without a thumbnail, while
  // re-runs keep any previously committed thumbnail when no usable frame exists.
  const poster = await extractPosterBestEffort(mediaPath, workDir, {
    durationMs,
    signal,
  })
  const thumb =
    poster.kind === "thumbnail"
      ? await publishRunThumbnail(id, runId, poster.poster, uploadedKeys)
      : row.thumbKey
        ? {
            thumbKey: row.thumbKey,
            thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
          }
        : { thumbKey: null, thumbBlurHash: null }
  const { thumbKey, thumbBlurHash } = thumb
  if (
    !(await store.commitThumb(id, runId, {
      thumbKey,
      thumbBlurHash,
      thumbFailedAt: poster.kind === "permanent-empty" ? new Date() : undefined,
    }))
  )
    throw abortMediaProcessing()
  // Reprocess runs keep old renditions until commitReady swaps them.
  if (!row.sourceKey && !(await store.commitPlayable(id, runId)))
    throw abortMediaProcessing()
  if (thumbKey) retainPublishedKey(thumbKey)
  store.publishUpsert(row.authorId, id)
  progress.complete(POSTER_PHASE_COST)

  // Run-scoped rendition keys stay unpublished until the ready transition.
  const renditions: MediaRenditionRecord[] = []
  let hardwareFailed = false
  for (const step of ladder) {
    await ensureStillPresent(store, id, runId, signal)
    const tierCost = encodeTierCost(step)
    if (
      !(await store.commitStage(id, runId, "encoding", {
        name: step.name,
        index: renditions.length + 1,
        count: ladder.length,
      }))
    )
      throw abortMediaProcessing()
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
      onProgress: (fraction) => progress.writeAt(tierCost, fraction),
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
    progress.complete(tierCost)
  }

  await ensureStillPresent(store, id, runId, signal)
  // Snapshot the outgoing rendition keys before commitReady replaces the rows.
  const previousAssets = await store.currentAssetKeys(id)
  if (!(await store.commitStage(id, runId, "finalizing")))
    throw abortMediaProcessing()
  const committed = await store.commitReady(
    id,
    runId,
    {
      ...sourcePatch,
      thumbKey,
      thumbBlurHash,
      encodeFingerprint: fingerprint,
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
  if (!(await clipThumbnailStorage.resolve(clipScrubberKey(id)))) {
    try {
      // Warm the trim scrubber while the source is already on disk. The
      // editor's first open otherwise re-downloads the source and blocks on
      // generation; best-effort, the lazy path regenerates it.
      await publishScrubberSheet({
        clipId: id,
        sourcePath,
        workDir,
        durationMs: sourceProbe.durationMs,
        signal,
      })
    } catch (err) {
      logger.warn(`scrubber sheet warmup failed for ${id}:`, err)
    }
  }
  progress.complete(FINALIZE_PHASE_COST)
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

/**
 * Ingest-time trims (from /initiate) are validated only against the
 * client-declared duration, so clamp against the probed reality here. A
 * start beyond the media is a hard failure — silently publishing footage the
 * uploader asked to cut would be worse than a failed clip.
 */
function trimRange(
  row: Pick<MediaRow, "trimStartMs" | "trimEndMs">,
  sourceDurationMs: number,
): { startMs: number; endMs: number } | null {
  if (row.trimStartMs == null || row.trimEndMs == null) return null
  if (row.trimStartMs >= sourceDurationMs) {
    throw new Error("The trim range lies outside the media duration")
  }
  const endMs = Math.min(row.trimEndMs, sourceDurationMs)
  if (endMs <= row.trimStartMs) return null
  return { startMs: row.trimStartMs, endMs }
}

async function materializeEffectiveMedia(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  options: { workDir: string; signal: AbortSignal },
): Promise<{ path: string; durationMs: number }> {
  if (!(await store.commitStage(id, runId, "downloading")))
    throw abortMediaProcessing()
  const mediaPath = join(options.workDir, "media.mp4")
  if (row.cutKey) {
    await clipStorage.downloadToFile(row.cutKey, mediaPath)
    return {
      path: mediaPath,
      durationMs:
        row.durationMs ??
        row.sourceDurationMs ??
        (await probeMedia(mediaPath)).durationMs,
    }
  }

  if (!row.sourceKey) throw new Error("Clip is missing source media")
  const sourcePath = join(options.workDir, "source")
  await clipStorage.downloadToFile(row.sourceKey, sourcePath)

  const sourceDurationMs =
    row.sourceDurationMs ?? (await probeMedia(sourcePath)).durationMs
  const trim = trimRange(row, sourceDurationMs)
  if (!trim) {
    return {
      path: sourcePath,
      durationMs: row.durationMs ?? sourceDurationMs,
    }
  }

  await trimToMp4(sourcePath, mediaPath, { ...trim, signal: options.signal })
  return {
    path: mediaPath,
    durationMs: row.durationMs ?? trim.endMs - trim.startMs,
  }
}

async function extractPosterBestEffort(
  mediaPath: string,
  workDir: string,
  opts: { durationMs: number; signal: AbortSignal },
): Promise<
  | { kind: "thumbnail"; poster: ExtractedPoster }
  | { kind: "permanent-empty" }
  | { kind: "transient-error" }
> {
  try {
    const poster = await extractPoster(mediaPath, workDir, opts)
    return poster ? { kind: "thumbnail", poster } : { kind: "permanent-empty" }
  } catch (err) {
    if (opts.signal.aborted) throw err
    logger.warn(`poster extraction failed transiently for ${mediaPath}:`, err)
    return { kind: "transient-error" }
  }
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

async function publishRunThumbnail(
  id: string,
  runId: string,
  poster: ExtractedPoster,
  uploadedKeys: string[],
): Promise<{ thumbKey: string; thumbBlurHash: string }> {
  const thumbKey = runScopedThumbKey(id, runId)
  await clipThumbnailStorage.put(thumbKey, poster.jpeg, "image/jpeg")
  uploadedKeys.push(thumbKey)
  return { thumbKey, thumbBlurHash: poster.blurHash }
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
