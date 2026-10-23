import { EXT_FOR_CONTENT_TYPE } from "@alloy/server/users/user-assets"

/** Rejects an empty, oversized, or unsupported image upload before reading it. */
export function imageFileError(
  file: File,
  limit: { label: string; maxBytes: number },
): { ok: false; status: 400 | 413; error: string } | null {
  if (file.size === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (file.size > limit.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${limit.label} too large. Max ${limit.maxBytes / 1024 / 1024} MB`,
    }
  }
  if (!Object.hasOwn(EXT_FOR_CONTENT_TYPE, file.type)) {
    return { ok: false, status: 400, error: "Unsupported image type" }
  }
  return null
}
