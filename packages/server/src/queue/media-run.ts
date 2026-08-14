import { normalizeBlurHash, type AcceptedContentType } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { renditionIsH264 } from "@alloy/server/clips/codecs"
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
import { probeMedia, sourceCodecsString } from "@alloy/server/media/probe"
import { join } from "@alloy/server/runtime/path"
import { clipThumbnailStorage } from "@alloy/server/storage/index"
import { deleteStagedUpload } from "@alloy/server/uploads/staged"
import {
  cleanupTickets,
  selectVideoTicketKey,
} from "@alloy/server/uploads/tickets"
import { announceClipPublished } from "@alloy/server/webhooks/publish"

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
import {
  ensureStillPresent,
  pruneStaleAssets,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type { MediaRow, MediaStore } from "./media-store"
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
  const transcodingConfig = configStore.get("transcoding")
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

  const sourceAsset = await resolveSourceAsset({
    id,
    runId,
    row,
    sourcePath,
    sourceContentType,
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
    cutKey: cut.key,
    cutCodecs: cut.codecs,
    durationMs,
    width: sourceProbe.width,
    height: sourceProbe.height,
  }
  if (!(await store.commitSource(id, runId, sourcePatch)))
    throw abortMediaProcessing()
  retainSourceAsset(sourceAsset, !row.sourceKey)
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
    // The clip went live at commitPlayable. Announce once the OG tier is an
    // embeddable H.264 rendition; non-H.264 OG tiers use the end-of-run net.
    onOgRenditionCommitted: (rendition) => {
      retainPublishedKey(rendition.storageKey)
      if (renditionIsH264(rendition.codecs)) announceClipPublished(id)
    },
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
      ...(cut.key ? [cut.key] : []),
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
