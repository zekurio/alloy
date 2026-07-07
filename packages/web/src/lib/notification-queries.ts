import type { NotificationItem, NotificationListResponse } from "@alloy/api"
import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import { api } from "./api"

export const notificationKeys = {
  all: ["notifications"] as const,
  list: () => [...notificationKeys.all, "list"] as const,
  unreadCount: () => [...notificationKeys.all, "unread-count"] as const,
}

type NotificationListData =
  | InfiniteData<NotificationListResponse, string | null>
  | undefined

export function notificationsInfiniteQueryOptions(limit = 30) {
  return infiniteQueryOptions({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) =>
      api.notifications.fetch({ cursor: pageParam, limit }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function unreadCountQueryOptions() {
  return queryOptions({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => api.notifications.unreadCount(),
  })
}

export function prependNotification(
  data: NotificationListData,
  item: NotificationItem,
): NotificationListData {
  if (!data) {
    return {
      pages: [{ items: [item], nextCursor: null, unreadCount: 1 }],
      pageParams: [null],
    }
  }
  const [first, ...rest] = data.pages
  return {
    ...data,
    pages: first
      ? [{ ...first, items: [item, ...first.items] }, ...rest]
      : [{ items: [item], nextCursor: null, unreadCount: 1 }],
  }
}

function markNotificationRead(
  data: NotificationListData,
  id: string,
): NotificationListData {
  if (!data) return data
  const readAt = new Date().toISOString()
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === id && item.readAt === null ? { ...item, readAt } : item,
      ),
    })),
  }
}

export function isNotificationUnread(
  data: NotificationListData,
  id: string,
): boolean {
  return (
    data?.pages.some((page) =>
      page.items.some((item) => item.id === id && item.readAt === null),
    ) ?? false
  )
}

function markAllNotificationsRead(
  data: NotificationListData,
): NotificationListData {
  if (!data) return data
  const readAt = new Date().toISOString()
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.readAt === null ? { ...item, readAt } : item,
      ),
    })),
  }
}

export function useMarkNotificationReadMutation() {
  const qc = useQueryClient()
  return useMutation<string, Error, string>({
    mutationFn: (id: string) => api.notifications.markRead(id).then(() => id),
    onSuccess: (id) => {
      const wasUnread = isNotificationUnread(
        qc.getQueryData<NotificationListData>(notificationKeys.list()),
        id,
      )
      if (wasUnread) {
        qc.setQueryData<number>(notificationKeys.unreadCount(), (old) =>
          Math.max(0, (old ?? 0) - 1),
        )
      }
      qc.setQueryData<NotificationListData>(notificationKeys.list(), (old) =>
        markNotificationRead(old, id),
      )
    },
  })
}

export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      qc.setQueryData(notificationKeys.unreadCount(), 0)
      qc.setQueryData<NotificationListData>(notificationKeys.list(), (old) =>
        markAllNotificationsRead(old),
      )
    },
  })
}
