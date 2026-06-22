import { normalizeBlurHash, type QueueClip } from "@alloy/contracts"
import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { gameSlug } from "@alloy/server/games/slug"
import { isoDate } from "@alloy/server/runtime/date"
import { desc, eq } from "drizzle-orm"

import { clipThumbnailVersion } from "./thumbnail-version"

const queueSelectShape = {
  id: clip.id,
  game: clip.game,
  gameId: clip.game_id,
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
  game: string | null
  gameId: string | null
  createdAt: Date
  updatedAt: Date
}): QueueClip {
  const {
    thumbKey,
    thumbBlurHash,
    createdAt,
    updatedAt,
    game,
    gameId,
    ...publicRow
  } = row
  return {
    ...publicRow,
    gameSlug: gameId === null ? null : gameSlug(game?.trim() || "Game"),
    hasThumb: thumbKey !== null,
    thumbVersion: thumbKey ? clipThumbnailVersion(thumbKey) : null,
    thumbBlurHash: normalizeBlurHash(thumbBlurHash),
    gameId,
    createdAt: isoDate(createdAt),
    updatedAt: isoDate(updatedAt),
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
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ? serialize(row) : null
}
