import type { QueueClip } from "@alloy/contracts"
import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { gameSlugWithId } from "@alloy/server/games/slug"
import { isoDate } from "@alloy/server/runtime/date"
import { desc, eq } from "drizzle-orm"

const queueSelectShape = {
  id: clip.id,
  game: clip.game,
  igdbId: clip.igdbId,
  title: clip.title,
  status: clip.status,
  encodeProgress: clip.encodeProgress,
  failureReason: clip.failureReason,
  thumbKey: clip.thumbKey,
  thumbBlurHash: clip.thumbBlurHash,
  createdAt: clip.createdAt,
  updatedAt: clip.updatedAt,
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
  igdbId: number | null
  createdAt: Date
  updatedAt: Date
}): QueueClip {
  const {
    thumbKey,
    thumbBlurHash,
    createdAt,
    updatedAt,
    game,
    igdbId,
    ...publicRow
  } = row
  return {
    ...publicRow,
    gameSlug:
      igdbId === null
        ? null
        : gameSlugWithId(game?.trim() || `Game ${igdbId}`, igdbId),
    hasThumb: thumbKey !== null,
    thumbBlurHash,
    igdbId,
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
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ? serialize(row) : null
}
