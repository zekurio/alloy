import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"

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
import { storage } from "../storage"
import { codecNameFor, encode, probe } from "./ffmpeg"
import { buildVariantSpecs, type VariantSpec } from "./variant-specs"
import {
  planReuse,
  pruneStaleVariants,
  resolveVariantSettings,
} from "./encode-variant-helpers"
import { makeProgressWriter } from "./encode-progress"

export async function runEncodeInner(
  clipId: string,
  row: typeof clip.$inferSelect,
  signal: AbortSignal
): Promise<void> {
  const sourceKey = row.storageKey
  const scratchDir = await makeScratchDir(clipId)
  try {
    await runEncodeInScratch(clipId, row, sourceKey, scratchDir, signal)
  } finally {
    await fsp.rm(scratchDir, { recursive: true, force: true }).catch(() => {
      // Best-effort — a stray scratch dir is a capacity hit, not a
      // correctness issue. The OS will reclaim /tmp eventually.
    })
  }
}

async function runEncodeInScratch(
  clipId: string,
  row: typeof clip.$inferSelect,
  sourceKey: string,
  scratchDir: string,
  signal: AbortSignal
): Promise<void> {
  const sourcePath = path.join(scratchDir, "source")
  await storage.downloadToFile(sourceKey, sourcePath)
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

  const trimRequested =
    row.trimStartMs != null &&
    row.trimEndMs != null &&
    row.trimStartMs >= 0 &&
    row.trimEndMs > row.trimStartMs
  const effectiveTrimStart = trimRequested ? (row.trimStartMs as number) : null
  const effectiveTrimEnd = trimRequested
    ? Math.min(row.trimEndMs as number, probed.durationMs)
    : null
  const outputDurationMs =
    effectiveTrimStart != null && effectiveTrimEnd != null
      ? Math.max(1, effectiveTrimEnd - effectiveTrimStart)
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

  const writeProgress = makeProgressWriter(clipId, row.authorId)
  const encoderConfig = configStore.get("encoder")

  if (!encoderConfig.enabled) {
    await publishSourceOnlyClip({
      clipId,
      authorId: row.authorId,
      row,
      probed,
      sourceKey,
    })
    return
  }

  const sourceVariant: ClipEncodedVariant | null = encoderConfig.keepSource
    ? {
        id: "source",
        label: "Source",
        storageKey: sourceKey,
        contentType: row.contentType,
        width: probed.width,
        height: probed.height,
        sizeBytes: row.sizeBytes ?? 0,
        isDefault: false,
      }
    : null

  const variantSpecs = buildVariantSpecs(
    clipId,
    probed.height,
    encoderConfig.variants
  )
  if (variantSpecs.length === 0) {
    throw new Error("Encoder is enabled but no variants are configured")
  }
  const targetSettings = variantSpecs.map((spec) =>
    resolveVariantSettings(
      spec,
      encoderConfig,
      effectiveTrimStart,
      effectiveTrimEnd
    )
  )

  const reusedBySpecIndex = await planReuse(row, variantSpecs, targetSettings)
  await pruneStaleVariants(row, reusedBySpecIndex, sourceVariant)

  const encodedVariants = await encodeVariants({
    clipId,
    reuse: reusedBySpecIndex,
    paths: { sourcePath, scratchDir },
    specs: variantSpecs,
    settings: targetSettings,
    config: encoderConfig,
    duration: outputDurationMs,
    trim: { startMs: effectiveTrimStart, endMs: effectiveTrimEnd },
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

  if (sourceVariant) encodedVariants.push(sourceVariant)

  // Thumbnail is uploaded by the client during finalize — nothing to do
  // server-side, the `thumbKey` column is already populated.
  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      sizeBytes: defaultVariant.sizeBytes,
      width: defaultVariant.width,
      height: defaultVariant.height,
      variants: encodedVariants,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))

  void publishClipUpsert(row.authorId, clipId)
}

async function publishSourceOnlyClip({
  clipId,
  authorId,
  row,
  probed,
  sourceKey,
}: {
  clipId: string
  authorId: string
  row: typeof clip.$inferSelect
  probed: Awaited<ReturnType<typeof probe>>
  sourceKey: string
}): Promise<void> {
  const sourceVariant: ClipEncodedVariant = {
    id: "source",
    label: "Source",
    storageKey: sourceKey,
    contentType: row.contentType,
    width: probed.width,
    height: probed.height,
    sizeBytes: row.sizeBytes ?? 0,
    isDefault: true,
  }

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
      sizeBytes: defaultVariant.sizeBytes,
      width: defaultVariant.width,
      height: defaultVariant.height,
      variants: sourceVariant ? [...variants, sourceVariant] : [...variants],
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
