import { mkdir, stat } from "node:fs/promises"

import type { ClipAudioTrackInput } from "@alloy/contracts"
import { join } from "@alloy/server/runtime/path"

import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"
import { runFfprobe } from "./ffprobe"
import { buildAudioCodecString, type MediaAudioProbe } from "./probe"

const STEM_AUDIO_BITRATE_KBPS = 192
const MAX_STEM_TIMELINE_ERROR_MS = 60
const INITIAL_EXTRACTION_PROGRESS_FRACTION = 0.5

export interface ExtractedAudioStem {
  index: number
  kind: ClipAudioTrackInput["kind"]
  label: string
  filePath: string
  codecs: string
  sizeBytes: number
}

type StemPlan = {
  index: number
  hint: ClipAudioTrackInput
  sourceTrack: MediaAudioProbe
  filePath: string
  copy: boolean
}

/**
 * Extract per-source tracks from the original source into standalone M4A
 * assets. The initial outputs share one ffmpeg invocation, so even a large
 * source is demuxed only once. AAC is packet-copied; other codecs are encoded
 * to AAC-LC. Each output's starting PTS and duration are validated against the
 * canonical playback timeline because duration equality alone cannot prove
 * alignment. An inaccurate output is re-encoded with leading-gap repair. The
 * operation is all-or-nothing so published stem indices remain contiguous.
 */
export async function extractAudioStems(options: {
  sourcePath: string
  outDir: string
  sourceTracks: readonly MediaAudioProbe[]
  hints: readonly ClipAudioTrackInput[]
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<ExtractedAudioStem[]> {
  await mkdir(options.outDir, { recursive: true })
  const plans = options.hints.map((hint, index) => {
    const sourceTrack = options.sourceTracks[index + 1]
    if (!sourceTrack) {
      throw new Error("Validated audio stem metadata no longer matches probe")
    }
    return {
      index,
      hint,
      sourceTrack,
      filePath: join(options.outDir, `stem-${index}.m4a`),
      copy: sourceTrack.codec === "aac",
    }
  })
  if (plans.length === 0) return []

  await runStemFfmpeg({
    sourcePath: options.sourcePath,
    outputArgs: plans.flatMap((plan) =>
      stemOutputArgs({
        sourceStreamIndex: plan.sourceTrack.index,
        filePath: plan.filePath,
        copy: plan.copy,
        trim: options.trim,
      }),
    ),
    trim: options.trim,
    canonicalDurationMs: options.canonicalDurationMs,
    signal: options.signal,
    onProgress: (fraction) =>
      options.onProgress?.(fraction * INITIAL_EXTRACTION_PROGRESS_FRACTION),
  })

  const stems: ExtractedAudioStem[] = []
  for (const [planIndex, plan] of plans.entries()) {
    const initiallyAccurate = await stemTimelineAccurate(
      plan.filePath,
      options.canonicalDurationMs,
      options.signal,
    )
    if (initiallyAccurate) {
      stems.push(await extractedStem(plan, plan.copy))
      options.onProgress?.(stemProgress(planIndex + 1, plans.length))
      continue
    }

    await runStemFfmpeg({
      sourcePath: options.sourcePath,
      outputArgs: stemOutputArgs({
        sourceStreamIndex: plan.sourceTrack.index,
        filePath: plan.filePath,
        copy: false,
        trim: options.trim,
      }),
      trim: options.trim,
      canonicalDurationMs: options.canonicalDurationMs,
      signal: options.signal,
      onProgress: (fraction) =>
        options.onProgress?.(stemProgress(planIndex + fraction, plans.length)),
    })
    const reencoded = await stemTimelineAccurate(
      plan.filePath,
      options.canonicalDurationMs,
      options.signal,
    )
    if (!reencoded) {
      throw new Error("Extracted audio stem does not match playback timeline")
    }

    stems.push(await extractedStem(plan, false))
    options.onProgress?.(stemProgress(planIndex + 1, plans.length))
  }
  return stems
}

async function runStemFfmpeg(options: {
  sourcePath: string
  outputArgs: readonly string[]
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}): Promise<void> {
  const durationSec = options.canonicalDurationMs / 1000
  await runFfmpeg({
    timeoutMs: transcodeTimeoutMs(options.canonicalDurationMs),
    signal: options.signal,
    onProgress: (outTimeSec) => {
      if (durationSec <= 0) return
      options.onProgress?.(Math.min(1, outTimeSec / durationSec))
    },
    args: [
      "-v",
      "error",
      "-y",
      ...inputArgs(options.sourcePath, options.trim),
      ...options.outputArgs,
    ],
  })
}

function inputArgs(
  sourcePath: string,
  trim: { startMs: number; endMs: number } | undefined,
): string[] {
  return [
    ...(trim ? ["-ss", (trim.startMs / 1000).toFixed(6)] : []),
    "-i",
    sourcePath,
  ]
}

function stemOutputArgs(options: {
  sourceStreamIndex: number
  filePath: string
  copy: boolean
  trim?: { startMs: number; endMs: number }
}): string[] {
  return [
    ...(options.trim
      ? ["-t", ((options.trim.endMs - options.trim.startMs) / 1000).toFixed(6)]
      : []),
    "-map",
    `0:${options.sourceStreamIndex}`,
    "-vn",
    "-sn",
    "-dn",
    "-c:a",
    options.copy ? "copy" : "aac",
    ...(options.copy
      ? []
      : [
          "-b:a",
          `${STEM_AUDIO_BITRATE_KBPS}k`,
          "-profile:a",
          "aac_low",
          "-af",
          "aresample=async=1:first_pts=0",
        ]),
    "-movflags",
    "+faststart",
    options.filePath,
  ]
}

async function stemTimelineAccurate(
  filePath: string,
  canonicalDurationMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const timeline = await probeStemTimeline(filePath, signal)
    return (
      Math.abs(timeline.startMs) <= MAX_STEM_TIMELINE_ERROR_MS &&
      Math.abs(timeline.durationMs - canonicalDurationMs) <=
        MAX_STEM_TIMELINE_ERROR_MS
    )
  } catch (err) {
    if (signal?.aborted) throw err
    return false
  }
}

async function probeStemTimeline(
  filePath: string,
  signal?: AbortSignal,
): Promise<{ startMs: number; durationMs: number }> {
  const file = await stat(filePath)
  if (!file.isFile() || file.size <= 0) {
    throw new Error("Extracted audio stem is empty")
  }

  const output = await runFfprobe(filePath, signal)
  const streams = output.streams.filter(
    (candidate) => candidate.codec_type === "audio",
  )
  const stream = streams[0]
  if (
    streams.length !== 1 ||
    !stream ||
    stream.codec_name !== "aac" ||
    !buildAudioCodecString(stream)
  ) {
    throw new Error("Extracted audio stem has no supported audio stream")
  }

  const durationSec = Number.parseFloat(output.format.duration ?? "")
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Could not determine extracted audio stem duration")
  }
  const startSec = Number.parseFloat(
    stream.start_time ?? output.format.start_time ?? "",
  )
  if (!Number.isFinite(startSec)) {
    throw new Error("Could not determine extracted audio stem start time")
  }
  return {
    startMs: Math.round(startSec * 1000),
    durationMs: Math.round(durationSec * 1000),
  }
}

async function extractedStem(
  plan: StemPlan,
  copied: boolean,
): Promise<ExtractedAudioStem> {
  return {
    index: plan.index,
    kind: plan.hint.kind,
    label: plan.hint.label,
    filePath: plan.filePath,
    codecs: copied
      ? (plan.sourceTrack.codecString ?? "mp4a.40.2")
      : "mp4a.40.2",
    sizeBytes: (await stat(plan.filePath)).size,
  }
}

function stemProgress(completed: number, count: number): number {
  if (count === 0) return 1
  return (
    INITIAL_EXTRACTION_PROGRESS_FRACTION +
    (completed / count) * (1 - INITIAL_EXTRACTION_PROGRESS_FRACTION)
  )
}
