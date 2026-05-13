import { promises as fsp } from "node:fs"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import { clip, type ClipEncodedVariant } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { configStore } from "../config/store"
import { storage } from "../storage"
import { probe } from "./ffmpeg"
import { abortEncode } from "./encode-abort"
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
  publishOpenGraphVariant,
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
  runId: string,
  signal: AbortSignal
): Promise<void> {
  const scratchDir = await makeScratchDir(clipId)
  try {
    await runPipelineInScratch(clipId, row, runId, scratchDir, signal)
  } finally {
    await fsp.rm(scratchDir, { recursive: true, force: true }).catch(() => {
      // Best-effort: a stray scratch dir is a capacity issue, not data loss.
    })
  }
}

async function runPipelineInScratch(
  clipId: string,
  row: ClipRow,
  runId: string,
  scratchDir: string,
  signal: AbortSignal
): Promise<void> {
  const originalSourceKey = row.storageKey
  const sourcePath = path.join(scratchDir, "source")
  await storage.downloadToFile(originalSourceKey, sourcePath)
  await ensureClipStillPresent(clipId, runId, signal)

  const [published] = await db
    .update(clip)
    .set({
      status: "encoding",
      encodeProgress: 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!published) throw abortEncode()
  void publishClipUpsert(row.authorId, clipId)

  const probed = await probe(sourcePath)
  await ensureClipStillPresent(clipId, runId, signal)

  const sourceAlreadyRemuxed = isRemuxedSourceKey(clipId, originalSourceKey)
  const trim = sourceAlreadyRemuxed
    ? { startMs: null, endMs: null }
    : resolveTrim(row, probed.durationMs)
  const outputDurationMs =
    trim.startMs != null && trim.endMs != null
      ? Math.max(1, trim.endMs - trim.startMs)
      : probed.durationMs

  const [probedUpdate] = await db
    .update(clip)
    .set({
      durationMs: outputDurationMs,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!probedUpdate) throw abortEncode()

  const encoderConfig = configStore.get("encoder")
  const writeProgress = makeProgressWriter(clipId, row.authorId, runId)
  const preservedSource = sourceAlreadyRemuxed
    ? {
        storageKey: originalSourceKey,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes ?? 0,
      }
    : await promoteProcessingSource({
        clipId,
        row,
        originalSourceKey,
        contentType: row.contentType,
        probed,
        runId,
      })

  let processingPath = sourcePath
  let processingKey = preservedSource.storageKey
  let processingContentType = preservedSource.contentType
  let processingSizeBytes = preservedSource.sizeBytes
  let sourceVariant: ClipEncodedVariant | null = null
  let encodeTrim = trim
  let remuxedSource: { path: string; variant: ClipEncodedVariant } | null = null
  let canonicalSourceKey = preservedSource.storageKey

  if (sourceAlreadyRemuxed && encoderConfig.keepSource) {
    sourceVariant =
      findSourceVariant(row.variants) ??
      makeSourceVariant({
        storageKey: preservedSource.storageKey,
        contentType: preservedSource.contentType,
        width: probed.width,
        height: probed.height,
        sizeBytes: preservedSource.sizeBytes,
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
      exposeSource: encoderConfig.keepSource,
      runId,
    })
    if (remuxed) {
      remuxedSource = remuxed
      processingPath = remuxed.path
      processingKey = remuxed.variant.storageKey
      processingContentType = remuxed.variant.contentType
      processingSizeBytes = remuxed.variant.sizeBytes
      sourceVariant = encoderConfig.keepSource ? remuxed.variant : null
      encodeTrim = { startMs: null, endMs: null }
      if (trim.startMs != null && trim.endMs != null) {
        canonicalSourceKey = remuxed.variant.storageKey
        await storage.delete(preservedSource.storageKey).catch(() => undefined)
      }
    } else if (!encoderConfig.enabled) {
      throw new Error("Remux failed and variant encoding is disabled")
    }
  }

  if (
    !sourceAlreadyRemuxed &&
    (!encoderConfig.remuxEnabled || !remuxedSource)
  ) {
    sourceVariant = encoderConfig.keepSource
      ? makeSourceVariant({
          storageKey: preservedSource.storageKey,
          contentType: preservedSource.contentType,
          width: probed.width,
          height: probed.height,
          sizeBytes: preservedSource.sizeBytes,
          isDefault: !encoderConfig.enabled,
          trim,
        })
      : null
  }

  const openGraphVariant = await publishOpenGraphVariant({
    clipId,
    row,
    source: preservedSource,
    sourcePath,
    scratchDir,
    probed,
    trim,
    config: encoderConfig,
    signal,
    runId,
  })

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
      retainedVariants: [openGraphVariant],
      runId,
    })
    return
  }

  const variantSpecs = buildVariantSpecs(
    clipId,
    probed.height,
    encoderConfig.variants,
    encoderConfig.defaultVariantId,
    runId
  )
  if (variantSpecs.length === 0) {
    if (sourceVariant) {
      await publishSourceOnlyClip({
        clipId,
        authorId: row.authorId,
        row,
        sourceVariant,
        retainedVariants: [openGraphVariant],
        runId,
      })
      return
    }
    throw new Error(
      "Variant encoding is enabled but no variants are eligible for this source resolution"
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
        storageKey: canonicalSourceKey,
        variants: mergeVariantSets(row.variants, [
          sourceVariant,
          openGraphVariant,
        ]),
      }
    : {
        ...row,
        storageKey: canonicalSourceKey,
        variants: mergeVariantSets(row.variants, [openGraphVariant]),
      }
  const reusedBySpecIndex = await planReuse(
    rowForReuse,
    variantSpecs,
    targetSettings
  )
  await pruneStaleVariants(rowForReuse, reusedBySpecIndex, sourceVariant, [
    openGraphVariant,
  ])

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
    runId,
    writeProgress,
    onVariant: (variants, progress) =>
      publishEncodedVariants({
        clipId,
        authorId: row.authorId,
        variants,
        sourceVariant,
        retainedVariants: [openGraphVariant],
        progress,
        runId,
      }),
  })

  const defaultVariant =
    encodedVariants.find((variant) => variant.isDefault) ?? encodedVariants[0]
  if (!defaultVariant) {
    throw new Error(`No encoded variants were produced for clip ${clipId}`)
  }

  const [finalPublished] = await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      failureReason: null,
      variants: sourceVariant
        ? mergeVariantSets(mergeVariantSets(encodedVariants, [sourceVariant]), [
            openGraphVariant,
          ])
        : mergeVariantSets(encodedVariants, [openGraphVariant]),
      encodeRunId: null,
      encodeLockedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clip.id, clipId), eq(clip.encodeRunId, runId)))
    .returning({ id: clip.id })
  if (!finalPublished) throw abortEncode()
  void publishClipUpsert(row.authorId, clipId)
}
