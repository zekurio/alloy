import {
  CLIP_THUMBNAIL_WIDTHS,
  type ClipThumbnailWidth,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import type { StorageDriver } from "@alloy/server/storage/driver"

import { loadSharp } from "./sharp"

const logger = createLogger("media")

const VARIANT_QUALITY = 75
const VARIANT_SUFFIX = /\.w(\d+)\.webp$/

export function thumbnailVariantKey(
  thumbKey: string,
  width: ClipThumbnailWidth,
): string {
  return `${thumbKey}.w${width}.webp`
}

/** The thumbnail a variant key was made from, or null for any other key. */
export function thumbnailVariantBase(key: string): string | null {
  const match = VARIANT_SUFFIX.exec(key)
  if (!match || parseClipThumbnailWidth(match[1]) === null) return null
  return key.slice(0, match.index)
}

/** The variant keys of a thumbnail; none for a key that is a variant. */
export function thumbnailVariantKeys(thumbKey: string): string[] {
  if (thumbnailVariantBase(thumbKey) !== null) return []
  return CLIP_THUMBNAIL_WIDTHS.map((width) =>
    thumbnailVariantKey(thumbKey, width),
  )
}

export function parseClipThumbnailWidth(
  value: string | undefined,
): ClipThumbnailWidth | null {
  return CLIP_THUMBNAIL_WIDTHS.find((width) => String(width) === value) ?? null
}

/**
 * Write a clip thumbnail and its WebP variants. Callers reserve and fence the
 * JPEG key as before: the deletion worker treats each variant as part of its
 * thumbnail, so that reservation covers the variants too.
 */
export async function putClipThumbnail(
  storage: StorageDriver,
  thumbKey: string,
  jpeg: Buffer,
): Promise<void> {
  await storage.put(thumbKey, jpeg, "image/jpeg")
  await putThumbnailVariants(storage, thumbKey, jpeg)
}

/**
 * Best effort: the thumbnail route serves the JPEG for a missing variant, so a
 * failure here only costs bandwidth, never the thumbnail.
 */
export async function putThumbnailVariants(
  storage: StorageDriver,
  thumbKey: string,
  jpeg: Buffer,
): Promise<boolean> {
  try {
    const sharp = await loadSharp()
    const image = sharp(jpeg)
    for (const width of CLIP_THUMBNAIL_WIDTHS) {
      const bytes = await image
        .clone()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: VARIANT_QUALITY })
        .toBuffer()
      await storage.put(
        thumbnailVariantKey(thumbKey, width),
        bytes,
        "image/webp",
      )
    }
    return true
  } catch (cause) {
    logger.warn(`could not write thumbnail variants for ${thumbKey}:`, cause)
    return false
  }
}
