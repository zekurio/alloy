import { copyFile, rm, stat } from "node:fs/promises"

import type { AcceptedContentType } from "alloy-contracts"
import { clip, clipUploadTicket } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq } from "drizzle-orm"

import { publishClipUpsert } from "../clips/events"
import { publishOpenGraphVariant } from "../clips/opengraph-variant"
import { db } from "../db"
import { imageBlurHash } from "../media/blurhash"
import { notifyFollowersOfNewClip } from "../notifications"
import { join } from "../runtime/path"
import { clipAssetDir, clipAssetKey, clipStorage } from "../storage"
import { deleteScratchUpload, scratchUploadPath } from "../uploads/scratch"
import { probe, thumbnail, trimToMp4 } from "./ffmpeg"
import { abortMediaProcessing } from "./media-abort"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, publishOriginalSource } from "./media-publish"
import { ensureClipStillPresent, makeScratchDir } from "./media-run-helpers"

type ClipRow = typeof clip.$inferSelect

export async function runMediaProcessingInner(
  clipId: string,
  row: ClipRow,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const scratchDir = await makeScratchDir(clipId)
  const uploadedKeys: string[] = []
  const retainedKeys = new Set<string>()
  if (row.sourceKey) retainedKeys.add(row.sourceKey)
  if (row.thumbKey) retainedKeys.add(row.thumbKey)
  if (row.openGraphKey) retainedKeys.add(row.openGraphKey)
  let sourcePublishedForRetry = !!row.sourceKey
  try {
    await runPipelineInScratch({
      clipId,
      row,
      runId,
      signal,
      scratchDir,
      uploadedKeys,
      retainSourceAsset: (asset) => {
        retainedKeys.add(asset.storageKey)
        sourcePublishedForRetry = true
      },
      retainPublishedKey: (key) => retainedKeys.add(key),
    })
  } catch (err) {
    await cleanupFailedRun(uploadedKeys, retainedKeys)
    if (sourcePublishedForRetry) {
      await deleteScratchUpload(await selectScratchUploadKey(clipId))
    }
    throw err
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(
        `[queue] failed to remove media processing scratch dir ${scratchDir}:`,
        err,
      )
    })
  }
}

async function runPipelineInScratch({
  clipId,
  row,
  runId,
  signal,
  scratchDir,
  uploadedKeys,
  retainSourceAsset,
  retainPublishedKey,
}: {
  clipId: string
  row: ClipRow
  runId: string
  signal: AbortSignal
  scratchDir: string
  uploadedKeys: string[]
  retainSourceAsset: (asset: Asset) => void
  retainPublishedKey: (key: string) => void
}): Promise<void> {
  const sourceContentType = row.sourceContentType as AcceptedContentType | null
  if (!sourceContentType) throw new Error("Clip is missing source content type")

  const sourcePath = join(scratchDir, "source")
  if (row.sourceKey) {
    await clipStorage.downloadToFile(row.sourceKey, sourcePath)
  } else {
    const uploadKey = await selectScratchUploadKey(clipId)
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await copyFile(scratchUploadPath(uploadKey), sourcePath)
  }
  await ensureClipStillPresent(clipId, runId, signal)

  const [published] = await db
    .update(clip)
    .set({
      status: "processing",
      encodeProgress: 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!published) throw abortMediaProcessing()
  void publishClipUpsert(row.authorId, clipId)

  // A pending owner trim cuts the source before anything else is derived.
  // The cut file is published under a fresh versioned key, so the original
  // source stays intact until the new one is committed to the row — a retry
  // after a mid-run failure re-trims from the untouched original.
  const trim = pendingTrimRange(row)
  let mediaPath = sourcePath
  let mediaContentType = sourceContentType
  if (trim) {
    const trimmedPath = join(scratchDir, "trimmed.mp4")
    await trimToMp4(sourcePath, trimmedPath, { ...trim, signal })
    mediaPath = trimmedPath
    mediaContentType = "video/mp4"
  }
  await ensureClipStillPresent(clipId, runId, signal)

  const probed = await probe(mediaPath)
  const outputDurationMs = probed.durationMs

  const totalWork = 4
  let completedWork = 0
  const writeProgress = makeMediaProgressWriter(clipId, row.authorId, runId)
  const writePartialProgress = (pct: number) => {
    writeProgress(
      Math.min(99, Math.floor(((completedWork + pct / 100) / totalWork) * 100)),
    )
  }
  const completeWork = () => {
    completedWork += 1
    writeProgress(Math.min(99, Math.floor((completedWork / totalWork) * 100)))
  }

  const sourceKey = trim
    ? trimmedSourceKey(clipId)
    : (row.sourceKey ?? clipAssetKey(clipId, "source"))
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
  const [sourcePublished] = await db
    .update(clip)
    .set({
      sourceKey: sourceAsset.storageKey,
      sourceContentType: sourceAsset.contentType,
      sourceVideoCodec: sourceAsset.videoCodec,
      sourceAudioCodec: sourceAsset.audioCodec,
      sourceSizeBytes: sourceAsset.sizeBytes,
      durationMs: outputDurationMs,
      width: sourceAsset.width,
      height: sourceAsset.height,
      // The trim is applied the moment the row points at the cut source;
      // clearing it here keeps a retried run from cutting a second time.
      trimStartMs: null,
      trimEndMs: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!sourcePublished) throw abortMediaProcessing()
  retainSourceAsset(sourceAsset)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const thumbKey = clipAssetKey(clipId, "thumb")
  const thumbPath = join(scratchDir, "thumb.webp")
  const thumbAtMs = Math.min(outputDurationMs - 1, outputDurationMs / 3)
  await thumbnail(mediaPath, thumbPath, {
    atMs: Math.max(0, thumbAtMs),
    signal,
  })
  // Prefer the freshly computed hash; keep a client-provided one from
  // initiate when the local compute fails rather than blanking it out.
  const thumbBlurHash =
    (await computeThumbBlurHash(thumbPath, signal)) ?? row.thumbBlurHash
  await clipStorage.uploadFromFile(thumbPath, thumbKey, "image/webp")
  uploadedKeys.push(thumbKey)
  const [thumbPublished] = await db
    .update(clip)
    .set({
      thumbKey,
      thumbBlurHash,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!thumbPublished) throw abortMediaProcessing()
  retainPublishedKey(thumbKey)
  void publishClipUpsert(row.authorId, clipId)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const openGraphPath = join(scratchDir, "opengraph.mp4")
  const openGraphAsset = await publishOpenGraphVariant({
    clipId,
    sourcePath: mediaPath,
    outPath: openGraphPath,
    source: probed,
    signal,
    onProgress: writePartialProgress,
  })
  uploadedKeys.push(openGraphAsset.storageKey)
  const [openGraphPublished] = await db
    .update(clip)
    .set({
      openGraphKey: openGraphAsset.storageKey,
      openGraphContentType: openGraphAsset.contentType,
      openGraphSizeBytes: openGraphAsset.sizeBytes,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!openGraphPublished) throw abortMediaProcessing()
  retainPublishedKey(openGraphAsset.storageKey)
  void publishClipUpsert(row.authorId, clipId)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const publishState = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ status: clip.status, privacy: clip.privacy })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
      .for("update")
    const [updated] = await tx
      .update(clip)
      .set({
        status: "ready",
        sourceKey: sourceAsset.storageKey,
        sourceContentType: sourceAsset.contentType,
        sourceVideoCodec: sourceAsset.videoCodec,
        sourceAudioCodec: sourceAsset.audioCodec,
        sourceSizeBytes: sourceAsset.sizeBytes,
        openGraphKey: openGraphAsset.storageKey,
        openGraphContentType: openGraphAsset.contentType,
        openGraphSizeBytes: openGraphAsset.sizeBytes,
        thumbKey,
        thumbBlurHash,
        durationMs: outputDurationMs,
        width: sourceAsset.width,
        height: sourceAsset.height,
        variants: [],
        encodeProgress: 100,
        encodeRunId: null,
        encodeLockedAt: null,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
      .returning({ status: clip.status, privacy: clip.privacy })
    return { previous, updated }
  })
  if (!publishState.updated) throw abortMediaProcessing()
  // The clip row now points at the newly published assets. Any previous asset
  // that was not retained is orphaned; prune it best-effort after publish.
  await pruneStaleClipAssets(row, [
    sourceAsset.storageKey,
    openGraphAsset.storageKey,
    thumbKey,
  ])
  await cleanupCompletedScratchUpload(clipId)
  completeWork()
  void publishClipUpsert(row.authorId, clipId)
  if (
    publishState.previous?.status !== "ready" &&
    publishState.updated.privacy === "public"
  ) {
    void notifyFollowersOfNewClip({ authorId: row.authorId, clipId })
  }
}

function pendingTrimRange(
  row: Pick<ClipRow, "trimStartMs" | "trimEndMs">,
): { startMs: number; endMs: number } | null {
  if (row.trimStartMs == null || row.trimEndMs == null) return null
  if (row.trimEndMs <= row.trimStartMs) return null
  return { startMs: row.trimStartMs, endMs: row.trimEndMs }
}

/**
 * A fresh key per trim so the cut source never overwrites the original
 * in place; the stale object is pruned after the run publishes.
 */
function trimmedSourceKey(clipId: string): string {
  const stamp = Date.now().toString(36)
  return `${clipAssetDir(clipId)}/source-${stamp}`
}

async function pruneStaleClipAssets(
  row: Pick<ClipRow, "sourceKey" | "openGraphKey" | "thumbKey" | "variants">,
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([
    row.sourceKey,
    row.openGraphKey,
    row.thumbKey,
    ...row.variants.map((variant) => variant.storageKey),
  ])
  previousKeys.delete(null)

  await deleteClipAssetsBestEffort(
    [...previousKeys].filter((key): key is string => key !== null),
    retained,
    "stale clip asset",
  )
}

async function selectScratchUploadKey(clipId: string): Promise<string | null> {
  const [ticket] = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.role, "video"),
      ),
    )
    .limit(1)
  return ticket?.storageKey ?? null
}

async function computeThumbBlurHash(
  thumbPath: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    return await imageBlurHash({
      source: thumbPath,
      label: "clip thumbnail blurhash",
      signal,
    })
  } catch (err) {
    if (signal.aborted) throw err
    logger.warn("[queue] failed to compute thumbnail blurhash:", err)
    return null
  }
}

async function cleanupCompletedScratchUpload(clipId: string): Promise<void> {
  const uploadKey = await selectScratchUploadKey(clipId)
  if (!uploadKey) return
  try {
    await deleteScratchUpload(uploadKey)
  } catch (err) {
    logger.warn(
      `[queue] failed to delete completed scratch upload ${uploadKey}:`,
      err,
    )
    return
  }
  await db
    .delete(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.role, "video"),
        eq(clipUploadTicket.storageKey, uploadKey),
      ),
    )
}

async function cleanupFailedRun(
  uploadedKeys: readonly string[],
  retainedKeys: ReadonlySet<string>,
): Promise<void> {
  await deleteClipAssetsBestEffort(
    new Set(uploadedKeys),
    retainedKeys,
    "failed media processing asset",
  )
}

async function deleteClipAssetsBestEffort(
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
          logger.warn(`[queue] failed to delete ${label} ${key}:`, err)
        }
      }),
  )
}
