import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs"
import { dirname, extname, join } from "node:path"

import type { RecordingLibraryItem } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app, nativeImage } from "electron"

import { imageFileBlurHash } from "./image-blurhash"
import {
  captureCachePath,
  pruneCaptureCache,
} from "./recording-library-cache-files"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  thumbnailSignature,
  MEDIA_EXTENSIONS,
} from "./recording-library-shared"
import {
  pruneThumbnailBlurHashes,
  rememberThumbnailBlurHash,
} from "./recording-thumbnail-meta"

const logger = createLogger("library")

export type ThumbnailSource = Pick<
  RecordingLibraryItem,
  "id" | "kind" | "filename"
>

export function cachedRecordingThumbnail(item: ThumbnailSource): string | null {
  const out = captureCachePath(thumbnailFolder(), item.id, item.filename)
  if (!out) return null
  if (!existsSync(out) && item.kind === "screenshot") {
    const image = nativeImage.createFromPath(item.filename)
    if (image.isEmpty()) return null
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(
      out,
      image.resize({ width: Math.min(960, image.getSize().width) }).toJPEG(85),
    )
    pruneStaleThumbnails(item.id, out)
  }
  if (!existsSync(out)) return null
  return out
}

export function storeRecordingThumbnail(
  id: string,
  jpegBytes: Uint8Array,
): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return
  if (!MEDIA_EXTENSIONS.has(extname(item.filename).toLowerCase())) return

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
  pruneCaptureCache(thumbnailFolder(), id, keep)
}

function thumbnailPath(id: string, stat: Stats): string {
  return join(thumbnailFolder(), `${thumbnailSignature(id, stat)}.jpg`)
}

function thumbnailFolder(): string {
  return join(app.getPath("userData"), "recording-thumbnails")
}
