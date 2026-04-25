import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
  NotificationEvent,
  NotificationRow,
  NotificationsResponse,
} from "@workspace/api"
import { toast } from "@workspace/ui/lib/toast"

import { api } from "./api"
import { apiOrigin } from "./env"

const STREAM_URL = "/api/events/notifications"

export const notificationKeys = {
  all: ["notifications"] as const,
  list: () => [...notificationKeys.all, "list"] as const,
}

export function useNotificationsQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => api.notifications.fetch(),
    enabled,
  })
}

export function useMarkNotificationReadMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: (row) => {
      qc.setQueryData<NotificationsResponse>(notificationKeys.list(), (old) => {
        if (!old) return old
        const wasUnread = old.items.some(
          (item) => item.id === row.id && item.readAt === null
        )
        return {
          unreadCount: wasUnread
            ? Math.max(0, old.unreadCount - 1)
            : old.unreadCount,
          items: old.items.map((item) => (item.id === row.id ? row : item)),
        }
      })
    },
  })
}

export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: ({ readAt, unreadCount }) => {
      qc.setQueryData<NotificationsResponse>(notificationKeys.list(), (old) =>
        old
          ? {
              unreadCount,
              items: old.items.map((item) =>
                item.readAt ? item : { ...item, readAt }
              ),
            }
          : old
      )
    },
  })
}

export function useDeleteNotificationMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.notifications.delete(id).then((result) => ({ ...result, id })),
    onSuccess: ({ id, unreadCount }) => {
      qc.setQueryData<NotificationsResponse>(notificationKeys.list(), (old) =>
        old
          ? {
              unreadCount,
              items: old.items.filter((item) => item.id !== id),
            }
          : old
      )
    },
  })
}

export function useClearNotificationsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.notifications.clear(),
    onSuccess: ({ unreadCount }) => {
      qc.setQueryData<NotificationsResponse>(notificationKeys.list(), (old) =>
        old ? { unreadCount, items: [] } : old
      )
    },
  })
}

export function useNotificationStream({
  enabled,
  includeSnapshot = true,
}: {
  enabled: boolean
  includeSnapshot?: boolean
}) {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!enabled) return

    const url = new URL(STREAM_URL, apiOrigin())
    if (!includeSnapshot) url.searchParams.set("snapshot", "false")
    const source = new EventSource(url, { withCredentials: true })

    const handleEvent = (ev: MessageEvent<string>) => {
      const event = JSON.parse(ev.data) as NotificationEvent
      queryClient.setQueryData<NotificationsResponse>(
        notificationKeys.list(),
        (old) => applyNotificationEvent(old, event)
      )
      if (event.type === "upsert") {
        toastNotification(event.notification)
      }
    }

    source.addEventListener("snapshot", handleEvent)
    source.addEventListener("upsert", handleEvent)
    source.addEventListener("read", handleEvent)
    source.addEventListener("read_all", handleEvent)
    source.addEventListener("remove", handleEvent)
    source.addEventListener("clear", handleEvent)

    return () => {
      source.removeEventListener("snapshot", handleEvent)
      source.removeEventListener("upsert", handleEvent)
      source.removeEventListener("read", handleEvent)
      source.removeEventListener("read_all", handleEvent)
      source.removeEventListener("remove", handleEvent)
      source.removeEventListener("clear", handleEvent)
      source.close()
    }
  }, [enabled, includeSnapshot, queryClient])
}

function applyNotificationEvent(
  old: NotificationsResponse | undefined,
  event: NotificationEvent
): NotificationsResponse | undefined {
  switch (event.type) {
    case "snapshot":
      return event.payload
    case "upsert": {
      const current = old ?? { items: [], unreadCount: event.unreadCount }
      const existing = current.items.findIndex(
        (item) => item.id === event.notification.id
      )
      if (existing === -1) {
        return {
          unreadCount: event.unreadCount,
          items: [event.notification, ...current.items],
        }
      }
      const items = current.items.slice()
      items[existing] = event.notification
      return { unreadCount: event.unreadCount, items }
    }
    case "read":
      return old
        ? {
            unreadCount: event.unreadCount,
            items: old.items.map((item) =>
              item.id === event.id ? { ...item, readAt: event.readAt } : item
            ),
          }
        : old
    case "read_all":
      return old
        ? {
            unreadCount: event.unreadCount,
            items: old.items.map((item) =>
              item.readAt ? item : { ...item, readAt: event.readAt }
            ),
          }
        : old
    case "remove":
      return old
        ? {
            unreadCount: event.unreadCount,
            items: old.items.filter((item) => item.id !== event.id),
          }
        : old
    case "clear":
      return old ? { unreadCount: event.unreadCount, items: [] } : old
  }
}

function toastNotification(row: NotificationRow) {
  if (row.type !== "clip_upload_failed") return

  const text = notificationText(row)
  toast.error(text.title, {
    description: text.body,
    id: `notification:${row.id}`,
  })
}

export function notificationText(row: NotificationRow): {
  title: string
  body: string
} {
  const actor =
    row.actor?.displayUsername ||
    row.actor?.username ||
    row.actor?.name ||
    "Someone"
  const clipTitle = row.clip?.title ?? "your clip"

  switch (row.type) {
    case "clip_upload_failed":
      return { title: "Clip upload failed", body: clipTitle }
    case "new_follower":
      return { title: "New follower", body: `${actor} followed you.` }
    case "clip_comment":
      return {
        title: "New comment",
        body: `${actor} commented on ${clipTitle}.`,
      }
    case "comment_reply":
      return {
        title: "New reply",
        body: `${actor} replied to your comment on ${clipTitle}.`,
      }
    case "comment_pinned":
      return {
        title: "Comment pinned",
        body: `${actor} pinned your comment on ${clipTitle}.`,
      }
    case "comment_liked_by_author":
      return {
        title: "Comment liked",
        body: `${actor} liked your comment on ${clipTitle}.`,
      }
  }
}

export function notificationHref(row: NotificationRow): string | null {
  if (row.type === "new_follower" && row.actor) {
    return `/u/${row.actor.username}`
  }
  if (!row.clip) return null
  const slug = row.clip.gameSlug ?? row.clip.slug
  return `/g/${slug}/c/${row.clip.id}`
}
