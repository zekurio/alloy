import type { EncoderVariant } from "@workspace/contracts"
import { clipVideoVariantKey } from "../storage/driver"

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

export interface VariantPlan {
  specs: VariantSpec[]
  skipped: Array<{ id: string; label: string; height: number; reason: string }>
}

export function buildVariantPlan(
  clipId: string,
  sourceHeight: number,
  configuredVariants: ReadonlyArray<EncoderVariant>,
  defaultVariantId: string | null,
  runId?: string
): VariantPlan {
  const specs: VariantSpec[] = []
  const skipped: VariantPlan["skipped"] = []
  const defaultVariantIsAvailable = configuredVariants.some(
    (variant) =>
      variant.id === defaultVariantId &&
      variant.height > 0 &&
      variant.height <= sourceHeight
  )

  for (const configured of configuredVariants) {
    if (configured.height <= 0) {
      skipped.push({
        id: configured.id,
        label: configured.name,
        height: configured.height,
        reason: "invalid height",
      })
      continue
    }
    if (configured.height > sourceHeight) {
      skipped.push({
        id: configured.id,
        label: configured.name,
        height: configured.height,
        reason: `source is ${sourceHeight}p`,
      })
      continue
    }
    const isFirstAvailable = specs.length === 0
    specs.push({
      id: configured.id,
      label: configured.name,
      height: configured.height,
      storageKey: clipVideoVariantKey(clipId, configured.id, runId),
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

  specs.sort(
    (a, b) =>
      b.height - a.height ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
  )
  return { specs, skipped }
}

export function buildVariantSpecs(
  clipId: string,
  sourceHeight: number,
  configuredVariants: ReadonlyArray<EncoderVariant>,
  defaultVariantId: string | null,
  runId?: string
): VariantSpec[] {
  return buildVariantPlan(
    clipId,
    sourceHeight,
    configuredVariants,
    defaultVariantId,
    runId
  ).specs
}
