import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import {
  clipKeys,
  useInvalidateClips,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { uploadToTicket, type QueueClip } from "@workspace/api"
import {
  hueFor,
  localToQueueItem,
  serverToQueueItem,
  type ActiveUpload,
} from "./upload-queue-mapping"
import type { PublishPayload } from "./new-clip-helpers"
import type { QueueItem } from "./upload-queue"
import { useDismissedClips } from "./use-dismissed-clips"

async function performUpload(
  payload: PublishPayload,
  entry: ActiveUpload,
  bump: () => void,
  invalidateClips: () => void
): Promise<void> {
  const { clipId, ticket, thumbTicket } = await api.clips.initiate({
    filename: payload.file.name,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    title: payload.title,
    description: payload.description ?? undefined,
    gameId: payload.gameId,
    privacy: payload.privacy,
    trimStartMs: payload.trimStartMs ?? undefined,
    trimEndMs: payload.trimEndMs ?? undefined,
    thumbSizeBytes: payload.thumbBlob.size,
    mentionedUserIds:
      payload.mentionedUserIds.length > 0
        ? payload.mentionedUserIds
        : undefined,
  })

  entry.clipId = clipId
  entry.status = "uploading"
  bump()

  await uploadToTicket(
    ticket,
    payload.file,
    (loaded, total) => {
      entry.bytesLoaded = loaded
      entry.bytesTotal = total
      bump()
    },
    entry.abort.signal
  )

  await uploadToTicket(
    thumbTicket,
    payload.thumbBlob,
    () => undefined,
    entry.abort.signal
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
  bump: () => void
) {
  const invalidateClips = useInvalidateClips()
  const readyNotifiedRef = React.useRef<Set<string>>(new Set())
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
          URL.revokeObjectURL(retained)
        }
        retainedThumbsRef.current.set(active.clipId, active.thumbUrl)
        activeRef.current.delete(localId)
        changed = true
      }
    }
    if (changed) bump()
    let becameReady = false
    for (const row of serverQueue) {
      if (row.status === "ready" && !readyNotifiedRef.current.has(row.id)) {
        readyNotifiedRef.current.add(row.id)
        becameReady = true
      }
    }
    if (becameReady) void invalidateClips()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverQueue])
}

function useCancelRow(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
  bump: () => void
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
            URL.revokeObjectURL(entry.thumbUrl)
            activeRef.current.delete(localId)
            bump()
            if (entry.clipId) {
              void api.clips.delete(entry.clipId).catch(() => undefined)
            }
          }
        }
      }
      if (clipId) {
        const retained = retainedThumbsRef.current.get(clipId)
        if (retained) {
          URL.revokeObjectURL(retained)
          retainedThumbsRef.current.delete(clipId)
        }
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          old ? old.filter((r) => r.id !== clipId) : old
        )
        void api.clips
          .delete(clipId)
          .then(() => invalidateClips())
          .catch(() => undefined)
      }
    },
    [invalidateClips, queryClient, bump, activeRef, retainedThumbsRef]
  )
}

function useRunUpload(
  activeRef: React.MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: React.MutableRefObject<Map<string, string>>,
  bump: () => void
) {
  const invalidateClips = useInvalidateClips()
  return React.useCallback(
    async (payload: PublishPayload) => {
      const localId = `local-${Math.random().toString(36).slice(2)}`
      const entry: ActiveUpload = {
        localId,
        title: payload.title,
        hue: hueFor(payload.title),
        bytesTotal: payload.sizeBytes,
        bytesLoaded: 0,
        status: "initiating",
        abort: new AbortController(),
        thumbUrl: URL.createObjectURL(payload.thumbBlob),
      }
      activeRef.current.set(localId, entry)
      bump()

      try {
        await performUpload(payload, entry, bump, invalidateClips)
        if (entry.clipId) {
          retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
        } else {
          URL.revokeObjectURL(entry.thumbUrl)
        }
        activeRef.current.delete(localId)
        bump()
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          URL.revokeObjectURL(entry.thumbUrl)
          activeRef.current.delete(localId)
          bump()
          if (entry.clipId) {
            void api.clips.delete(entry.clipId).catch(() => undefined)
          }
          return
        }
        if (entry.clipId) {
          void api.clips.delete(entry.clipId).catch(() => undefined)
        }
        entry.status = "error"
        entry.errorMessage = (err as Error).message
        bump()
        throw err
      }
    },
    [invalidateClips, bump, activeRef, retainedThumbsRef]
  )
}

export function useUploadQueueState(
  queueOpen: boolean,
  onOpenClip: (row: QueueClip) => void
) {
  const activeRef = React.useRef<Map<string, ActiveUpload>>(new Map())
  const retainedThumbsRef = React.useRef<Map<string, string>>(new Map())
  const [, bumpState] = React.useReducer((n: number) => n + 1, 0)
  const bump = React.useCallback(() => bumpState(), [])

  const { data: serverQueueData, stream } = useUploadQueueQuery({
    enabled: queueOpen,
  })
  const serverQueueHydrated = serverQueueData !== undefined
  const queueStreamFailed = stream.initialError
  const serverQueue = React.useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData]
  )

  React.useEffect(() => {
    return () => {
      for (const active of activeRef.current.values()) {
        URL.revokeObjectURL(active.thumbUrl)
      }
      activeRef.current.clear()
      for (const url of retainedThumbsRef.current.values()) {
        URL.revokeObjectURL(url)
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
      URL.revokeObjectURL(retained)
      retainedThumbsRef.current.delete(clipId)
      bump()
    },
    [bump]
  )
  const { dismissed, dismiss, dismissMany } = useDismissedClips(serverQueue)

  const queue: QueueItem[] = React.useMemo(() => {
    const localEntries = Array.from(activeRef.current.values())
    const localClipIds = new Set(
      localEntries.map((e) => e.clipId).filter((x): x is string => Boolean(x))
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
    (q) => q.status !== "published" && q.status !== "failed"
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
  return `${window.location.origin}/g/${row.gameSlug}/c/${row.id}`
}

async function copyClipLink(row: QueueClip): Promise<void> {
  try {
    await navigator.clipboard.writeText(clipLinkFor(row))
    toast.success("Link copied")
  } catch {
    toast.error("Couldn't copy link")
  }
}
