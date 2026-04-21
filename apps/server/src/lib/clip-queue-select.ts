import { desc, eq } from "drizzle-orm"

import { clip, game } from "@workspace/db/schema"

import { db } from "../db"

export interface QueueClipRow {
  id: string
  gameSlug: string
  title: string
  status: (typeof clip.$inferSelect)["status"]
  encodeProgress: number
  failureReason: string | null
  createdAt: string
}

const queueSelectShape = {
  id: clip.id,
  gameSlug: game.slug,
  title: clip.title,
  status: clip.status,
  encodeProgress: clip.encodeProgress,
  failureReason: clip.failureReason,
  createdAt: clip.createdAt,
} as const

function serialize(
  row: {
    id: string
    gameSlug: string
    title: string
    status: (typeof clip.$inferSelect)["status"]
    encodeProgress: number
    failureReason: string | null
    createdAt: Date
  } | null
): QueueClipRow | null {
  if (!row) return null
  return { ...row, createdAt: row.createdAt.toISOString() }
}

/** Viewer's 50 most recent clips — the snapshot sent on queue opens and on
 *  SSE (re)connects. Single source of truth for the queue shape. */
export async function selectQueueRowsForAuthor(
  authorId: string
): Promise<QueueClipRow[]> {
  const rows = await db
    .select(queueSelectShape)
    .from(clip)
    .innerJoin(game, eq(clip.gameId, game.id))
    .where(eq(clip.authorId, authorId))
    .orderBy(desc(clip.createdAt))
    .limit(50)
  return rows.map((row) => serialize(row)!)
}

export async function selectQueueRowById(
  clipId: string
): Promise<QueueClipRow | null> {
  const [row] = await db
    .select(queueSelectShape)
    .from(clip)
    .innerJoin(game, eq(clip.gameId, game.id))
    .where(eq(clip.id, clipId))
    .limit(1)
  return serialize(row ?? null)
}
