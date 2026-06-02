import type {
  ClipEncodedVariant,
  ClipVariantSettings,
} from "@workspace/db/schema"

import { configStore } from "../config/store"
import { join } from "../runtime/path"
import { clipOpenGraphVideoKey, storage } from "../storage"
import { ensureClipStillPresent } from "./encode-run-helpers"
import { codecNameFor, encode, probe, remuxToMp4 } from "./ffmpeg"
import type { VariantSpec } from "./variant-specs"

export type Asset = {
  storageKey: string
  contentType: string
  sizeBytes: number
}

export async function publishRemuxedSource({
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

export async function publishOpenGraph({
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
    durationMs: trim.startMs != null && trim.endMs != null
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
    "video/mp4",
  )
  return {
    storageKey,
    contentType: "video/mp4",
    sizeBytes: size,
    width: variantProbe.width,
    height: variantProbe.height,
  }
}

export async function encodePlaybackVariants(opts: {
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
      "video/mp4",
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
