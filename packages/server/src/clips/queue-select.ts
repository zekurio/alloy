import { normalizeBlurHash, type QueueClip } from "@alloy/contracts"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { isoDate } from "@alloy/server/runtime/date"
import { desc, eq } from "drizzle-orm"

import { clipThumbnailVersion } from "./thumbnail-version"

const queueSelectShape = {
  id: clip.id,
  gameId: clip.game_id,
  gameSlug: game.slug,
  title: clip.title,
  status: clip.status,
  encodeProgress: clip.encode_progress,
  failureReason: clip.failure_reason,
  thumbKey: clip.thumb_key,
  thumbBlurHash: clip.thumb_blur_hash,
  createdAt: clip.created_at,
  updatedAt: clip.updated_at,
} as const

function serialize(row: {
  id: string
  title: string
  status: (typeof clip.$inferSelect)["status"]
  encodeProgress: number
  failureReason: string | null
  thumbKey: string | null
  thumbBlurHash: string | null
  gameId: string | null
  gameSlug: string | null
  createdAt: Date
  updatedAt: Date
}): QueueClip {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    encodeProgress: row.encodeProgress,
    failureReason: row.failureReason,
    gameSlug: row.gameSlug,
    hasThumb: row.thumbKey !== null,
    thumbVersion: row.thumbKey ? clipThumbnailVersion(row.thumbKey) : null,
    thumbBlurHash: normalizeBlurHash(row.thumbBlurHash),
    gameId: row.gameId,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
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
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(eq(clip.author_id, authorId))
    .orderBy(desc(clip.created_at))
    .limit(50)
  return rows.map((row) => serialize(row))
}

export async function selectQueueRowById(
  clipId: string,
): Promise<QueueClip | null> {
  const [row] = await db
    .select(queueSelectShape)
    .from(clip)
    .leftJoin(game, eq(clip.game_id, game.id))
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ? serialize(row) : null
}
