import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
} from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { app } from "electron"

import type {
  RecordingCaptureMention,
  RecordingLibraryItem,
  RecordingLibraryProjectDraft,
} from "@/shared/ipc"

export interface CaptureManifest {
  version: 1
  captures: Record<string, CaptureManifestEntry>
  projectDrafts: Record<string, RecordingLibraryProjectDraft>
}

export interface CaptureManifestEntry {
  filename: string
  title: string
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  gameName: string | null
  gameIconUrl: string | null
  sizeBytes: number | null
  durationMs: number | null
  bookmarksMs?: number[]
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  /**
   * Draft upload metadata edited in the library. Optional so manifests
   * written before these fields existed keep parsing.
   */
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: RecordingLibraryItem["privacy"]
  /** Server clip id this capture was published as, once an upload finished. */
  uploadedClipId?: string | null
  /** Local play session the capture was recorded in, stamped at save time. */
  gameSessionId?: string | null
}

export function readCaptureManifest(): CaptureManifest {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), "utf8"))
    if (!isCaptureManifest(parsed)) throw new Error("Invalid manifest.")
    const record = parsed as {
      captures: Record<string, CaptureManifestEntry>
      projectDrafts?: unknown
    }
    return {
      version: 1,
      captures: record.captures,
      projectDrafts: isProjectDraftsRecord(record.projectDrafts)
        ? record.projectDrafts
        : {},
    }
  } catch {
    return { version: 1, captures: {}, projectDrafts: {} }
  }
}

export function writeCaptureManifest(manifest: CaptureManifest): void {
  try {
    const path = manifestPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (cause) {
    logger.warn("[desktop] failed to write recording library manifest:", cause)
  }
}

/**
 * Replaces a capture's recorded duration with the measured one. Replay saves
 * report the requested buffer window, which overshoots when the buffer
 * wasn't full yet; downstream seeks (filmstrip, editor) need the real value.
 * Returns true when the manifest changed.
 */
export function correctCaptureDurationMs(
  filename: string,
  durationMs: number,
): boolean {
  const manifest = readCaptureManifest()
  const entry = manifest.captures[manifestKey(filename)]
  if (!entry || entry.durationMs === durationMs) return false
  logger.info(
    `[desktop] correcting capture duration ${entry.durationMs ?? "null"}ms → ${durationMs}ms for ${filename}`,
  )
  entry.durationMs = durationMs
  entry.updatedAt = new Date().toISOString()
  writeCaptureManifest(manifest)
  return true
}

function manifestPath(): string {
  return join(app.getPath("userData"), "recording-library.json")
}

function isCaptureManifest(value: unknown): value is CaptureManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { captures?: unknown }).captures === "object" &&
    (value as { captures?: unknown }).captures !== null
  )
}

function isProjectDraftsRecord(
  value: unknown,
): value is Record<string, RecordingLibraryProjectDraft> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}
