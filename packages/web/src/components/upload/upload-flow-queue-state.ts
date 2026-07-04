import { type QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { stableHue } from "@alloy/ui/lib/stable-hash"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import type { MutableRefObject } from "react"

import { absoluteClipHref } from "@/lib/app-paths"
import { removeClipDownload, useClipDownloads } from "@/lib/clip-downloads"
import {
  clipKeys,
  useInvalidateClips,
  useReEncodeClipMutation,
  useUploadQueueQuery,
} from "@/lib/clip-queries"
import { removeUploadQueueClip } from "@/lib/clip-queue-stream"
import { copyTextToClipboard } from "@/lib/clipboard"
import { alloyDesktop } from "@/lib/desktop"
import { publicOrigin } from "@/lib/env"
import { useInvalidateGames } from "@/lib/game-queries"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import {
  isDeferredPublishPayload,
  type PublishClipInput,
  type PublishPayload,
} from "./new-clip-helpers"
import {
  clearLocalCaptureClipLink,
  deleteUploadClipBestEffort,
  linkLocalCaptureToClip,
  markUploadFailedBestEffort,
  startUpload,
} from "./upload-flow-runner"
import {
  type ActiveUpload,
  downloadToQueueItem,
  localToQueueItem,
  serverToQueueItem,
} from "./upload-queue-mapping"
import type { QueueItem } from "./upload-queue-types"
import { useDismissedClips } from "./use-dismissed-clips"

function revokeUploadThumbUrl(url: string | null | undefined, label: string) {
  if (!url?.startsWith("blob:")) return
  revokeObjectUrl(url, label)
}

function useServerQueueSync(
  serverQueue: QueueClip[],
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const invalidateClips = useInvalidateClips()
  const invalidateGames = useInvalidateGames()
  const readyNotifiedRef = useRef<Set<string>>(new Set())
  const thumbNotifiedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (serverQueue.length === 0) return
    const rowsById = new Map(serverQueue.map((row) => [row.id, row]))
    let changed = false
    for (const [localId, active] of activeRef.current) {
      const clipId = active.clipId
      if (!clipId) continue
      const row = rowsById.get(clipId)
      // Only hand off once the server has taken ownership (processing/ready).
      // A row flipping to "failed" must NOT evict the local entry: it still
      // holds preparedPayload for a re-begin retry, and the failed server twin
      // stays hidden behind localClipIds until then.
      if (
        row &&
        (row.status === "processing" || row.status === "ready") &&
        active.status !== "uploading"
      ) {
        const retained = retainedThumbsRef.current.get(clipId)
        if (retained && retained !== active.thumbUrl) {
          revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
        }
        if (active.thumbUrl) {
          retainedThumbsRef.current.set(clipId, active.thumbUrl)
        }
        activeRef.current.delete(localId)
        changed = true
      }
    }
    if (changed) bump()
    let shouldInvalidateClips = false
    let shouldInvalidateGames = false
    for (const row of serverQueue) {
      if (row.hasThumb && !thumbNotifiedRef.current.has(row.id)) {
        thumbNotifiedRef.current.add(row.id)
        shouldInvalidateClips = true
      }
      if (row.status === "ready" && !readyNotifiedRef.current.has(row.id)) {
        readyNotifiedRef.current.add(row.id)
        shouldInvalidateClips = true
        shouldInvalidateGames = true
      }
    }
    if (shouldInvalidateClips) void invalidateClips()
    if (shouldInvalidateGames) void invalidateGames()
  }, [
    activeRef,
    retainedThumbsRef,
    bump,
    invalidateClips,
    invalidateGames,
    serverQueue,
  ])
}

function useCancelRow(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const queryClient = useQueryClient()
  const invalidateClips = useInvalidateClips()
  const invalidateGames = useInvalidateGames()
  return useCallback(
    (localId: string | null, clipId: string | null) => {
      if (localId) {
        const entry = activeRef.current.get(localId)
        if (entry) {
          entry.abort.abort()
          if (entry.status !== "uploading") {
            revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
            activeRef.current.delete(localId)
            bump()
            if (entry.localCaptureId && entry.clipId) {
              void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
            }
            if (entry.serverClipCreated && entry.clipId) {
              void deleteUploadClipBestEffort(
                entry.clipId,
                "local cancel",
              ).then((deleted) => {
                if (deleted) {
                  invalidateClips()
                  invalidateGames()
                }
              })
            }
          }
        }
      }
      if (clipId) {
        const retained = retainedThumbsRef.current.get(clipId)
        if (retained) {
          revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
          retainedThumbsRef.current.delete(clipId)
        }
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          removeUploadQueueClip(old, clipId),
        )
        void deleteUploadClipBestEffort(clipId, "queue cancel").then(
          (deleted) => {
            if (deleted) {
              invalidateClips()
              invalidateGames()
            }
          },
        )
      }
    },
    [
      invalidateClips,
      invalidateGames,
      queryClient,
      bump,
      activeRef,
      retainedThumbsRef,
    ],
  )
}

function useRunUpload(
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  const invalidateClips = useInvalidateClips()
  const finishActiveUpload = useCallback(
    (entry: ActiveUpload) => {
      if (entry.clipId && entry.thumbUrl) {
        retainedThumbsRef.current.set(entry.clipId, entry.thumbUrl)
      } else {
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
      }
      activeRef.current.delete(entry.localId)
      bump()
    },
    [activeRef, retainedThumbsRef, bump],
  )
  const failActiveUpload = useCallback(
    (entry: ActiveUpload, err: unknown) => {
      if ((err as Error).name === "AbortError") {
        revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
        activeRef.current.delete(entry.localId)
        bump()
        if (entry.localCaptureId && entry.clipId) {
          void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
        }
        if (entry.serverClipCreated && entry.clipId) {
          void deleteUploadClipBestEffort(entry.clipId, "upload abort").then(
            (deleted) => {
              if (deleted) invalidateClips()
            },
          )
        }
        return
      }

      if (entry.serverClipCreated && entry.clipId) {
        void markUploadFailedBestEffort(entry.clipId).finally(invalidateClips)
      } else if (entry.localCaptureId && entry.clipId) {
        void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
      }
      entry.status = "error"
      entry.errorMessage = (err as Error).message
      bump()
    },
    [activeRef, bump, invalidateClips],
  )
  const beginUpload = useCallback(
    async (entry: ActiveUpload, payload: PublishPayload) => {
      // Retained so a local failure (before or during byte upload) can retry
      // from the same prepared payload without re-running the editor flow.
      entry.preparedPayload = payload
      entry.title = payload.title
      entry.hue = stableHue(payload.title)
      entry.bytesTotal = payload.sizeBytes
      entry.bytesLoaded = 0
      entry.localCaptureId = payload.localCaptureId ?? entry.localCaptureId
      entry.thumbBlurHash = payload.thumbBlurHash ?? entry.thumbBlurHash
      if (!entry.thumbUrl) {
        entry.thumbUrl = createObjectUrl(
          payload.thumbBlob,
          "upload thumbnail URL",
        )
      }
      entry.status = "initiating"
      bump()

      const { clipId, completion } = await startUpload(
        payload,
        entry,
        bump,
        invalidateClips,
      )
      void completion.then(
        () => finishActiveUpload(entry),
        (err) => failActiveUpload(entry, err),
      )
      return clipId
    },
    [invalidateClips, bump, finishActiveUpload, failActiveUpload],
  )

  const runUpload = useCallback(
    async (input: PublishClipInput) => {
      const localId = `local-${Math.random().toString(36).slice(2)}`
      const deferred = isDeferredPublishPayload(input)
      const entry: ActiveUpload = {
        localId,
        clipId: deferred ? crypto.randomUUID() : undefined,
        localCaptureId: input.localCaptureId,
        title: input.title,
        hue: stableHue(input.title),
        bytesTotal: input.sizeBytes,
        bytesLoaded: 0,
        status: deferred ? "preparing" : "initiating",
        abort: new AbortController(),
        thumbUrl: deferred
          ? input.thumbUrl
          : createObjectUrl(input.thumbBlob, "upload thumbnail URL"),
        thumbBlurHash: input.thumbBlurHash,
      }
      activeRef.current.set(localId, entry)
      bump()

      if (deferred && entry.localCaptureId && entry.clipId) {
        void linkLocalCaptureToClip(entry.localCaptureId, entry.clipId)
      }

      if (deferred) {
        void input
          .prepare(entry.abort.signal)
          .then((payload) => {
            entry.abort.signal.throwIfAborted()
            return beginUpload(entry, payload)
          })
          .catch((err: unknown) => failActiveUpload(entry, err))

        return { clipId: entry.clipId ?? null }
      }

      try {
        const clipId = await beginUpload(entry, input)
        return { clipId }
      } catch (err) {
        failActiveUpload(entry, err)
        if ((err as Error).name === "AbortError") return { clipId: null }
        throw err
      }
    },
    [activeRef, bump, beginUpload, failActiveUpload],
  )

  const retryUpload = useCallback(
    (localId: string) => {
      const entry = activeRef.current.get(localId)
      if (!entry || entry.status !== "error" || !entry.preparedPayload) return
      const payload = entry.preparedPayload
      // A retry is a fresh attempt with a new clip id: /initiate rejects a
      // duplicate client id, so any half-created server clip is dropped first.
      const staleClipId = entry.serverClipCreated ? entry.clipId : undefined
      entry.abort = new AbortController()
      entry.clipId = undefined
      entry.serverClipCreated = false
      entry.errorMessage = undefined
      entry.bytesLoaded = 0
      entry.status = "initiating"
      bump()
      if (staleClipId) {
        void deleteUploadClipBestEffort(staleClipId, "upload retry")
      }
      void beginUpload(entry, payload).catch((err: unknown) =>
        failActiveUpload(entry, err),
      )
    },
    [activeRef, bump, beginUpload, failActiveUpload],
  )

  return { runUpload, retryUpload }
}

export function useUploadQueueState(onOpenClip: (row: QueueClip) => void) {
  const activeRef = useRef<Map<string, ActiveUpload>>(new Map())
  const retainedThumbsRef = useRef<Map<string, string>>(new Map())
  const [queueVersion, bumpState] = useReducer((n: number) => n + 1, 0)
  const bump = useCallback(() => bumpState(), [])

  const { data: serverQueueData } = useUploadQueueQuery({
    enabled: true,
  })
  const serverQueueHydrated = serverQueueData !== undefined
  const serverQueue = useMemo<QueueClip[]>(
    () => serverQueueData ?? [],
    [serverQueueData],
  )

  useEffect(() => {
    return () => {
      for (const active of activeRef.current.values()) {
        revokeUploadThumbUrl(active.thumbUrl, "local upload thumbnail URL")
      }
      activeRef.current.clear()
      for (const url of retainedThumbsRef.current.values()) {
        revokeUploadThumbUrl(url, "retained upload thumbnail URL")
      }
      retainedThumbsRef.current.clear()
    }
  }, [])

  useServerQueueSync(serverQueue, activeRef, retainedThumbsRef, bump)
  const { runUpload, retryUpload } = useRunUpload(
    activeRef,
    retainedThumbsRef,
    bump,
  )
  const cancelRow = useCancelRow(activeRef, retainedThumbsRef, bump)
  // Depend on the stable `mutate` fn, not the mutation result: `useMutation`
  // returns a fresh object every render, and an unstable dep here loops the
  // queue memo → setQueueState → context re-render cycle until React aborts.
  const reEncodeClip = useReEncodeClipMutation().mutate
  const downloads = useClipDownloads()
  const releaseRetainedThumb = useCallback(
    (clipId: string) => {
      const retained = retainedThumbsRef.current.get(clipId)
      if (!retained) return
      revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
      retainedThumbsRef.current.delete(clipId)
      bump()
    },
    [bump],
  )
  const { dismissed, dismiss } = useDismissedClips(
    serverQueue,
    serverQueueHydrated,
  )

  const queue: QueueItem[] = useMemo(() => {
    const localEntries = Array.from(activeRef.current.values())
    const localClipIds = new Set(
      localEntries.map((e) => e.clipId).filter((x): x is string => Boolean(x)),
    )
    const fromLocal = localEntries.map((e) =>
      localToQueueItem(e, {
        onCancel: () => cancelRow(e.localId, e.clipId ?? null),
        // A local failure re-begins the upload from its retained payload; a
        // server-side encode failure (a bare server row) re-encodes instead.
        onRetry:
          e.status === "error" ? () => retryUpload(e.localId) : undefined,
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
          onRetry:
            row.status === "failed"
              ? () => reEncodeClip({ clipId: row.id })
              : undefined,
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
    return [...fromDownloads, ...fromLocal, ...fromServer]
  }, [
    queueVersion,
    serverQueue,
    downloads,
    cancelRow,
    retryUpload,
    reEncodeClip,
    onOpenClip,
    dismissed,
    dismiss,
    releaseRetainedThumb,
  ])

  return {
    runUpload,
    queue,
  }
}

function clipLinkFor(row: QueueClip): string {
  return absoluteClipHref(row.gameSlug ?? null, row.id, publicOrigin())
}

async function copyClipLink(row: QueueClip): Promise<void> {
  const copied = await copyTextToClipboard(clipLinkFor(row), {
    action: "copy uploaded clip link",
  })
  if (copied) {
    toast.success(t("Link copied"))
  } else {
    toast.error(t("Couldn't copy link"))
  }
}
