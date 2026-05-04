import { promises as fsp } from "node:fs"
import path from "node:path"

import type {
  ClipEncodedVariant,
  ClipVariantSettings,
} from "@workspace/db/schema"

import { clipOpenGraphVideoKey, storage } from "../storage"
import {
  OPEN_GRAPH_VARIANT_ID,
  isOpenGraphVariant,
  openGraphCompatibleSource,
} from "../open-graph/video-selection"
import { type EncoderConfig } from "../config/store"
import { codecNameFor, encode, probe } from "./ffmpeg"
import { settingsEqual } from "./encode-variant-helpers"
import type { VariantSpec } from "./variant-specs"

type ClipRow = {
  variants: ClipEncodedVariant[]
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
  runId: string
  writeProgress: (pct: number) => void
  ensureClipStillPresent: (
    clipId: string,
    runId: string,
    signal: AbortSignal
  ) => Promise<void>
  onVariant: (
    variants: readonly ClipEncodedVariant[],
    progress: number
  ) => Promise<void>
}

export async function encodeVariants(
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
    await opts.ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
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

    await opts.ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
    const variantProbe = await probe(variantPath)
    await opts.ensureClipStillPresent(opts.clipId, opts.runId, opts.signal)
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

export async function publishOpenGraphVariant({
  clipId,
  row,
  source,
  sourcePath,
  scratchDir,
  probed,
  trim,
  config,
  signal,
  runId,
  ensureClipStillPresent,
}: {
  clipId: string
  row: ClipRow
  source: { storageKey: string; contentType: string; sizeBytes: number }
  sourcePath: string
  scratchDir: string
  probed: Awaited<ReturnType<typeof probe>>
  trim: { startMs: number | null; endMs: number | null }
  config: EncoderConfig
  signal: AbortSignal
  runId: string
  ensureClipStillPresent: EncodeVariantsOpts["ensureClipStillPresent"]
}): Promise<ClipEncodedVariant> {
  const reusableSource = openGraphCompatibleSource({
    contentType: source.contentType,
    videoCodec: probed.videoCodec,
    audioCodec: probed.audioCodec,
    height: probed.height,
    trim,
  })
  if (reusableSource) {
    return {
      id: OPEN_GRAPH_VARIANT_ID,
      label: "OpenGraph",
      role: "openGraph",
      storageKey: source.storageKey,
      contentType: source.contentType,
      width: probed.width,
      height: probed.height,
      sizeBytes: source.sizeBytes,
      isDefault: false,
      settings: {
        hwaccel: "source",
        codec: "h264",
        audioCodec: probed.audioCodec === "aac" ? "aac" : "none",
        quality: 0,
        audioBitrateKbps: 0,
        extraInputArgs: "",
        extraOutputArgs: "",
        height: probed.height,
        trimStartMs: null,
        trimEndMs: null,
      },
    }
  }

  const targetHeight = Math.min(probed.height, 1080)
  const storageKey = clipOpenGraphVideoKey(clipId)
  const settings: ClipVariantSettings = {
    hwaccel: config.hwaccel,
    codec: "h264",
    audioCodec: "aac",
    quality: 23,
    audioBitrateKbps: 256,
    extraInputArgs: "",
    extraOutputArgs: "",
    height: targetHeight,
    trimStartMs: trim.startMs,
    trimEndMs: trim.endMs,
  }
  const existing = row.variants.find(isOpenGraphVariant)
  if (existing?.settings && settingsEqual(existing.settings, settings)) {
    const fileHit = await storage.resolve(existing.storageKey)
    if (fileHit) return existing
  }

  const variantPath = path.join(scratchDir, `${OPEN_GRAPH_VARIANT_ID}.mp4`)
  await encode(sourcePath, variantPath, {
    config: {
      hwaccel: config.hwaccel,
      encoder: codecNameFor(config.hwaccel, "h264"),
      quality: settings.quality,
      audioBitrateKbps: settings.audioBitrateKbps,
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

  await ensureClipStillPresent(clipId, runId, signal)
  const variantProbe = await probe(variantPath)
  await ensureClipStillPresent(clipId, runId, signal)
  const { size } = await storage.uploadFromFile(
    variantPath,
    storageKey,
    "video/mp4"
  )
  await fsp.rm(variantPath, { force: true }).catch(() => undefined)

  return {
    id: OPEN_GRAPH_VARIANT_ID,
    label: "OpenGraph",
    role: "openGraph",
    storageKey,
    contentType: "video/mp4",
    width: variantProbe.width,
    height: variantProbe.height,
    sizeBytes: size,
    isDefault: false,
    settings,
  }
}
