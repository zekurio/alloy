import { normalizeSelectedServerUrl } from "./app-protocol-policy"

export const MAX_CLIP_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024
const DOWNLOAD_SIZE_TOLERANCE_BYTES = 1024 * 1024

export function clipDownloadByteLimit(expectedBytes: number | null): number {
  if (expectedBytes === null) return MAX_CLIP_DOWNLOAD_BYTES
  if (expectedBytes > MAX_CLIP_DOWNLOAD_BYTES) {
    throw new Error("The clip exceeds the desktop download limit.")
  }
  const tolerance = Math.max(
    DOWNLOAD_SIZE_TOLERANCE_BYTES,
    Math.ceil(expectedBytes * 0.01),
  )
  return Math.min(MAX_CLIP_DOWNLOAD_BYTES, expectedBytes + tolerance)
}

export function selectedServerClipDownloadUrl(
  clipId: string,
  serverUrl: string,
): string | null {
  const serverOrigin = normalizeSelectedServerUrl(serverUrl)
  if (!serverOrigin || !/^[0-9a-f-]{36}$/i.test(clipId)) return null
  return new URL(
    `/api/clips/${encodeURIComponent(clipId)}/download`,
    serverOrigin,
  ).toString()
}
