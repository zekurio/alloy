import type { AcceptedMediaContentType } from "@alloy/contracts"
import { clipStorageForKey } from "@alloy/server/storage/index"

export function stagedSourceKey(
  recordingId: string,
  contentType: AcceptedMediaContentType,
  uploadAttemptId: string,
): string {
  return `uploads/${recordingId}/${uploadAttemptId}/source${sourceExtension(contentType)}`
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

function sourceExtension(contentType: AcceptedMediaContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return ".jpg"
    case "image/png":
      return ".png"
    case "image/webp":
      return ".webp"
    case "video/mp4":
      return ".mp4"
  }
}
