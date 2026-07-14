import { type QueueClip } from "@alloy/api"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useReducer, useRef } from "react"
import type { MutableRefObject } from "react"

import { clipKeys, useInvalidateClips } from "@/lib/clip-queries"
import { removeUploadQueueClip } from "@/lib/clip-queue-stream"
import { useInvalidateGames } from "@/lib/game-queries"

import {
  clearLocalCaptureClipLink,
  deleteUploadClipBestEffort,
} from "./upload-flow-runner"
import type { ActiveUpload } from "./upload-queue-mapping"
import { revokeUploadThumbUrl } from "./upload-thumbnail-urls"

export function useUploadQueueRuntime() {
  const activeRef = useRef<Map<string, ActiveUpload>>(new Map())
  const retainedThumbsRef = useRef<Map<string, string>>(new Map())
  const [queueVersion, bumpState] = useReducer((n: number) => n + 1, 0)
  const bump = useCallback(() => bumpState(), [])

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

  return { activeRef, retainedThumbsRef, queueVersion, bump }
}

export function useServerQueueSync(
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
    if (handoffServerOwnedUploads(serverQueue, activeRef, retainedThumbsRef)) {
      bump()
    }
    const invalidations = recordServerQueueUpdates(
      serverQueue,
      readyNotifiedRef.current,
      thumbNotifiedRef.current,
    )
    if (invalidations.clips) void invalidateClips()
    if (invalidations.games) void invalidateGames()
  }, [
    activeRef,
    retainedThumbsRef,
    bump,
    invalidateClips,
    invalidateGames,
    serverQueue,
  ])
}

function handoffServerOwnedUploads(
  serverQueue: QueueClip[],
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
) {
  const rowsById = new Map(serverQueue.map((row) => [row.id, row]))
  let changed = false
  for (const [localId, active] of activeRef.current) {
    if (!active.clipId) continue
    const row = rowsById.get(active.clipId)
    // Failed rows remain local because the active entry owns the retry payload.
    if (
      !row ||
      (row.status !== "processing" && row.status !== "ready") ||
      active.status === "uploading"
    ) {
      continue
    }
    const retained = retainedThumbsRef.current.get(active.clipId)
    if (retained && retained !== active.thumbUrl) {
      revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
    }
    if (active.thumbUrl) {
      retainedThumbsRef.current.set(active.clipId, active.thumbUrl)
    }
    activeRef.current.delete(localId)
    changed = true
  }
  return changed
}

function recordServerQueueUpdates(
  serverQueue: QueueClip[],
  readyNotified: Set<string>,
  thumbNotified: Set<string>,
) {
  let clips = false
  let games = false
  for (const row of serverQueue) {
    if (row.hasThumb && !thumbNotified.has(row.id)) {
      thumbNotified.add(row.id)
      clips = true
    }
    if (row.status === "ready" && !readyNotified.has(row.id)) {
      readyNotified.add(row.id)
      clips = true
      games = true
    }
  }
  return { clips, games }
}

export function useCancelQueueRow(
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
        cancelLocalUpload(
          localId,
          activeRef,
          bump,
          invalidateClips,
          invalidateGames,
        )
      }
      if (clipId) {
        releaseRetainedThumbnail(clipId, retainedThumbsRef)
        queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (old) =>
          removeUploadQueueClip(old, clipId),
        )
        deleteCancelledClip(clipId, invalidateClips, invalidateGames)
      }
    },
    [
      activeRef,
      retainedThumbsRef,
      bump,
      invalidateClips,
      invalidateGames,
      queryClient,
    ],
  )
}

function cancelLocalUpload(
  localId: string,
  activeRef: MutableRefObject<Map<string, ActiveUpload>>,
  bump: () => void,
  invalidateClips: () => void,
  invalidateGames: () => void,
) {
  const entry = activeRef.current.get(localId)
  if (!entry) return
  entry.abort.abort()
  if (entry.status === "uploading") return

  revokeUploadThumbUrl(entry.thumbUrl, "local upload thumbnail URL")
  activeRef.current.delete(localId)
  bump()
  if (entry.localCaptureId && entry.clipId) {
    void clearLocalCaptureClipLink(entry.localCaptureId, entry.clipId)
  }
  if (entry.serverClipCreated && entry.clipId) {
    void deleteUploadClipBestEffort(entry.clipId, "local cancel").then(
      (deleted) => {
        if (deleted) {
          invalidateClips()
          invalidateGames()
        }
      },
    )
  }
}

function releaseRetainedThumbnail(
  clipId: string,
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
) {
  const retained = retainedThumbsRef.current.get(clipId)
  if (!retained) return false
  revokeUploadThumbUrl(retained, "retained upload thumbnail URL")
  retainedThumbsRef.current.delete(clipId)
  return true
}

function deleteCancelledClip(
  clipId: string,
  invalidateClips: () => void,
  invalidateGames: () => void,
) {
  void deleteUploadClipBestEffort(clipId, "queue cancel").then((deleted) => {
    if (deleted) {
      invalidateClips()
      invalidateGames()
    }
  })
}

export function useReleaseRetainedThumbnail(
  retainedThumbsRef: MutableRefObject<Map<string, string>>,
  bump: () => void,
) {
  return useCallback(
    (clipId: string) => {
      if (releaseRetainedThumbnail(clipId, retainedThumbsRef)) bump()
    },
    [retainedThumbsRef, bump],
  )
}
