import { mkdir, stat } from "node:fs/promises"

import {
  deriveRenditionNames,
  type RenditionTierConfig,
  type TranscodingConfig,
  type VideoCodec,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { join } from "@alloy/server/runtime/path"

import {
  buildEncoderGlobalArgs,
  buildEncoderVideoArgs,
  buildVideoFilterChain,
} from "./encoders"
import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"
import { probeMedia } from "./probe"
import { transcodeSettings } from "./transcode-settings"

const logger = createLogger("media")

/**
 * Keyframe interval target. Progressive MP4 seeks land on keyframes, so a
 * consistent short GOP keeps scrubbing accurate in every tier.
 */
const GOP_SECONDS = 2

const MEDIA_FILENAME = "media.mp4"

export interface RenditionTier {
  height: number
  maxFps: number
  maxrateKbps: number
  /** Per-tier codec override; falls back to the config's `videoCodec`. */
  codec?: VideoCodec
  /** Marks the tier whose rendition powers OpenGraph/social embeds. */
  og?: boolean
}

export interface LadderStep {
  tier: RenditionTier
  /** Output frame height, clamped to the source and rounded down to even. */
  height: number
  /** Output frame rate used for GOP sizing. */
  fps: number
  /** Whether an fps filter must cap the source's frame rate. */
  capFps: boolean
  /** Video codec for this step: the tier override or the global default. */
  codec: VideoCodec
  /** Stable per-tier slug derived from output height/fps/codec, e.g. "1080p60". */
  name: string
  /** Whether this step's rendition powers OpenGraph/social embeds. */
  og: boolean
}

/**
 * The tiers to actually encode for a source. Browser-safe H.264/AAC MP4
 * sources already serve their own height and above, so those tiers are skipped
 * before clamping and the ladder may be empty. Other sources keep the compat
 * behavior: configured tiers are clamped to source height and deduplicated
 * when clamping collapses them to the same output signature (height, fps,
 * codec); the survivor keeps the highest maxrate and inherits the og flag.
 */
export function effectiveLadder(
  config: TranscodingConfig,
  source: { height: number; fps: number | null; browserSafe: boolean },
): LadderStep[] {
  const byOutput = new Map<string, Omit<LadderStep, "name">>()
  for (const tier of sortedTiers(config.tiers)) {
    if (source.browserSafe && tier.height >= source.height) continue
    const height = evenFloor(Math.min(tier.height, source.height))
    if (height <= 0) continue
    // Cap the frame rate when the source exceeds the tier's target, and also
    // when the source rate is unknown — an uncapped 144fps encode is worse
    // than a rare 24->30 upsample.
    const capFps = source.fps === null || source.fps > tier.maxFps
    const fps = Math.max(
      1,
      capFps ? tier.maxFps : Math.round(source.fps ?? tier.maxFps),
    )
    const codec = tier.codec ?? config.videoCodec
    const key = `${height}:${fps}:${codec}`
    const existing = byOutput.get(key)
    if (existing) {
      const og = existing.og || Boolean(tier.og)
      if (existing.tier.maxrateKbps >= tier.maxrateKbps) {
        byOutput.set(key, { ...existing, og })
        continue
      }
      byOutput.set(key, { tier, height, fps, capFps, codec, og })
      continue
    }
    byOutput.set(key, {
      tier,
      height,
      fps,
      capFps,
      codec,
      og: Boolean(tier.og),
    })
  }
  const steps = [...byOutput.values()].sort(
    (a, b) => b.height - a.height || b.fps - a.fps,
  )
  const names = deriveRenditionNames(steps)
  return steps.map((step, index) => ({
    ...step,
    name: names[index] ?? `${step.height}p`,
  }))
}

export function buildRenditionArgs(options: {
  config: TranscodingConfig
  srcPath: string
  step: LadderStep
  /**
   * Source-time cut applied on the decode side: `-ss` before `-i` plus an
   * output duration. With a re-encode this is frame-exact — ffmpeg decodes
   * from the preceding keyframe and discards frames before the seek point.
   */
  trim?: { startMs: number; endMs: number }
}): string[] {
  const gop = Math.round(options.step.fps * GOP_SECONDS)
  const filters = [
    `scale=-2:${options.step.height}:flags=lanczos`,
    ...(options.step.capFps ? [`fps=${options.step.tier.maxFps}`] : []),
  ]
  const threads = transcodeSettings().threads
  const softwareEncoder = options.config.hardwareAcceleration === "none"
  return [
    "-v",
    "error",
    "-y",
    ...buildEncoderGlobalArgs(options.config),
    ...(options.trim ? ["-ss", String(options.trim.startMs / 1000)] : []),
    "-i",
    options.srcPath,
    ...(options.trim
      ? ["-t", String((options.trim.endMs - options.trim.startMs) / 1000)]
      : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...buildEncoderVideoArgs({
      config: options.config,
      codec: options.step.codec,
      maxrateKbps: options.step.tier.maxrateKbps,
    }),
    "-vf",
    buildVideoFilterChain(options.config, filters),
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-force_key_frames",
    `expr:gte(t,n_forced*${GOP_SECONDS})`,
    "-c:a",
    "aac",
    "-b:a",
    `${options.config.audioBitrateKbps}k`,
    "-ac",
    "2",
    ...(softwareEncoder && threads > 0 ? ["-threads", String(threads)] : []),
    "-movflags",
    "+faststart",
    MEDIA_FILENAME,
  ]
}

export interface EncodedRendition {
  /** Absolute path of the encoded progressive MP4 within the work dir. */
  filePath: string
  height: number
  width: number
  fps: number
  /** Probed output duration — the cut length when a trim was applied. */
  durationMs: number
  /** RFC 6381 codec string; empty when it could not be derived. */
  codecs: string
  sizeBytes: number
}

/**
 * Encode one ladder step from `srcPath` into `outDir` as a progressive
 * (faststart) MP4. `onProgress` receives 0..1. `durationMs` is the expected
 * output duration — the trim length when `trim` is set — and drives both the
 * encode timeout and progress mapping.
 */
export async function encodeRendition(
  srcPath: string,
  outDir: string,
  config: TranscodingConfig,
  step: LadderStep,
  opts: {
    durationMs: number
    trim?: { startMs: number; endMs: number }
    signal?: AbortSignal
    onProgress?: (fraction: number) => void
  },
): Promise<EncodedRendition> {
  await mkdir(outDir, { recursive: true })

  const durationSec = opts.durationMs / 1000
  await runFfmpeg({
    cwd: outDir,
    timeoutMs: transcodeTimeoutMs(opts.durationMs),
    signal: opts.signal,
    onProgress: (outTimeSec) => {
      if (durationSec <= 0) return
      opts.onProgress?.(Math.min(1, outTimeSec / durationSec))
    },
    args: buildRenditionArgs({ config, srcPath, step, trim: opts.trim }),
  })

  const filePath = join(outDir, MEDIA_FILENAME)
  const sizeBytes = (await stat(filePath)).size
  const probed = await probeMedia(filePath)
  return {
    filePath,
    height: probed.height,
    width: probed.width,
    fps: Math.round(probed.fps ?? step.fps),
    durationMs: probed.durationMs,
    codecs: [probed.videoCodecString, probed.audioCodecString]
      .filter((value): value is string => !!value)
      .join(","),
    sizeBytes,
  }
}

/**
 * {@link encodeRendition} with a one-shot software fallback: when the
 * configured hardware encoder fails, the step is retried with
 * `hardwareAcceleration: "none"` and `onHardwareFailed` is invoked so the
 * caller can skip hardware for subsequent steps.
 */
export async function encodeRenditionWithFallback(options: {
  srcPath: string
  outDir: string
  config: TranscodingConfig
  step: LadderStep
  durationMs: number
  trim?: { startMs: number; endMs: number }
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  onHardwareFailed?: () => void
}): Promise<EncodedRendition> {
  const opts = {
    durationMs: options.durationMs,
    trim: options.trim,
    signal: options.signal,
    onProgress: options.onProgress,
  }
  try {
    return await encodeRendition(
      options.srcPath,
      options.outDir,
      options.config,
      options.step,
      opts,
    )
  } catch (err) {
    // A cancelled run rejects with AbortError — not an encoder failure, so it
    // must not trigger the software fallback.
    if (options.signal?.aborted) throw err
    if (options.config.hardwareAcceleration === "none") throw err
    logger.warn(
      `hardware ${options.config.hardwareAcceleration} encode failed for ${options.step.height}p; falling back to software:`,
      err,
    )
    options.onHardwareFailed?.()
    return encodeRendition(
      options.srcPath,
      options.outDir,
      { ...options.config, hardwareAcceleration: "none" },
      options.step,
      opts,
    )
  }
}

export function evenFloor(value: number): number {
  return Math.floor(value / 2) * 2
}

function sortedTiers(tiers: readonly RenditionTierConfig[]): RenditionTier[] {
  return [...tiers].sort((a, b) => b.height - a.height)
}
