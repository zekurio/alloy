import {
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"

import { storage } from "../storage"
import { codecNameFor } from "./ffmpeg"
import type { EncoderConfig } from "../lib/config-store"
import type { VariantSpec } from "./variant-specs"

export async function planReuse(
  row: { variants: ClipEncodedVariant[] },
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

export async function pruneStaleVariants(
  row: { variants: ClipEncodedVariant[] },
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

export function resolveVariantSettings(
  spec: VariantSpec,
  config: EncoderConfig,
  trimStartMs: number | null,
  trimEndMs: number | null
): ClipVariantSettings {
  return {
    hwaccel: config.hwaccel,
    codec: codecNameFor(config.hwaccel, spec.override.codec),
    audioCodec: "aac",
    quality: spec.override.quality,
    preset: spec.override.preset,
    audioBitrateKbps: spec.override.audioBitrateKbps,
    extraInputArgs: spec.override.extraInputArgs,
    extraOutputArgs: spec.override.extraOutputArgs,
    height: spec.height,
    trimStartMs,
    trimEndMs,
  }
}

function settingsEqual(a: ClipVariantSettings, b: ClipVariantSettings): boolean {
  return (
    a.codec === b.codec &&
    a.hwaccel === b.hwaccel &&
    a.audioCodec === b.audioCodec &&
    a.quality === b.quality &&
    a.preset === b.preset &&
    a.audioBitrateKbps === b.audioBitrateKbps &&
    a.extraInputArgs === b.extraInputArgs &&
    a.extraOutputArgs === b.extraOutputArgs &&
    a.height === b.height &&
    a.trimStartMs === b.trimStartMs &&
    a.trimEndMs === b.trimEndMs
  )
}
