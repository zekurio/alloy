import {
  parseQueueEventPayload,
  parseQueueSnapshotPayload,
  type ClipRow,
  type QueueClip,
  type QueueEvent,
  uploadQueueStreamUrl,
} from "@alloy/api"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { clipEncodingActive } from "./clip-encoding"
import { invalidateClipCaches, patchClipInCaches } from "./clip-query-cache"
import { clipKeys } from "./clip-query-keys"
import { apiOrigin } from "./env"
import { bindEventSourceListeners } from "./event-source-listeners"

function applyUploadQueueEvent(
  prev: QueueClip[] | undefined,
  event: QueueEvent,
): QueueClip[] | undefined {
  if (!prev) {
    return event.type === "upsert" ? [event.clip] : prev
  }
  switch (event.type) {
    case "upsert": {
      const existing = prev.findIndex((row) => row.id === event.clip.id)
      if (existing === -1) {
        // New row: prepend so it slots in at the top of the queue,
        // matching the server's `orderBy createdAt desc`.
        return [event.clip, ...prev]
      }
      const next = prev.slice()
      next[existing] = event.clip
      return next
    }
    case "progress": {
      const existing = prev.findIndex((row) => row.id === event.id)
      if (existing === -1) return prev
      const row = prev[existing]
      if (!row) return prev
      if (row.encodeProgress === event.encodeProgress) return prev
      const next = prev.slice()
      next[existing] = { ...row, encodeProgress: event.encodeProgress }
      return next
    }
    case "remove": {
      const filtered = prev.filter((row) => row.id !== event.id)
      return filtered.length === prev.length ? prev : filtered
    }
  }
}

export function removeUploadQueueClip(
  prev: QueueClip[] | undefined,
  clipId: string,
): QueueClip[] | undefined {
  return applyUploadQueueEvent(prev, { type: "remove", id: clipId })
}

function queueClipPatch(row: QueueClip): Partial<ClipRow> {
  return {
    status: row.status,
    encodeActive: row.encodeActive,
    encodeProgress: row.encodeProgress,
    encodeStage: row.encodeStage,
    encodeTier: row.encodeTier,
    encodeTierIndex: row.encodeTierIndex,
    encodeTierCount: row.encodeTierCount,
    failureReason: row.failureReason,
  }
}

function syncQueueClipCaches(
  queryClient: QueryClient,
  previous: QueueClip | undefined,
  current: QueueClip,
): boolean {
  patchClipInCaches(queryClient, current.id, queueClipPatch(current))
  return Boolean(
    previous && clipEncodingActive(previous) && !clipEncodingActive(current),
  )
}

function bindUploadQueueStream(input: {
  source: EventSource
  queryClient: QueryClient
  setInitialError: (next: boolean) => void
}) {
  const { source, queryClient, setInitialError } = input
  const handleSnapshot = (ev: MessageEvent<string>) => {
    const snapshot = parseQueueSnapshotPayload(ev.data)
    if (!snapshot) {
      setInitialError(true)
      return
    }
    const previous = queryClient.getQueryData<QueueClip[]>(clipKeys.queue())
    const previousById = new Map(previous?.map((row) => [row.id, row]))
    let completed = false
    for (const row of snapshot) {
      completed =
        syncQueueClipCaches(queryClient, previousById.get(row.id), row) ||
        completed
    }
    queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), snapshot)
    if (completed) invalidateClipCaches(queryClient)
    setInitialError(false)
  }

  const handleDelta = (ev: MessageEvent<string>) => {
    const event = parseQueueEventPayload(ev.data)
    if (!event) {
      setInitialError(true)
      return
    }
    const previousQueue = queryClient.getQueryData<QueueClip[]>(
      clipKeys.queue(),
    )
    const eventClipId =
      event.type === "upsert"
        ? event.clip.id
        : event.type === "progress"
          ? event.id
          : null
    const previous = eventClipId
      ? previousQueue?.find((row) => row.id === eventClipId)
      : undefined
    queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (current) =>
      applyUploadQueueEvent(current, event),
    )

    if (event.type === "upsert") {
      if (syncQueueClipCaches(queryClient, previous, event.clip)) {
        invalidateClipCaches(queryClient)
      }
    } else if (event.type === "progress") {
      patchClipInCaches(queryClient, event.id, {
        encodeProgress: event.encodeProgress,
      })
    }
  }

  return bindEventSourceListeners(
    source,
    {
      snapshot: handleSnapshot,
      upsert: handleDelta,
      progress: handleDelta,
      remove: handleDelta,
    },
    () => {
      setInitialError(true)
    },
  )
}

export function useUploadQueueStream({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const [initialError, setInitialError] = useState(false)

  useEffect(() => {
    setInitialError(false)
    if (!enabled) return

    const url = uploadQueueStreamUrl(apiOrigin())
    const source = new EventSource(url, { withCredentials: true })
    const removeListeners = bindUploadQueueStream({
      source,
      queryClient,
      setInitialError,
    })
    // `heartbeat` lands as an unhandled event — EventSource ignores it
    // silently. Nothing to wire up.

    return () => {
      removeListeners()
      source.close()
    }
  }, [enabled, queryClient])

  return { initialError }
}
