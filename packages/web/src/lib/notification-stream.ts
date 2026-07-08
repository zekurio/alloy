import {
  notificationStreamUrl,
  parseNotificationPayload,
  type NotificationItem,
} from "@alloy/api"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { apiOrigin } from "./env"
import { bindEventSourceListeners } from "./event-source-listeners"
import { presentNotification } from "./notification-present"
import { notificationKeys, prependNotification } from "./notification-queries"

function parseSnapshot(data: string): { unreadCount: number } | null {
  try {
    const value = JSON.parse(data) as { unreadCount?: unknown }
    return typeof value.unreadCount === "number"
      ? { unreadCount: value.unreadCount }
      : null
  } catch {
    return null
  }
}

function bindNotificationStream(input: {
  source: EventSource
  queryClient: QueryClient
  navigate: (options: { to: string }) => void
  setInitialError: (next: boolean) => void
}) {
  const { source, queryClient, navigate, setInitialError } = input
  const handleSnapshot = (ev: MessageEvent<string>) => {
    const snapshot = parseSnapshot(ev.data)
    if (!snapshot) return
    setInitialError(false)
    queryClient.setQueryData(
      notificationKeys.unreadCount(),
      snapshot.unreadCount,
    )
  }
  const handleNotification = (ev: MessageEvent<string>) => {
    const event = parseNotificationPayload(ev.data)
    if (!event) return
    queryClient.setQueryData(
      notificationKeys.list(),
      (old: Parameters<typeof prependNotification>[0]) =>
        prependNotification(old, event.item),
    )
    queryClient.setQueryData<number>(
      notificationKeys.unreadCount(),
      (old) => (old ?? 0) + 1,
    )
    presentNotification(event.item, navigate)
  }
  return bindEventSourceListeners(
    source,
    { snapshot: handleSnapshot, notification: handleNotification },
    () => {
      setInitialError(true)
    },
  )
}

export function useNotificationStream({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [initialError, setInitialError] = useState(false)
  useEffect(() => {
    if (!enabled) return
    setInitialError(false)
    const source = new EventSource(notificationStreamUrl(apiOrigin()), {
      withCredentials: true,
    })
    const cleanup = bindNotificationStream({
      source,
      queryClient,
      navigate,
      setInitialError,
    })
    return () => {
      cleanup()
      source.close()
    }
  }, [enabled, navigate, queryClient])
  return { initialError }
}

export type { NotificationItem }
