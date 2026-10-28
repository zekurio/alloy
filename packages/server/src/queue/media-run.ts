import { normalizeBlurHash, type TranscodingConfig } from "@alloy/contracts"
import { trimShowsFrame } from "@alloy/server/clips/trim-range"
import {
  encodeFingerprint,
  expectedLadder,
  persistedSourceFps,
} from "@alloy/server/media/encode-fingerprint"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"

import { abortMediaProcessing } from "./media-abort"
import {
  FINALIZE_PHASE_COST,
  makeEncodeProgressTracker,
  POSTER_PHASE_COST,
  SOURCE_PHASE_COST,
} from "./media-encode-progress"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, type SourceAsset } from "./media-publish"
import {
  encodeAndPublishCut,
  encodeAndUploadRenditions,
} from "./media-run-encode"
import { runImageProcessing } from "./media-run-image"
import {
  extractPosterBestEffort,
  publishRunThumbnail,
  trimRange,
} from "./media-run-input"
import { acquireSourceFile, resolveSourceAsset } from "./media-run-source"
import { resolveWaveformAudio } from "./media-run-waveform"
import {
  ensureStillPresent,
  type RunUploads,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type {
  MediaCompletion,
  MediaRow,
  MediaSourcePatch,
  MediaStore,
  MediaThumbPatch,
} from "./media-store"

export { runThumbnailBackfill } from "./media-thumbnail-backfill"

/**
 * Run the media pipeline for one leased clip. Downloads the source, applies a
 * physical owner cut when present, publishes playable source/cut + poster, then
 * finishes the encode ladder under the same lease.
 */
export async function runMediaProcessing(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
  options: {
    config: Readonly<TranscodingConfig>
    completion: MediaCompletion
  },
): Promise<void> {
  if (row.sourceContentType?.startsWith("image/")) {
    return runImageProcessing(store, id, row, runId, signal, options.completion)
  }
  await withMediaRunWorkspace(
    {
      store,
      id,
      runId,
      row,
      cleanupLabel: "media processing",
    },
    async (workspace) => {
      await runPipelineInWorkDir({
        store,
        id,
        row,
        runId,
        signal,
        transcodingConfig: options.config,
        completion: options.completion,
        workDir: workspace.workDir,
        uploadedKeys: workspace.uploadedKeys,
        retainSourceAsset: (asset) => {
          workspace.retainedKeys.add(asset.storageKey)
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
  transcodingConfig,
  completion,
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
  transcodingConfig: Readonly<TranscodingConfig>
  completion: MediaCompletion
  workDir: string
  uploadedKeys: RunUploads
  retainSourceAsset: (asset: Asset) => void
  retainPublishedKey: (key: string) => void
}): Promise<void> {
  const sourceContentType = row.sourceContentType
  if (sourceContentType !== "video/mp4")
    throw new Error("Recording is missing source content type")

  const sourcePath = await acquireSourceFile({
    store,
    id,
    runId,
    row,
    sourceContentType,
    workDir,
    signal,
  })
  await ensureStillPresent(store, id, runId, signal)

  if (!(await store.beginProcessing(id, runId))) throw abortMediaProcessing()
  if (!(await store.commitStage(id, runId, "processing")))
    throw abortMediaProcessing()

  const sourceProbe = await probeMedia(sourcePath)
  const trim = trimRange(row, sourceProbe.durationMs)
  let hardwareFailed = false
  // The frame-exact H.264 cut is the clip's canonical playback media and the
  // poster source. Renditions encode from the original with the same range,
  // so every published asset is a first-generation encode of the source.
  const cut = await encodeAndPublishCut({
    id,
    runId,
    workDir,
    sourcePath,
    config: transcodingConfig,
    source: sourceProbe,
    trim,
    signal,
    uploadedKeys,
    onHardwareFailed: () => {
      hardwareFailed = true
    },
  })
  await ensureStillPresent(store, id, runId, signal)

  const durationMs = cut.durationMs ?? sourceProbe.durationMs
  const sourceFps = persistedSourceFps(sourceProbe.fps)
  const fingerprintFacts = {
    height: sourceProbe.height,
    sourceFps,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
  }
  const ladder = expectedLadder(transcodingConfig, fingerprintFacts)

  const writeProgress = makeMediaProgressWriter({
    id,
    commit: (pct) => store.commitProgress(id, runId, pct),
    onCommitted: (pct) => store.publishProgress(row.authorId, id, pct),
  })
  const progress = makeEncodeProgressTracker(ladder, writeProgress)

  const sourceAsset = await resolveSourceAsset({
    id,
    runId,
    row,
    sourcePath,
    sourceContentType,
    probe: sourceProbe,
    uploadedKeys,
  })
  const hasAudio = sourceProbe.audioCodec !== null
  const waveformKey = hasAudio
    ? (row.waveformKey ??
      (await resolveWaveformAudio({
        id,
        runId,
        sourcePath,
        workDir,
        durationMs: sourceProbe.durationMs,
        hasAudio,
        signal,
        uploadedKeys,
      })))
    : null

  const sourcePatch = makeSourcePatch({
    asset: sourceAsset,
    probe: sourceProbe,
    sourceFps,
    waveformKey,
    cut,
    durationMs,
  })
  const sourceCommitted = await store.commitSource(id, runId, sourcePatch)
  if (!sourceCommitted) {
    throw abortMediaProcessing()
  }
  retainSourceAsset(sourceAsset)
  if (waveformKey) retainPublishedKey(waveformKey)
  if (cut.key) retainPublishedKey(cut.key)
  progress.complete(SOURCE_PHASE_COST)

  await ensureStillPresent(store, id, runId, signal)
  // Publish the poster before the encode ladder so viewers see a real
  // thumbnail for the whole encode instead of only the BlurHash. A poster the
  // owner picked stays while the cut still shows its frame. Otherwise
  // extraction is best-effort: first publishes can proceed without a
  // thumbnail, while re-runs keep an automatic thumbnail when no usable frame
  // exists. A re-trim already dropped any poster the new cut does not show.
  const picked = pickedPoster(row, trim, sourceProbe.durationMs)
  const poster = picked
    ? null
    : await extractPosterBestEffort(cut.posterMediaPath, workDir, {
        durationMs,
        signal,
      })
  const thumb =
    picked ??
    (poster?.kind === "thumbnail"
      ? await publishRunThumbnail(id, runId, poster.poster, uploadedKeys)
      : previousAutomaticPoster(row))
  const { thumbKey } = thumb
  // A clip with no usable frame is marked so the thumbnail backfill leaves it
  // alone. commitReady writes the mark again, since its source columns reset
  // it and the backfill would otherwise re-run the same grabs after every
  // full run.
  const thumbFailedAt =
    poster?.kind === "permanent-empty" ? new Date() : undefined
  if (
    !(await store.commitThumb(id, runId, {
      ...thumb,
      thumbFailedAt,
    }))
  )
    throw abortMediaProcessing()
  // Reprocess runs keep old renditions until commitReady swaps them.
  if (!row.sourceKey && !(await store.commitPlayable(id, runId)))
    throw abortMediaProcessing()
  if (thumbKey) retainPublishedKey(thumbKey)
  store.publishUpsert(row.authorId, id)
  progress.complete(POSTER_PHASE_COST)

  const renditions = await encodeAndUploadRenditions({
    store,
    id,
    runId,
    signal,
    workDir,
    sourcePath,
    ladder,
    config: transcodingConfig,
    trim: trim ?? undefined,
    durationMs,
    hardwareFailed,
    uploadedKeys,
    progress,
  })

  await ensureStillPresent(store, id, runId, signal)
  if (!(await store.commitStage(id, runId, "finalizing")))
    throw abortMediaProcessing()
  const committed = await store.commitReady(
    id,
    runId,
    {
      ...sourcePatch,
      ...thumb,
      thumbFailedAt,
      encodeFingerprint: encodeFingerprint(transcodingConfig, fingerprintFacts),
    },
    renditions,
    completion,
  )
  if (!committed) throw abortMediaProcessing()
  progress.complete(FINALIZE_PHASE_COST)
  store.publishUpsert(row.authorId, id)
}

/** The poster the owner picked, while the cut still shows its frame. */
function pickedPoster(
  row: MediaRow,
  trim: { startMs: number; endMs: number } | null,
  sourceDurationMs: number,
): MediaThumbPatch | null {
  if (row.thumbKey === null || row.thumbTimeMs === null) return null
  if (!trimShowsFrame(trim, row.thumbTimeMs, sourceDurationMs)) return null
  return {
    thumbKey: row.thumbKey,
    thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
    thumbTimeMs: row.thumbTimeMs,
  }
}

/**
 * What a re-run keeps when the cut has no usable frame: an automatic poster,
 * which still matches the cut since a re-trim drops it. A picked poster that
 * got here shows a frame the cut no longer has, so it goes.
 */
function previousAutomaticPoster(row: MediaRow): MediaThumbPatch {
  return row.thumbKey !== null && row.thumbTimeMs === null
    ? {
        thumbKey: row.thumbKey,
        thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
        thumbTimeMs: null,
      }
    : { thumbKey: null, thumbBlurHash: null, thumbTimeMs: null }
}

function makeSourcePatch({
  asset,
  probe,
  sourceFps,
  waveformKey,
  cut,
  durationMs,
}: {
  asset: SourceAsset
  probe: Awaited<ReturnType<typeof probeMedia>>
  sourceFps: MediaSourcePatch["sourceFps"]
  waveformKey: string | null
  cut: Awaited<ReturnType<typeof encodeAndPublishCut>>
  durationMs: number
}): MediaSourcePatch {
  return {
    sourceKey: asset.storageKey,
    sourceContentType: asset.contentType,
    sourceVideoCodec: asset.videoCodec,
    sourceAudioCodec: asset.audioCodec,
    sourceCodecs: sourceCodecsString(probe),
    sourceFps,
    sourceSizeBytes: asset.sizeBytes,
    sourceDurationMs: probe.durationMs,
    waveformKey,
    cutKey: cut.key,
    cutCodecs: cut.codecs,
    durationMs,
    width: probe.width,
    height: probe.height,
  }
}
