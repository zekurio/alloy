import type { ClipEncodedVariant } from "@workspace/db/schema"

export const OPEN_GRAPH_VARIANT_ID = "opengraph"

export function isOpenGraphVariant(variant: ClipEncodedVariant): boolean {
  return variant.id === OPEN_GRAPH_VARIANT_ID
}

export function isOpenGraphCompatibleVideoVariant(
  variant: ClipEncodedVariant
): boolean {
  return (
    isOpenGraphVariant(variant) &&
    variant.contentType === "video/mp4" &&
    variant.settings?.codec === "h264" &&
    (variant.settings.audioCodec === "aac" ||
      variant.settings.audioCodec === "none")
  )
}

export function selectOpenGraphVideo(
  variants: readonly ClipEncodedVariant[]
): ClipEncodedVariant | null {
  return variants.find(isOpenGraphCompatibleVideoVariant) ?? null
}

export function openGraphCompatibleSource(input: {
  contentType: string
  videoCodec: string
  audioCodec: string | null
  height: number
  trim: { startMs: number | null; endMs: number | null }
}): boolean {
  return (
    input.contentType === "video/mp4" &&
    input.videoCodec === "h264" &&
    (input.audioCodec === "aac" || input.audioCodec === null) &&
    input.height <= 1080 &&
    input.trim.startMs === null &&
    input.trim.endMs === null
  )
}
