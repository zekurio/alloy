import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type {
  RecordingCaptureAudioTrack,
  RecordingCaptureKind,
  RecordingCaptureMention,
  RecordingCaptureSource,
  RecordingGameGuess,
  RecordingLibraryItem,
} from "@alloy/contracts"
import { normalizeCaptureAudioTracks } from "@alloy/contracts/desktop-recording-normalizers"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { parseUntrustedRecord, type UntrustedInput } from "./runtime-validation"

const logger = createLogger("library")

export interface CaptureManifest {
  version: 2
  captures: Record<string, CaptureManifestEntry>
}

export interface CaptureManifestEntry {
  /** Stable renderer-facing id for this capture. */
  id: string
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
  /** Omitted for captures recorded with only the fallback mix track. */
  audioTracks?: RecordingCaptureAudioTrack[]
  createdAt: string
  updatedAt: string
  /** Draft upload metadata edited in the library. */
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: RecordingLibraryItem["privacy"]
  /** Server clip id this capture was published as, once an upload finished. */
  uploadedClipId?: string | null
  /** Non-destructive trim range; cleared trims omit both fields. */
  trimStartMs?: number
  trimEndMs?: number
}

export function readCaptureManifest(): CaptureManifest {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), "utf8"))
    if (!isCaptureManifest(parsed)) throw new Error("Invalid manifest.")
    return {
      version: 2,
      captures: Object.fromEntries(
        Object.entries(parsed.captures).map(([key, entry]) => [
          key,
          {
            ...entry,
            audioTracks: normalizeCaptureAudioTracks(entry.audioTracks),
          },
        ]),
      ),
    }
  } catch {
    return { version: 2, captures: {} }
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
 * wasn't full yet; downstream editing needs the real value. Returns true
 * when the manifest changed.
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

function isCaptureManifest(value: UntrustedInput): value is CaptureManifest {
  const manifest = parseUntrustedRecord(value)
  return (
    manifest?.version === 2 && parseUntrustedRecord(manifest.captures) !== null
  )
}

export function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}
