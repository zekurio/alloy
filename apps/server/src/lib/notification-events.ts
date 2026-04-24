import { EventEmitter } from "node:events"

import type { NotificationEvent, NotificationRow } from "@workspace/contracts"

export type { NotificationEvent } from "@workspace/contracts"

const emitter = new EventEmitter()
emitter.setMaxListeners(0)

function channel(userId: string): string {
  return `notifications:${userId}`
}

export function publishNotificationUpsert(
  recipientId: string,
  notification: NotificationRow,
  unreadCount: number
): void {
  emitter.emit(channel(recipientId), {
    type: "upsert",
    notification,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationRead(
  recipientId: string,
  id: string,
  readAt: string,
  unreadCount: number
): void {
  emitter.emit(channel(recipientId), {
    type: "read",
    id,
    readAt,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationsReadAll(
  recipientId: string,
  readAt: string,
  unreadCount: number
): void {
  emitter.emit(channel(recipientId), {
    type: "read_all",
    readAt,
    unreadCount,
  } satisfies NotificationEvent)
}

export function subscribeToNotifications(
  recipientId: string,
  handler: (event: NotificationEvent) => void
): () => void {
  const ch = channel(recipientId)
  emitter.on(ch, handler)
  return () => emitter.off(ch, handler)
}
