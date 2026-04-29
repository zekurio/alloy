import { promises as fsp } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"

import { clip, type ClipEncodedVariant } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { configStore } from "../config/store"
import { storage } from "../storage"
import { probe } from "./ffmpeg"
import { makeProgressWriter } from "./encode-progress"
import {
  planReuse,
  pruneStaleVariants,
  resolveVariantSettings,
} from "./encode-variant-helpers"
import { buildVariantSpecs } from "./variant-specs"
import {
  encodeVariants,
  ensureClipStillPresent,
  makeScratchDir,
  publishEncodedVariants,
  publishSourceOnlyClip,
  resolveTrim,
  tryPublishRemux,
} from "./encode-run-helpers"
import {
  findSourceVariant,
  isRemuxedSourceKey,
  makeSourceVariant,
  mergeVariantSets,
  promoteProcessingSource,
} from "./encode-source-helpers"

type ClipRow = typeof clip.$inferSelect

export async function runEncodeInner(
  clipId: string,
  row: ClipRow,
  signal: AbortSignal
): Promise<void> {
  const scratchDir = await makeScratchDir(clipId)
  try {
    await runPipelineInScratch(clipId, row, scratchDir, signal)
  } finally {
    await fsp.rm(scratchDir, { recursive: true, force: true }).catch(() => {
      // Best-effort: a stray scratch dir is a capacity issue, not data loss.
    })
  }
}

async function runPipelineInScratch(
  clipId: string,
  row: ClipRow,
  scratchDir: string,
  signal: AbortSignal
): Promise<void> {
  const originalSourceKey = row.storageKey
  const sourcePath = path.join(scratchDir, "source")
  await storage.downloadToFile(originalSourceKey, sourcePath)
  await ensureClipStillPresent(clipId, signal)

  await db
    .update(clip)
    .set({
      status: row.status === "ready" ? "ready" : "encoding",
      encodeProgress: row.status === "ready" ? row.encodeProgress : 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(row.authorId, clipId)

  const probed = await probe(sourcePath)
  await ensureClipStillPresent(clipId, signal)

  const sourceAlreadyRemuxed = isRemuxedSourceKey(clipId, originalSourceKey)
  const trim = sourceAlreadyRemuxed
    ? { startMs: null, endMs: null }
    : resolveTrim(row, probed.durationMs)
  const outputDurationMs =
    trim.startMs != null && trim.endMs != null
      ? Math.max(1, trim.endMs - trim.startMs)
      : probed.durationMs

  await db
    .update(clip)
    .set({
      durationMs: outputDurationMs,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))

  const encoderConfig = configStore.get("encoder")
  const writeProgress = makeProgressWriter(clipId, row.authorId)

  let processingPath = sourcePath
  let processingKey = originalSourceKey
  let processingContentType = row.contentType
  let processingSizeBytes = row.sizeBytes ?? 0
  let sourceVariant: ClipEncodedVariant | null = null
  let encodeTrim = trim
  let remuxedSource: { path: string; variant: ClipEncodedVariant } | null = null

  if (sourceAlreadyRemuxed && encoderConfig.keepSource) {
    sourceVariant =
      findSourceVariant(row.variants) ??
      makeSourceVariant({
        storageKey: originalSourceKey,
        contentType: row.contentType,
        width: probed.width,
        height: probed.height,
        sizeBytes: row.sizeBytes ?? 0,
        isDefault: !encoderConfig.enabled,
        trim,
      })
  }

  if (encoderConfig.remuxEnabled && !sourceAlreadyRemuxed) {
    const remuxed = await tryPublishRemux({
      clipId,
      row,
      sourcePath,
      scratchDir,
      trim,
      signal,
      originalSourceKey,
      exposeSource: encoderConfig.keepSource,
    })
    if (remuxed) {
      remuxedSource = remuxed
      processingPath = remuxed.path
      processingKey = remuxed.variant.storageKey
      processingContentType = remuxed.variant.contentType
      processingSizeBytes = remuxed.variant.sizeBytes
      sourceVariant = encoderConfig.keepSource ? remuxed.variant : null
      encodeTrim = { startMs: null, endMs: null }
    } else if (!encoderConfig.enabled) {
      throw new Error("Remux failed and variant encoding is disabled")
    }
  }

  const shouldPromoteOriginal =
    !sourceAlreadyRemuxed && (!encoderConfig.remuxEnabled || !remuxedSource)
  if (shouldPromoteOriginal) {
    const promoted = await promoteProcessingSource({
      clipId,
      row,
      originalSourceKey,
      contentType: row.contentType,
      probed,
    })
    processingKey = promoted.storageKey
    processingContentType = promoted.contentType
    processingSizeBytes = promoted.sizeBytes
    sourceVariant =
      !encoderConfig.remuxEnabled && encoderConfig.keepSource
        ? makeSourceVariant({
            storageKey: promoted.storageKey,
            contentType: promoted.contentType,
            width: probed.width,
            height: probed.height,
            sizeBytes: promoted.sizeBytes,
            isDefault: !encoderConfig.enabled,
            trim,
          })
        : null
  }

  if (!encoderConfig.enabled) {
    await publishSourceOnlyClip({
      clipId,
      authorId: row.authorId,
      row,
      sourceVariant:
        sourceVariant ??
        makeSourceVariant({
          storageKey: processingKey,
          contentType: processingContentType,
          width: probed.width,
          height: probed.height,
          sizeBytes: processingSizeBytes,
          isDefault: true,
          trim,
        }),
    })
    return
  }

  const variantSpecs = buildVariantSpecs(
    clipId,
    probed.height,
    encoderConfig.variants,
    encoderConfig.defaultVariantId
  )
  if (variantSpecs.length === 0) {
    throw new Error(
      "Variant encoding is enabled but no variants are configured"
    )
  }
  const targetSettings = variantSpecs.map((spec) =>
    resolveVariantSettings(
      spec,
      encoderConfig,
      encodeTrim.startMs,
      encodeTrim.endMs
    )
  )

  const rowForReuse = sourceVariant
    ? {
        ...row,
        variants: mergeVariantSets(row.variants, [sourceVariant]),
      }
    : row
  const reusedBySpecIndex = await planReuse(
    rowForReuse,
    variantSpecs,
    targetSettings
  )
  await pruneStaleVariants(rowForReuse, reusedBySpecIndex, sourceVariant)

  const encodedVariants = await encodeVariants({
    clipId,
    reuse: reusedBySpecIndex,
    paths: { sourcePath: processingPath, scratchDir },
    specs: variantSpecs,
    settings: targetSettings,
    config: encoderConfig,
    duration: outputDurationMs,
    trim: encodeTrim,
    signal,
    writeProgress,
    onVariant: (variants, progress) =>
      publishEncodedVariants({
        clipId,
        authorId: row.authorId,
        variants,
        sourceVariant,
        progress,
      }),
  })

  const defaultVariant =
    encodedVariants.find((variant) => variant.isDefault) ?? encodedVariants[0]
  if (!defaultVariant) {
    throw new Error(`No encoded variants were produced for clip ${clipId}`)
  }

  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      failureReason: null,
      sizeBytes: sourceVariant?.sizeBytes ?? defaultVariant.sizeBytes,
      width: sourceVariant?.width ?? defaultVariant.width,
      height: sourceVariant?.height ?? defaultVariant.height,
      variants: sourceVariant
        ? mergeVariantSets(encodedVariants, [sourceVariant])
        : encodedVariants,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(row.authorId, clipId)
}
