import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { dirname, extname, join } from "node:path"

import { createLogger } from "@alloy/logging"
import { app } from "electron"

import type { RecordingLibraryItem } from "@/shared/ipc"

import { imageFileBlurHash } from "./image-blurhash"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  thumbnailSignature,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"
import {
  getThumbnailBlurHash,
  pruneThumbnailBlurHashes,
  rememberThumbnailBlurHash,
} from "./recording-thumbnail-meta"

const logger = createLogger("library")

export type ThumbnailSource = Pick<
  RecordingLibraryItem,
  "id" | "kind" | "filename"
>

export function cachedRecordingThumbnail(item: ThumbnailSource): string | null {
  if (!VIDEO_EXTENSIONS.has(extname(item.filename).toLowerCase())) return null

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const out = thumbnailPath(item.id, stat)
  if (existsSync(out)) return out
  return null
}

export function storeRecordingThumbnail(
  id: string,
  jpegBytes: Uint8Array,
): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return
  if (!VIDEO_EXTENSIONS.has(extname(item.filename).toLowerCase())) return

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return
  }

  const out = thumbnailPath(item.id, stat)
  try {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, jpegBytes)
    pruneStaleThumbnails(item.id, out)

    const signature = thumbnailSignature(item.id, stat)
    const blurHash = imageFileBlurHash(out)
    if (blurHash) {
      rememberThumbnailBlurHash(signature, blurHash)
      pruneThumbnailBlurHashes(item.id, signature)
    }
  } catch (cause) {
    logger.warn("failed to store recording thumbnail:", cause)
  }
}

/** Drops thumbnails generated from an older mtime/size of the same capture. */
export function pruneStaleThumbnails(id: string, keep: string): void {
  const folder = thumbnailFolder()
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(`${id}-`)) continue
    const path = join(folder, entry.name)
    if (path === keep) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}

/**
 * Computes (and persists) the BlurHash for a capture from its thumbnail. Hashes
 * are keyed by the same mtime/size signature as thumbnail files, so they stay
 * stable across app starts and invalidate together with the thumbnail when the
 * file changes.
 */
export async function ensureCaptureBlurHash(
  item: ThumbnailSource,
): Promise<string | null> {
  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const signature = thumbnailSignature(item.id, stat)
  const existing = getThumbnailBlurHash(signature)
  if (existing) return existing

  const imagePath = cachedRecordingThumbnail(item)
  if (!imagePath) return null

  const blurHash = imageFileBlurHash(imagePath)
  if (blurHash) {
    rememberThumbnailBlurHash(signature, blurHash)
    pruneThumbnailBlurHashes(item.id, signature)
  }
  return blurHash
}

function thumbnailPath(id: string, stat: Stats): string {
  return join(thumbnailFolder(), `${thumbnailSignature(id, stat)}.jpg`)
}

function thumbnailFolder(): string {
  return join(app.getPath("userData"), "recording-thumbnails")
}
