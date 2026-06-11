import type { QueueEvent } from "@alloy/contracts"
import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { eq } from "drizzle-orm"

import { selectQueueRowById } from "./queue-select"

const subscribers = new Map<string, Set<(event: QueueEvent) => void>>()

function channel(authorId: string): string {
  return `queue:${authorId}`
}

export async function publishClipUpsert(
  authorId: string,
  clipId: string,
): Promise<void> {
  const row = await selectQueueRowById(clipId)
  if (!row) return
  publish(channel(authorId), {
    type: "upsert",
    clip: row,
  } satisfies QueueEvent)
}

export async function publishClipUpsertById(clipId: string): Promise<void> {
  const [owner] = await db
    .select({ authorId: clip.authorId })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!owner) return
  await publishClipUpsert(owner.authorId, clipId)
}

/** Hot-path progress tick. No DB fetch — the client patches in place. */
export function publishClipProgress(
  authorId: string,
  clipId: string,
  encodeProgress: number,
): void {
  publish(channel(authorId), {
    type: "progress",
    id: clipId,
    encodeProgress,
  } satisfies QueueEvent)
}

export function publishClipRemove(authorId: string, clipId: string): void {
  publish(channel(authorId), {
    type: "remove",
    id: clipId,
  } satisfies QueueEvent)
}

/** Subscribe to one author's queue events. Returns an unsubscribe fn. */
export function subscribeToAuthorQueue(
  authorId: string,
  handler: (event: QueueEvent) => void,
): () => void {
  const ch = channel(authorId)
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

function publish(channelName: string, event: QueueEvent): void {
  for (const handler of subscribers.get(channelName) ?? []) handler(event)
}

export type { QueueEvent } from "@alloy/contracts"
