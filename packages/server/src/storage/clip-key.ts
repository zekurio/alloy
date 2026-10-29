import type { StorageDeletionNamespace } from "@alloy/db/schema"
import { thumbnailVariantBase } from "@alloy/server/media/thumbnail-variants"

/** Keep deletion intents on the same physical namespace as normal clip IO. */
export function clipKeyDeletionNamespace(
  key: string,
): Extract<StorageDeletionNamespace, "clips" | "thumbnails"> {
  // A thumbnail's resized variants live beside it.
  const thumbKey = thumbnailVariantBase(key) ?? key
  const filename = thumbKey.slice(thumbKey.lastIndexOf("/") + 1).toLowerCase()
  return filename.startsWith("thumb-") && filename.endsWith(".jpg")
    ? "thumbnails"
    : "clips"
}
