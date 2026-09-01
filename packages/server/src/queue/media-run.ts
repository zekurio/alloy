import { normalizeBlurHash, type TranscodingConfig } from "@alloy/contracts"
import {
  encodeFingerprint,
  expectedLadder,
  persistedSourceFps,
} from "@alloy/server/media/encode-fingerprint"
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
import { join } from "@alloy/server/runtime/path"

import { abortMediaProcessing } from "./media-abort"
import {
  audioStemPhaseCost,
  FINALIZE_PHASE_COST,
  makeEncodeProgressTracker,
  POSTER_PHASE_COST,
  SOURCE_PHASE_COST,
} from "./media-encode-progress"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset } from "./media-publish"
import {
  encodeAndPublishCut,
  encodeAndUploadRenditions,
} from "./media-run-encode"
import {
  extractPosterBestEffort,
  publishRunThumbnail,
  trimRange,
} from "./media-run-input"
import { acquireSourceFile, resolveSourceAsset } from "./media-run-source"
import {
  extractAndUploadAudioStemsBestEffort,
  validatedAudioTrackHints,
} from "./media-run-stems"
import { resolveWaveformAudio } from "./media-run-waveform"
import {
  ensureStillPresent,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type { MediaCompletion, MediaRow, MediaStore } from "./media-store"
export {
  encodeProgressPercent,
  encodeProgressTotalCost,
} from "./media-encode-progress"
export { runThumbnailBackfill } from "./media-thumbnail-backfill"
export { runWaveformBackfill } from "./media-run-waveform"

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
  uploadedKeys: string[]
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
  const audioTrackHints = validatedAudioTrackHints(
    row,
    sourceProbe.audioTracks.length,
  )
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
  const sourceCodecs = sourceCodecsString(sourceProbe)
  const sourceFps = persistedSourceFps(sourceProbe.fps)
  const fingerprintFacts = {
    height: sourceProbe.height,
    sourceFps,
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

  const sourceAsset = await resolveSourceAsset({
    id,
    runId,
    row,
    sourcePath,
    sourceContentType,
    probe: sourceProbe,
    uploadedKeys,
  })
  const hasAudio = sourceProbe.audioTracks.length > 0
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

  const sourcePatch = {
    sourceKey: sourceAsset.storageKey,
    sourceContentType: sourceAsset.contentType,
    sourceVideoCodec: sourceAsset.videoCodec,
    sourceAudioCodec: sourceAsset.audioCodec,
    sourceCodecs,
    sourceFps,
    sourceSizeBytes: sourceAsset.sizeBytes,
    sourceDurationMs: sourceProbe.durationMs,
    waveformKey,
    pendingAudioTracks: audioTrackHints.length ? audioTrackHints : null,
    audioTrackFingerprint: fingerprintFacts.audioTrackFingerprint,
    cutKey: cut.key,
    cutCodecs: cut.codecs,
    durationMs,
    width: sourceProbe.width,
    height: sourceProbe.height,
  }
  if (!(await store.commitSource(id, runId, sourcePatch)))
    throw abortMediaProcessing()
  retainSourceAsset(sourceAsset)
  if (waveformKey) retainPublishedKey(waveformKey)
  if (cut.key) retainPublishedKey(cut.key)
  progress.complete(SOURCE_PHASE_COST)

  await ensureStillPresent(store, id, runId, signal)
  // Publish the poster before the encode ladder so viewers see a real
  // thumbnail for the whole encode instead of only the BlurHash. Extraction is
  // best-effort: first publishes can proceed without a thumbnail, while
  // re-runs keep any previously committed thumbnail when no usable frame exists.
  const poster = await extractPosterBestEffort(cut.posterMediaPath, workDir, {
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
    completion,
  )
  if (!committed) throw abortMediaProcessing()
  progress.complete(FINALIZE_PHASE_COST)
  store.publishUpsert(row.authorId, id)
}
