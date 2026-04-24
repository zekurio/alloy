import type { EncoderVariant } from "../lib/config-store"
import { clipVideoVariantKey } from "../storage"

/** Per-variant override resolved from the runtime config. */
export interface VariantOverride {
  hwaccel: EncoderVariant["hwaccel"]
  codec: EncoderVariant["codec"]
  quality: EncoderVariant["quality"]
  preset: EncoderVariant["preset"]
  audioBitrateKbps: EncoderVariant["audioBitrateKbps"]
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
  const specs: VariantSpec[] = []

  for (const [index, configured] of configuredVariants.entries()) {
    const cappedHeight = Math.min(configured.height, sourceHeight)
    if (cappedHeight <= 0) continue
    const id = buildVariantId(configured, cappedHeight, index)
    const isDefault = specs.length === 0
    specs.push({
      id,
      label: configured.name,
      height: cappedHeight,
      storageKey: clipVideoVariantKey(clipId, id),
      isDefault,
      override: {
        hwaccel: configured.hwaccel,
        codec: configured.codec,
        quality: configured.quality,
        preset: configured.preset,
        audioBitrateKbps: configured.audioBitrateKbps,
      },
    })
  }

  return specs
}

function buildVariantId(
  variant: EncoderVariant,
  cappedHeight: number,
  index: number
): string {
  const name = variant.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const readable = [name, `${cappedHeight}p`, variant.hwaccel, variant.codec]
    .filter(Boolean)
    .join("-")
  return `${String(index + 1).padStart(2, "0")}-${readable}`
}
