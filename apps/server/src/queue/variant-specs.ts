import type { EncoderVariant } from "../lib/config-store"
import { clipVideoVariantKey } from "../storage"

/** Per-variant override resolved from the runtime config. */
export interface VariantOverride {
  codec: EncoderVariant["codec"]
  quality: EncoderVariant["quality"]
  preset: EncoderVariant["preset"]
  audioBitrateKbps: EncoderVariant["audioBitrateKbps"]
  extraInputArgs: EncoderVariant["extraInputArgs"]
  extraOutputArgs: EncoderVariant["extraOutputArgs"]
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
  configuredVariants: ReadonlyArray<EncoderVariant>,
  defaultVariantId: string | null
): VariantSpec[] {
  const specs: VariantSpec[] = []

  for (const configured of configuredVariants) {
    const cappedHeight = Math.min(configured.height, sourceHeight)
    if (cappedHeight <= 0) continue
    const isDefault = specs.length === 0
    specs.push({
      id: configured.id,
      label: configured.name,
      height: cappedHeight,
      storageKey: clipVideoVariantKey(clipId, configured.id),
      isDefault: configured.id === defaultVariantId || (!defaultVariantId && isDefault),
      override: {
        codec: configured.codec,
        quality: configured.quality,
        preset: configured.preset,
        audioBitrateKbps: configured.audioBitrateKbps,
        extraInputArgs: configured.extraInputArgs,
        extraOutputArgs: configured.extraOutputArgs,
      },
    })
  }

  return specs
}
