import { readdirSync, rmSync, statSync, type Dirent, type Stats } from "node:fs"
import { extname, join } from "node:path"

import {
  thumbnailSignature,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"

/**
 * The thumbnail cache stores one JPEG per capture version, named after the
 * capture's mtime/size signature so editing the file invalidates the old
 * entry. Path derivation and the prune sweep live here so cache users cannot
 * drift apart.
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
 * Drops every cached thumbnail for a capture except `keepPath`. Pass an empty
 * path to clear all of them after deleting the capture.
 */
export function pruneCaptureCache(
  folder: string,
  id: string,
  keepPath: string,
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
    if (path === keepPath) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}
