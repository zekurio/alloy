import * as React from "react"
import {
  queryOptions,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query"

import { clipKeys } from "./clip-query-keys"
import { api } from "./api"
import { clientLogger } from "./client-log"
import { apiOrigin } from "./env"
import { bindEventSourceListeners } from "./event-source-listeners"
import {
  parseQueueEventPayload,
  parseQueueSnapshotPayload,
  uploadQueueStreamUrl,
  type QueueClip,
  type QueueEvent,
} from "@workspace/api"

export function uploadQueueQueryOptions() {
  return queryOptions({
    queryKey: clipKeys.queue(),
    queryFn: () => api.clips.fetchQueue(),
    refetchInterval: 15_000,
    staleTime: 5_000,
  })
}

function applyUploadQueueEvent(
  prev: QueueClip[] | undefined,
  event: QueueEvent
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
  clipId: string
): QueueClip[] | undefined {
  return applyUploadQueueEvent(prev, { type: "remove", id: clipId })
}

function fetchUploadQueueFallback(input: {
  queryClient: QueryClient
  fallbackFetchRef: React.MutableRefObject<Promise<QueueClip[]> | null>
  active: () => boolean
  setInitialError: (next: boolean) => void
}) {
  const { queryClient, fallbackFetchRef, active, setInitialError } = input
  if (fallbackFetchRef.current) return fallbackFetchRef.current
  const hadCachedQueue =
    queryClient.getQueryData<QueueClip[]>(clipKeys.queue()) !== undefined
  void queryClient.invalidateQueries({ queryKey: clipKeys.queue() })
  const request = queryClient
    .fetchQuery({ ...uploadQueueQueryOptions(), staleTime: 0 })
    .then((queue) => {
      if (active()) setInitialError(false)
      return queue
    })
    .catch((err: unknown) => {
      if (active() && !hadCachedQueue) setInitialError(true)
      throw err
    })
    .finally(() => {
      if (fallbackFetchRef.current === request) {
        fallbackFetchRef.current = null
      }
    })
  fallbackFetchRef.current = request
  return request
}

function bindUploadQueueStream(input: {
  source: EventSource
  queryClient: QueryClient
  requestRefresh: (reason: string) => void
  setInitialError: (next: boolean) => void
}) {
  const { source, queryClient, requestRefresh, setInitialError } = input
  const handleSnapshot = (ev: MessageEvent<string>) => {
    const snapshot = parseQueueSnapshotPayload(ev.data)
    if (!snapshot) {
      requestRefresh("Ignoring malformed snapshot payload")
      return
    }
    queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), snapshot)
    setInitialError(false)
  }

  const handleDelta = (ev: MessageEvent<string>) => {
    const event = parseQueueEventPayload(ev.data)
    if (!event) {
      requestRefresh("Ignoring malformed event payload")
      return
    }
    queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (prev) =>
      applyUploadQueueEvent(prev, event)
    )
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
      requestRefresh("Event stream disconnected")
    }
  )
}

export function useUploadQueueStream({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const [initialError, setInitialError] = React.useState(false)
  const fallbackFetchRef = React.useRef<Promise<QueueClip[]> | null>(null)

  React.useEffect(() => {
    setInitialError(false)
    if (!enabled) return

    let active = true

    const refreshFromFetch = () => {
      return fetchUploadQueueFallback({
        queryClient,
        fallbackFetchRef,
        active: () => active,
        setInitialError,
      })
    }

    const requestRefresh = (reason: string) => {
      void refreshFromFetch().catch((cause) => {
        clientLogger.warn(`[upload-queue] ${reason}; refresh failed.`, cause)
      })
    }

    const url = uploadQueueStreamUrl(apiOrigin())
    const source = new EventSource(url, { withCredentials: true })
    const removeListeners = bindUploadQueueStream({
      source,
      queryClient,
      requestRefresh,
      setInitialError,
    })
    // `heartbeat` lands as an unhandled event — EventSource ignores it
    // silently. Nothing to wire up.

    return () => {
      active = false
      removeListeners()
      source.close()
    }
  }, [enabled, queryClient])

  return { initialError }
}
