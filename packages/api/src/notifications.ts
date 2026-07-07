import type {
  NotificationListResponse,
  NotificationStreamEvent,
} from "@alloy/contracts"

import type { ApiContext } from "./client"
import {
  validateNotificationItem,
  validateNotificationList,
  validateNotificationStreamEvent,
} from "./contract-validators/notifications"
import { parseJsonPayload, readJsonOrThrow } from "./http"
import { readSuccessJson } from "./mutations"
import {
  encodedPathSegment,
  queryParams,
  resolvePublicUrlWithQuery,
} from "./paths"

export type {
  NotificationItem,
  NotificationKind,
  NotificationListResponse,
  NotificationStreamEvent,
} from "@alloy/contracts"

export interface NotificationsApi {
  fetch(params?: {
    cursor?: string | null
    limit?: number
  }): Promise<NotificationListResponse>
  unreadCount(): Promise<number>
  markRead(id: string): Promise<void>
  markAllRead(): Promise<void>
}

export function parseNotificationPayload(
  data: string,
): NotificationStreamEvent | null {
  return parseJsonPayload(data, validateNotificationStreamEvent)
}

export function notificationStreamUrl(origin?: string): string {
  return resolvePublicUrlWithQuery("/api/events/notifications", {}, origin)
}

async function fetchNotifications(
  context: ApiContext,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<NotificationListResponse> {
  const search = new URLSearchParams(queryParams(params))
  return readJsonOrThrow(
    await context.client.request(
      `/api/notifications${search.size > 0 ? `?${search}` : ""}`,
    ),
    validateNotificationList,
  )
}

async function unreadCount(context: ApiContext): Promise<number> {
  const row = await readJsonOrThrow(
    await context.client.request("/api/notifications/unread-count"),
    (value) => {
      const record = value as { count?: unknown } | null
      if (
        !record ||
        typeof record !== "object" ||
        typeof record.count !== "number"
      ) {
        throw new Error("Invalid unread count response")
      }
      return { count: record.count }
    },
  )
  return row.count
}

async function markRead(context: ApiContext, id: string): Promise<void> {
  await readSuccessJson(
    await context.client.request(
      `/api/notifications/${encodedPathSegment(id)}/read`,
      { method: "POST" },
    ),
  )
}

async function markAllRead(context: ApiContext): Promise<void> {
  await readSuccessJson(
    await context.client.request("/api/notifications/read-all", {
      method: "POST",
    }),
  )
}

export function createNotificationsApi(context: ApiContext): NotificationsApi {
  return {
    fetch: (params?: { cursor?: string | null; limit?: number }) =>
      fetchNotifications(context, params),
    unreadCount: () => unreadCount(context),
    markRead: (id: string) => markRead(context, id),
    markAllRead: () => markAllRead(context),
  }
}

export { validateNotificationItem }
