import { mkdir, stat } from "node:fs/promises"

import type { ClipAudioTrackInput } from "@alloy/contracts"
import { join } from "@alloy/server/runtime/path"

import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"
import { runFfprobe } from "./ffprobe"
import { buildAudioCodecString, type MediaAudioProbe } from "./probe"

const STEM_AUDIO_BITRATE_KBPS = 192
const MAX_PACKET_COPY_TIMELINE_ERROR_MS = 60

export interface ExtractedAudioStem {
  index: number
  kind: ClipAudioTrackInput["kind"]
  label: string
  filePath: string
  codecs: string
  sizeBytes: number
}

/**
 * Extract per-source tracks from the original source into standalone M4A
 * assets. AAC tracks are packet-copied first. A trimmed copy is accepted when
 * its container duration is within 60ms of the canonical cut: one AAC frame
 * is normally 21-24ms, so this permits mux rounding while bounding player-time
 * drift to less than three frames. Larger errors are re-encoded to AAC-LC at
 * 192kbps with exact input seeking and duration.
 */
export async function extractAudioStems(options: {
  sourcePath: string
  outDir: string
  sourceTracks: readonly MediaAudioProbe[]
  hints: readonly ClipAudioTrackInput[]
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  signal?: AbortSignal
}): Promise<ExtractedAudioStem[]> {
  await mkdir(options.outDir, { recursive: true })
  const stems: ExtractedAudioStem[] = []
  for (const hintIndex of options.hints.keys()) {
    const sourceTrack = options.sourceTracks[hintIndex + 1]
    const hint = options.hints[hintIndex]
    if (!sourceTrack || !hint) {
      throw new Error("Validated audio stem metadata no longer matches probe")
    }
    const filePath = join(options.outDir, `stem-${hintIndex}.m4a`)
    const copied = sourceTrack.codec === "aac"
    await runStemFfmpeg({
      ...options,
      sourceAudioIndex: sourceTrack.index,
      filePath,
      copy: copied,
    })

    const copyAccurate = await stemTimelineAccurate(
      filePath,
      options.canonicalDurationMs,
      options.trim,
      options.signal,
    )
    if (copied && !copyAccurate) {
      await runStemFfmpeg({
        ...options,
        sourceAudioIndex: sourceTrack.index,
        filePath,
        copy: false,
      })
    }
    const finalAccurate =
      copied && copyAccurate
        ? true
        : await stemTimelineAccurate(
            filePath,
            options.canonicalDurationMs,
            options.trim,
            options.signal,
          )
    if (!finalAccurate) {
      throw new Error("Extracted audio stem does not match playback timeline")
    }

    stems.push({
      index: hintIndex,
      kind: hint.kind,
      label: hint.label,
      filePath,
      codecs:
        copied && copyAccurate
          ? (sourceTrack.codecString ?? "mp4a.40.2")
          : "mp4a.40.2",
      sizeBytes: (await stat(filePath)).size,
    })
  }
  return stems
}

async function runStemFfmpeg(options: {
  sourcePath: string
  sourceAudioIndex: number
  filePath: string
  copy: boolean
  trim?: { startMs: number; endMs: number }
  canonicalDurationMs: number
  signal?: AbortSignal
}): Promise<void> {
  const seekArgs = options.trim
    ? ["-ss", (options.trim.startMs / 1000).toFixed(6)]
    : []
  const durationArgs = options.trim
    ? ["-t", ((options.trim.endMs - options.trim.startMs) / 1000).toFixed(6)]
    : []
  // Output-side seek discards copied AAC packets before the requested bound;
  // re-encoding uses fast input-side seek and resolves the exact sample itself.
  const inputArgs = options.copy
    ? ["-i", options.sourcePath, ...seekArgs]
    : [...seekArgs, "-i", options.sourcePath]
  await runFfmpeg({
    timeoutMs: transcodeTimeoutMs(options.canonicalDurationMs),
    signal: options.signal,
    args: [
      "-v",
      "error",
      "-y",
      ...inputArgs,
      ...durationArgs,
      "-map",
      `0:a:${options.sourceAudioIndex}`,
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      options.copy ? "copy" : "aac",
      ...(options.copy
        ? []
        : ["-b:a", `${STEM_AUDIO_BITRATE_KBPS}k`, "-profile:a", "aac_low"]),
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      options.filePath,
    ],
  })
}

async function stemTimelineAccurate(
  filePath: string,
  canonicalDurationMs: number,
  trim: { startMs: number; endMs: number } | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!trim) return true
  return (
    Math.abs((await probeDurationMs(filePath, signal)) - canonicalDurationMs) <=
    MAX_PACKET_COPY_TIMELINE_ERROR_MS
  )
}

async function probeDurationMs(
  filePath: string,
  signal?: AbortSignal,
): Promise<number> {
  const output = await runFfprobe(filePath, signal)
  const duration = Number.parseFloat(output.format.duration ?? "")
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine extracted audio stem duration")
  }
  const stream = output.streams.find(
    (candidate) => candidate.codec_type === "audio",
  )
  if (!stream || !buildAudioCodecString(stream)) {
    throw new Error("Extracted audio stem has no supported audio stream")
  }
  return Math.round(duration * 1000)
}
