export type OpenGraphSourceMetadata = {
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
}

export function isOpenGraphCompatibleSource(
  row: OpenGraphSourceMetadata,
): boolean {
  return (
    row.sourceContentType === "video/mp4" &&
    isH264Codec(row.sourceVideoCodec) &&
    isOpenGraphAudioCodec(row.sourceAudioCodec)
  )
}

function isH264Codec(codec: string | null): boolean {
  const normalized = codec?.trim().toLowerCase()
  return normalized === "h264" || normalized === "avc1"
}

function isOpenGraphAudioCodec(codec: string | null): boolean {
  if (codec == null) return true
  const normalized = codec.trim().toLowerCase()
  return normalized === "aac"
}
