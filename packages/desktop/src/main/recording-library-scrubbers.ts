import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { dirname, extname, join } from "node:path"

import { CLIP_SCRUBBER_MAX_BYTES } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  thumbnailSignature,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"

const logger = createLogger("library")

export function readRecordingScrubber(id: string): Uint8Array | null {
  const item = findRecordingLibraryItem(id)
  if (!item) return null
  const path = scrubberPathForItem(item.id, item.filename)
  if (!path || !existsSync(path)) return null

  try {
    const cachedStat = statSync(path)
    if (cachedStat.size === 0 || cachedStat.size > CLIP_SCRUBBER_MAX_BYTES) {
      return null
    }
    return readFileSync(path)
  } catch {
    return null
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
  let entries: Dirent[]
  try {
    entries = readdirSync(scrubberFolder(), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${id}-`)) continue
    const path = join(scrubberFolder(), entry.name)
    if (path === keep) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file can be removed on the next save.
    }
  }
}

function scrubberPathForItem(id: string, filename: string): string | null {
  if (!VIDEO_EXTENSIONS.has(extname(filename).toLowerCase())) return null

  let stat: Stats
  try {
    stat = statSync(filename)
  } catch {
    return null
  }
  return join(scrubberFolder(), `${thumbnailSignature(id, stat)}.jpg`)
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
