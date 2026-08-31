import type { AcceptedContentType, UploadTicket } from "@alloy/contracts"
import { clipStorage, clipStorageForKey } from "@alloy/server/storage/index"

export function stagedSourceKey(
  recordingId: string,
  contentType: AcceptedContentType,
  uploadAttemptId: string,
): string {
  return `uploads/${recordingId.toLowerCase()}/${uploadAttemptId.toLowerCase()}/source${sourceExtension(contentType)}`
}

export async function mintStagedUpload(input: {
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
  return clipStorageForKey(key).resolve(key)
}

export async function downloadStagedUploadToFile(
  key: string,
  destPath: string,
): Promise<void> {
  await clipStorageForKey(key).downloadToFile(key, destPath)
}

export async function deleteStagedUpload(key: string | null): Promise<void> {
  if (!key) return
  const storage = clipStorageForKey(key)
  await storage.abortUpload({ key })
  await storage.delete(key)
}

function sourceExtension(contentType: AcceptedContentType): string {
  switch (contentType) {
    case "video/mp4":
      return ".mp4"
  }
}
