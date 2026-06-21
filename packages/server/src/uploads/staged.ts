import type { AcceptedContentType, UploadTicket } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { clipStorage } from "@alloy/server/storage/index"

const logger = createLogger("uploads")

export function stagedSourceKey(
  recordingId: string,
  contentType: AcceptedContentType,
): string {
  return `uploads/${recordingId}/source${sourceExtension(contentType)}`
}

/** Staged target for the client-rendered poster image. */
export function stagedThumbKey(recordingId: string): string {
  return `uploads/${recordingId}/thumb.jpg`
}

export async function mintStagedUploadUrl(input: {
  key: string
  contentType: string
  maxBytes: number
  expiresInSec: number
  userId: string
  clipId: string
  role: "video" | "thumb"
}): Promise<UploadTicket> {
  return clipStorage.mintUploadUrl(input)
}

export async function mintStagedUpload(input: {
  key: string
  contentType: string
  maxBytes: number
  expiresInSec: number
  userId: string
  clipId: string
  role: "video" | "thumb"
}) {
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
  await clipStorage.abortUpload({ key })
  await clipStorage.delete(key)
}

export async function deleteStagedUploads(
  keys: Iterable<string | { key: string | null } | null>,
  label: string,
): Promise<void> {
  await Promise.all(
    Array.from(keys, async (entry) => {
      const key =
        typeof entry === "string" || entry === null ? entry : entry.key
      if (!key) return
      try {
        await deleteStagedUpload(key)
      } catch (err) {
        logger.warn(`failed to delete ${label} ${key}:`, err)
      }
    }),
  )
}

function sourceExtension(contentType: AcceptedContentType): string {
  switch (contentType) {
    case "video/mp4":
      return ".mp4"
  }
}
