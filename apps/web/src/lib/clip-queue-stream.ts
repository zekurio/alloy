import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { clipKeys } from "./clip-query-keys"
import { api } from "./api"
import { apiOrigin } from "./env"
import type { QueueClip, QueueEvent } from "@workspace/api"

const STREAM_URL = "/api/events/clips/queue"

function applyEvent(
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
      const row = prev[existing]!
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

function parseQueuePayload<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
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
      if (fallbackFetchRef.current) return fallbackFetchRef.current
      const hadCachedQueue =
        queryClient.getQueryData<QueueClip[]>(clipKeys.queue()) !== undefined
      void queryClient.invalidateQueries({ queryKey: clipKeys.queue() })
      const request = queryClient
        .fetchQuery({
          queryKey: clipKeys.queue(),
          queryFn: () => api.clips.fetchQueue(),
          staleTime: 0,
        })
        .then((queue) => {
          if (active) setInitialError(false)
          return queue
        })
        .catch((err: unknown) => {
          if (active && !hadCachedQueue) setInitialError(true)
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

    const url = new URL(STREAM_URL, apiOrigin()).toString()
    const source = new EventSource(url, { withCredentials: true })

    const handleSnapshot = (ev: MessageEvent<string>) => {
      const snapshot = parseQueuePayload<QueueClip[]>(ev.data)
      if (!snapshot) {
        void refreshFromFetch().catch(() => undefined)
        return
      }
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), snapshot)
      setInitialError(false)
    }

    const handleDelta = (ev: MessageEvent<string>) => {
      const event = parseQueuePayload<QueueEvent>(ev.data)
      if (!event) {
        void refreshFromFetch().catch(() => undefined)
        return
      }
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (prev) =>
        applyEvent(prev, event)
      )
    }

    source.onerror = () => {
      void refreshFromFetch().catch(() => undefined)
    }

    source.addEventListener("snapshot", handleSnapshot)
    source.addEventListener("upsert", handleDelta)
    source.addEventListener("progress", handleDelta)
    source.addEventListener("remove", handleDelta)
    // `heartbeat` lands as an unhandled event — EventSource ignores it
    // silently. Nothing to wire up.

    return () => {
      active = false
      source.removeEventListener("snapshot", handleSnapshot)
      source.removeEventListener("upsert", handleDelta)
      source.removeEventListener("progress", handleDelta)
      source.removeEventListener("remove", handleDelta)
      source.onerror = null
      source.close()
    }
  }, [enabled, queryClient])

  return { initialError }
}
