import type { NotificationEvent, NotificationRow } from "@workspace/contracts"

export type { NotificationEvent } from "@workspace/contracts"

const subscribers = new Map<string, Set<(event: NotificationEvent) => void>>()

function channel(userId: string): string {
  return `notifications:${userId}`
}

export function publishNotificationUpsert(
  recipientId: string,
  notification: NotificationRow,
  unreadCount: number,
): void {
  publish(channel(recipientId), {
    type: "upsert",
    notification,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationRead(
  recipientId: string,
  id: string,
  readAt: string,
  unreadCount: number,
): void {
  publish(channel(recipientId), {
    type: "read",
    id,
    readAt,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationsReadAll(
  recipientId: string,
  readAt: string,
  unreadCount: number,
): void {
  publish(channel(recipientId), {
    type: "read_all",
    readAt,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationRemove(
  recipientId: string,
  id: string,
  unreadCount: number,
): void {
  publish(channel(recipientId), {
    type: "remove",
    id,
    unreadCount,
  } satisfies NotificationEvent)
}

export function publishNotificationsClear(
  recipientId: string,
  unreadCount: number,
): void {
  publish(channel(recipientId), {
    type: "clear",
    unreadCount,
  } satisfies NotificationEvent)
}

export function subscribeToNotifications(
  recipientId: string,
  handler: (event: NotificationEvent) => void,
): () => void {
  const ch = channel(recipientId)
  let channelSubscribers = subscribers.get(ch)
  if (!channelSubscribers) {
    channelSubscribers = new Set()
    subscribers.set(ch, channelSubscribers)
  }
  channelSubscribers.add(handler)
  return () => {
    channelSubscribers.delete(handler)
    if (channelSubscribers.size === 0) subscribers.delete(ch)
  }
}

function publish(channelName: string, event: NotificationEvent): void {
  for (const handler of subscribers.get(channelName) ?? []) handler(event)
}
