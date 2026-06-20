import { uploadToTicket } from "@alloy/api"

import { api } from "@/lib/api"
import { clientLogger } from "@/lib/client-log"
import { alloyDesktop, notifyLibraryCapturesChanged } from "@/lib/desktop"

import type { PublishPayload } from "./new-clip-helpers"
import type { ActiveUpload } from "./upload-queue-mapping"

export async function deleteUploadClipBestEffort(
  clipId: string,
  reason: string,
): Promise<boolean> {
  try {
    await api.clips.delete(clipId)
    return true
  } catch (cause) {
    clientLogger.warn(
      `[upload] Failed to delete clip ${clipId} after ${reason}.`,
      cause,
    )
    return false
  }
}

export async function markUploadFailedBestEffort(
  clipId: string,
): Promise<void> {
  try {
    await api.clips.markUploadFailed(clipId)
  } catch (cause) {
    clientLogger.warn(
      `[upload] Failed to mark clip ${clipId} as failed after upload error.`,
      cause,
    )
  }
}

export async function startUpload(
  payload: PublishPayload,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void,
): Promise<{ clipId: string; completion: Promise<void> }> {
  if (!alloyDesktop()) {
    throw new Error("Uploads are only available in Alloy Desktop.")
  }

  const localClipId = entry.clipId ?? crypto.randomUUID()
  entry.clipId = localClipId
  bump()

  const initiate = await api.clips.initiate({
    clientClipId: localClipId,
    filename: payload.file.name,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    title: payload.title,
    description: payload.description ?? undefined,
    steamgriddbId: payload.steamgriddbId,
    privacy: payload.privacy,
    mentionedUserIds:
      payload.mentionedUserIds.length > 0
        ? payload.mentionedUserIds
        : undefined,
    tags: payload.tags.length > 0 ? payload.tags : undefined,
    thumbBlurHash: payload.thumbBlurHash ?? undefined,
  })
  const { clipId } = initiate

  entry.clipId = clipId
  entry.serverClipCreated = true
  entry.abort.signal.throwIfAborted()
  entry.status = "uploading"
  bump()
  void invalidateClips()
  if (payload.localCaptureId) {
    void linkLocalCaptureToClip(payload.localCaptureId, clipId)
  }

  return {
    clipId,
    completion: completeUpload(payload, initiate, entry, bump, invalidateClips),
  }
}

async function completeUpload(
  payload: PublishPayload,
  initiate: Awaited<ReturnType<typeof api.clips.initiate>>,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void,
): Promise<void> {
  const { clipId } = initiate

  await uploadToTicket(
    initiate.ticket,
    payload.file,
    (loaded, total) => {
      entry.bytesLoaded = loaded
      entry.bytesTotal = total
      bump()
    },
    entry.abort.signal,
  )

  try {
    await uploadToTicket(
      initiate.thumbTicket,
      payload.thumbBlob,
      () => undefined,
      entry.abort.signal,
    )
  } catch (cause) {
    if ((cause as Error).name === "AbortError") throw cause
    clientLogger.warn(
      `[upload] Failed to upload poster for clip ${clipId}; continuing.`,
      cause,
    )
  }

  entry.status = "finalizing"
  bump()

  await api.clips.finalize(clipId)
  void invalidateClips()
}

export async function linkLocalCaptureToClip(
  captureId: string,
  clipId: string,
): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop) return
  try {
    await desktop.recording.updateLibraryCapture({
      id: captureId,
      uploadedClipId: clipId,
    })
    notifyLibraryCapturesChanged()
  } catch (cause) {
    clientLogger.warn(
      `[upload] Failed to link capture ${captureId} to clip ${clipId}.`,
      cause,
    )
  }
}

export async function clearLocalCaptureClipLink(
  captureId: string,
  clipId: string,
): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop) return
  try {
    await desktop.recording.updateLibraryCapture({
      id: captureId,
      uploadedClipId: null,
    })
    notifyLibraryCapturesChanged()
  } catch (cause) {
    clientLogger.warn(
      `[upload] Failed to clear capture ${captureId} link to clip ${clipId}.`,
      cause,
    )
  }
}
