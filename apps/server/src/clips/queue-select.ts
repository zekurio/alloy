import { desc, eq } from "drizzle-orm"

import type { QueueClip } from "@workspace/contracts"
import { clip, game } from "@workspace/db/schema"

import { db } from "../db"
import { isoDate } from "../runtime/date"

const queueSelectShape = {
  id: clip.id,
  gameSlug: game.slug,
  title: clip.title,
  status: clip.status,
  encodeProgress: clip.encodeProgress,
  failureReason: clip.failureReason,
  thumbKey: clip.thumbKey,
  createdAt: clip.createdAt,
} as const

function serialize(row: {
  id: string
  gameSlug: string
  title: string
  status: (typeof clip.$inferSelect)["status"]
  encodeProgress: number
  failureReason: string | null
  thumbKey: string | null
  createdAt: Date
}): QueueClip {
  const { thumbKey, createdAt, ...publicRow } = row
  return {
    ...publicRow,
    hasThumb: thumbKey !== null,
    createdAt: isoDate(createdAt),
  }
}

/** Viewer's 50 most recent clips — the snapshot sent on queue opens and on
 *  SSE (re)connects. Single source of truth for the queue shape. */
export async function selectQueueRowsForAuthor(
  authorId: string,
): Promise<QueueClip[]> {
  const rows = await db
    .select(queueSelectShape)
    .from(clip)
    .innerJoin(game, eq(clip.gameId, game.id))
    .where(eq(clip.authorId, authorId))
    .orderBy(desc(clip.createdAt))
    .limit(50)
  return rows.map((row) => serialize(row))
}

export async function selectQueueRowById(
  clipId: string,
): Promise<QueueClip | null> {
  const [row] = await db
    .select(queueSelectShape)
    .from(clip)
    .innerJoin(game, eq(clip.gameId, game.id))
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ? serialize(row) : null
}
