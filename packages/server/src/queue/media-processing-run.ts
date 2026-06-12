import { rm, stat } from "node:fs/promises"

import type { AcceptedContentType } from "@alloy/contracts"
import { type Clip, clip, clipUploadTicket } from "@alloy/db/schema"
import { logger } from "@alloy/logging"
import {
  ensureDirectHlsPackage,
  makeDirectHlsSpec,
} from "@alloy/server/clips/direct-hls"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import * as imageValidation from "@alloy/server/media/image-validation"
import { probeMedia } from "@alloy/server/media/probe"
import { trimToMp4 } from "@alloy/server/media/trim"
import { notifyFollowersOfNewClip } from "@alloy/server/notifications/index"
import { THUMB_UPLOAD_MAX_BYTES } from "@alloy/server/routes/clips-upload-helpers"
import { join } from "@alloy/server/runtime/path"
import { clipStorage } from "@alloy/server/storage/index"
import {
  deleteStagedUpload,
  deleteStagedUploads,
  downloadStagedUploadToFile,
  resolveStagedUpload,
} from "@alloy/server/uploads/staged"
import { and, eq } from "drizzle-orm"
import sharp from "sharp"

import { abortMediaProcessing } from "./media-abort"
import { runScopedSourceKey, runScopedThumbKey } from "./media-asset-keys"
import { makeMediaProgressWriter } from "./media-progress"
import { type Asset, publishOriginalSource } from "./media-publish"
import { ensureClipStillPresent, makeMediaWorkDir } from "./media-run-helpers"

export async function runMediaProcessingInner(
  clipId: string,
  row: Clip,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const workDir = await makeMediaWorkDir(clipId)
  const uploadedKeys: string[] = []
  const retainedKeys = new Set<string>()
  if (row.sourceKey) retainedKeys.add(row.sourceKey)
  if (row.thumbKey) retainedKeys.add(row.thumbKey)
  let sourcePublishedForRetry = !!row.sourceKey
  try {
    await runPipelineInWorkDir({
      clipId,
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
    await retainRowAssetKeys(clipId, retainedKeys)
    await cleanupFailedRun(uploadedKeys, retainedKeys)
    if (sourcePublishedForRetry) {
      await deleteStagedUpload(await selectStagedUploadKey(clipId))
    }
    throw err
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((err) => {
      logger.warn(
        `[queue] failed to remove media processing work dir ${workDir}:`,
        err,
      )
    })
  }
}

async function runPipelineInWorkDir({
  clipId,
  row,
  runId,
  signal,
  workDir,
  uploadedKeys,
  retainSourceAsset,
  retainPublishedKey,
}: {
  clipId: string
  row: Clip
  runId: string
  signal: AbortSignal
  workDir: string
  uploadedKeys: string[]
  retainSourceAsset: (asset: Asset) => void
  retainPublishedKey: (key: string) => void
}): Promise<void> {
  const sourceContentType = row.sourceContentType as AcceptedContentType | null
  if (!sourceContentType) throw new Error("Clip is missing source content type")

  const sourcePath = join(workDir, "source")
  if (row.sourceKey) {
    await clipStorage.downloadToFile(row.sourceKey, sourcePath)
  } else {
    const uploadKey = await selectStagedUploadKey(clipId)
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await downloadStagedUploadToFile(uploadKey, sourcePath)
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
    const trimmedPath = join(workDir, "trimmed.mp4")
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
    ? runScopedSourceKey(clipId, runId)
    : (row.sourceKey ?? runScopedSourceKey(clipId, runId))
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
    runId,
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
  await cleanupCompletedStagedUploads(clipId)
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
  runId: string,
  row: Clip,
  uploadedKeys: string[],
): Promise<{ thumbKey: string | null; thumbBlurHash: string | null }> {
  const uploadedThumbKey = await selectThumbUploadKey(clipId)
  if (uploadedThumbKey) {
    const stagedThumb = await resolveStagedUpload(uploadedThumbKey)
    if (stagedThumb) {
      if (stagedThumb.size > THUMB_UPLOAD_MAX_BYTES) {
        logger.warn(
          `[queue] rejected oversized staged poster for ${clipId}: ${stagedThumb.size} bytes`,
        )
        return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
      }

      const buf = Buffer.from(
        await new Response(stagedThumb.stream()).arrayBuffer(),
      )
      const webp = await normalizeStagedPosterToWebp(buf, clipId)
      if (!webp) {
        return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
      }

      const thumbKey = runScopedThumbKey(clipId, runId)
      await clipStorage.put(thumbKey, webp, "image/webp")
      uploadedKeys.push(thumbKey)
      return { thumbKey, thumbBlurHash: row.thumbBlurHash }
    }
  }
  return { thumbKey: row.thumbKey, thumbBlurHash: row.thumbBlurHash }
}

/**
 * The published poster is always webp. The renderer uploads webp directly;
 * the desktop sync engine ships its cached JPEG poster, converted here.
 */
async function normalizeStagedPosterToWebp(
  buf: Buffer,
  clipId: string,
): Promise<Buffer | null> {
  const asWebp = imageValidation.validateImageBytes(buf, "image/webp")
  if (asWebp.ok) return buf

  const asJpeg = imageValidation.validateImageBytes(buf, "image/jpeg")
  if (!asJpeg.ok) {
    logger.warn(`[queue] rejected staged poster for ${clipId}: ${asJpeg.error}`)
    return null
  }
  try {
    return await sharp(buf).webp({ quality: 82 }).toBuffer()
  } catch (err) {
    logger.warn(`[queue] failed to convert staged poster for ${clipId}:`, err)
    return null
  }
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

async function selectStagedUploadKey(clipId: string): Promise<string | null> {
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

async function cleanupCompletedStagedUploads(clipId: string): Promise<void> {
  // After a successful publish every staged upload (video + poster) is
  // consumed, so drop their objects and ticket rows together.
  const tickets = await db
    .select({ storageKey: clipUploadTicket.storageKey })
    .from(clipUploadTicket)
    .where(eq(clipUploadTicket.clipId, clipId))
  if (tickets.length === 0) return
  await deleteStagedUploads(
    tickets.map((ticket) => ticket.storageKey),
    "completed staged upload",
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

/**
 * A competing run may have published while this run was failing; never
 * delete whatever the row currently points at. Best-effort: if the read
 * fails, uploadedKeys are run-scoped, so deleting them is safe regardless.
 */
async function retainRowAssetKeys(
  clipId: string,
  retainedKeys: Set<string>,
): Promise<void> {
  try {
    const [fresh] = await db
      .select({ sourceKey: clip.sourceKey, thumbKey: clip.thumbKey })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    if (fresh?.sourceKey) retainedKeys.add(fresh.sourceKey)
    if (fresh?.thumbKey) retainedKeys.add(fresh.thumbKey)
  } catch (err) {
    logger.warn(`[queue] failed to retain row asset keys for ${clipId}:`, err)
  }
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
