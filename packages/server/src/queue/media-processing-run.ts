import { copyFile, rm, stat } from "node:fs/promises"

import type { AcceptedContentType } from "@alloy/contracts"
import { type Clip, clip, clipUploadTicket } from "@alloy/db/schema"
import { logger } from "@alloy/logging"
import {
  ensureDirectHlsPackage,
  makeDirectHlsSpec,
} from "@alloy/server/clips/direct-hls"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { probeMedia } from "@alloy/server/media/probe"
import { trimToMp4 } from "@alloy/server/media/trim"
import { notifyFollowersOfNewClip } from "@alloy/server/notifications/index"
import { join } from "@alloy/server/runtime/path"
import {
  clipAssetDir,
  clipAssetKey,
  clipStorage,
} from "@alloy/server/storage/index"
import {
  deleteScratchUpload,
  deleteScratchUploads,
  scratchUploadPath,
} from "@alloy/server/uploads/scratch"
import { and, eq } from "drizzle-orm"

import { abortMediaProcessing } from "./media-abort"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, publishOriginalSource } from "./media-publish"
import { ensureClipStillPresent, makeScratchDir } from "./media-run-helpers"

export async function runMediaProcessingInner(
  clipId: string,
  row: Clip,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const scratchDir = await makeScratchDir(clipId)
  const uploadedKeys: string[] = []
  const retainedKeys = new Set<string>()
  if (row.sourceKey) retainedKeys.add(row.sourceKey)
  if (row.thumbKey) retainedKeys.add(row.thumbKey)
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
  row: Clip
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

  const probed = await probeMedia(mediaPath)
  const outputDurationMs = probed.durationMs

  const totalWork = 3
  let completedWork = 0
  const writeProgress = makeMediaProgressWriter(clipId, row.authorId, runId)
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
  // The desktop client is the only producer of posters: it ships a rendered
  // webp plus a BlurHash at initiate. The server never extracts frames — when
  // no poster was uploaded (an owner trim reprocess), the existing one is
  // kept as-is.
  const { thumbKey, thumbBlurHash } = await republishUploadedThumbnail(
    clipId,
    row,
    uploadedKeys,
  )
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
  if (thumbKey) retainPublishedKey(thumbKey)
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
        thumbKey,
        thumbBlurHash,
        durationMs: outputDurationMs,
        width: sourceAsset.width,
        height: sourceAsset.height,
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
    ...(thumbKey ? [thumbKey] : []),
  ])
  await cleanupCompletedScratchUploads(clipId)
  completeWork()
  void publishClipUpsert(row.authorId, clipId)
  void prewarmDirectHls(clipId)
  if (
    publishState.previous?.status !== "ready" &&
    publishState.updated.privacy === "public"
  ) {
    void notifyFollowersOfNewClip({ authorId: row.authorId, clipId })
  }
}

/** Build the clip's HLS package ahead of the first viewer. Best-effort. */
async function prewarmDirectHls(clipId: string): Promise<void> {
  try {
    const [fresh] = await db
      .select({
        id: clip.id,
        sourceKey: clip.sourceKey,
        sourceSizeBytes: clip.sourceSizeBytes,
        updatedAt: clip.updatedAt,
      })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    if (!fresh?.sourceKey) return
    await ensureDirectHlsPackage(
      makeDirectHlsSpec({ ...fresh, sourceKey: fresh.sourceKey }),
    )
  } catch (err) {
    logger.warn(`[queue] direct HLS prewarm failed for ${clipId}:`, err)
  }
}

function pendingTrimRange(
  row: Pick<Clip, "trimStartMs" | "trimEndMs">,
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
  row: Pick<Clip, "sourceKey" | "thumbKey">,
  retainedKeys: Iterable<string>,
): Promise<void> {
  const retained = new Set(retainedKeys)
  const previousKeys = new Set([row.sourceKey, row.thumbKey])
  previousKeys.delete(null)

  await deleteClipAssetsBestEffort(
    [...previousKeys].filter((key): key is string => key !== null),
    retained,
    "stale clip asset",
  )
}

/**
 * Republish the desktop-uploaded poster when one was staged for this run,
 * otherwise keep whatever the row already points at (owner trim reprocess).
 */
async function republishUploadedThumbnail(
  clipId: string,
  row: Clip,
  uploadedKeys: string[],
): Promise<{ thumbKey: string | null; thumbBlurHash: string | null }> {
  const uploadedThumbKey = await selectThumbUploadKey(clipId)
  if (uploadedThumbKey) {
    const uploadedPath = scratchUploadPath(uploadedThumbKey)
    if (await scratchFileExists(uploadedPath)) {
      const thumbKey = clipAssetKey(clipId, "thumb")
      await clipStorage.uploadFromFile(uploadedPath, thumbKey, "image/webp")
      uploadedKeys.push(thumbKey)
      return { thumbKey, thumbBlurHash: row.thumbBlurHash }
    }
  }
  return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
}

async function scratchFileExists(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch(() => false)
}

async function selectThumbUploadKey(clipId: string): Promise<string | null> {
  const [ticket] = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, clipId),
        eq(clipUploadTicket.role, "thumb"),
      ),
    )
    .limit(1)
  return ticket?.storageKey ?? null
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

async function cleanupCompletedScratchUploads(clipId: string): Promise<void> {
  // After a successful publish every staged upload (video + poster) is
  // consumed, so drop their scratch files and ticket rows together.
  const tickets = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(eq(clipUploadTicket.clipId, clipId))
  if (tickets.length === 0) return
  await deleteScratchUploads(
    tickets.map((ticket) => ticket.storageKey),
    "completed scratch upload",
  )
  await db.delete(clipUploadTicket).where(eq(clipUploadTicket.clipId, clipId))
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
