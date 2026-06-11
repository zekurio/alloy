import { existsSync, mkdirSync, statSync, type Stats } from "node:fs"
import { basename, dirname, extname, join } from "node:path"

import { logger } from "alloy-logging"
import { app } from "electron"

import type {
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
} from "../shared/ipc"
import { runFfmpeg, runFfprobe } from "./ffmpeg"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  captureId,
  clampMs,
  contentTypeForFile,
  EXPORT_HOST,
  ffmpegSeconds,
  MEDIA_PROTOCOL,
  thumbnailSignature,
} from "./recording-library-shared"
import { ensureCaptureBlurHash } from "./recording-library-thumbnails"

/**
 * Edited exports rendered to the userData export folder, keyed by export id,
 * so the capture protocol can serve them back to the renderer.
 */
export const exportedCaptureFiles = new Map<string, string>()

/** Smallest segment and total an export may carry. */
const EXPORT_MIN_SEGMENT_MS = 100
const EXPORT_MIN_TOTAL_MS = 1000

export async function exportRecordingLibraryItem(
  request: RecordingLibraryExportRequest,
) {
  const item = findRecordingLibraryItem(request.id)
  if (!item) throw new Error("Capture not found.")
  if (item.kind === "screenshot") {
    throw new Error("Screenshots cannot be uploaded as clips yet.")
  }

  const sourceDurationMs = item.durationMs
  if (!sourceDurationMs || sourceDurationMs <= 0) {
    throw new Error("Could not determine capture duration.")
  }

  const segments = sanitizeExportSegments(request.segments, sourceDurationMs)
  const totalMs = segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs),
    0,
  )
  if (segments.length === 0 || totalMs < EXPORT_MIN_TOTAL_MS) {
    throw new Error("The selection is too short to export.")
  }

  const fullSource =
    segments.length === 1 &&
    segments[0].startMs <= 50 &&
    segments[0].endMs >= sourceDurationMs - 50

  // The source capture's hash is a representative placeholder for edited
  // exports too; the server recomputes the canonical one while processing.
  const thumbBlurHash = await ensureCaptureBlurHash(item)

  if (fullSource) {
    return {
      id: item.id,
      mediaUrl: item.mediaUrl,
      fileName: item.fileName,
      contentType: contentTypeForFile(item.fileName),
      sizeBytes: item.sizeBytes,
      durationMs: sourceDurationMs,
      width: item.width,
      height: item.height,
      thumbBlurHash,
    }
  }

  const segmentsKey = segments
    .map((segment) => `${segment.startMs}-${segment.endMs}`)
    .join(",")
  const exportId = captureId(
    `${item.filename}:${statSync(item.filename).mtimeMs}:${segmentsKey}`,
  )
  const fileName = exportFileName(item.fileName, segments)
  const out = join(exportFolder(), `${exportId}.mp4`)
  mkdirSync(dirname(out), { recursive: true })

  if (!existsSync(out) || statSync(out).size === 0) {
    if (segments.length === 1) {
      await trimRecordingCapture(
        item.filename,
        out,
        segments[0].startMs,
        segments[0].endMs,
      )
    } else {
      await concatRecordingCaptureSegments(item.filename, out, segments)
    }
  }

  const stat = statSync(out)
  exportedCaptureFiles.set(exportId, out)

  return {
    id: exportId,
    mediaUrl: `${MEDIA_PROTOCOL}://${EXPORT_HOST}/${exportId}`,
    fileName,
    contentType: "video/mp4",
    sizeBytes: stat.size,
    durationMs: totalMs,
    width: item.width,
    height: item.height,
    thumbBlurHash,
  }
}

/**
 * Clamps every segment into the media bounds and drops degenerate ones.
 * Order is preserved — it's the playback order of the edited sequence.
 */
function sanitizeExportSegments(
  segments: RecordingLibraryExportSegment[],
  sourceDurationMs: number,
): RecordingLibraryExportSegment[] {
  return segments
    .map((segment) => {
      const startMs = clampMs(segment.startMs, 0, sourceDurationMs)
      return {
        startMs,
        endMs: clampMs(segment.endMs, startMs, sourceDurationMs),
      }
    })
    .filter(
      (segment) => segment.endMs - segment.startMs >= EXPORT_MIN_SEGMENT_MS,
    )
}

/* ─── Keyframe probing ─────────────────────────────────────────────── */

const KEYFRAME_CACHE_MAX = 32
const keyframeCache = new Map<string, Promise<number[]>>()

/**
 * Returns the capture's video keyframe (I-frame) positions in milliseconds,
 * sorted ascending, for the editor timeline. Results are cached per file
 * signature (id + mtime + size); failures return an empty list because the
 * markers are purely informational.
 */
export async function getRecordingLibraryCaptureKeyframes(
  id: string,
): Promise<number[]> {
  const item = findRecordingLibraryItem(id)
  if (!item || item.kind === "screenshot") return []

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return []
  }

  const key = thumbnailSignature(item.id, stat)
  const pending = keyframeCache.get(key)
  if (pending) return pending

  const task = probeCaptureKeyframes(item.filename).catch((cause) => {
    keyframeCache.delete(key)
    logger.warn("[desktop] capture keyframe probe failed:", cause)
    return []
  })
  // Evict the oldest entry instead of growing across the whole library.
  if (keyframeCache.size >= KEYFRAME_CACHE_MAX) {
    const oldest = keyframeCache.keys().next().value
    if (oldest !== undefined) keyframeCache.delete(oldest)
  }
  keyframeCache.set(key, task)
  return task
}

/** Reads packet headers only (no decode), so long captures stay fast. */
async function probeCaptureKeyframes(filename: string): Promise<number[]> {
  const stdout = await runFfprobe(
    [
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=print_section=0",
      filename,
    ],
    { timeout: 60_000 },
  )

  const keyframes: number[] = []
  for (const line of stdout.split("\n")) {
    const [pts, flags] = line.trim().split(",")
    if (!flags?.includes("K")) continue
    const seconds = Number.parseFloat(pts)
    if (Number.isFinite(seconds)) keyframes.push(Math.round(seconds * 1000))
  }
  keyframes.sort((a, b) => a - b)
  return keyframes
}

async function trimRecordingCapture(
  input: string,
  output: string,
  trimStartMs: number,
  trimEndMs: number,
): Promise<void> {
  const start = ffmpegSeconds(trimStartMs)
  const duration = ffmpegSeconds(trimEndMs - trimStartMs)

  try {
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start,
        "-i",
        input,
        "-t",
        duration,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 120_000 },
    )
  } catch (cause) {
    logger.warn("[desktop] stream-copy trim failed; retrying encode:", cause)
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start,
        "-i",
        input,
        "-t",
        duration,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 300_000 },
    )
  }
}

/**
 * Renders an edited sequence (cut + reordered segments) in one re-encode
 * pass via filter_complex trim/concat. Stream copy can't express
 * frame-accurate cuts or reordering, so multi-segment exports always
 * re-encode.
 */
async function concatRecordingCaptureSegments(
  input: string,
  output: string,
  segments: RecordingLibraryExportSegment[],
): Promise<void> {
  const hasAudio = await captureHasAudioStream(input)

  const filters: string[] = []
  const concatInputs: string[] = []
  segments.forEach((segment, index) => {
    const start = ffmpegSeconds(segment.startMs)
    const end = ffmpegSeconds(segment.endMs)
    filters.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
    )
    if (hasAudio) {
      filters.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
      )
    }
    concatInputs.push(hasAudio ? `[v${index}][a${index}]` : `[v${index}]`)
  })
  filters.push(
    `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}` +
      (hasAudio ? "[v][a]" : "[v]"),
  )

  await runFfmpeg(
    [
      "-y",
      "-i",
      input,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      ...(hasAudio ? ["-map", "[a]"] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags",
      "+faststart",
      output,
    ],
    { timeout: 600_000 },
  )
}

async function captureHasAudioStream(filename: string): Promise<boolean> {
  try {
    const stdout = await runFfprobe(
      [
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        filename,
      ],
      { timeout: 30_000 },
    )
    return stdout.trim().length > 0
  } catch (cause) {
    logger.warn("[desktop] audio stream probe failed:", cause)
    return false
  }
}

function exportFolder(): string {
  return join(app.getPath("userData"), "recording-exports")
}

function exportFileName(
  fileName: string,
  segments: RecordingLibraryExportSegment[],
): string {
  const base = basename(fileName, extname(fileName)) || "clip"
  if (segments.length === 1) {
    const [segment] = segments
    return `${base}-${Math.round(segment.startMs / 1000)}-${Math.round(segment.endMs / 1000)}.mp4`
  }
  return `${base}-edited.mp4`
}
