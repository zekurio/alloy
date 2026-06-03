import {
  type ClipEncodedVariant,
  type ClipVariantSettings,
} from "@workspace/db/schema"

import { storage } from "../storage"
import { codecNameFor } from "./ffmpeg"
import type { EncoderConfig } from "../config/store"
import type { VariantSpec } from "./variant-specs"

export async function planReuse(
  row: { variants: ClipEncodedVariant[] },
  variantSpecs: VariantSpec[],
  targetSettings: ClipVariantSettings[],
): Promise<Map<number, ClipEncodedVariant>> {
  const reusedBySpecIndex = new Map<number, ClipEncodedVariant>()
  const priorByVariantId = new Map<string, ClipEncodedVariant>()
  for (const prev of row.variants) {
    priorByVariantId.set(prev.id, prev)
  }

  for (const [i, spec] of variantSpecs.entries()) {
    const prev = priorByVariantId.get(spec.id)
    if (!prev?.settings) continue
    // Pre-HLS variants must be re-encoded so they pick up the CMAF/playlist
    // artifacts; only reuse renditions that already carry HLS metadata.
    if (!prev.hls) continue
    const target = targetSettings[i]
    if (!target || !settingsEqual(prev.settings, target)) continue
    const fileHit = await storage.resolve(prev.storageKey)
    if (!fileHit) continue
    reusedBySpecIndex.set(i, prev)
  }
  return reusedBySpecIndex
}

export function resolveVariantSettings(
  spec: VariantSpec,
  config: EncoderConfig,
  trimStartMs: number | null,
  trimEndMs: number | null,
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

function settingsEqual(
  a: ClipVariantSettings,
  b: ClipVariantSettings,
): boolean {
  return (
    a.codec === b.codec &&
    a.hwaccel === b.hwaccel &&
    a.audioCodec === b.audioCodec &&
    a.quality === b.quality &&
    a.preset === b.preset &&
    a.audioBitrateKbps === b.audioBitrateKbps &&
    argsEqual(a.extraInputArgs, b.extraInputArgs) &&
    argsEqual(a.extraOutputArgs, b.extraOutputArgs) &&
    a.height === b.height &&
    a.trimStartMs === b.trimStartMs &&
    a.trimEndMs === b.trimEndMs
  )
}

function argsEqual(a: string, b: string): boolean {
  return normalizeArgs(a) === normalizeArgs(b)
}

function normalizeArgs(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}
