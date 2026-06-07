import type { ClipPlaybackQuality } from "alloy-contracts"

type QualityPreset = {
  bitrate: number
  maxHeight: number
}

const QUALITY_PRESETS: readonly QualityPreset[] = [
  { bitrate: 120_000_000, maxHeight: 2160 },
  { bitrate: 80_000_000, maxHeight: 2160 },
  { bitrate: 60_000_000, maxHeight: 2160 },
  { bitrate: 40_000_000, maxHeight: 2160 },
  { bitrate: 20_000_000, maxHeight: 2160 },
  { bitrate: 15_000_000, maxHeight: 1440 },
  { bitrate: 10_000_000, maxHeight: 1440 },
  { bitrate: 8_000_000, maxHeight: 1080 },
  { bitrate: 6_000_000, maxHeight: 1080 },
  { bitrate: 4_000_000, maxHeight: 720 },
  { bitrate: 3_000_000, maxHeight: 720 },
  { bitrate: 1_500_000, maxHeight: 720 },
  { bitrate: 720_000, maxHeight: 480 },
  { bitrate: 420_000, maxHeight: 360 },
]

export function buildPlaybackQualities(input: {
  width: number | null
  height: number | null
  durationMs: number | null
  sourceSizeBytes: number | null
}): ClipPlaybackQuality[] {
  const sourceHeight = input.height
  const sourceBitrate = sourceTotalBitrate(input)
  if (!sourceHeight || !sourceBitrate) return []

  const sourceWidth = input.width && input.width > 0 ? input.width : null
  return [
    buildPlaybackQuality({
      bitrate: sourceBitrate,
      height: sourceHeight,
      sourceHeight,
      sourceWidth,
    }),
    ...QUALITY_PRESETS.filter(
      (preset) =>
        preset.bitrate < sourceBitrate && preset.maxHeight <= sourceHeight,
    ).map((preset) =>
      buildPlaybackQuality({
        bitrate: preset.bitrate,
        height: Math.min(preset.maxHeight, sourceHeight),
        sourceHeight,
        sourceWidth,
      }),
    ),
  ]
}

export function findPlaybackQuality(
  qualities: readonly ClipPlaybackQuality[],
  id: string | undefined,
): ClipPlaybackQuality | null {
  if (!id || id === "auto" || id === "source") return null
  return qualities.find((quality) => quality.id === id) ?? null
}

function sourceTotalBitrate(input: {
  durationMs: number | null
  sourceSizeBytes: number | null
}): number | null {
  if (!input.durationMs || !input.sourceSizeBytes) return null
  if (input.durationMs <= 0 || input.sourceSizeBytes <= 0) return null
  return Math.floor((input.sourceSizeBytes * 8 * 1000) / input.durationMs)
}

function playbackQualityId(bitrate: number): string {
  return `br-${bitrate}`
}

function buildPlaybackQuality({
  bitrate,
  height,
  sourceHeight,
  sourceWidth,
}: {
  bitrate: number
  height: number
  sourceHeight: number
  sourceWidth: number | null
}): ClipPlaybackQuality {
  const audioBitrate = audioBitrateForTotal(bitrate)
  const videoBitrate = Math.max(100_000, bitrate - audioBitrate)
  return {
    id: playbackQualityId(bitrate),
    label: `${height}p - ${formatBitrate(bitrate)}`,
    bitrate,
    videoBitrate,
    audioBitrate,
    width: sourceWidth
      ? even(Math.round((sourceWidth * height) / sourceHeight))
      : null,
    height,
  }
}

function audioBitrateForTotal(totalBitrate: number): number {
  if (totalBitrate >= 1_500_000) return 128_000
  if (totalBitrate >= 720_000) return 96_000
  return 64_000
}

function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    const mbps = bitrate / 1_000_000
    return `${Number.isInteger(mbps) ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`
  }
  return `${Math.round(bitrate / 1000)} kbps`
}

function even(value: number): number {
  return value % 2 === 0 ? value : value - 1
}
