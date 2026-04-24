import type { ApiContext } from "./client"
import type {
  NotificationRow,
  NotificationsResponse,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

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
      const res = await context.request("/api/notifications", {
        query: { limit: String(limit) },
      })
      return readJsonOrThrow<NotificationsResponse>(res)
    },

    async markRead(id: string): Promise<NotificationRow> {
      const res = await context.request(
        `/api/notifications/${encodeURIComponent(id)}/read`,
        { method: "PATCH" }
      )
      return readJsonOrThrow<NotificationRow>(res)
    },

    async markAllRead(): Promise<{ readAt: string; unreadCount: number }> {
      const res = await context.request("/api/notifications/read-all", {
        method: "PATCH",
      })
      return readJsonOrThrow(res)
    },

    async delete(id: string): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.request(
        `/api/notifications/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      )
      return readJsonOrThrow(res)
    },

    async clear(): Promise<{ deleted: true; unreadCount: number }> {
      const res = await context.request("/api/notifications", {
        method: "DELETE",
      })
      return readJsonOrThrow(res)
    },
  }
}
