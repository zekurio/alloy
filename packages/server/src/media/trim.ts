import type { TranscodingConfig } from "@alloy/contracts"

import {
  encodeRenditionWithFallback,
  evenFloor,
  type EncodedRendition,
  type LadderStep,
} from "./renditions"

/**
 * CRF-scale quality for the exact cut (mapped to the equivalent rate-control
 * knob of hardware encoders). Well below the rendition default so the cut is
 * near-transparent: it is the clip's canonical playback media, not a tier.
 */
const CUT_QUALITY = 18

/** Near-transparent audio for the canonical cut, whatever the tier bitrate. */
const CUT_MIN_AUDIO_KBPS = 192

/**
 * Bitrate ceiling for the cut as H.264 bits per pixel per second. Generous —
 * with CRF 18 the cap only tames pathological spikes (confetti, static).
 */
const CUT_MAX_BITS_PER_PIXEL = 0.15

const CUT_MIN_MAXRATE_KBPS = 8000
const CUT_MAX_MAXRATE_KBPS = 100_000

/** GOP sizing fallback when the container carries no frame rate. */
const CUT_FALLBACK_FPS = 30

/**
 * Cut `[startMs, endMs]` out of `sourcePath` with a frame-exact re-encode:
 * `-ss` before `-i` plus an output duration is sample-accurate under a
 * re-encode, unlike the keyframe-snapped packet copy this replaces. Desktop
 * uploads arrive as keyframe-snapped supersets whose ingest trim fields carry
 * the exact range; this cut applies that range against the stored original.
 *
 * The cut is conceptually a source-resolution rendition, so it reuses the
 * rendition arg/hardware-accel/fallback machinery with a source-shaped step.
 * It always encodes H.264 High + AAC at source resolution/fps and
 * near-transparent quality: universally decodable, so playback never depends
 * on stale renditions once the cut commits.
 */
export async function encodeExactCut(options: {
  sourcePath: string
  outDir: string
  config: TranscodingConfig
  source: { width: number; height: number; fps: number | null }
  startMs: number
  endMs: number
  signal?: AbortSignal
  onHardwareFailed?: () => void
}): Promise<EncodedRendition> {
  return encodeRenditionWithFallback({
    srcPath: options.sourcePath,
    outDir: options.outDir,
    config: {
      ...options.config,
      quality: Math.min(options.config.quality, CUT_QUALITY),
      audioBitrateKbps: Math.max(
        options.config.audioBitrateKbps,
        CUT_MIN_AUDIO_KBPS,
      ),
    },
    step: exactCutStep(options.source),
    trim: { startMs: options.startMs, endMs: options.endMs },
    durationMs: options.endMs - options.startMs,
    signal: options.signal,
    onHardwareFailed: options.onHardwareFailed,
  })
}

/** A source-shaped ladder step: source resolution/fps, always H.264. */
function exactCutStep(source: {
  width: number
  height: number
  fps: number | null
}): LadderStep {
  const fps = Math.max(1, Math.round(source.fps ?? CUT_FALLBACK_FPS))
  // The scale filter emits -2:<height>, so odd source heights round to even.
  const height = evenFloor(source.height)
  const maxrateKbps = Math.min(
    CUT_MAX_MAXRATE_KBPS,
    Math.max(
      CUT_MIN_MAXRATE_KBPS,
      Math.round(
        (source.width * source.height * fps * CUT_MAX_BITS_PER_PIXEL) / 1000,
      ),
    ),
  )
  return {
    tier: { height, maxFps: fps, maxrateKbps },
    height,
    fps,
    capFps: false,
    codec: "h264",
    name: "cut",
    og: false,
  }
}
