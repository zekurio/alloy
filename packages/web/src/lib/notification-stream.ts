import {
  notificationStreamUrl,
  parseNotificationPayload,
  type NotificationItem,
} from "@alloy/api"
import { t } from "@alloy/contracts/schema"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { apiOrigin } from "./env"
import { bindEventSourceListeners } from "./event-source-listeners"
import { presentNotification } from "./notification-present"
import { notificationKeys, prependNotification } from "./notification-queries"

const NotificationSnapshotSchema = t.object({ unreadCount: t.number() })

function parseSnapshot(data: string): { unreadCount: number } | null {
  try {
    const result = NotificationSnapshotSchema.safeParse(JSON.parse(data))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function bindNotificationStream(input: {
  source: EventSource
  queryClient: QueryClient
  navigate: (options: { to: string }) => void
}) {
  const { source, queryClient, navigate } = input
  const handleSnapshot = (ev: MessageEvent<string>) => {
    const snapshot = parseSnapshot(ev.data)
    if (!snapshot) return
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
  return bindEventSourceListeners(source, {
    snapshot: handleSnapshot,
    notification: handleNotification,
  })
}

export function useNotificationStream({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(notificationStreamUrl(apiOrigin()), {
      withCredentials: true,
    })
    const cleanup = bindNotificationStream({
      source,
      queryClient,
      navigate,
    })
    return () => {
      cleanup()
      source.close()
    }
  }, [enabled, navigate, queryClient])
}

export type { NotificationItem }
