import { and, eq } from "drizzle-orm"

import { clip, clipUploadTicket } from "@workspace/db/schema"
import type { AcceptedContentType } from "@workspace/contracts"
import { logger } from "@workspace/logging"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { notifyFollowersOfNewClip } from "../notifications"
import { configStore } from "../config/store"
import { join } from "../runtime/path"

import { clipAssetKey, storage } from "../storage"
import { deleteScratchUpload, scratchUploadPath } from "../uploads/scratch"
import { abortEncode } from "./encode-abort"
import { makeProgressWriter } from "./encode-progress"
import { probe, thumbnail } from "./ffmpeg"
import {
  planReuse,
  pruneStaleVariants,
  resolveVariantSettings,
} from "./encode-variant-helpers"
import { buildVariantPlan } from "./variant-specs"
import {
  ensureClipStillPresent,
  makeScratchDir,
  resolveTrim,
} from "./encode-run-helpers"
import {
  type Asset,
  encodePlaybackVariants,
  publishOpenGraph,
  publishRemuxedSource,
} from "./encode-publish"

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
    await Deno.remove(scratchDir, { recursive: true }).catch((err) => {
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
    await storage.downloadToFile(row.sourceKey, sourcePath)
  } else {
    const uploadKey = await selectScratchUploadKey(clipId)
    if (!uploadKey) throw new Error("Uploaded source is missing")
    await Deno.copyFile(scratchUploadPath(uploadKey), sourcePath)
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
  const trim = resolveTrim(row, probed.durationMs)
  const outputDurationMs = trim.startMs != null && trim.endMs != null
    ? Math.max(1, trim.endMs - trim.startMs)
    : probed.durationMs

  const encoderConfig = configStore.get("encoder")
  const variantPlan = encoderConfig.enabled
    ? buildVariantPlan(
      clipId,
      probed.height,
      encoderConfig.variants,
      encoderConfig.defaultVariantId,
      runId,
    )
    : { specs: [], skipped: [] }
  const variantSpecs = variantPlan.specs

  const totalWork = 4 + variantSpecs.length
  let completedWork = 0
  const writeProgress = makeProgressWriter(clipId, row.authorId, runId)
  const completeWork = () => {
    completedWork += 1
    writeProgress(Math.min(99, Math.floor((completedWork / totalWork) * 100)))
  }
  const writeVariantProgress = (variantPct: number) => {
    writeProgress(
      Math.min(
        99,
        Math.floor(((completedWork + variantPct / 100) / totalWork) * 100),
      ),
    )
  }

  const publishedSourceContentType = "video/mp4"
  const sourceKey = row.sourceKey ?? clipAssetKey(clipId, "source")
  const sourceUpload = row.sourceKey
    ? { size: row.sourceSizeBytes ?? (await Deno.stat(sourcePath)).size }
    : await publishRemuxedSource({
      sourcePath,
      scratchDir,
      trim,
      signal,
      sourceKey,
    })
  if (!row.sourceKey) uploadedKeys.push(sourceKey)
  const sourceAsset = {
    storageKey: sourceKey,
    contentType: publishedSourceContentType,
    sizeBytes: sourceUpload.size,
  }
  const [sourcePublished] = await db
    .update(clip)
    .set({
      sourceKey: sourceAsset.storageKey,
      sourceContentType: sourceAsset.contentType,
      sourceSizeBytes: sourceAsset.sizeBytes,
      durationMs: outputDurationMs,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!sourcePublished) throw abortEncode()
  retainSourceAsset(sourceAsset)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const openGraph = await publishOpenGraph({
    clipId,
    sourcePath,
    scratchDir,
    probed,
    trim,
    signal,
  })
  uploadedKeys.push(openGraph.storageKey)
  completeWork()

  await ensureClipStillPresent(clipId, runId, signal)
  const thumbKey = clipAssetKey(clipId, "thumb")
  const thumbPath = join(scratchDir, "thumb.jpg")
  const thumbAtMs = (trim.startMs ?? 0) +
    Math.min(outputDurationMs - 1, outputDurationMs / 3)
  await thumbnail(sourcePath, thumbPath, {
    atMs: Math.max(0, thumbAtMs),
    signal,
  })
  await storage.uploadFromFile(thumbPath, thumbKey, "image/jpeg")
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

  const targetSettings = variantSpecs.map((spec) =>
    resolveVariantSettings(spec, encoderConfig, trim.startMs, trim.endMs)
  )
  const reusedBySpecIndex = await planReuse(row, variantSpecs, targetSettings)
  const encodedVariants = await encodePlaybackVariants({
    clipId,
    specs: variantSpecs,
    settings: targetSettings,
    reuse: reusedBySpecIndex,
    sourcePath,
    scratchDir,
    durationMs: outputDurationMs,
    trim,
    runId,
    signal,
    writeVariantProgress,
    onVariantUploaded: (key) => uploadedKeys.push(key),
    completeWork,
  })

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
        sourceSizeBytes: sourceAsset.sizeBytes,
        openGraphKey: openGraph.storageKey,
        openGraphContentType: openGraph.contentType,
        openGraphSizeBytes: openGraph.sizeBytes,
        thumbKey,
        durationMs: outputDurationMs,
        width: probed.width,
        height: probed.height,
        variants: encodedVariants,
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
  // The clip row now points at `encodedVariants`; any previous variant whose
  // run-scoped storage key was not reused is orphaned. Variant keys embed the
  // runId, so a re-encode that drops or re-keys a profile would otherwise leak
  // the prior files. Best-effort cleanup, logged on failure.
  await pruneStaleVariants(row, reusedBySpecIndex)
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
  await Promise.all(
    [...new Set(uploadedKeys)]
      .filter((key) => !retainedKeys.has(key))
      .map(async (key) => {
        try {
          await storage.delete(key)
        } catch (err) {
          logger.warn(
            `[queue] failed to delete failed encode asset ${key}:`,
            err,
          )
        }
      }),
  )
}
