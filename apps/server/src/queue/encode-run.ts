import { and, eq } from "drizzle-orm"

import {
  clip,
  clipUploadTicket,
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"
import type { AcceptedContentType } from "@workspace/contracts"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { notifyFollowersOfNewClip } from "../notifications"
import { configStore } from "../config/store"
import { join } from "../runtime/path"
import { clipAssetKey, clipOpenGraphVideoKey, storage } from "../storage"
import { deleteScratchUpload, scratchUploadPath } from "../uploads/scratch"
import { abortEncode } from "./encode-abort"
import { makeProgressWriter } from "./encode-progress"
import { codecNameFor, encode, probe, remuxToMp4, thumbnail } from "./ffmpeg"
import { planReuse, resolveVariantSettings } from "./encode-variant-helpers"
import { buildVariantPlan, type VariantSpec } from "./variant-specs"
import {
  ensureClipStillPresent,
  makeScratchDir,
  resolveTrim,
} from "./encode-run-helpers"

type ClipRow = typeof clip.$inferSelect

type Asset = {
  storageKey: string
  contentType: string
  sizeBytes: number
}

export async function runEncodeInner(
  clipId: string,
  row: ClipRow,
  runId: string,
  signal: AbortSignal
): Promise<void> {
  const scratchDir = await makeScratchDir(clipId)
  const uploadedKeys: string[] = []
  let retainedSourceKey: string | null = null
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
        retainedSourceKey = asset.storageKey
        sourcePublishedForRetry = true
      },
    })
  } catch (err) {
    await cleanupFailedRun(uploadedKeys, retainedSourceKey)
    if (sourcePublishedForRetry) {
      await deleteScratchUpload(await selectScratchUploadKey(clipId))
    }
    throw err
  } finally {
    await Deno.remove(scratchDir, { recursive: true }).catch(() => {
      // Best-effort: a stray scratch dir is a capacity issue, not data loss.
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
}: {
  clipId: string
  row: ClipRow
  runId: string
  signal: AbortSignal
  scratchDir: string
  uploadedKeys: string[]
  retainSourceAsset: (asset: Asset) => void
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
  const outputDurationMs =
    trim.startMs != null && trim.endMs != null
      ? Math.max(1, trim.endMs - trim.startMs)
      : probed.durationMs

  const encoderConfig = configStore.get("encoder")
  const variantPlan = encoderConfig.enabled
    ? buildVariantPlan(
        clipId,
        probed.height,
        encoderConfig.variants,
        encoderConfig.defaultVariantId
      )
    : { specs: [], skipped: [] }
  const variantSpecs = variantPlan.specs
  if (variantPlan.skipped.length > 0) {
    console.info(
      `[encode] clip ${clipId}: skipped variants: ${variantPlan.skipped
        .map((variant) => `${variant.id} (${variant.reason})`)
        .join(", ")}`
    )
  }

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
        Math.floor(((completedWork + variantPct / 100) / totalWork) * 100)
      )
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
  const thumbAtMs =
    (trim.startMs ?? 0) + Math.min(outputDurationMs - 1, outputDurationMs / 3)
  await thumbnail(sourcePath, thumbPath, {
    atMs: Math.max(0, thumbAtMs),
    signal,
  })
  await storage.uploadFromFile(thumbPath, thumbKey, "image/jpeg")
  uploadedKeys.push(thumbKey)
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
  await deleteScratchUpload(await selectScratchUploadKey(clipId))
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
        eq(clipUploadTicket.role, "video")
      )
    )
    .limit(1)
  return ticket?.storageKey ?? null
}

async function publishRemuxedSource({
  sourcePath,
  scratchDir,
  trim,
  signal,
  sourceKey,
}: {
  sourcePath: string
  scratchDir: string
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  sourceKey: string
}): Promise<{ size: number }> {
  const remuxedSourcePath = join(scratchDir, "source.mp4")
  await remuxToMp4(sourcePath, remuxedSourcePath, {
    trimStartMs: trim.startMs,
    trimEndMs: trim.endMs,
    signal,
  })
  return await storage.uploadFromFile(remuxedSourcePath, sourceKey, "video/mp4")
}

async function publishOpenGraph({
  clipId,
  sourcePath,
  scratchDir,
  probed,
  trim,
  signal,
}: {
  clipId: string
  sourcePath: string
  scratchDir: string
  probed: Awaited<ReturnType<typeof probe>>
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
}): Promise<Asset & { width: number; height: number }> {
  const config = configStore.get("encoder")
  const targetHeight = Math.min(probed.height, 1080)
  const outPath = join(scratchDir, "opengraph.mp4")
  await encode(sourcePath, outPath, {
    config: {
      hwaccel: config.hwaccel,
      encoder: codecNameFor(config.hwaccel, "h264"),
      quality: 23,
      audioBitrateKbps: 256,
      extraInputArgs: "",
      extraOutputArgs: "",
      qsvDevice: config.qsvDevice,
      vaapiDevice: config.vaapiDevice,
    },
    targetHeight,
    durationMs:
      trim.startMs != null && trim.endMs != null
        ? Math.max(1, trim.endMs - trim.startMs)
        : probed.durationMs,
    onProgress: () => undefined,
    trimStartMs: trim.startMs,
    trimEndMs: trim.endMs,
    signal,
  })
  const variantProbe = await probe(outPath)
  const storageKey = clipOpenGraphVideoKey(clipId)
  const { size } = await storage.uploadFromFile(
    outPath,
    storageKey,
    "video/mp4"
  )
  return {
    storageKey,
    contentType: "video/mp4",
    sizeBytes: size,
    width: variantProbe.width,
    height: variantProbe.height,
  }
}

async function encodePlaybackVariants(opts: {
  clipId: string
  specs: VariantSpec[]
  settings: ClipVariantSettings[]
  reuse: Map<number, ClipEncodedVariant>
  sourcePath: string
  scratchDir: string
  durationMs: number
  trim: { startMs: number | null; endMs: number | null }
  runId: string
  signal: AbortSignal
  writeVariantProgress: (pct: number) => void
  onVariantUploaded: (storageKey: string) => void
  completeWork: () => void
}): Promise<ClipEncodedVariant[]> {
  const config = configStore.get("encoder")
  const encodedVariants: ClipEncodedVariant[] = []

  for (const [index, spec] of opts.specs.entries()) {
    await ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const reuse = opts.reuse.get(index)
    if (reuse) {
      encodedVariants.push({
        ...reuse,
        id: spec.id,
        label: spec.label,
        isDefault: spec.isDefault,
      })
      opts.completeWork()
      continue
    }

    const variantPath = join(opts.scratchDir, `${spec.id}.mp4`)
    await encode(opts.sourcePath, variantPath, {
      config: {
        hwaccel: config.hwaccel,
        encoder: codecNameFor(config.hwaccel, spec.override.codec),
        quality: spec.override.quality,
        preset: spec.override.preset,
        audioBitrateKbps: spec.override.audioBitrateKbps,
        extraInputArgs: spec.override.extraInputArgs,
        extraOutputArgs: spec.override.extraOutputArgs,
        qsvDevice: config.qsvDevice,
        vaapiDevice: config.vaapiDevice,
      },
      targetHeight: spec.height,
      durationMs: opts.durationMs,
      onProgress: opts.writeVariantProgress,
      trimStartMs: opts.trim.startMs,
      trimEndMs: opts.trim.endMs,
      signal: opts.signal,
    })

    await ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const variantProbe = await probe(variantPath)
    const { size } = await storage.uploadFromFile(
      variantPath,
      spec.storageKey,
      "video/mp4"
    )
    opts.onVariantUploaded(spec.storageKey)
    encodedVariants.push({
      id: spec.id,
      label: spec.label,
      storageKey: spec.storageKey,
      contentType: "video/mp4",
      width: variantProbe.width,
      height: variantProbe.height,
      sizeBytes: size,
      isDefault: spec.isDefault,
      settings: opts.settings[index],
    })
    opts.completeWork()
  }

  return encodedVariants
}

async function cleanupFailedRun(
  uploadedKeys: readonly string[],
  retainedSourceKey: string | null
): Promise<void> {
  await Promise.allSettled(
    [...new Set(uploadedKeys)]
      .filter((key) => key !== retainedSourceKey)
      .map((key) => storage.delete(key))
  )
}
