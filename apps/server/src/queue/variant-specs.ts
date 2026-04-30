import type { EncoderVariant } from "../config/store"
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
  const defaultVariantIsAvailable = configuredVariants.some(
    (variant) =>
      variant.id === defaultVariantId &&
      variant.height > 0 &&
      variant.height <= sourceHeight
  )

  for (const configured of configuredVariants) {
    if (configured.height <= 0) continue
    if (configured.height > sourceHeight) {
      continue
    }
    const isFirstAvailable = specs.length === 0
    specs.push({
      id: configured.id,
      label: configured.name,
      height: configured.height,
      storageKey: clipVideoVariantKey(clipId, configured.id),
      isDefault:
        configured.id === defaultVariantId ||
        (!defaultVariantIsAvailable && isFirstAvailable),
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
