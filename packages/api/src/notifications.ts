import type { ApiContext } from "./client"
import type {
  NotificationRow,
  NotificationsResponse,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import {
  validateBooleanFlag,
  validateNotificationsResponse,
  validateObject,
} from "./contract-validators"

export type {
  NotificationClipRef,
  NotificationCommentRef,
  NotificationEvent,
  NotificationRow,
  NotificationsResponse,
  NotificationType,
} from "@workspace/contracts"

export function createNotificationsApi(context: ApiContext) {
  return {
    async fetch(limit = 20): Promise<NotificationsResponse> {
      const res = await context.rpc.api.notifications.$get({
        query: { limit: String(limit) },
      })
      return readJsonOrThrow(res, validateNotificationsResponse)
    },

    async markRead(id: string): Promise<NotificationRow> {
      const res = await context.rpc.api.notifications[":id"].read.$patch({
        param: { id },
      })
      return readJsonOrThrow(res, (value) =>
        validateObject<NotificationRow>(value, "notification")
      )
    },

    async markAllRead(): Promise<{ readAt: string; unreadCount: number }> {
      const res = await context.rpc.api.notifications["read-all"].$patch()
      return readJsonOrThrow(res, (value) =>
        validateObject<{ readAt: string; unreadCount: number }>(
          value,
          "mark all notifications read"
        )
      )
    },

    async delete(id: string): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.rpc.api.notifications[":id"].$delete({
        param: { id },
      })
      const response = await readJsonOrThrow<unknown>(res)
      validateBooleanFlag(response, "deleted", true)
      return validateObject<{ deleted: true; unreadCount: number }>(
        response,
        "delete notification"
      )
    },

    async clear(): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.rpc.api.notifications.$delete()
      const response = await readJsonOrThrow<unknown>(res)
      validateBooleanFlag(response, "deleted", true)
      return validateObject<{ deleted: true; unreadCount: number }>(
        response,
        "clear notifications"
      )
    },
  }
}
