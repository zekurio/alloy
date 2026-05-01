import type { EncoderOpenGraphTarget } from "@workspace/contracts"
import type { ClipEncodedVariant } from "@workspace/db/schema"

export function isOpenGraphCompatibleVideoVariant(
  variant: ClipEncodedVariant
): boolean {
  return (
    variant.contentType === "video/mp4" &&
    variant.settings?.codec === "h264" &&
    variant.settings.audioCodec === "aac"
  )
}

export function selectOpenGraphVideo(
  variants: readonly ClipEncodedVariant[],
  target: EncoderOpenGraphTarget
): ClipEncodedVariant | null {
  if (target.type === "none") return null

  const compatiblePlaybackVariants = variants.filter(
    (variant) =>
      variant.role !== "source" &&
      variant.id !== "source" &&
      isOpenGraphCompatibleVideoVariant(variant)
  )
  const defaultCompatiblePlaybackVariant =
    compatiblePlaybackVariants.find((variant) => variant.isDefault) ??
    compatiblePlaybackVariants[0] ??
    null

  const selected = selectConfiguredTarget(variants, target)
  if (selected && isOpenGraphCompatibleVideoVariant(selected)) return selected

  return defaultCompatiblePlaybackVariant
}

function selectConfiguredTarget(
  variants: readonly ClipEncodedVariant[],
  target: Exclude<EncoderOpenGraphTarget, { type: "none" }>
): ClipEncodedVariant | null {
  switch (target.type) {
    case "source":
      return (
        variants.find(
          (variant) => variant.role === "source" || variant.id === "source"
        ) ?? null
      )
    case "defaultVariant": {
      const playbackVariants = variants.filter(
        (variant) => variant.role !== "source" && variant.id !== "source"
      )
      return (
        playbackVariants.find((variant) => variant.isDefault) ??
        playbackVariants[0] ??
        null
      )
    }
    case "variant":
      return (
        variants.find(
          (variant) =>
            variant.role !== "source" && variant.id === target.variantId
        ) ?? null
      )
  }
}
