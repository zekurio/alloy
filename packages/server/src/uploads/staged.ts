import type { AcceptedContentType, UploadTicket } from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { clipStorage } from "@alloy/server/storage/index"

export function clipStagedUploadKey(
  clipId: string,
  contentType: AcceptedContentType,
): string {
  return `uploads/${clipId}/source${sourceExtension(contentType)}`
}

/** Staged target for the client-rendered poster image (always webp). */
export function clipThumbStagedUploadKey(clipId: string): string {
  return `uploads/${clipId}/thumb.webp`
}

export async function mintStagedUploadUrl(input: {
  key: string
  contentType: string
  maxBytes: number
  expiresInSec: number
  userId: string
  clipId: string
}): Promise<UploadTicket> {
  return clipStorage.mintUploadUrl(input)
}

export async function resolveStagedUpload(key: string) {
  return clipStorage.resolve(key)
}

export async function downloadStagedUploadToFile(
  key: string,
  destPath: string,
): Promise<void> {
  await clipStorage.downloadToFile(key, destPath)
}

export async function deleteStagedUpload(key: string | null): Promise<void> {
  if (!key) return
  await clipStorage.delete(key)
}

export async function deleteStagedUploads(
  keys: Iterable<string | null>,
  label: string,
): Promise<void> {
  await Promise.all(
    Array.from(keys, async (key) => {
      if (!key) return
      try {
        await deleteStagedUpload(key)
      } catch (err) {
        logger.warn(`[uploads] failed to delete ${label} ${key}:`, err)
      }
    }),
  )
}

function sourceExtension(contentType: AcceptedContentType): string {
  switch (contentType) {
    case "video/mp4":
      return ".mp4"
    case "video/quicktime":
      return ".mov"
    case "video/x-matroska":
      return ".mkv"
    case "video/webm":
      return ".webm"
  }
}
