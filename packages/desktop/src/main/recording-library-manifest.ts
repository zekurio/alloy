import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingGameGuess,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import type {
  RecordingCaptureMention,
  RecordingLibraryItem,
} from "@/shared/ipc"

const logger = createLogger("library")

export interface CaptureManifest {
  version: 1
  captures: Record<string, CaptureManifestEntry>
}

export interface CaptureManifestEntry {
  /**
   * Stable renderer-facing id. Older manifests did not store this; those
   * entries fall back to the path-derived id until the next manifest write.
   */
  id?: string
  filename: string
  title: string
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  gameName: string | null
  gameIconUrl: string | null
  gameGuess?: RecordingGameGuess | null
  sizeBytes: number | null
  durationMs: number | null
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
}

export function readCaptureManifest(): CaptureManifest {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), "utf8"))
    if (!isCaptureManifest(parsed)) throw new Error("Invalid manifest.")
    return {
      version: 1,
      captures: parsed.captures,
    }
  } catch {
    return { version: 1, captures: {} }
  }
}

export function writeCaptureManifest(manifest: CaptureManifest): void {
  try {
    const path = manifestPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (cause) {
    logger.warn("failed to write recording library manifest:", cause)
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
    `correcting capture duration ${entry.durationMs ?? "null"}ms → ${durationMs}ms for ${filename}`,
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

export function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}
