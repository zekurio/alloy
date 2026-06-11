import {
  type NotificationEvent,
  type NotificationRow,
  type NotificationsResponse,
  notificationStreamUrl,
  parseNotificationEventPayload,
} from "@alloy/api"
import { toast } from "@alloy/ui/lib/toast"
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as React from "react"

import { api } from "./api"
import { clipHref, userProfileHref } from "./app-paths"
import { clientLogger } from "./client-log"
import { apiOrigin } from "./env"
import { bindEventSourceListeners } from "./event-source-listeners"

const notificationKeys = {
  all: ["notifications"] as const,
  list: () => [...notificationKeys.all, "list"] as const,
}

export function useNotificationsQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...notificationListQueryOptions(),
    enabled,
  })
}

function notificationListQueryOptions() {
  return queryOptions({
    queryKey: notificationKeys.list(),
    queryFn: () => api.notifications.fetch(),
  })
}

export function useMarkNotificationReadMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: (row) => {
      qc.setQueryData<NotificationsResponse>(notificationKeys.list(), (old) => {
        return replaceNotificationRow(old, row)
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
        markAllNotificationsReadInCache(old, readAt, unreadCount),
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
        removeNotificationFromCache(old, id, unreadCount),
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
        clearNotificationsInCache(old, unreadCount),
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

    const url = notificationStreamUrl({ includeSnapshot, origin: apiOrigin() })
    const source = new EventSource(url, { withCredentials: true })
    let refreshRequested = false
    const refreshFromFetch = () => {
      if (refreshRequested) return
      refreshRequested = true
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list() })
      void queryClient
        .fetchQuery(notificationListQueryOptions())
        .catch((cause) => {
          clientLogger.warn(
            "[notifications] Failed to refresh notification list.",
            cause,
          )
        })
        .finally(() => {
          refreshRequested = false
        })
    }

    const handleEvent = (ev: MessageEvent<string>) => {
      const event = parseNotificationEvent(ev.data, refreshFromFetch)
      if (!event) return
      queryClient.setQueryData<NotificationsResponse>(
        notificationKeys.list(),
        (old) => applyNotificationEvent(old, event),
      )
      if (event.type === "upsert") {
        toastNotification(event.notification)
      }
    }

    const removeListeners = bindEventSourceListeners(
      source,
      {
        snapshot: handleEvent,
        upsert: handleEvent,
        read: handleEvent,
        read_all: handleEvent,
        remove: handleEvent,
        clear: handleEvent,
      },
      refreshFromFetch,
    )

    return () => {
      removeListeners()
      source.close()
    }
  }, [enabled, includeSnapshot, queryClient])
}

function parseNotificationEvent(
  data: string,
  refreshFromFetch: () => void,
): NotificationEvent | null {
  const event = parseNotificationEventPayload(data)
  if (event) return event
  clientLogger.warn("[notifications] Ignoring malformed SSE payload.")
  refreshFromFetch()
  return null
}

function applyNotificationEvent(
  old: NotificationsResponse | undefined,
  event: NotificationEvent,
): NotificationsResponse | undefined {
  switch (event.type) {
    case "snapshot":
      return event.payload
    case "upsert":
      return upsertNotificationInCache(
        old,
        event.notification,
        event.unreadCount,
      )
    case "read":
      return markNotificationReadInCache(
        old,
        event.id,
        event.readAt,
        event.unreadCount,
      )
    case "read_all":
      return markAllNotificationsReadInCache(
        old,
        event.readAt,
        event.unreadCount,
      )
    case "remove":
      return removeNotificationFromCache(old, event.id, event.unreadCount)
    case "clear":
      return clearNotificationsInCache(old, event.unreadCount)
  }
}

function replaceNotificationRow(
  old: NotificationsResponse | undefined,
  row: NotificationRow,
): NotificationsResponse | undefined {
  if (!old) return old
  const wasUnread = old.items.some(
    (item) => item.id === row.id && item.readAt === null,
  )
  return {
    unreadCount: wasUnread ? Math.max(0, old.unreadCount - 1) : old.unreadCount,
    items: old.items.map((item) => (item.id === row.id ? row : item)),
  }
}

function upsertNotificationInCache(
  old: NotificationsResponse | undefined,
  notification: NotificationRow,
  unreadCount: number,
): NotificationsResponse {
  const current = old ?? { items: [], unreadCount }
  const existing = current.items.findIndex(
    (item) => item.id === notification.id,
  )
  if (existing === -1) {
    return { unreadCount, items: [notification, ...current.items] }
  }
  const items = current.items.slice()
  items[existing] = notification
  return { unreadCount, items }
}

function markNotificationReadInCache(
  old: NotificationsResponse | undefined,
  id: string,
  readAt: string,
  unreadCount: number,
): NotificationsResponse | undefined {
  if (!old) return old
  return {
    unreadCount,
    items: old.items.map((item) =>
      item.id === id ? { ...item, readAt } : item,
    ),
  }
}

function markAllNotificationsReadInCache(
  old: NotificationsResponse | undefined,
  readAt: string,
  unreadCount: number,
): NotificationsResponse | undefined {
  if (!old) return old
  return {
    unreadCount,
    items: old.items.map((item) => (item.readAt ? item : { ...item, readAt })),
  }
}

function removeNotificationFromCache(
  old: NotificationsResponse | undefined,
  id: string,
  unreadCount: number,
): NotificationsResponse | undefined {
  if (!old) return old
  return {
    unreadCount,
    items: old.items.filter((item) => item.id !== id),
  }
}

function clearNotificationsInCache(
  old: NotificationsResponse | undefined,
  unreadCount: number,
): NotificationsResponse | undefined {
  return old ? { unreadCount, items: [] } : old
}

function toastNotification(row: NotificationRow) {
  if (row.type !== "clip_upload_failed") return

  const text = notificationText(row)
  toast.error(text.kind, {
    description: text.title,
    id: `notification:${row.id}`,
  })
}

export function notificationText(row: NotificationRow): {
  /** Short label for the notification kind — surfaces above the body. */
  kind: string
  /** Primary, scannable line — the user's name or the clip title. */
  title: string
  /** Optional secondary line, used for context (e.g. comment body excerpt). */
  body: string | null
} {
  const actor = row.actor?.displayUsername || row.actor?.username || "Someone"
  const clipTitle = row.clip?.title ?? "your clip"

  switch (row.type) {
    case "clip_upload_failed":
      return {
        kind: "Upload failed",
        title: clipTitle,
        body: "Check uploads for details.",
      }
    case "new_follower":
      return {
        kind: "New follower",
        title: `${actor} followed you`,
        body: null,
      }
    case "new_video":
      return {
        kind: "New video",
        title: `${actor} uploaded a new video`,
        body: clipTitle,
      }
    case "clip_comment":
      return {
        kind: "New comment",
        title: `${actor} commented on ${clipTitle}`,
        body: row.comment?.body ?? null,
      }
    case "comment_reply":
      return {
        kind: "New reply",
        title: `${actor} replied to your comment`,
        body: row.comment?.body ?? clipTitle,
      }
    case "comment_pinned":
      return {
        kind: "Comment pinned",
        title: `${actor} pinned your comment`,
        body: clipTitle,
      }
    case "comment_liked_by_author":
      return {
        kind: "Comment liked",
        title: `${actor} liked your comment`,
        body: clipTitle,
      }
  }
}

export function notificationHref(row: NotificationRow): string | null {
  if (row.type === "clip_upload_failed") return null
  if (row.type === "new_follower" && row.actor) {
    return userProfileHref(row.actor.username)
  }
  if (row.type === "new_video" && row.clip) {
    return clipHref(row.clip.gameSlug, row.clip.id)
  }
  if (!row.clip) return null
  return clipHref(row.clip.gameSlug, row.clip.id, {
    commentId: row.comment?.id,
  })
}
