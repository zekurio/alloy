import { mkdir, readFile, stat } from "node:fs/promises"

import type { TranscodingConfig } from "@alloy/contracts"
import { join } from "@alloy/server/runtime/path"

import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"
import { probeMedia } from "./probe"
import { transcodeSettings } from "./transcode-settings"

/**
 * Segment target duration. Keyframes are forced on this boundary in every
 * tier so segments align across renditions and ABR switches are seamless.
 */
export const SEGMENT_SECONDS = 2

/**
 * Placeholder written into stored media playlists wherever ffmpeg referenced
 * the rendition file. Routes substitute a versioned URL at serve time, so the
 * stored playlist never embeds an origin or storage key.
 */
export const RENDITION_MEDIA_URI_PLACEHOLDER = "__MEDIA_URI__"

const MEDIA_FILENAME = "media.mp4"
const PLAYLIST_FILENAME = "index.m3u8"

export interface RenditionTier {
  height: number
  maxFps: number
  crf: number
  maxrateKbps: number
  audioBitrate: string
  enabled: (config: TranscodingConfig) => boolean
}

/**
 * The encode ladder, highest first. crf/maxrate pairs are capped-VBR targets
 * chosen for 60fps game footage; the admin transcoding config toggles tiers.
 */
export const RENDITION_TIERS: readonly RenditionTier[] = [
  {
    height: 1080,
    maxFps: 60,
    crf: 21,
    maxrateKbps: 8000,
    audioBitrate: "160k",
    enabled: (config) => config.enable1080p,
  },
  {
    height: 720,
    maxFps: 60,
    crf: 22,
    maxrateKbps: 5000,
    audioBitrate: "128k",
    enabled: (config) => config.enable720p,
  },
  {
    height: 480,
    maxFps: 30,
    crf: 23,
    maxrateKbps: 2500,
    audioBitrate: "96k",
    enabled: (config) => config.enable480p,
  },
] as const

export interface LadderStep {
  tier: RenditionTier
  /** Output frame height, clamped to the source and rounded down to even. */
  height: number
  /** Output frame rate used for GOP sizing. */
  fps: number
  /** Whether an fps filter must cap the source's frame rate. */
  capFps: boolean
}

/**
 * The tiers to actually encode for a source: enabled tiers clamped to the
 * source height, deduplicated when clamping collapses two tiers to the same
 * output height (the tier whose native height matches wins — its rate targets
 * were chosen for that resolution). Always non-empty for a valid config, so
 * every clip gets at least one compat rendition.
 */
export function effectiveLadder(
  config: TranscodingConfig,
  source: { height: number; fps: number | null },
): LadderStep[] {
  const byHeight = new Map<number, LadderStep>()
  for (const tier of RENDITION_TIERS) {
    if (!tier.enabled(config)) continue
    const height = evenFloor(Math.min(tier.height, source.height))
    if (height <= 0) continue
    const existing = byHeight.get(height)
    if (existing && existing.tier.height <= tier.height) continue
    // Cap the frame rate when the source exceeds the tier's target, and also
    // when the source rate is unknown — an uncapped 144fps encode is worse
    // than a rare 24->30 upsample.
    const capFps = source.fps === null || source.fps > tier.maxFps
    const fps = capFps ? tier.maxFps : Math.round(source.fps ?? tier.maxFps)
    byHeight.set(height, { tier, height, fps: Math.max(1, fps), capFps })
  }
  return [...byHeight.values()].sort((a, b) => b.height - a.height)
}

export interface EncodedRendition {
  /** Absolute path of the encoded single-file fMP4 within the work dir. */
  filePath: string
  /** Media playlist with the file URI replaced by the placeholder. */
  playlist: string
  height: number
  width: number
  fps: number
  /** RFC 6381 CODECS value; empty when it could not be derived. */
  codecs: string
  /** Peak segment bits/sec for the master playlist BANDWIDTH attribute. */
  bandwidth: number
  sizeBytes: number
}

/**
 * Encode one ladder step from `srcPath` into `outDir` as a single-file fMP4
 * plus HLS byte-range media playlist. `onProgress` receives 0..1.
 */
export async function encodeRendition(
  srcPath: string,
  outDir: string,
  step: LadderStep,
  opts: {
    durationMs: number
    signal?: AbortSignal
    onProgress?: (fraction: number) => void
  },
): Promise<EncodedRendition> {
  await mkdir(outDir, { recursive: true })
  const gop = Math.round(step.fps * SEGMENT_SECONDS)
  const filters = [
    `scale=-2:${step.height}:flags=lanczos`,
    ...(step.capFps ? [`fps=${step.tier.maxFps}`] : []),
  ]

  const durationSec = opts.durationMs / 1000
  const threads = transcodeSettings().threads
  await runFfmpeg({
    cwd: outDir,
    timeoutMs: transcodeTimeoutMs(opts.durationMs),
    signal: opts.signal,
    onProgress: (outTimeSec) => {
      if (durationSec <= 0) return
      opts.onProgress?.(Math.min(1, outTimeSec / durationSec))
    },
    args: [
      "-v",
      "error",
      "-y",
      "-i",
      srcPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(step.tier.crf),
      "-maxrate",
      `${step.tier.maxrateKbps}k`,
      "-bufsize",
      `${Math.round(step.tier.maxrateKbps * 1.5)}k`,
      // 8-bit 4:2:0 regardless of source depth — the whole point of these
      // renditions is universal decoder support.
      "-pix_fmt",
      "yuv420p",
      "-vf",
      filters.join(","),
      "-g",
      String(gop),
      "-keyint_min",
      String(gop),
      "-sc_threshold",
      "0",
      "-force_key_frames",
      `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
      "-c:a",
      "aac",
      "-b:a",
      step.tier.audioBitrate,
      "-ac",
      "2",
      ...(threads > 0 ? ["-threads", String(threads)] : []),
      "-f",
      "hls",
      "-hls_time",
      String(SEGMENT_SECONDS),
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_flags",
      "single_file",
      "-hls_segment_filename",
      MEDIA_FILENAME,
      PLAYLIST_FILENAME,
    ],
  })

  const filePath = join(outDir, MEDIA_FILENAME)
  const rawPlaylist = await readFile(join(outDir, PLAYLIST_FILENAME), "utf8")
  const playlist = rawPlaylist.replaceAll(
    MEDIA_FILENAME,
    RENDITION_MEDIA_URI_PLACEHOLDER,
  )

  const sizeBytes = (await stat(filePath)).size
  const probed = await probeMedia(filePath)
  const stats = mediaPlaylistStats(rawPlaylist)
  return {
    filePath,
    playlist,
    height: probed.height,
    width: probed.width,
    fps: Math.round(probed.fps ?? step.fps),
    codecs: [probed.videoCodecString, probed.audioCodecString]
      .filter((value): value is string => !!value)
      .join(","),
    bandwidth:
      stats?.peakBitrate ??
      Math.round((sizeBytes * 8) / Math.max(durationSec, 0.001)),
    sizeBytes,
  }
}

/** Substitute the placeholder in a stored media playlist with a real URL. */
export function renderMediaPlaylist(playlist: string, fileUrl: string): string {
  return playlist.replaceAll(RENDITION_MEDIA_URI_PLACEHOLDER, fileUrl)
}

export interface MasterPlaylistRendition {
  height: number
  width: number
  fps: number
  codecs: string
  bandwidth: number
  playlistUrl: string
}

/** Render the HLS master playlist for a clip's committed renditions. */
export function renderMasterPlaylist(
  renditions: readonly MasterPlaylistRendition[],
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
  const ordered = [...renditions].sort((a, b) => b.height - a.height)
  for (const rendition of ordered) {
    const attrs = [
      `BANDWIDTH=${rendition.bandwidth}`,
      `RESOLUTION=${rendition.width}x${rendition.height}`,
      `FRAME-RATE=${rendition.fps.toFixed(3)}`,
      ...(rendition.codecs ? [`CODECS="${rendition.codecs}"`] : []),
    ]
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`)
    lines.push(rendition.playlistUrl)
  }
  return `${lines.join("\n")}\n`
}

/**
 * Peak segment bitrate from a byte-range media playlist (EXTINF duration
 * paired with the following EXT-X-BYTERANGE length). Null when the playlist
 * has no parseable segments.
 */
export function mediaPlaylistStats(
  playlist: string,
): { peakBitrate: number; segmentCount: number } | null {
  let peak = 0
  let count = 0
  let pendingDuration: number | null = null
  for (const line of playlist.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#EXTINF:")) {
      pendingDuration = Number.parseFloat(trimmed.slice("#EXTINF:".length))
      continue
    }
    if (trimmed.startsWith("#EXT-X-BYTERANGE:") && pendingDuration) {
      const bytes = Number.parseInt(
        trimmed.slice("#EXT-X-BYTERANGE:".length),
        10,
      )
      if (Number.isFinite(bytes) && pendingDuration > 0) {
        peak = Math.max(peak, Math.round((bytes * 8) / pendingDuration))
        count += 1
      }
      pendingDuration = null
    }
  }
  if (count === 0) return null
  return { peakBitrate: peak, segmentCount: count }
}

function evenFloor(value: number): number {
  return Math.floor(value / 2) * 2
}
