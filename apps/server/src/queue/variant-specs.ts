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
  configuredVariants: ReadonlyArray<EncoderVariant>
): VariantSpec[] {
  const specs: VariantSpec[] = []
  const usedIds = new Set<string>()

  for (const [index, configured] of configuredVariants.entries()) {
    const cappedHeight = Math.min(configured.height, sourceHeight)
    if (cappedHeight <= 0) continue
    const id = buildVariantId(configured, index, usedIds)
    const isDefault = specs.length === 0
    specs.push({
      id,
      label: configured.name,
      height: cappedHeight,
      storageKey: clipVideoVariantKey(clipId, id),
      isDefault,
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

function buildVariantId(
  variant: EncoderVariant,
  index: number,
  usedIds: Set<string>
): string {
  const slug =
    variant.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `variant-${index + 1}`
  let id = slug
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${slug}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}
