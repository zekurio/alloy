import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { CLIP_SCRUBBER_MAX_BYTES } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import {
  captureCachePath,
  pruneCaptureCache,
} from "./recording-library-cache-files"
import { findRecordingLibraryItem } from "./recording-library-scan"

const logger = createLogger("library")

export function readRecordingScrubber(id: string): Uint8Array | null {
  const item = findRecordingLibraryItem(id)
  if (!item) return null
  const path = scrubberPathForItem(item.id, item.filename)
  if (!path) return null

  // Sized and read through one descriptor: checking the path instead would let
  // a concurrent write swap the file between the guard and the read.
  let fd: number | null = null
  try {
    fd = openSync(path, "r")
    const size = fstatSync(fd).size
    if (size === 0 || size > CLIP_SCRUBBER_MAX_BYTES) return null
    return readFileSync(fd)
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export function storeRecordingScrubber(
  id: string,
  jpegBytes: Uint8Array,
): void {
  const item = findRecordingLibraryItem(id)
  if (
    !item ||
    jpegBytes.byteLength > CLIP_SCRUBBER_MAX_BYTES ||
    !isJpeg(jpegBytes)
  ) {
    return
  }
  const out = scrubberPathForItem(item.id, item.filename)
  if (!out) return

  try {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, jpegBytes)
    pruneRecordingScrubbers(item.id, out)
  } catch (cause) {
    logger.warn("failed to store recording scrubber:", cause)
  }
}

/** Drops scrubbers generated from another version of the same capture. */
export function pruneRecordingScrubbers(id: string, keep: string): void {
  pruneCaptureCache(scrubberFolder(), id, keep)
}

function scrubberPathForItem(id: string, filename: string): string | null {
  return captureCachePath(scrubberFolder(), id, filename)
}

function scrubberFolder(): string {
  return join(app.getPath("userData"), "recording-scrubbers")
}

function isJpeg(data: Uint8Array): boolean {
  return (
    data.byteLength >= 4 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[data.byteLength - 2] === 0xff &&
    data[data.byteLength - 1] === 0xd9
  )
}
