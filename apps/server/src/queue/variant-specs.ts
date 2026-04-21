import type { EncoderConfig, EncoderVariant } from "../lib/config-store"
import { clipAssetKey, clipVideoVariantKey } from "../storage"

/** Per-variant override resolved from the runtime config. */
export interface VariantOverride {
  codec?: EncoderConfig["codec"]
  quality?: number
  preset?: string
  audioBitrateKbps?: number
}

export interface VariantSpec {
  id: string
  label: string
  height: number
  storageKey: string
  isDefault: boolean
  override: VariantOverride
}

export function buildVariantSpecs(
  clipId: string,
  sourceHeight: number,
  configuredVariants: ReadonlyArray<EncoderVariant>
): VariantSpec[] {
  const seenHeights = new Set<number>()
  const specs: VariantSpec[] = []

  for (const configured of configuredVariants) {
    const cappedHeight = Math.min(configured.height, sourceHeight)
    if (cappedHeight <= 0) continue
    if (seenHeights.has(cappedHeight)) continue
    seenHeights.add(cappedHeight)
    const id = `${cappedHeight}p`
    const isDefault = specs.length === 0
    specs.push({
      id,
      label: id,
      height: cappedHeight,
      storageKey: isDefault
        ? clipAssetKey(clipId, "video")
        : clipVideoVariantKey(clipId, id),
      isDefault,
      override: {
        codec: configured.codec,
        quality: configured.quality,
        preset: configured.preset,
        audioBitrateKbps: configured.audioBitrateKbps,
      },
    })
  }

  return specs
}
