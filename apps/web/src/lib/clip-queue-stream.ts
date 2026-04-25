import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { clipKeys } from "./clip-query-keys"
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

export function useUploadQueueStream({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!enabled) return

    const url = new URL(STREAM_URL, apiOrigin()).toString()
    const source = new EventSource(url, { withCredentials: true })

    const handleSnapshot = (ev: MessageEvent<string>) => {
      const snapshot = JSON.parse(ev.data) as QueueClip[]
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), snapshot)
    }

    const handleDelta = (ev: MessageEvent<string>) => {
      const event = JSON.parse(ev.data) as QueueEvent
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (prev) =>
        applyEvent(prev, event)
      )
    }

    source.addEventListener("snapshot", handleSnapshot)
    source.addEventListener("upsert", handleDelta)
    source.addEventListener("progress", handleDelta)
    source.addEventListener("remove", handleDelta)
    // `heartbeat` lands as an unhandled event — EventSource ignores it
    // silently. Nothing to wire up.

    return () => {
      source.removeEventListener("snapshot", handleSnapshot)
      source.removeEventListener("upsert", handleDelta)
      source.removeEventListener("progress", handleDelta)
      source.removeEventListener("remove", handleDelta)
      source.close()
    }
  }, [enabled, queryClient])
}
