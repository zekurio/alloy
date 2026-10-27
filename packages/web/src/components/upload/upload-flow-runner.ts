import { uploadToTicket } from "@alloy/api"

import { api } from "@/lib/api"
import { clientLogger } from "@/lib/client-log"
import { alloyDesktop, notifyLibraryCapturesChanged } from "@/lib/desktop"
import { randomId } from "@/lib/random-id"

import type { PublishPayload } from "./new-clip-helpers"
import type { ActiveUpload } from "./upload-queue-mapping"

/** One run of an upload: reads its latest entry and writes changes back. */
export interface UploadAttempt {
  current: () => ActiveUpload
  update: (change: Partial<ActiveUpload>) => void
}

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
  attempt: UploadAttempt,
  invalidateClips: () => void,
): Promise<{ clipId: string; completion: Promise<void> }> {
  const localClipId = attempt.current().clipId ?? randomId()
  attempt.update({ clipId: localClipId })

  const initiate = await api.clips.initiate({
    clientClipId: localClipId,
    filename: payload.file.name,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    title: payload.title,
    description: payload.description ?? undefined,
    gameId: payload.gameId,
    privacy: payload.privacy,
    mentionedUserIds:
      payload.mentionedUserIds.length > 0
        ? payload.mentionedUserIds
        : undefined,
    tags: payload.tags.length > 0 ? payload.tags : undefined,
    width: payload.width,
    height: payload.height,
    durationMs: payload.contentType.startsWith("image/")
      ? undefined
      : Math.round(payload.durationMs),
    trimStartMs: payload.trimStartMs,
    trimEndMs: payload.trimEndMs,
  })
  const { clipId } = initiate

  attempt.update({ clipId, serverClipCreated: true })
  attempt.current().abort.signal.throwIfAborted()
  attempt.update({ status: "uploading" })
  void invalidateClips()
  if (payload.localCaptureId) {
    void linkLocalCaptureToClip(
      payload.localCaptureId,
      clipId,
      payload.localClipSource,
    )
  }

  return {
    clipId,
    completion: completeUpload(payload, initiate, attempt, invalidateClips),
  }
}

async function completeUpload(
  payload: PublishPayload,
  initiate: Awaited<ReturnType<typeof api.clips.initiate>>,
  attempt: UploadAttempt,
  invalidateClips: () => void,
): Promise<void> {
  const { clipId } = initiate

  await uploadToTicket(
    initiate.ticket,
    payload.file,
    (loaded, total) => {
      attempt.update({ bytesLoaded: loaded, bytesTotal: total })
    },
    attempt.current().abort.signal,
  )
  attempt.update({ status: "finalizing" })

  await api.clips.finalize(clipId)
  void invalidateClips()
}

export async function linkLocalCaptureToClip(
  captureId: string,
  clipId: string,
  source?: { startMs: number; durationMs: number },
): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop) return
  try {
    await desktop.recording.updateLibraryCapture({
      id: captureId,
      uploadedClipId: clipId,
      uploadedClipSourceStartMs: source?.startMs ?? null,
      uploadedClipSourceDurationMs: source?.durationMs ?? null,
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
