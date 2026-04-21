import { promises as fsp } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"

import {
  clip,
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"

import { db } from "../db"
import { configStore, type EncoderConfig } from "../lib/config-store"
import { clipAssetKey, storage } from "../storage"
import { FsStorageDriver } from "../storage/fs-driver"
import { encode, probe } from "./ffmpeg"
import { ensureThumbnails } from "./encode-thumbnails"
import { buildVariantSpecs, type VariantSpec } from "./variant-specs"

export async function runEncodeInner(
  clipId: string,
  row: typeof clip.$inferSelect,
  signal: AbortSignal
): Promise<void> {
  const sourceKey = row.storageKey
  const thumbKey = clipAssetKey(clipId, "thumb")
  const thumbSmallKey = clipAssetKey(clipId, "thumb-small")

  const sourcePath = localPathFor(sourceKey)
  const thumbPath = localPathFor(thumbKey)
  const thumbSmallPath = localPathFor(thumbSmallKey)

  await db
    .update(clip)
    .set({
      status: "encoding",
      encodeProgress: 0,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))

  const probed = await probe(sourcePath)

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

  const writeProgress = makeProgressWriter(clipId)
  const encoderConfig = configStore.get("encoder")

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

  const trimChanged = row.variants.some(
    (prev) =>
      prev.settings !== undefined &&
      (prev.settings.trimStartMs !== effectiveTrimStart ||
        prev.settings.trimEndMs !== effectiveTrimEnd)
  )
  if (trimChanged) {
    await storage.delete(thumbKey).catch(() => undefined)
    await storage.delete(thumbSmallKey).catch(() => undefined)
  }

  const encodedVariants = await encodeVariants({
    variantSpecs,
    targetSettings,
    reusedBySpecIndex,
    sourcePath,
    encoderConfig,
    outputDurationMs,
    effectiveTrimStart,
    effectiveTrimEnd,
    signal,
    writeProgress,
  })

  const defaultVariant =
    encodedVariants.find((variant) => variant.isDefault) ?? encodedVariants[0]
  if (!defaultVariant) {
    throw new Error(`No encoded variants were produced for clip ${clipId}`)
  }

  if (sourceVariant) encodedVariants.push(sourceVariant)

  const thumbStored = await ensureThumbnails({
    clipId,
    sourcePath,
    thumbPath,
    thumbSmallPath,
    thumbKey,
    thumbSmallKey,
    effectiveTrimStart,
    effectiveTrimEnd,
    durationMs: probed.durationMs,
  })

  await db
    .update(clip)
    .set({
      status: "ready",
      encodeProgress: 100,
      sizeBytes: defaultVariant.sizeBytes,
      width: defaultVariant.width,
      height: defaultVariant.height,
      variants: encodedVariants,
      thumbKey: thumbStored ? thumbKey : null,
      thumbSmallKey: thumbStored ? thumbSmallKey : null,
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
}

function makeProgressWriter(clipId: string): (pct: number) => void {
  let lastWrittenPct = 0
  let lastWriteAt = 0
  return (pct: number) => {
    const now = Date.now()
    if (pct <= lastWrittenPct) return
    if (now - lastWriteAt < 2000 && pct < 99) return
    lastWrittenPct = pct
    lastWriteAt = now
    db.update(clip)
      .set({ encodeProgress: pct, updatedAt: new Date() })
      .where(eq(clip.id, clipId))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          `[encode-worker] progress update failed for ${clipId}:`,
          err
        )
      })
  }
}

async function planReuse(
  row: typeof clip.$inferSelect,
  variantSpecs: VariantSpec[],
  targetSettings: ClipVariantSettings[]
): Promise<Map<number, ClipEncodedVariant>> {
  const reusedBySpecIndex = new Map<number, ClipEncodedVariant>()
  const priorByStorageKey = new Map<string, ClipEncodedVariant>()
  for (const prev of row.variants) priorByStorageKey.set(prev.storageKey, prev)

  for (let i = 0; i < variantSpecs.length; i++) {
    const spec = variantSpecs[i]!
    const prev = priorByStorageKey.get(spec.storageKey)
    if (!prev?.settings) continue
    if (!settingsEqual(prev.settings, targetSettings[i]!)) continue
    const fileHit = await storage.resolve(spec.storageKey)
    if (!fileHit) continue
    reusedBySpecIndex.set(i, prev)
  }
  return reusedBySpecIndex
}

async function pruneStaleVariants(
  row: typeof clip.$inferSelect,
  reusedBySpecIndex: Map<number, ClipEncodedVariant>,
  sourceVariant: ClipEncodedVariant | null
): Promise<void> {
  const reusedKeys = new Set(
    Array.from(reusedBySpecIndex.values()).map((v) => v.storageKey)
  )
  if (sourceVariant) reusedKeys.add(sourceVariant.storageKey)
  for (const prev of row.variants) {
    if (reusedKeys.has(prev.storageKey)) continue
    await storage.delete(prev.storageKey).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[encode-worker] failed to remove stale variant ${prev.storageKey}:`,
        err
      )
    })
  }
}

async function encodeVariants({
  variantSpecs,
  targetSettings,
  reusedBySpecIndex,
  sourcePath,
  encoderConfig,
  outputDurationMs,
  effectiveTrimStart,
  effectiveTrimEnd,
  signal,
  writeProgress,
}: {
  variantSpecs: VariantSpec[]
  targetSettings: ClipVariantSettings[]
  reusedBySpecIndex: Map<number, ClipEncodedVariant>
  sourcePath: string
  encoderConfig: EncoderConfig
  outputDurationMs: number
  effectiveTrimStart: number | null
  effectiveTrimEnd: number | null
  signal: AbortSignal
  writeProgress: (pct: number) => void
}): Promise<ClipEncodedVariant[]> {
  const encodedVariants: ClipEncodedVariant[] = []
  let completedWork = 0
  const totalWork = variantSpecs.length

  for (const [index, variant] of variantSpecs.entries()) {
    const reuse = reusedBySpecIndex.get(index)
    if (reuse) {
      encodedVariants.push({
        id: variant.id,
        label: variant.label,
        storageKey: variant.storageKey,
        contentType: "video/mp4",
        width: reuse.width,
        height: reuse.height,
        sizeBytes: reuse.sizeBytes,
        isDefault: variant.isDefault,
        settings: targetSettings[index],
      })
      completedWork += 1
      writeProgress(Math.floor((completedWork / totalWork) * 100))
      continue
    }

    const variantPath = localPathFor(variant.storageKey)
    await fsp.mkdir(path.dirname(variantPath), { recursive: true })

    const rungConfig: EncoderConfig = {
      ...encoderConfig,
      codec: variant.override.codec ?? encoderConfig.codec,
      quality: variant.override.quality ?? encoderConfig.quality,
      preset: variant.override.preset ?? encoderConfig.preset,
      audioBitrateKbps:
        variant.override.audioBitrateKbps ?? encoderConfig.audioBitrateKbps,
    }

    await encode(sourcePath, variantPath, {
      config: rungConfig,
      targetHeight: variant.height,
      durationMs: outputDurationMs,
      onProgress: (pct) => {
        const overallPct = Math.floor(
          ((completedWork + pct / 100) / totalWork) * 100
        )
        writeProgress(overallPct)
      },
      trimStartMs: effectiveTrimStart,
      trimEndMs: effectiveTrimEnd,
      signal,
    })

    const [variantProbe, variantStat] = await Promise.all([
      probe(variantPath),
      fsp.stat(variantPath),
    ])

    encodedVariants.push({
      id: variant.id,
      label: variant.label,
      storageKey: variant.storageKey,
      contentType: "video/mp4",
      width: variantProbe.width,
      height: variantProbe.height,
      sizeBytes: variantStat.size,
      isDefault: variant.isDefault,
      settings: targetSettings[index],
    })
    completedWork += 1
  }

  return encodedVariants
}

function localPathFor(key: string): string {
  if (storage instanceof FsStorageDriver) {
    return storage.fullPath(key)
  }
  throw new Error(
    "Encoder needs a local source; S3 driver requires a download step that isn't implemented yet"
  )
}

function resolveVariantSettings(
  spec: VariantSpec,
  encoderConfig: EncoderConfig,
  trimStartMs: number | null,
  trimEndMs: number | null
): ClipVariantSettings {
  return {
    codec: spec.override.codec ?? encoderConfig.codec,
    audioCodec: "aac",
    quality: spec.override.quality ?? encoderConfig.quality,
    preset: spec.override.preset ?? encoderConfig.preset,
    audioBitrateKbps:
      spec.override.audioBitrateKbps ?? encoderConfig.audioBitrateKbps,
    height: spec.height,
    trimStartMs,
    trimEndMs,
  }
}

function settingsEqual(
  a: ClipVariantSettings,
  b: ClipVariantSettings
): boolean {
  return (
    a.codec === b.codec &&
    a.audioCodec === b.audioCodec &&
    a.quality === b.quality &&
    a.preset === b.preset &&
    a.audioBitrateKbps === b.audioBitrateKbps &&
    a.height === b.height &&
    a.trimStartMs === b.trimStartMs &&
    a.trimEndMs === b.trimEndMs
  )
}
