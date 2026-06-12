import { type QueueClip, uploadToTicket } from "@alloy/api"
import { stableHue } from "@alloy/ui/lib/stable-hash"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { api } from "@/lib/api"
import { absoluteClipHref } from "@/lib/app-paths"
import { clientLogger } from "@/lib/client-log"
import { removeClipDownload, useClipDownloads } from "@/lib/clip-downloads"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { removeUploadQueueClip } from "@/lib/clip-queue-stream"
import {
  cancelClipSyncItem,
  clipSyncSupported,
  pauseClipSync,
  resumeClipSync,
  retryClipSyncItem,
  useClipSync,
} from "@/lib/clip-sync"
import { copyTextToClipboard } from "@/lib/clipboard"
import { alloyDesktop, notifyLibraryCapturesChanged } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { PublishPayload } from "./new-clip-helpers"
import { isCompletedQueueStatus, type QueueItem } from "./upload-queue"
import {
  type ActiveUpload,
  downloadToQueueItem,
  localToQueueItem,
  serverToQueueItem,
  syncToQueueItem,
} from "./upload-queue-mapping"
import { useDismissedClips } from "./use-dismissed-clips"

async function deleteUploadClipBestEffort(
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

async function markUploadFailedBestEffort(clipId: string): Promise<void> {
  try {
    await api.clips.markUploadFailed(clipId)
  } catch (cause) {
    clientLogger.warn(
      `[upload] Failed to mark clip ${clipId} as failed after upload error.`,
      cause,
    )
  }
}

async function performUpload(
  payload: PublishPayload,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void,
): Promise<string> {
  const initiate = await api.clips.initiate({
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
  entry.status = "uploading"
  bump()

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

  // The poster image is small and the desktop client always renders one, so
  // ship it alongside the video; the server publishes it as-is rather than
  // extracting a frame. A failed poster upload must not sink the clip.
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

  if (payload.localCaptureId) {
    void linkLocalCaptureToClip(payload.localCaptureId, clipId)
  }

  return clipId
}

/**
 * Records the server clip id on the desktop capture it was published from,
 * so the library can collapse the local/uploaded pair into one entry.
 * Best-effort — a missed link only leaves a duplicate card.
 */
async function linkLocalCaptureToClip(
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

function useServerQueueSync(
  serverQueue: QueueClip[],
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const invalidateClips = useInvalidateClips()
  const readyNotifiedRef = React.useRef<Set<string>>(new Set())
  const thumbNotifiedRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    if (serverQueue.length === 0) return
    const seen = new Set(serverQueue.map((r) => r.id))
    let changed = false
    for (const [localId, active] of activeRef.current) {
      if (
        active.clipId &&
        seen.has(active.clipId) &&
        active.status !== "uploading"
      ) {
        const retained = retainedThumbsRef.current.get(active.clipId)
        if (retained && retained !== active.thumbUrl) {
          revokeObjectUrl(retained, "retained upload thumbnail URL")
        }
        if (active.thumbUrl) {
          retainedThumbsRef.current.set(active.clipId, active.thumbUrl)
        }
        activeRef.current.delete(localId)
        changed = true
      }
    }
    if (changed) bump()
    let shouldInvalidateClips = false
    for (const row of serverQueue) {
      if (row.hasThumb && !thumbNotifiedRef.current.has(row.id)) {
        thumbNotifiedRef.current.add(row.id)
        shouldInvalidateClips = true
      }
      if (row.status === "ready" && !readyNotifiedRef.current.has(row.id)) {
        readyNotifiedRef.current.add(row.id)
        shouldInvalidateClips = true
      }
    }
    if (shouldInvalidateClips) void invalidateClips()
  }, [activeRef, retainedThumbsRef, bump, invalidateClips, serverQueue])
}

function useCancelRow(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const queryClient = useQueryClient()
  const invalidateClips = useInvalidateClips()
  return React.useCallback(
    (localId: string | null, clipId: string | null) => {
      if (localId) {
        const entry = activeRef.current.get(localId)
        if (entry) {
          entry.abort.abort()
          if (entry.status !== "uploading") {
            revokeObjectUrl(entry.thumbUrl, "local upload thumbnail URL")
            activeRef.current.delete(localId)
            bump()
            if (entry.clipId) {
              void deleteUploadClipBestEffort(entry.clipId, "local cancel")
            }
          }
        }
      }
      if (clipId) {
        const retained = retainedThumbsRef.current.get(clipId)
        if (retained) {
          revokeObjectUrl(retained, "retained upload thumbnail URL")
          retainedThumbsRef.current.delete(clipId)
        }
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          removeUploadQueueClip(old, clipId),
        )
        void deleteUploadClipBestEffort(clipId, "queue cancel").then(
          (deleted) => {
            if (deleted) invalidateClips()
          },
        )
      }
    },
    [invalidateClips, queryClient, bump, activeRef, retainedThumbsRef],
  )
}

function useRunUpload(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const invalidateClips = useInvalidateClips()
  return React.useCallback(
    async (payload: PublishPayload) => {
      const localId = `local-${Math.random().toString(36).slice(2)}`
      const entry: ActiveUpload = {
        localId,
        title: payload.title,
        hue: stableHue(payload.title),
        bytesTotal: payload.sizeBytes,
        bytesLoaded: 0,
        status: "initiating",
        abort: new AbortController(),
        thumbUrl: createObjectUrl(payload.thumbBlob, "upload thumbnail URL"),
        thumbBlurHash: payload.thumbBlurHash,
      }
      activeRef.current.set(localId, entry)
      bump()

      try {
        const clipId = await performUpload(
          payload,
          entry,
          bump,
          invalidateClips,
        )
        if (entry.clipId && entry.thumbUrl) {
          retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
        } else {
          revokeObjectUrl(entry.thumbUrl, "local upload thumbnail URL")
        }
        activeRef.current.delete(localId)
        bump()
        return { clipId }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          revokeObjectUrl(entry.thumbUrl, "local upload thumbnail URL")
          activeRef.current.delete(localId)
          bump()
          if (entry.clipId) {
            void deleteUploadClipBestEffort(entry.clipId, "upload abort")
          }
          return { clipId: null }
        }
        if (entry.clipId) {
          void markUploadFailedBestEffort(entry.clipId)
        }
        entry.status = "error"
        entry.errorMessage = (err as Error).message
        bump()
        throw err
      }
    },
    [invalidateClips, bump, activeRef, retainedThumbsRef],
  )
}

export function useUploadQueueState(
  queueOpen: boolean,
  onOpenClip: (row: QueueClip) => void,
) {
  const activeRef = React.useRef<Map<string, ActiveUpload>>(new Map())
  const retainedThumbsRef = React.useRef<Map<string, string>>(new Map())
  const [, bumpState] = React.useReducer((n: number) => n + 1, 0)
  const bump = React.useCallback(() => bumpState(), [])

  const { data: serverQueueData, stream } = useUploadQueueQuery({
    enabled: true,
  })
  const serverQueueHydrated = serverQueueData !== undefined
  const queueStreamFailed = stream.initialError
  const serverQueue = React.useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData],
  )

  React.useEffect(() => {
    return () => {
      for (const active of activeRef.current.values()) {
        revokeObjectUrl(active.thumbUrl, "local upload thumbnail URL")
      }
      activeRef.current.clear()
      for (const url of retainedThumbsRef.current.values()) {
        revokeObjectUrl(url, "retained upload thumbnail URL")
      }
      retainedThumbsRef.current.clear()
    }
  }, [])

  useServerQueueSync(serverQueue, activeRef, retainedThumbsRef, bump)
  const runUpload = useRunUpload(activeRef, retainedThumbsRef, bump)
  const cancelRow = useCancelRow(activeRef, retainedThumbsRef, bump)
  const downloads = useClipDownloads()
  const sync = useClipSync()
  const releaseRetainedThumb = React.useCallback(
    (clipId: string) => {
      const retained = retainedThumbsRef.current.get(clipId)
      if (!retained) return
      revokeObjectUrl(retained, "retained upload thumbnail URL")
      retainedThumbsRef.current.delete(clipId)
      bump()
    },
    [bump],
  )
  const { dismissed, dismiss, dismissMany } = useDismissedClips(
    serverQueue,
    serverQueueHydrated,
  )

  const queue: QueueItem[] = React.useMemo(() => {
    const localEntries = Array.from(activeRef.current.values())
    const localClipIds = new Set(
      localEntries.map((e) => e.clipId).filter((x): x is string => Boolean(x)),
    )
    const fromLocal = localEntries.map((e) =>
      localToQueueItem(e, () => cancelRow(e.localId, e.clipId ?? null)),
    )
    // Desktop sync queue (auto-sync after gaming). Once an item finalizes,
    // its server queue row tells the rest of the story — drop the sync row.
    const serverIds = new Set(serverQueue.map((row) => row.id))
    const fromSync = sync.items
      .filter(
        (item) =>
          !(item.clipId && serverIds.has(item.clipId)) &&
          item.status !== "completed",
      )
      .map((item) =>
        syncToQueueItem(item, sync.paused, sync.blockedReason, {
          onCancel: () => cancelClipSyncItem(item.captureId),
          onRetry: () => retryClipSyncItem(item.captureId),
        }),
      )
    const fromServer = serverQueue
      .filter((row) => !localClipIds.has(row.id) && !dismissed.has(row.id))
      .map((row) =>
        serverToQueueItem(row, {
          onCancel: () => cancelRow(null, row.id),
          onOpen: row.status === "ready" ? () => onOpenClip(row) : undefined,
          onCopyLink:
            row.status === "ready" ? () => copyClipLink(row) : undefined,
          onDismiss:
            row.status === "ready"
              ? () => {
                  releaseRetainedThumb(row.id)
                  dismiss(row.id)
                }
              : undefined,
          thumbFallbackUrl: retainedThumbsRef.current.get(row.id),
          onThumbLoad: () => releaseRetainedThumb(row.id),
        }),
      )
    // Downloads (clips persisting back to this device) share the surface
    // with uploads; they lead the list while active so progress stays visible.
    const fromDownloads = downloads.map((download) =>
      downloadToQueueItem(download, {
        onCancel: () => removeClipDownload(download.clipId),
        onOpen: download.libraryItemId
          ? () => {
              void alloyDesktop()?.recording.revealLibraryCapture(
                download.libraryItemId as string,
              )
            }
          : undefined,
        onDismiss:
          download.status !== "downloading"
            ? () => removeClipDownload(download.clipId)
            : undefined,
      }),
    )
    return [...fromDownloads, ...fromSync, ...fromLocal, ...fromServer]
  }, [
    serverQueue,
    downloads,
    sync,
    cancelRow,
    onOpenClip,
    dismissed,
    dismiss,
    releaseRetainedThumb,
  ])

  const activeCount = queue.filter(
    (q) =>
      !isCompletedQueueStatus(q.status) &&
      q.status !== "failed" &&
      q.status !== "paused",
  ).length

  const onToggleSyncPause = React.useCallback(() => {
    if (sync.paused) {
      resumeClipSync()
    } else {
      pauseClipSync()
    }
  }, [sync.paused])

  // Show the pause control whenever the desktop sync queue is in play: it
  // has items, or it's paused (so it can be resumed even when drained).
  const syncPaused =
    clipSyncSupported() && (sync.items.length > 0 || sync.paused)
      ? sync.paused
      : null

  const clearCompleted = React.useCallback(() => {
    const readyIds = serverQueue
      .filter((r) => r.status === "ready" && !dismissed.has(r.id))
      .map((r) => r.id)
    for (const id of readyIds) {
      releaseRetainedThumb(id)
    }
    dismissMany(readyIds)
    for (const download of downloads) {
      if (download.status === "completed") removeClipDownload(download.clipId)
    }
  }, [serverQueue, dismissed, dismissMany, releaseRetainedThumb, downloads])

  return {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
    syncPaused,
    onToggleSyncPause,
    isQueueLoading: queueOpen && !serverQueueHydrated && !queueStreamFailed,
    isQueueUnavailable: queueOpen && !serverQueueHydrated && queueStreamFailed,
  }
}

function clipLinkFor(row: QueueClip): string {
  return absoluteClipHref(row.gameSlug, row.id, publicOrigin())
}

async function copyClipLink(row: QueueClip): Promise<void> {
  const copied = await copyTextToClipboard(clipLinkFor(row), {
    action: "copy uploaded clip link",
  })
  if (copied) {
    toast.success("Link copied")
  } else {
    toast.error("Couldn't copy link")
  }
}
