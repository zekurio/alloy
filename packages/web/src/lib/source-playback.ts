import { t } from "@alloy/i18n"
type SourceCodecHints = {
  videoCodec?: string | null
  audioCodec?: string | null
}

type SourceSupportProbe = {
  canPlayType: (mimeType: string) => string
}

const VIDEO_CODEC_MIME_NAMES: Record<string, readonly string[]> = {
  av1: ["av01.0.08M.08", "av01.0.15M.08", "av01.0.15M.10"],
  h264: ["avc1.42E01E", "avc1.640029"],
  hevc: [
    "hvc1.1.L120",
    "hev1.1.L120",
    "hvc1.1.0.L120",
    "hev1.1.0.L120",
    "hvc1.1.6.L120.B0",
    "hev1.1.6.L120.B0",
  ],
  vp8: ["vp8"],
  vp9: ["vp9", "vp09.00.10.08"],
}

const AUDIO_CODEC_MIME_NAMES: Record<string, readonly string[]> = {
  aac: ["mp4a.40.2"],
  mp3: ["mp3", "mp4a.69", "mp4a.6B"],
  opus: ["opus"],
  vorbis: ["vorbis"],
}

const CONTAINER_MIME_CANDIDATES: Record<string, readonly string[]> = {
  "video/x-matroska": ["video/x-matroska", "video/mkv", "video/matroska"],
  "video/matroska": ["video/matroska", "video/x-matroska", "video/mkv"],
  "video/mkv": ["video/mkv", "video/x-matroska", "video/matroska"],
  "video/mp4": ["video/mp4", "video/x-m4v"],
  "video/x-m4v": ["video/x-m4v", "video/mp4"],
}

export function sourceMimeCandidates(
  contentType: string | null | undefined,
  hints: SourceCodecHints = {},
): string[] {
  const type = contentType?.trim().toLowerCase()
  if (!type) return []

  const containerCandidates = CONTAINER_MIME_CANDIDATES[type] ?? [type]
  const codecLists = sourceCodecLists(hints)
  if (codecLists.length === 0) return [...containerCandidates]

  return uniqueStrings([
    ...containerCandidates.flatMap((container) =>
      codecCombinations(codecLists).map(
        (codecList) => `${container}; codecs="${codecList.join(",")}"`,
      ),
    ),
    ...containerCandidates,
  ])
}

export function canPlaySourceFromSupport(
  contentType: string | null | undefined,
  probe: SourceSupportProbe,
  hints: SourceCodecHints = {},
): boolean {
  return sourceMimeCandidates(contentType, hints).some(
    (mimeType) => probe.canPlayType(mimeType) !== "",
  )
}

export function canPlaySource(
  contentType: string | null | undefined,
  hints: SourceCodecHints = {},
): boolean {
  if (typeof document === "undefined") return false
  const video = document.createElement("video")
  return canPlaySourceFromSupport(
    contentType,
    {
      canPlayType: (mimeType) => video.canPlayType(mimeType),
    },
    hints,
  )
}

function sourceCodecLists(hints: SourceCodecHints): string[][] {
  const videoCodec = normalizeSourceCodec(hints.videoCodec)
  const audioCodec = normalizeSourceCodec(hints.audioCodec)
  return [
    videoCodec ? VIDEO_CODEC_MIME_NAMES[videoCodec] : null,
    audioCodec ? AUDIO_CODEC_MIME_NAMES[audioCodec] : null,
  ]
    .filter((codecs): codecs is readonly string[] =>
      Boolean(codecs && codecs.length > 0),
    )
    .map((codecs) => [...codecs])
}

function normalizeSourceCodec(codec: string | null | undefined): string | null {
  const normalized = codec?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === "avc" || normalized === "avc1") return t("h264")
  if (normalized === "h265" || normalized === "hvc1" || normalized === "hev1") {
    return t("hevc")
  }
  if (normalized === "mpeg4aac") return "aac"
  return normalized
}

function codecCombinations(lists: readonly string[][]): string[][] {
  return lists.reduce<string[][]>(
    (combinations, list) =>
      combinations.flatMap((combination) =>
        list.map((codec) => [...combination, codec]),
      ),
    [[]],
  )
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}
