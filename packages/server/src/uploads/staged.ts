import type { AcceptedContentType, UploadTicket } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import {
  clipStorage,
  type UploadTicketStorageState,
} from "@alloy/server/storage/index"

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
  return (await clipStorage.mintUploadUrl(input)).ticket
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

export async function deleteStagedUpload(
  key: string | null,
  uploadState: UploadTicketStorageState = null,
): Promise<void> {
  if (!key) return
  await clipStorage.abortUpload({ key, storageState: uploadState })
  await clipStorage.delete(key)
}

export async function deleteStagedUploads(
  keys: Iterable<string | { key: string | null; uploadState?: unknown } | null>,
  label: string,
): Promise<void> {
  await Promise.all(
    Array.from(keys, async (entry) => {
      const key =
        typeof entry === "string" || entry === null ? entry : entry.key
      const uploadState =
        typeof entry === "string" || entry === null
          ? null
          : parseUploadTicketStorageState(entry.uploadState)
      if (!key) return
      try {
        await deleteStagedUpload(key, uploadState)
      } catch (err) {
        logger.warn(`failed to delete ${label} ${key}:`, err)
      }
    }),
  )
}

export function parseUploadTicketStorageState(
  value: unknown,
): UploadTicketStorageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    record.type === "s3-multipart" &&
    typeof record.uploadId === "string" &&
    record.uploadId.trim()
  ) {
    return { type: "s3-multipart", uploadId: record.uploadId }
  }
  return null
}

function sourceExtension(contentType: AcceptedContentType): string {
  switch (contentType) {
    case "video/mp4":
      return ".mp4"
  }
}
