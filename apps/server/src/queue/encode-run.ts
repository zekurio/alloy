import { copyFile, rm, stat } from "node:fs/promises"

import type { AcceptedContentType } from "@workspace/contracts"
import { clip, clipUploadTicket } from "@workspace/db/schema"
import { logger } from "@workspace/logging"
import { and, eq } from "drizzle-orm"

import { publishClipUpsert } from "../clips/events"
import { db } from "../db"
import { notifyFollowersOfNewClip } from "../notifications"
import { join } from "../runtime/path"
import { clipAssetKey, clipStorage } from "../storage"
import { deleteScratchUpload, scratchUploadPath } from "../uploads/scratch"
import { abortEncode } from "./encode-abort"
import { makeProgressWriter } from "./encode-progress"
import { type Asset, publishOriginalSource } from "./encode-publish"
import { ensureClipStillPresent, makeScratchDir } from "./encode-run-helpers"
import { probe, thumbnail } from "./ffmpeg"

type ClipRow = typeof clip.$inferSelect

export async function runEncodeInner(
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
        `[queue] failed to remove encode scratch dir ${scratchDir}:`,
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
  if (!published) throw abortEncode()
  void publishClipUpsert(row.authorId, clipId)

  const probed = await probe(sourcePath)
  const outputDurationMs = probed.durationMs

  const totalWork = 3
  let completedWork = 0
  const writeProgress = makeProgressWriter(clipId, row.authorId, runId)
  const completeWork = () => {
    completedWork += 1
    writeProgress(Math.min(99, Math.floor((completedWork / totalWork) * 100)))
  }

  const sourceKey = row.sourceKey ?? clipAssetKey(clipId, "source")
  const canReuseSource = row.sourceKey === sourceKey
  const sourceAsset = canReuseSource
    ? {
        storageKey: sourceKey,
        contentType: sourceContentType,
        sizeBytes: row.sourceSizeBytes ?? (await stat(sourcePath)).size,
        width: probed.width,
        height: probed.height,
        videoCodec: probed.videoCodec,
        audioCodec: probed.audioCodec,
      }
    : await publishOriginalSource({
        sourcePath,
        sourceKey,
        contentType: sourceContentType,
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
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!sourcePublished) throw abortEncode()
  retainSourceAsset(sourceAsset)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const thumbKey = clipAssetKey(clipId, "thumb")
  const thumbPath = join(scratchDir, "thumb.webp")
  const thumbAtMs = Math.min(outputDurationMs - 1, outputDurationMs / 3)
  await thumbnail(sourcePath, thumbPath, {
    atMs: Math.max(0, thumbAtMs),
    signal,
  })
  await clipStorage.uploadFromFile(thumbPath, thumbKey, "image/webp")
  uploadedKeys.push(thumbKey)
  const [thumbPublished] = await db
    .update(clip)
    .set({
      thumbKey,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!thumbPublished) throw abortEncode()
  retainPublishedKey(thumbKey)
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
        openGraphKey: null,
        openGraphContentType: null,
        openGraphSizeBytes: null,
        thumbKey,
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
  if (!publishState.updated) throw abortEncode()
  // The clip row now points at the newly published assets. Any previous asset
  // that was not retained is orphaned; prune it best-effort after publish.
  await pruneStaleClipAssets(row, [sourceAsset.storageKey, thumbKey])
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
    "failed encode asset",
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
