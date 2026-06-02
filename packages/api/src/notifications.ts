import type { ApiContext } from "./client"
import type {
  NotificationEvent,
  NotificationRow,
  NotificationsResponse,
} from "@workspace/contracts"
import { NOTIFICATIONS_DEFAULT_LIMIT } from "@workspace/contracts"
import { parseJsonPayload, readJsonOrThrow } from "./http"
import { resolvePublicUrlWithQuery } from "./paths"
import {
  validateNotificationEvent,
  validateNotificationRow,
  validateNotificationsDeleteResponse,
  validateNotificationsReadAllResponse,
  validateNotificationsResponse,
} from "./contract-validators"

export type {
  NotificationClipRef,
  NotificationCommentRef,
  NotificationEvent,
  NotificationRow,
  NotificationsResponse,
  NotificationType,
} from "@workspace/contracts"
export {
  NOTIFICATIONS_DEFAULT_LIMIT,
  NOTIFICATIONS_MAX_LIMIT,
} from "@workspace/contracts"

export function notificationStreamUrl({
  includeSnapshot = true,
  origin,
}: {
  includeSnapshot?: boolean
  origin?: string
} = {}): string {
  return resolvePublicUrlWithQuery(
    "/api/events/notifications",
    { snapshot: includeSnapshot ? undefined : "false" },
    origin
  )
}

export function parseNotificationEventPayload(
  data: string
): NotificationEvent | null {
  return parseJsonPayload(data, validateNotificationEvent)
}

export function createNotificationsApi(context: ApiContext) {
  return {
    async fetch(
      limit = NOTIFICATIONS_DEFAULT_LIMIT
    ): Promise<NotificationsResponse> {
      const res = await context.rpc.api.notifications.$get({
        query: { limit: String(limit) },
      })
      return readJsonOrThrow(res, validateNotificationsResponse)
    },

    async markRead(id: string): Promise<NotificationRow> {
      const res = await context.rpc.api.notifications[":id"].read.$patch({
        param: { id },
      })
      return readJsonOrThrow(res, validateNotificationRow)
    },

    async markAllRead(): Promise<{ readAt: string; unreadCount: number }> {
      const res = await context.rpc.api.notifications["read-all"].$patch()
      return readJsonOrThrow(res, validateNotificationsReadAllResponse)
    },

    async delete(id: string): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.rpc.api.notifications[":id"].$delete({
        param: { id },
      })
      return readJsonOrThrow(res, validateNotificationsDeleteResponse)
    },

    async clear(): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.rpc.api.notifications.$delete()
      return readJsonOrThrow(res, validateNotificationsDeleteResponse)
    },
  }
}
