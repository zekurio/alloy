import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { stableHue } from "@workspace/ui/lib/stable-hash"
import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { absoluteClipHref } from "@/lib/app-paths"
import { copyTextToClipboard } from "@/lib/clipboard"
import { clientLogger } from "@/lib/client-log"
import { publicOrigin } from "@/lib/env"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { removeUploadQueueClip } from "@/lib/clip-queue-stream"
import { type QueueClip, uploadToTicket } from "@workspace/api"
import {
  type ActiveUpload,
  localToQueueItem,
  serverToQueueItem,
} from "./upload-queue-mapping"
import type { PublishPayload } from "./new-clip-helpers"
import type { QueueItem } from "./upload-queue"
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
): Promise<void> {
  const initiate = await api.clips.initiate({
    filename: payload.file.name,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    title: payload.title,
    description: payload.description ?? undefined,
    gameId: payload.gameId,
    privacy: payload.privacy,
    mentionedUserIds: payload.mentionedUserIds.length > 0
      ? payload.mentionedUserIds
      : undefined,
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

  entry.status = "finalizing"
  bump()

  await api.clips.finalize(clipId)
  void invalidateClips()
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
        queryClient.setQueryData<QueueClip[]>(
          clipKeys.queue(),
          (old) => removeUploadQueueClip(old, clipId),
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
      }
      activeRef.current.set(localId, entry)
      bump()

      try {
        await performUpload(payload, entry, bump, invalidateClips)
        if (entry.clipId && entry.thumbUrl) {
          retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
        } else {
          revokeObjectUrl(entry.thumbUrl, "local upload thumbnail URL")
        }
        activeRef.current.delete(localId)
        bump()
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          revokeObjectUrl(entry.thumbUrl, "local upload thumbnail URL")
          activeRef.current.delete(localId)
          bump()
          if (entry.clipId) {
            void deleteUploadClipBestEffort(entry.clipId, "upload abort")
          }
          return
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
      localToQueueItem(e, () => cancelRow(e.localId, e.clipId ?? null))
    )
    const fromServer = serverQueue
      .filter((row) => !localClipIds.has(row.id) && !dismissed.has(row.id))
      .map((row) =>
        serverToQueueItem(row, {
          onCancel: () => cancelRow(null, row.id),
          onOpen: row.status === "ready" ? () => onOpenClip(row) : undefined,
          onCopyLink: row.status === "ready"
            ? () => copyClipLink(row)
            : undefined,
          onDismiss: row.status === "ready"
            ? () => {
              releaseRetainedThumb(row.id)
              dismiss(row.id)
            }
            : undefined,
          thumbFallbackUrl: retainedThumbsRef.current.get(row.id),
          onThumbLoad: () => releaseRetainedThumb(row.id),
        })
      )
    return [...fromLocal, ...fromServer]
  }, [
    serverQueue,
    cancelRow,
    onOpenClip,
    dismissed,
    dismiss,
    releaseRetainedThumb,
  ])

  const activeCount = queue.filter(
    (q) => q.status !== "published" && q.status !== "failed",
  ).length

  const clearCompleted = React.useCallback(() => {
    const readyIds = serverQueue
      .filter((r) => r.status === "ready" && !dismissed.has(r.id))
      .map((r) => r.id)
    for (const id of readyIds) {
      releaseRetainedThumb(id)
    }
    dismissMany(readyIds)
  }, [serverQueue, dismissed, dismissMany, releaseRetainedThumb])

  return {
    runUpload,
    queue,
    activeCount,
    clearCompleted,
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
