import type { StorageDeletionNamespace } from "@alloy/db/schema"

/** Keep deletion intents on the same physical namespace as normal clip IO. */
export function clipKeyDeletionNamespace(
  key: string,
): Extract<StorageDeletionNamespace, "clips" | "thumbnails"> {
  const filename = key.slice(key.lastIndexOf("/") + 1).toLowerCase()
  return filename === "thumb.jpg" ||
    filename === "thumb-small.jpg" ||
    (filename.startsWith("thumb-") && filename.endsWith(".jpg"))
    ? "thumbnails"
    : "clips"
}
