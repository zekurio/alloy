import { existsSync, mkdirSync, statSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"

import { app } from "electron"

import type {
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
} from "@/shared/ipc"

import { trimMp4 } from "./media"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  captureId,
  clampMs,
  contentTypeForFile,
  EXPORT_HOST,
  MEDIA_PROTOCOL,
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
  // Multi-cut sequences re-encode; that lives in the editor's render
  // pipeline, which imports its result back into the library for publishing.
  if (segments.length > 1) {
    throw new Error(
      "Multi-segment exports are not supported here — open the capture in the editor to cut and publish.",
    )
  }

  const fullSource =
    segments.length === 1 &&
    segments[0].startMs <= 50 &&
    segments[0].endMs >= sourceDurationMs - 50

  // The source capture's hash is a representative placeholder for edited
  // exports too. If it is missing, the publish flow hashes the exact poster
  // blob before initiating the upload.
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
      thumbUrl: item.thumbnailUrl,
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
    // Packet copy — the cut start snaps to the preceding keyframe.
    // Frame-accurate cuts go through the editor's render pipeline instead.
    await trimMp4(item.filename, out, {
      startMs: segments[0].startMs,
      endMs: segments[0].endMs,
    })
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
    // The source capture's poster stands in for the trimmed export; the web
    // layer falls back to capturing a frame from the file when it's missing.
    thumbUrl: item.thumbnailUrl,
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
