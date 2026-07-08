import type {
  NotificationItem,
  NotificationStreamEvent,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

const logger = createLogger("notifications")
const subscribers = new Map<
  string,
  Set<(event: NotificationStreamEvent) => void>
>()

function channel(userId: string): string {
  return `notify:${userId}`
}

export function publishNotification(
  recipientId: string,
  item: NotificationItem,
): void {
  try {
    publish(channel(recipientId), { type: "notification", item })
  } catch (err) {
    logger.warn(`failed to publish notification ${item.id}:`, err)
  }
}

export function subscribeToNotifications(
  userId: string,
  handler: (event: NotificationStreamEvent) => void,
): () => void {
  const ch = channel(userId)
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

function publish(channelName: string, event: NotificationStreamEvent): void {
  for (const handler of subscribers.get(channelName) ?? []) handler(event)
}

export type { NotificationStreamEvent } from "@alloy/contracts"
