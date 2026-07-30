import { rm, stat } from "node:fs/promises"

import {
  normalizeBlurHash,
  type AcceptedContentType,
  type ClipAudioTrackInput,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipScrubberKey,
  publishScrubberSheet,
} from "@alloy/server/clips/scrubber"
import { configStore } from "@alloy/server/config/store"
import { extractAudioStems } from "@alloy/server/media/audio-stems"
import {
  encodeFingerprint,
  expectedLadder,
  persistedSourceFps,
} from "@alloy/server/media/encode-fingerprint"
import { faststartPath } from "@alloy/server/media/mp4-layout"
import {
  probeMedia,
  sourceCodecsString,
  type MediaAudioProbe,
} from "@alloy/server/media/probe"
import { encodeRenditionWithFallback } from "@alloy/server/media/renditions"
import { encodeExactCut } from "@alloy/server/media/trim"
import { join } from "@alloy/server/runtime/path"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
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
  runScopedAudioTrackKey,
  runScopedCutKey,
  runScopedRenditionKey,
  runScopedSourceKey,
} from "./media-asset-keys"
import {
  audioStemPhaseCost,
  encodeTierCost,
  FINALIZE_PHASE_COST,
  makeEncodeProgressTracker,
  POSTER_PHASE_COST,
  SOURCE_PHASE_COST,
} from "./media-encode-progress"
import { makeMediaProgressWriter } from "./media-progress"
import {
  type Asset,
  publishOriginalSource,
  type SourceAsset,
} from "./media-publish"
import {
  extractPosterBestEffort,
  publishRunThumbnail,
  trimRange,
} from "./media-run-input"
import {
  deleteAssetsBestEffort,
  ensureStillPresent,
  pruneStaleAssets,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type {
  MediaAudioTrackRecord,
  MediaRenditionRecord,
  MediaRow,
  MediaStore,
} from "./media-store"
export {
  encodeProgressPercent,
  encodeProgressTotalCost,
} from "./media-encode-progress"
export { runThumbnailBackfill } from "./media-thumbnail-backfill"

const logger = createLogger("queue")

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
  let sourcePublishedForRetry = false
  await withMediaRunWorkspace(
    {
      store,
      id,
      row,
      cleanupLabel: "media processing",
      onFailure: async () => {
        if (!sourcePublishedForRetry) return
        await deleteStagedUpload(
          await selectVideoTicketKey({ type: store.target, id }),
        )
      },
    },
    async (workspace) => {
      await runPipelineInWorkDir({
        store,
        id,
        row,
        runId,
        signal,
        workDir: workspace.workDir,
        uploadedKeys: workspace.uploadedKeys,
        retainSourceAsset: (asset, publishedByRun) => {
          workspace.retainedKeys.add(asset.storageKey)
          if (publishedByRun) sourcePublishedForRetry = true
        },
        retainPublishedKey: (key) => workspace.retainedKeys.add(key),
      })
    },
  )
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
  const audioTrackHints = validatedAudioTrackHints(
    row,
    sourceProbe.audioTracks.length,
  )
  const trim = trimRange(row, sourceProbe.durationMs)
  const transcodingConfig = configStore.get("transcoding")
  let hardwareFailed = false
  // The frame-exact H.264 cut is the clip's canonical playback media and the
  // poster source. Renditions encode from the original with the same range,
  // so every published asset is a first-generation encode of the source.
  let posterMediaPath = sourcePath
  let cutKey: string | null = null
  let cutDurationMs: number | null = null
  let cutCodecs: string | null = null
  if (trim) {
    const cut = await encodeExactCut({
      sourcePath,
      outDir: join(workDir, "cut"),
      config: transcodingConfig,
      source: sourceProbe,
      startMs: trim.startMs,
      endMs: trim.endMs,
      signal,
      onHardwareFailed: () => {
        hardwareFailed = true
      },
    })
    cutKey = runScopedCutKey(id, runId)
    await clipStorage.uploadFromFile(cut.filePath, cutKey, "video/mp4")
    uploadedKeys.push(cutKey)
    posterMediaPath = cut.filePath
    cutDurationMs = cut.durationMs
    // Probe-derived; empty when the codec string could not be built.
    cutCodecs = cut.codecs || null
  }
  await ensureStillPresent(store, id, runId, signal)

  const durationMs = cutDurationMs ?? sourceProbe.durationMs
  const sourceCodecs = sourceCodecsString(sourceProbe)
  const sourceFps = persistedSourceFps(sourceProbe.fps)
  const fingerprintFacts = {
    height: sourceProbe.height,
    sourceFps,
    sourceContentType,
    sourceCodecs,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
    audioTrackFingerprint: audioTrackHints.length
      ? JSON.stringify({
          hints: audioTrackHints,
          tracks: sourceProbe.audioTracks.slice(1).map((track) => ({
            codec: track.codec,
            codecs: track.codecString,
          })),
        })
      : null,
  }
  const ladder = expectedLadder(transcodingConfig, fingerprintFacts)

  const writeProgress = makeMediaProgressWriter({
    id,
    commit: (pct) => store.commitProgress(id, runId, pct),
    onCommitted: (pct) => store.publishProgress(row.authorId, id, pct),
  })
  const stemPhaseCost = audioTrackHints.length ? audioStemPhaseCost(ladder) : 0
  const progress = makeEncodeProgressTracker(
    ladder,
    writeProgress,
    stemPhaseCost,
  )

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
    pendingAudioTracks: audioTrackHints.length ? audioTrackHints : null,
    audioTrackFingerprint: fingerprintFacts.audioTrackFingerprint,
    cutKey,
    cutCodecs,
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
  const poster = await extractPosterBestEffort(posterMediaPath, workDir, {
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

  // Run-scoped rendition keys stay unpublished until commitReady.
  const renditions: MediaRenditionRecord[] = []
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
      srcPath: sourcePath,
      trim: trim ?? undefined,
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
  if (!(await store.commitStage(id, runId, "finalizing")))
    throw abortMediaProcessing()
  // Stems use the original source and the same trim bounds as the canonical
  // cut. They run after the ladder so a bad or sparse source track can never
  // discard otherwise-usable renditions.
  const audioTracks = await extractAndUploadAudioStemsBestEffort({
    store,
    id,
    runId,
    signal,
    sourcePath,
    outDir: join(workDir, "audio-stems"),
    sourceTracks: sourceProbe.audioTracks,
    hints: audioTrackHints,
    trim: trim ?? undefined,
    canonicalDurationMs: durationMs,
    uploadedKeys,
    onProgress: (fraction) => progress.writeAt(stemPhaseCost, fraction),
  })
  progress.complete(stemPhaseCost)

  const stemsFailed = audioTracks.length !== audioTrackHints.length
  const readyAudioTracks = stemsFailed ? [] : audioTracks
  const readySourcePatch = stemsFailed
    ? {
        ...sourcePatch,
        pendingAudioTracks: null,
        audioTrackFingerprint: null,
      }
    : sourcePatch
  const readyFingerprintFacts = stemsFailed
    ? { ...fingerprintFacts, audioTrackFingerprint: null }
    : fingerprintFacts

  await ensureStillPresent(store, id, runId, signal)
  const previousAssets = await store.currentAssetKeys(id)
  const committed = await store.commitReady(
    id,
    runId,
    {
      ...readySourcePatch,
      thumbKey,
      thumbBlurHash,
      encodeFingerprint: encodeFingerprint(
        transcodingConfig,
        readyFingerprintFacts,
      ),
    },
    renditions,
    readyAudioTracks,
  )
  if (!committed) throw abortMediaProcessing()
  // The row now points at the newly published assets. Any previous asset that
  // was not retained is orphaned; prune it best-effort after publish.
  await pruneStaleAssets(
    row,
    [
      ...(previousAssets?.renditionKeys ?? []),
      ...(previousAssets?.audioTrackKeys ?? []),
    ],
    [
      sourceAsset.storageKey,
      ...(cutKey ? [cutKey] : []),
      ...renditions.map((rendition) => rendition.storageKey),
      ...readyAudioTracks.map((track) => track.storageKey),
      ...(thumbKey ? [thumbKey] : []),
    ],
  )
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

async function extractAndUploadAudioStemsBestEffort(options: {
  store: MediaStore
  id: string
  runId: string
  signal: AbortSignal
  sourcePath: string
  outDir: string
  sourceTracks: readonly MediaAudioProbe[]
  hints: readonly ClipAudioTrackInput[]
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  uploadedKeys: string[]
  onProgress: (fraction: number) => void
}): Promise<MediaAudioTrackRecord[]> {
  if (options.hints.length === 0) return []

  await ensureStillPresent(
    options.store,
    options.id,
    options.runId,
    options.signal,
  )
  const extracted = await extractStemsBestEffort(options)
  if (!extracted) return []

  const audioTracks: MediaAudioTrackRecord[] = []
  for (const stem of extracted) {
    await ensureStillPresent(
      options.store,
      options.id,
      options.runId,
      options.signal,
    )
    const storageKey = runScopedAudioTrackKey(
      options.id,
      options.runId,
      stem.index,
    )
    const uploaded = await uploadAudioStemBestEffort(
      options.id,
      stem.filePath,
      storageKey,
      options.signal,
    )
    if (!uploaded) {
      await deleteAssetsBestEffort(
        [...audioTracks.map((track) => track.storageKey), storageKey],
        "incomplete audio stem",
      )
      return []
    }

    options.uploadedKeys.push(storageKey)
    await rm(stem.filePath, { force: true }).catch(() => undefined)
    audioTracks.push({
      index: stem.index,
      kind: stem.kind,
      label: stem.label,
      storageKey,
      codecs: stem.codecs,
      sizeBytes: stem.sizeBytes,
    })
  }
  return audioTracks
}

async function extractStemsBestEffort(
  options: Parameters<typeof extractAndUploadAudioStemsBestEffort>[0],
) {
  try {
    return await extractAudioStems({
      sourcePath: options.sourcePath,
      outDir: options.outDir,
      sourceTracks: options.sourceTracks,
      hints: options.hints,
      trim: options.trim,
      canonicalDurationMs: options.canonicalDurationMs,
      signal: options.signal,
      onProgress: options.onProgress,
    })
  } catch (err) {
    if (options.signal.aborted) throw err
    logger.warn(`audio stem extraction failed for ${options.id}:`, err)
    return null
  }
}

async function uploadAudioStemBestEffort(
  clipId: string,
  filePath: string,
  storageKey: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await clipStorage.uploadFromFile(filePath, storageKey, "audio/mp4")
    return true
  } catch (err) {
    if (signal.aborted) throw err
    logger.warn(`audio stem upload failed for ${clipId}:`, err)
    return false
  }
}

function validatedAudioTrackHints(
  row: MediaRow,
  probedAudioTrackCount: number,
) {
  if (row.pendingAudioTracks === null) return []
  const hints = row.pendingAudioTracks
  const expectedHintCount = Math.max(0, probedAudioTrackCount - 1)
  if (hints.length === expectedHintCount) return hints
  logger.warn(
    `discarding audio stem hints for ${row.id}: expected ${expectedHintCount}, received ${hints.length}`,
  )
  return []
}
