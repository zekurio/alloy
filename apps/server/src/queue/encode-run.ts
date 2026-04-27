import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"

import type { AcceptedContentType } from "@workspace/contracts"
import { eq } from "drizzle-orm"

import {
  clip,
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import { publishClipUpsert } from "../lib/clip-events"
import { configStore, type EncoderConfig } from "../lib/config-store"
import {
  clipOriginalAssetKey,
  clipSourceMp4Key,
  storage,
} from "../storage"
import { codecNameFor, encode, probe, remuxToMp4 } from "./ffmpeg"
import { makeProgressWriter } from "./encode-progress"
import {
  planReuse,
  pruneStaleVariants,
  resolveVariantSettings,
} from "./encode-variant-helpers"
import { buildVariantSpecs, type VariantSpec } from "./variant-specs"

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

  if (
    encoderConfig.remuxEnabled &&
    !sourceAlreadyRemuxed &&
    !remuxedSource
  ) {
    const promoted = await promoteOriginalSource({
      clipId,
      row,
      originalSourceKey,
      contentType: row.contentType,
      probed,
    })
    processingKey = promoted.storageKey
    processingContentType = promoted.contentType
    processingSizeBytes = promoted.sizeBytes
    if (promoted.storageKey !== originalSourceKey) {
      await storage.delete(originalSourceKey).catch(() => undefined)
    }
  } else if (!encoderConfig.remuxEnabled && !sourceAlreadyRemuxed) {
    const promoted = await promoteOriginalSource({
      clipId,
      row,
      originalSourceKey,
      contentType: row.contentType,
      probed,
    })
    processingKey = promoted.storageKey
    processingContentType = promoted.contentType
    processingSizeBytes = promoted.sizeBytes
    sourceVariant = encoderConfig.keepSource
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
    if (promoted.storageKey !== originalSourceKey) {
      await storage.delete(originalSourceKey).catch(() => undefined)
    }
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
    throw new Error("Variant encoding is enabled but no variants are configured")
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

async function tryPublishRemux({
  clipId,
  row,
  sourcePath,
  scratchDir,
  trim,
  signal,
  originalSourceKey,
  exposeSource,
}: {
  clipId: string
  row: ClipRow
  sourcePath: string
  scratchDir: string
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  originalSourceKey: string
  exposeSource: boolean
}): Promise<{ path: string; variant: ClipEncodedVariant } | null> {
  const remuxPath = path.join(scratchDir, "source.mp4")
  const remuxKey = clipSourceMp4Key(clipId)
  try {
    await remuxToMp4(sourcePath, remuxPath, {
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
      signal,
    })
    await ensureClipStillPresent(clipId, signal)
    const remuxProbe = await probe(remuxPath)
    await ensureClipStillPresent(clipId, signal)
    const { size } = await storage.uploadFromFile(
      remuxPath,
      remuxKey,
      "video/mp4"
    )
    const variant = makeSourceVariant({
      storageKey: remuxKey,
      contentType: "video/mp4",
      width: remuxProbe.width,
      height: remuxProbe.height,
      sizeBytes: size,
      isDefault: true,
      trim,
    })
    await db
      .update(clip)
      .set({
        status: "ready",
        encodeProgress: 0,
        failureReason: null,
        storageKey: remuxKey,
        contentType: "video/mp4",
        sizeBytes: size,
        width: remuxProbe.width,
        height: remuxProbe.height,
        variants: exposeSource
          ? mergeVariantSets(row.variants, [variant])
          : removeSourceVariants(row.variants),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    if (originalSourceKey !== remuxKey) {
      await storage.delete(originalSourceKey).catch(() => undefined)
    }
    void publishClipUpsert(row.authorId, clipId)
    return { path: remuxPath, variant }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    const reason = err instanceof Error ? err.message : "Remux failed"
    await db
      .update(clip)
      .set({
        failureReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(clip.id, clipId))
    void publishClipUpsert(row.authorId, clipId)
    return null
  }
}

async function promoteOriginalSource({
  clipId,
  row,
  originalSourceKey,
  contentType,
  probed,
}: {
  clipId: string
  row: ClipRow
  originalSourceKey: string
  contentType: string
  probed: Awaited<ReturnType<typeof probe>>
}): Promise<{ storageKey: string; contentType: string; sizeBytes: number }> {
  if (!isStagingKey(originalSourceKey)) {
    return {
      storageKey: originalSourceKey,
      contentType,
      sizeBytes: row.sizeBytes ?? 0,
    }
  }

  const durableKey = clipOriginalAssetKey(
    clipId,
    contentType as AcceptedContentType
  )
  const { size } = await storage.copy({
    fromKey: originalSourceKey,
    toKey: durableKey,
    contentType,
  })
  await db
    .update(clip)
    .set({
      storageKey: durableKey,
      contentType,
      sizeBytes: size,
      width: probed.width,
      height: probed.height,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  return { storageKey: durableKey, contentType, sizeBytes: size }
}

async function publishSourceOnlyClip({
  clipId,
  authorId,
  row,
  sourceVariant,
}: {
  clipId: string
  authorId: string
  row: ClipRow
  sourceVariant: ClipEncodedVariant
}): Promise<void> {
  await pruneStaleVariants(row, new Map(), sourceVariant)
  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      failureReason: null,
      sizeBytes: sourceVariant.sizeBytes,
      width: sourceVariant.width,
      height: sourceVariant.height,
      variants: [sourceVariant],
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(authorId, clipId)
}

async function publishEncodedVariants({
  clipId,
  authorId,
  variants,
  sourceVariant,
  progress,
}: {
  clipId: string
  authorId: string
  variants: readonly ClipEncodedVariant[]
  sourceVariant: ClipEncodedVariant | null
  progress: number
}): Promise<void> {
  const defaultVariant =
    variants.find((variant) => variant.isDefault) ?? variants[0]
  if (!defaultVariant) return

  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: progress,
      failureReason: null,
      sizeBytes: sourceVariant?.sizeBytes ?? defaultVariant.sizeBytes,
      width: sourceVariant?.width ?? defaultVariant.width,
      height: sourceVariant?.height ?? defaultVariant.height,
      variants: sourceVariant
        ? mergeVariantSets([...variants], [sourceVariant])
        : [...variants],
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(authorId, clipId)
}

type EncodeVariantsOpts = {
  clipId: string
  specs: VariantSpec[]
  settings: ClipVariantSettings[]
  reuse: Map<number, ClipEncodedVariant>
  paths: { sourcePath: string; scratchDir: string }
  config: EncoderConfig
  duration: number
  trim: { startMs: number | null; endMs: number | null }
  signal: AbortSignal
  writeProgress: (pct: number) => void
  onVariant: (
    variants: readonly ClipEncodedVariant[],
    progress: number
  ) => Promise<void>
}

async function encodeVariants(
  opts: EncodeVariantsOpts
): Promise<ClipEncodedVariant[]> {
  const encodedVariants: ClipEncodedVariant[] = []
  let completedWork = 0
  const totalWork = opts.specs.length

  const pushVariant = (
    spec: VariantSpec,
    index: number,
    dims: { width: number; height: number; sizeBytes: number }
  ): ClipEncodedVariant => {
    const encodedVariant = {
      id: spec.id,
      label: spec.label,
      role: "variant" as const,
      storageKey: spec.storageKey,
      contentType: "video/mp4",
      width: dims.width,
      height: dims.height,
      sizeBytes: dims.sizeBytes,
      isDefault: spec.isDefault,
      settings: opts.settings[index],
    }
    encodedVariants.push(encodedVariant)
    return encodedVariant
  }

  for (const [index, variant] of opts.specs.entries()) {
    await ensureClipStillPresent(opts.clipId, opts.signal)
    const reuse = opts.reuse.get(index)
    if (reuse) {
      pushVariant(variant, index, reuse)
      completedWork += 1
      const progress = Math.floor((completedWork / totalWork) * 100)
      opts.writeProgress(progress)
      await opts.onVariant(encodedVariants, progress)
      continue
    }

    const variantPath = path.join(opts.paths.scratchDir, `${variant.id}.mp4`)
    const rungConfig = {
      hwaccel: opts.config.hwaccel,
      encoder: codecNameFor(opts.config.hwaccel, variant.override.codec),
      quality: variant.override.quality,
      preset: variant.override.preset,
      audioBitrateKbps: variant.override.audioBitrateKbps,
      extraInputArgs: variant.override.extraInputArgs,
      extraOutputArgs: variant.override.extraOutputArgs,
      qsvDevice: opts.config.qsvDevice,
      vaapiDevice: opts.config.vaapiDevice,
    }

    await encode(opts.paths.sourcePath, variantPath, {
      config: rungConfig,
      targetHeight: variant.height,
      durationMs: opts.duration,
      onProgress: (pct) => {
        const overallPct = Math.floor(
          ((completedWork + pct / 100) / totalWork) * 100
        )
        opts.writeProgress(overallPct)
      },
      trimStartMs: opts.trim.startMs,
      trimEndMs: opts.trim.endMs,
      signal: opts.signal,
    })

    await ensureClipStillPresent(opts.clipId, opts.signal)
    const variantProbe = await probe(variantPath)
    await ensureClipStillPresent(opts.clipId, opts.signal)
    const { size: uploadedSize } = await storage.uploadFromFile(
      variantPath,
      variant.storageKey,
      "video/mp4"
    )
    await fsp.rm(variantPath, { force: true }).catch(() => undefined)

    pushVariant(variant, index, {
      width: variantProbe.width,
      height: variantProbe.height,
      sizeBytes: uploadedSize,
    })
    completedWork += 1
    const progress = Math.floor((completedWork / totalWork) * 100)
    opts.writeProgress(progress)
    await opts.onVariant(encodedVariants, progress)
  }

  return encodedVariants
}

function resolveTrim(
  row: ClipRow,
  durationMs: number
): { startMs: number | null; endMs: number | null } {
  const trimRequested =
    row.trimStartMs != null &&
    row.trimEndMs != null &&
    row.trimStartMs >= 0 &&
    row.trimEndMs > row.trimStartMs
  if (!trimRequested) return { startMs: null, endMs: null }
  return {
    startMs: row.trimStartMs as number,
    endMs: Math.min(row.trimEndMs as number, durationMs),
  }
}

function makeSourceVariant({
  storageKey,
  contentType,
  width,
  height,
  sizeBytes,
  isDefault,
  trim,
}: {
  storageKey: string
  contentType: string
  width: number
  height: number
  sizeBytes: number
  isDefault: boolean
  trim: { startMs: number | null; endMs: number | null }
}): ClipEncodedVariant {
  return {
    id: "source",
    label: "Source",
    role: "source",
    storageKey,
    contentType,
    width,
    height,
    sizeBytes,
    isDefault,
    remuxSettings: {
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
    },
  }
}

function mergeVariantSets(
  existing: readonly ClipEncodedVariant[],
  updates: readonly ClipEncodedVariant[]
): ClipEncodedVariant[] {
  const byId = new Map<string, ClipEncodedVariant>()
  for (const variant of existing) byId.set(variant.id, variant)
  for (const variant of updates) byId.set(variant.id, variant)
  return Array.from(byId.values())
}

function findSourceVariant(
  variants: readonly ClipEncodedVariant[]
): ClipEncodedVariant | null {
  return (
    variants.find(
      (variant) => variant.role === "source" || variant.id === "source"
    ) ?? null
  )
}

function removeSourceVariants(
  variants: readonly ClipEncodedVariant[]
): ClipEncodedVariant[] {
  return variants.filter(
    (variant) => variant.role !== "source" && variant.id !== "source"
  )
}

function isRemuxedSourceKey(clipId: string, key: string): boolean {
  return key === clipSourceMp4Key(clipId)
}

function isStagingKey(key: string): boolean {
  return key.includes("/staging/")
}

async function ensureClipStillPresent(
  clipId: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (row) return
  const err = new Error("Encode cancelled")
  err.name = "AbortError"
  throw err
}

async function makeScratchDir(clipId: string): Promise<string> {
  const base = env.ENCODE_SCRATCH_DIR ?? path.join(os.tmpdir(), "alloy-encode")
  await fsp.mkdir(base, { recursive: true })
  return fsp.mkdtemp(path.join(base, `${clipId}-`))
}
