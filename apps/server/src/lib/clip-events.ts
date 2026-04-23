import { EventEmitter } from "node:events"

import { eq } from "drizzle-orm"

import type { QueueEvent } from "@workspace/db/contracts"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import {
  selectQueueRowById,
} from "./clip-queue-select"

const emitter = new EventEmitter()
// Subscribers are one per open SSE connection — cap removed so we don't
// trip Node's default 10-listener warning on a moderately busy instance.
emitter.setMaxListeners(0)

function channel(authorId: string): string {
  return `queue:${authorId}`
}

export async function publishClipUpsert(
  authorId: string,
  clipId: string
): Promise<void> {
  const row = await selectQueueRowById(clipId)
  if (!row) return
  emitter.emit(channel(authorId), {
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
  encodeProgress: number
): void {
  emitter.emit(channel(authorId), {
    type: "progress",
    id: clipId,
    encodeProgress,
  } satisfies QueueEvent)
}

export function publishClipRemove(authorId: string, clipId: string): void {
  emitter.emit(channel(authorId), {
    type: "remove",
    id: clipId,
  } satisfies QueueEvent)
}

/** Subscribe to one author's queue events. Returns an unsubscribe fn. */
export function subscribeToAuthorQueue(
  authorId: string,
  handler: (event: QueueEvent) => void
): () => void {
  const ch = channel(authorId)
  emitter.on(ch, handler)
  return () => emitter.off(ch, handler)
}

export type { QueueEvent } from "@workspace/db/contracts"
