import { readdirSync, rmSync, statSync, type Dirent, type Stats } from "node:fs"
import { extname, join } from "node:path"

import {
  thumbnailSignature,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"

/**
 * The thumbnail and scrubber caches both store one JPEG per capture version,
 * named after the capture's mtime/size signature so editing the file
 * invalidates the old entry. Path derivation and the prune sweep live here so
 * the two caches cannot drift apart.
 */
export function captureCachePath(
  folder: string,
  id: string,
  filename: string,
): string | null {
  if (!VIDEO_EXTENSIONS.has(extname(filename).toLowerCase())) return null

  let stat: Stats
  try {
    stat = statSync(filename)
  } catch {
    return null
  }
  return join(folder, `${thumbnailSignature(id, stat)}.jpg`)
}

/**
 * Drops every cached entry for a capture except the kept ones: `path` keeps
 * exactly one file (thumbnail/scrubber caches), `prefix` keeps every file of
 * the capture's current signature (audio stem cache, one file per track).
 * Pass `{ path: "" }` to clear all of them (the capture itself was deleted).
 */
export function pruneCaptureCache(
  folder: string,
  id: string,
  keep: { path: string } | { prefix: string },
): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${id}-`)) continue
    const path = join(folder, entry.name)
    const kept =
      "path" in keep
        ? path === keep.path
        : keep.prefix.length > 0 && entry.name.startsWith(keep.prefix)
    if (kept) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}
